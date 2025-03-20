/* eslint-disable */
/**
 * Admin API Routes
 */

const express = require("express");
const router = express.Router();
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {FieldValue} = require("firebase-admin/firestore");
const Busboy = require("busboy");
const path = require("path");
const os = require("os");
const fs = require("fs");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

// Make sure Firebase Admin is properly initialized before accessing Firestore
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();

// Register Partner (Admin only)
router.post("/register", async (req, res) => {
  try {
    // Fix for newer versions of Busboy
    const busboy = Busboy({headers: req.headers});
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
      const filename = fileInfo ? fileInfo.filename : "";
      const mimetype = fileInfo ? fileInfo.mimeType : "";

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
              .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
              .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
              .substring(0, 50); // Limit length
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
              },
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

// Create a pending subscription (for testing)
router.post("/create-pending-subscription", async (req, res) => {
  try {
    const {email, partnerId, duration, notes} = req.body;

    if (!email || !partnerId) {
      return res.status(400).json({
        success: false,
        error: "Email and partnerId are required",
      });
    }

    // Normalize email
    const customerEmail = email.trim().toLowerCase();

    // Check if partner exists
    const partnerDoc = await db.collection("partners").doc(partnerId).get();
    if (!partnerDoc.exists) {
      return res.status(400).json({
        success: false,
        error: `Partner with ID ${partnerId} not found`,
      });
    }

    // Generate subscription ID
    const subscriptionId = `${partnerId}_${customerEmail.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;

    // Create subscription document
    const subscriptionData = {
      customerEmail,
      partnerId,
      status: "pending",
      duration: duration ? parseInt(duration) : partnerDoc.data().defaultSubscriptionDuration || 90,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      notes: notes || null,
      source: "admin_test",
    };

    // Save to Firestore
    await db.collection("subscriptions").doc(subscriptionId).set(subscriptionData);

    // Add to activity log
    await db.collection("activityLogs").add({
      partnerId,
      subscriptionId,
      customerEmail,
      action: "subscription_created",
      adminAction: true,
      performedBy: "admin",
      timestamp: FieldValue.serverTimestamp(),
      notes: "Test subscription created",
    });

    res.status(201).json({
      success: true,
      message: "Pending subscription created successfully",
      subscription: {
        id: subscriptionId,
        ...subscriptionData,
      },
    });
  } catch (error) {
    logger.error(`Error creating pending subscription: ${error.message}`, error);
    res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`,
    });
  }
});

