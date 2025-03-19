/**
 * Admin API Routes
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
const {v4: uuidv4} = require("uuid");
const crypto = require("crypto");

// Make sure Firebase Admin is properly initialized before accessing Firestore
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();

// Register Partner (Admin only)
router.post("/partners/register", async (req, res) => {
  try {
    // Fix for newer versions of Busboy
    const busboy = Busboy({ headers: req.headers });
    const tmpdir = os.tmpdir();
    
    // Object to store form fields
    const formData = {};
    
    // File details
    let logoFile = null;
    let logoFileName = null;
    const fileWrites = [];

    // Handle form fields
    busboy.on("field", (fieldname, val) => {
      formData[fieldname] = val;
      logger.debug(`Form field: ${fieldname} = ${val}`);
    });

    // Handle file upload (logo)
    busboy.on("file", (fieldname, file, fileInfo) => {
      // In newer Busboy versions, the file metadata is in a fileInfo object
      const filename = fileInfo ? fileInfo.filename : '';
      const mimetype = fileInfo ? fileInfo.mimeType : '';
      
      if (fieldname !== "logo" || !filename) {
        file.resume();
        return;
      }

      // Validate file is an image
      if (!mimetype || !mimetype.startsWith("image/")) {
        res.status(400).json({
          success: false,
          error: "Logo must be an image file",
        });
        return;
      }

      // Create a unique filename
      const extension = path.extname(filename);
      logoFileName = `${Date.now()}_${path.basename(filename, extension)}${extension}`;
      
      // Create temporary file path
      const filepath = path.join(tmpdir, logoFileName);
      logoFile = filepath;
      
      logger.info(`Processing file upload: ${logoFileName}`);
      
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

    // Process form when all uploads are complete
    busboy.on("finish", async () => {
      try {
        // Wait for all files to be written
        await Promise.all(fileWrites);
        
        // Validate required fields
        const requiredFields = ["name", "contactEmail", "contactName"];
        for (const field of requiredFields) {
          if (!formData[field]) {
            res.status(400).json({
              success: false,
              error: `Missing required field: ${field}`,
            });
            return;
          }
        }
        
        // Generate slug from name if not provided
        let slug = formData.slug;
        if (!slug) {
          slug = formData.name.toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")  // Replace non-alphanumeric with hyphens
            .replace(/^-|-$/g, "")        // Remove leading/trailing hyphens
            .substring(0, 50);            // Limit length
        }
        
        logger.info(`Registering partner with slug: ${slug}`);
        
        // Check if slug is already taken
        const existingPartner = await db.collection("partners").doc(slug).get();
        if (existingPartner.exists) {
          res.status(400).json({
            success: false,
            error: "Partner slug already exists. Please choose a different name or provide a custom slug.",
          });
          return;
        }
        
        // Generate a secure API key
        const apiKey = crypto.randomBytes(16).toString("hex");
        
        // Upload logo to Firebase Storage
        let logoUrl = null;
        if (logoFile) {
          try {
            const storagePath = `partner-logos/${slug}/${logoFileName}`;
            
            // 1. Upload the file
            await bucket.upload(logoFile, {
              destination: storagePath,
              metadata: {
                contentType: "image/jpeg", // Set appropriate content type
              }
            });
            
            // 2. Generate a Firebase Storage download URL in the correct format
            // This format matches what you see in the Firebase console
            logoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media`;
            
            logger.info(`Logo uploaded with URL: ${logoUrl}`);
            
            // Delete temp file
            fs.unlinkSync(logoFile);
          } catch (error) {
            logger.error("Error uploading logo:", error);
            // Continue without logo if there's an error
          }
        }
        
        // Create partner document
        const partnerData = {
          name: formData.name,
          slug: slug,
          status: formData.status || "active",
          apiKey: apiKey,
          logoUrl: logoUrl,
          partnershipStartDate: new Date(),
          defaultSubscriptionDuration: parseInt(formData.defaultDuration || "90"),
          
          // Contact information
          contactEmail: formData.contactEmail,
          contactName: formData.contactName,
          contactPhone: formData.contactPhone || null,
          website: formData.website || null,
          
          // Description
          description: formData.description || null,
          
          // Analytics
          totalSubscriptions: 0,
          lastImportDate: null,
          
          // Timestamps
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        
        // Save to Firestore
        await db.collection("partners").doc(slug).set(partnerData);
        logger.info(`Partner ${slug} registered successfully`);
        
        // Send success response (don't include the API key in the response object)
        const responseData = {...partnerData};
        delete responseData.apiKey; // Remove API key from response for security
        
        res.status(201).json({
          success: true,
          message: "Partner registered successfully",
          partner: {
            ...responseData,
            id: slug,
            apiKey: apiKey, // Include API key once in the response for the admin to save
          },
        });
        
      } catch (error) {
        logger.error("Error registering partner:", error);
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

module.exports = router;