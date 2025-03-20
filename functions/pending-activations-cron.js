/* eslint-disable */
/**
 * Scheduled function to check pending activations
 */
const functions = require("firebase-functions");
const logger = functions.logger;
const admin = require("firebase-admin");
const {FieldValue} = require("firebase-admin/firestore");

// Initialize Firebase Admin (if not already initialized)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Check for pending activations and activate premium status when users register
 *
 * This scheduled function:
 * - Retrieves pending activations from Firestore
 * - Checks if users have registered
 * - Activates premium status for newly registered users
 * - Marks expired pending activations
 * - Logs activation activities
 *
 * @param {Object} context - The Firebase Functions execution context
 * @param {Object} context.scheduledTime - Timestamp when the function was scheduled to run
 * @param {string} context.jobName - Name of the scheduled job (if applicable)
 * @returns {Promise<Object>} Results of the pending activations check
 */

async function checkPendingActivations(context) {
  logger.info("Starting scheduled check for pending activations");

  /**
   * Track the results of the pending activations check process
   *
   * @typedef {Object} PendingActivationsResults
   * @property {number} checked - Total number of pending activations processed
   * @property {number} activated - Number of successfully activated subscriptions
   * @property {number} expired - Number of expired pending activations
   * @property {number} stillPending - Number of pending activations still waiting for user registration
   * @property {Array<Object>} errors - List of errors encountered during processing
   */

  /**
   * Tracking object to aggregate statistics for pending activation processing
   * Initializes counters and error tracking for the activation check process
   */
  const results = {
    checked: 0,
    activated: 0,
    expired: 0,
    stillPending: 0,
    errors: [],
  };

  try {
    // Get pending activations
    // Limit to a reasonable number to avoid timeout issues
    const pendingActivationsSnapshot = await db.collection("pending_activations")
        .where("activationStatus", "==", "waiting_for_user")
        .limit(100)
        .get();

    if (pendingActivationsSnapshot.empty) {
      logger.info("No pending activations to process");
      return null;
    }

    logger.info(`Found ${pendingActivationsSnapshot.size} pending activations to check`);

    // Process in batches for efficiency
    const batch = db.batch();
    const now = new Date();

    for (const doc of pendingActivationsSnapshot.docs) {
      try {
        results.checked++;
        const pendingActivation = doc.data();
        const email = pendingActivation.email;

        // Update the check count and last checked timestamp
        batch.update(doc.ref, {
          checkCount: FieldValue.increment(1),
          lastChecked: FieldValue.serverTimestamp(),
        });

        // Check if the activation has expired
        const expiresAt = pendingActivation.expiresAt.toDate();
        if (now > expiresAt) {
          batch.update(doc.ref, {
            activationStatus: "expired",
            updatedAt: FieldValue.serverTimestamp(),
            notes: `${pendingActivation.notes || ""} Expired on ${expiresAt.toISOString()}`,
          });
          results.expired++;
          continue;
        }

        // Check if user has registered
        const usersSnapshot = await db.collection("users")
            .where("email", "==", email)
            .limit(1)
            .get();

        if (usersSnapshot.empty) {
          // User still hasn't registered
          results.stillPending++;
          continue;
        }

        // User found! Activate their premium status
        const userId = usersSnapshot.docs[0].id;
        const userRef = db.collection("users").doc(userId);

        // Update user to premium
        batch.update(userRef, {
          premium_user: true,
          mart_premium_user: true,
          premiumUpdatedAt: FieldValue.serverTimestamp(),
          premiumExpiryDate: expiresAt,
          premiumSource: `partner_${pendingActivation.partnerId}`,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Update pending activation status
        batch.update(doc.ref, {
          activationStatus: "activated",
          activatedAt: FieldValue.serverTimestamp(),
          userId: userId,
          updatedAt: FieldValue.serverTimestamp(),
          notes: `${pendingActivation.notes || ""} Activated on ${now.toISOString()}`,
        });

        // Add to activity log
        const logRef = db.collection("activityLogs").doc();
        batch.set(logRef, {
          partnerId: pendingActivation.partnerId,
          subscriptionId: pendingActivation.subscriptionId,
          customerEmail: email,
          userId: userId,
          action: "subscription_auto_activated",
          performedBy: "system",
          adminAction: false,
          timestamp: FieldValue.serverTimestamp(),
          notes: `Auto-activated from pending activation ${doc.id}`,
        });

        results.activated++;
      } catch (error) {
        logger.error(`Error processing pending activation ${doc.id}: ${error.message}`, error);
        results.errors.push({
          id: doc.id,
          error: error.message,
        });
      }
    }

    // Commit the batch if there are changes
    if (results.checked > 0) {
      await batch.commit();
    }

    logger.info(`Pending activations check complete: ${JSON.stringify(results)}`);
    return results;
  } catch (error) {
    logger.error(`Error checking pending activations: ${error.message}`, error);
    return {
      error: error.message,
      results,
    };
  }
}

module.exports = {checkPendingActivations};