router.post("/process-pending-subscriptions", async (req, res) => {
  try {
    logger.info(`Admin processing pending subscriptions`);

    // Validate request body
    const {subscriptions} = req.body;

    if (!subscriptions || !Array.isArray(subscriptions) || subscriptions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Request must include an array of subscriptions to process",
      });
    }

    // Validate each subscription in the array
    for (const sub of subscriptions) {
      if (!sub.email || !sub.action || !["approve", "decline"].includes(sub.action)) {
        return res.status(400).json({
          success: false,
          error: "Each subscription must have an 'email' and an 'action' of either 'approve' or 'decline'",
        });
      }

      // If approving, duration should be a positive number if provided
      if (sub.action === "approve" && sub.duration !== undefined) {
        const duration = parseInt(sub.duration);
        if (isNaN(duration) || duration <= 0) {
          return res.status(400).json({
            success: false,
            error: "Duration must be a positive number",
          });
        }
      }
    }

    const results = {
      processed: 0,
      approved: 0,
      declined: 0,
      userUpdated: 0,
      pendingActivation: 0, // Track pending activations
      errors: [],
      subscriptions: [],
    };

    // Process each subscription
    const batch = db.batch();
    const now = new Date();

    for (const sub of subscriptions) {
      try {
        // Normalize email
        const email = sub.email.trim().toLowerCase();

        // Find pending subscription for this email
        const pendingSubscriptionsSnapshot = await db.collection("subscriptions")
            .where("customerEmail", "==", email)
            .where("status", "==", "pending")
            .get();

        if (pendingSubscriptionsSnapshot.empty) {
          results.errors.push({
            email,
            error: "No pending subscription found for this email",
          });
          continue;
        }

        // Check if user exists in users table
        const usersSnapshot = await db.collection("users")
            .where("email", "==", email)
            .limit(1)
            .get();

        const userExists = !usersSnapshot.empty;
        let userId = null;

        if (userExists) {
          userId = usersSnapshot.docs[0].id;
          logger.info(`Found user with ID ${userId} for email ${email}`);
        } else {
          logger.info(`No user found for email ${email}`);
        }

        // Process all pending subscriptions for this email
        for (const doc of pendingSubscriptionsSnapshot.docs) {
          const subscriptionData = doc.data();
          const subscriptionId = doc.id;
          const partnerId = subscriptionData.partnerId;

          // Get partner data for default duration
          const partnerDoc = await db.collection("partners").doc(partnerId).get();
          if (!partnerDoc.exists) {
            results.errors.push({
              email,
              error: `Partner ${partnerId} not found`,
            });
            continue;
          }
          const partnerData = partnerDoc.data();

          // Process based on action
          if (sub.action === "approve") {
            // Use provided duration or default
            const duration = sub.duration !== undefined ?
                parseInt(sub.duration) :
                (subscriptionData.duration || partnerData.defaultSubscriptionDuration || 90);

            const endDate = new Date();
            endDate.setDate(now.getDate() + duration);

            // Update subscription to active
            batch.update(doc.ref, {
              status: "active",
              startDate: now,
              endDate: endDate,
              duration: duration, // Store the final duration used
              updatedAt: FieldValue.serverTimestamp(),
              approvedAt: FieldValue.serverTimestamp(),
              notes: sub.notes || subscriptionData.notes || null,
              userUpdated: userExists,
            });

            // If user exists, update their premium status
            if (userExists) {
              const userRef = db.collection("users").doc(userId);
              batch.update(userRef, {
                premium_user: true,
                mart_premium_user: true,
                premiumUpdatedAt: FieldValue.serverTimestamp(),
                premiumExpiryDate: endDate,
                premiumSource: `partner_${partnerId}`,
                updatedAt: FieldValue.serverTimestamp(),
              });
              results.userUpdated++;
            } else {
              // User doesn't exist yet - store in pending_activations
              const pendingActivationId = `${email.replace(/[^a-z0-9]/g, "_")}_${Date.now()}`;
              const pendingActivationRef = db.collection("pending_activations").doc(pendingActivationId);

              batch.set(pendingActivationRef, {
                email: email,
                partnerId: partnerId,
                subscriptionId: subscriptionId,
                duration: duration,
                approvedAt: now,
                expiresAt: endDate,
                activationStatus: "waiting_for_user",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                notes: sub.notes || null,
                checkCount: 0,
                lastChecked: null,
              });

              results.pendingActivation++;
            }

            results.approved++;
            results.subscriptions.push({
              id: subscriptionId,
              email,
              partnerId,
              action: "approve",
              duration,
              startDate: now,
              endDate,
              userUpdated: userExists,
              pendingActivation: !userExists,
            });

            // Add to activity log
            const logRef = db.collection("activityLogs").doc();
            batch.set(logRef, {
              partnerId,
              subscriptionId,
              customerEmail: email,
              userId: userExists ? userId : null,
              action: "subscription_approved",

              adminAction: true,
              timestamp: FieldValue.serverTimestamp(),
              notes: sub.notes || null,
              userUpdated: userExists,
              pendingActivation: !userExists,
            });

            // Update partner total subscriptions
            const partnerRef = db.collection("partners").doc(partnerId);
            batch.update(partnerRef, {
              totalSubscriptions: FieldValue.increment(1),
              lastActivityDate: FieldValue.serverTimestamp(),
            });
          } else if (sub.action === "decline") {
            // Update subscription to declined
            batch.update(doc.ref, {
              status: "declined",
              updatedAt: FieldValue.serverTimestamp(),
              declinedAt: FieldValue.serverTimestamp(),
              notes: sub.notes || subscriptionData.notes || null,
            });

            results.declined++;
            results.subscriptions.push({
              id: subscriptionId,
              email,
              partnerId,
              action: "decline",
              reason: sub.notes || null,
              userExists,
            });

            // Add to activity log
            const logRef = db.collection("activityLogs").doc();
            batch.set(logRef, {
              partnerId,
              subscriptionId,
              customerEmail: email,
              userId: userExists ? userId : null,
              action: "subscription_declined",
              adminAction: true,
              timestamp: FieldValue.serverTimestamp(),
              notes: sub.notes || null,
            });
          }

          results.processed++;
        }
      } catch (error) {
        logger.error(`Error processing subscription for email ${sub.email}: ${error.message}`, error);
        results.errors.push({
          email: sub.email,
          error: error.message,
        });
      }
    }

    // Commit the batch if there's at least one change
    if (results.processed > 0) {
      await batch.commit();
      logger.info(`Processed ${results.processed} subscriptions (${results.approved} approved, ${results.declined} declined, ${results.userUpdated} users updated, ${results.pendingActivation} pending activations)`);

      // Optionally send emails (would be implemented with your email service)
      try {
        // Send emails to users
        for (const sub of results.subscriptions) {
          // You would implement this with your email service
          await sendSubscriptionEmail(sub.email, sub.partnerId, sub.action, sub);
        }
      } catch (emailError) {
        logger.error(`Error sending notification emails: ${emailError.message}`, emailError);
        // Continue even if emails fail
      }
    }

    // Return results
    res.status(200).json({
      success: true,
      results,
    });
  } catch (error) {
    logger.error(`Error processing pending subscriptions: ${error.message}`, error);
    res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`,
    });
  }
});

/**
 * Sends a subscription email to a user based on their activation status
 *
 * @param {string} email - Recipient's email address
 * @param {string} partnerId - ID of the partner providing the subscription
 * @param {string} action - Subscription action (only 'approve' sends an email)
 * @param {Object} data - Subscription details including duration
 * @return {Promise<void>} Resolves after sending email or skipping
 * @throws {Error} Throws an error if email sending fails
 */
async function sendSubscriptionEmail(email, partnerId, action, data) {
  // Only send email for approved subscriptions
  if (action !== "approve") {
    logger.info(`Skipping email for declined subscription for ${email}`);
    return;
  }

  // Get partner info for email
  const partnerDoc = await db.collection("partners").doc(partnerId).get();
  if (!partnerDoc.exists) {
    logger.error(`Cannot send email: Partner ${partnerId} not found`);
    return;
  }


  // Check if user exists in users table
  const usersSnapshot = await db.collection("users")
      .where("email", "==", email.trim().toLowerCase())
      .limit(1)
      .get();

  const userExists = !usersSnapshot.empty;

  // Create a transporter using the SMTP settings
  const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    auth: {
      user: "7732de001@smtp-brevo.com",
      pass: "vbsxdyZXEn0GzmS3",
    },
  });

  // Prepare email options
  let subject; let html;

  if (userExists) {
    // Email for existing users
    subject = `Congratulations! You've Been Rewarded with NextBud Subscription`;
    html = `
        <html>
          <body>
            <h1>Exciting News! 🎉</h1>
            <p>Congratulations! You've been rewarded with a premium subscription to NextBud for ${data.duration} days.</p>
            <p>This exclusive access is now active on your account. Enjoy all the premium features!</p>
            <p>Log in to your account to start exploring your new benefits.</p>
            <p>Visit <a href="https://nextbud-e3389.web.app/">NextBud</a> now!</p>
            <p>Enjoy!</p>
          </body>
        </html>
      `;
  } else {
    // Email for new users
    subject = `Your NextBud Subscription Invitation`;
    html = `
        <html>
          <body>
            <h1>You've Got a Special Invitation! 📨</h1>
            <p>Great news! You've been granted a ${data.duration}-day premium subscription to NextBud.</p>
            <p>To activate your subscription:</p>
            <ol>
              <li>Create an account on <a href="https://nextbud-e3389.web.app/">NextBud</a></li>
              <li>Use the email address this invitation was sent to</li>
              <li>Your premium access will be automatically applied</li>
            </ol>
            <p>Don't miss out on this exclusive opportunity!</p>
          </body>
        </html>
      `;
  }

  // Prepare mail options
  const mailOptions = {
    from: "support@nextbudapp.com",
    to: email,
    subject: subject,
    html: html,
  };

  try {
    // Send email
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
  } catch (error) {
    logger.error(`Error sending email: ${error.message}`);
    throw error;
  }
}

module.exports = router;
