/**
 * Partner API Routes
 */

const express = require("express");
const router = express.Router();
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue } = require('firebase-admin/firestore');
const Busboy = require("busboy");
const path = require("path");
const os = require("os");
const fs = require("fs");
const Papa = require("papaparse");

const { authenticatePartner, isValidEmail } = require("../middleware/auth");

// Make sure Firebase Admin is properly initialized before accessing Firestore
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Process CSV subscriptions (Partner authenticated)
router.post("/:partnerSlug/process-csv", authenticatePartner, async (req, res) => {
  logger.info(`Processing CSV for partner: ${req.partnerSlug}`);

  try {
    // Create a Busboy instance to parse form data
    const busboy = Busboy({ headers: req.headers });
    const tmpdir = os.tmpdir();
    const uploads = {};
    const fileWrites = [];

    // Handle file upload
    busboy.on("file", (fieldname, file, fileInfo) => {
      // In newer Busboy versions, the file metadata is in a fileInfo object
      const filename = fileInfo ? fileInfo.filename : '';
      const mimetype = fileInfo ? fileInfo.mimeType : '';
      
      if (fieldname !== "csvFile") {
        logger.warn(`Invalid field name, expected "csvFile" but got: ${fieldname}`);
        res.status(400).json({ 
          success: false, 
          error: 'Invalid file field name, expected "csvFile"',
        });
        return;
      }

      // Validate file is a CSV
      if (mimetype !== "text/csv" && !filename.endsWith(".csv")) {
        logger.warn(`Invalid file type: ${mimetype}, filename: ${filename}`);
        res.status(400).json({ 
          success: false, 
          error: "File must be a CSV",
        });
        return;
      }

      logger.info(`Processing CSV file: ${filename}`);
      
      // Create a temporary file
      const filepath = path.join(tmpdir, filename);
      uploads[fieldname] = filepath;
      
      // Create write stream
      const writeStream = fs.createWriteStream(filepath);
      file.pipe(writeStream);
      
      // Add promise to array
      const promise = new Promise((resolve, reject) => {
        file.on("end", () => {
          writeStream.end();
        });
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
      fileWrites.push(promise);
    });

    // Process uploaded files when finish
    busboy.on("finish", async () => {
      try {
        // Wait for all files to be written
        await Promise.all(fileWrites);
        
        const results = {
          totalProcessed: 0,
          successCount: 0,
          errorCount: 0,
          errors: [],
          subscriptions: [],
        };
        
        // Process the CSV file
        if (uploads.csvFile) {
          const csvPath = uploads.csvFile;
          const fileContent = fs.readFileSync(csvPath, "utf8");
          
          // Parse CSV
          Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
            complete: async (parseResult) => {
              logger.info(`Parsed ${parseResult.data.length} rows from CSV`);
              
              results.totalProcessed = parseResult.data.length;
              
              // Batch operations for Firestore
              const batch = db.batch();
              
              // Process each row
              for (const row of parseResult.data) {
                try {
                  // Validate row data
                  if (!row.customerEmail) {
                    results.errorCount++;
                    results.errors.push({
                      row,
                      error: "Missing customerEmail",
                    });
                    continue;
                  }
                  
                  // Normalize and validate email
                  const email = row.customerEmail.trim().toLowerCase();
                  if (!isValidEmail(email)) {
                    results.errorCount++;
                    results.errors.push({
                      row,
                      error: "Invalid email format",
                    });
                    continue;
                  }
                  
                  // Set default duration if not provided or invalid
                  let duration = req.partner.defaultSubscriptionDuration || 90; // Use partner default or 90 days
                  if (row.duration && !isNaN(parseInt(row.duration))) {
                    duration = parseInt(row.duration);
                  }
                  
                  // Set default status to active if not provided
                  const status = row.status ? row.status.toLowerCase() : "active";
                  if (!["active", "inactive", "pending"].includes(status)) {
                    results.errorCount++;
                    results.errors.push({
                      row,
                      error: "Invalid status, must be active, inactive, or pending",
                    });
                    continue;
                  }
                  
                  // Calculate subscription start and end dates
                  const startDate = new Date();
                  const endDate = new Date();
                  endDate.setDate(endDate.getDate() + duration);
                  
                  // Create subscription document
                  const subscriptionId = `${req.partnerSlug}_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
                  const subscriptionRef = db.collection("subscriptions").doc(subscriptionId);
                  
                  batch.set(subscriptionRef, {
                    customerEmail: email,
                    partnerId: req.partnerSlug,
                    duration: duration,
                    status: status,
                    startDate: startDate,
                    endDate: endDate,
                    createdAt: FieldValue.serverTimestamp(),
                    source: "csv_import",
                  });
                  
                  results.successCount++;
                  results.subscriptions.push({
                    id: subscriptionId,
                    email,
                    duration,
                    status,
                    startDate,
                    endDate,
                  });
                  
                } catch (error) {
                  logger.error(`Error processing row: ${JSON.stringify(row)}`, error);
                  results.errorCount++;
                  results.errors.push({
                    row,
                    error: error.message,
                  });
                }
              }
              
              if (results.successCount > 0) {
                // Commit batch write
                await batch.commit();
                logger.info(`Successfully processed ${results.successCount} subscriptions`);
                
                // Update partner analytics
                await db.collection("partners").doc(req.partnerSlug).update({
                  totalSubscriptions: FieldValue.increment(results.successCount),
                  lastImportDate: FieldValue.serverTimestamp(),
                });
              }
              
              // Add import log
              await db.collection("importLogs").add({
                partnerId: req.partnerSlug,
                importDate: new Date(),
                totalProcessed: results.totalProcessed,
                successCount: results.successCount,
                errorCount: results.errorCount,
                errors: results.errors.slice(0, 20), // Limit the number of errors stored
                createdAt: FieldValue.serverTimestamp(),
              });
              
              // Clean up temporary files
              Object.values(uploads).forEach(filePath => {
                fs.unlinkSync(filePath);
              });
              
              // Send response
              res.status(200).json({
                success: true,
                partnerId: req.partnerSlug,
                results,
              });
            },
            error: (error) => {
              logger.error(`Error parsing CSV: ${error}`);
              res.status(400).json({
                success: false,
                error: `Error parsing CSV: ${error}`,
              });
            },
          });
        } else {
          logger.warn("No CSV file uploaded");
          res.status(400).json({
            success: false,
            error: "No CSV file uploaded",
          });
        }
      } catch (error) {
        logger.error("Error processing CSV file", error);
        res.status(500).json({
          success: false,
          error: `Server error: ${error.message}`,
        });
      }
    });

    // Handle any errors
    busboy.on("error", (error) => {
      logger.error("Error processing form", error);
      res.status(500).json({
        success: false,
        error: `Server error: ${error.message}`,
      });
    });

    // Start processing the request
    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      req.pipe(busboy);
    }

  } catch (error) {
    logger.error("Unexpected error:", error);
    res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`,
    });
  }
});

// Get all active partners (public)
router.get("/", async (req, res) => {
  try {
    const partnersSnapshot = await db.collection("partners")
      .where("status", "==", "active")
      .get();
    
    const partners = partnersSnapshot.docs.map(doc => {
      const data = doc.data();
      
      // Return only public information (exclude sensitive data)
      return {
        id: doc.id,
        name: data.name,
        slug: data.slug,
        description: data.description,
        logoUrl: data.logoUrl,
        website: data.website,
      };
    });
    
    res.status(200).json({
      success: true,
      partners,
    });
    
  } catch (error) {
    logger.error("Error fetching partners:", error);
    res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`,
    });
  }
});

// Get a specific partner (public, but only active partners)
router.get("/:slug", async (req, res) => {
  try {
    const partnerDoc = await db.collection("partners").doc(req.params.slug).get();
    
    if (!partnerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Partner not found",
      });
    }
    
    const partnerData = partnerDoc.data();
    
    // Only return active partners
    if (partnerData.status !== "active") {
      return res.status(404).json({
        success: false,
        error: "Partner not found",
      });
    }
    
    // Return only public information
    const publicData = {
      id: partnerDoc.id,
      name: partnerData.name,
      slug: partnerData.slug,
      description: partnerData.description,
      logoUrl: partnerData.logoUrl,
      website: partnerData.website,
    };
    
    res.status(200).json({
      success: true,
      partner: publicData,
    });
    
  } catch (error) {
    logger.error("Error fetching partner:", error);
    res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`,
    });
  }
});

module.exports = router;