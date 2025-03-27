/* eslint-disable */
/**
 * Scheduled function to check expired premium subscriptions
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
 * Check for expired premium subscriptions and deactivate them
 *
 * This scheduled function:
 * - Retrieves users with premium_user = true
 * - Checks if their premium subscription has expired
 * - Deactivates premium status for users with expired subscriptions
 * - Logs deactivation activities
 *
 * @param {Object} context - The Firebase Functions execution context
 * @param {Object} context.scheduledTime - Timestamp when the function was scheduled to run
 * @param {string} context.jobName - Name of the scheduled job (if applicable)
 * @returns {Promise<Object>} Results of the expired subscriptions check
 */
async function checkExpiredSubscriptions(context) {
  logger.info("Starting scheduled check for expired premium subscriptions");

  /**
   * Track the results of the expired subscriptions check process
   *
   * @typedef {Object} ExpiredSubscriptionsResults
   * @property {number} checked - Total number of premium users processed
   * @property {number} deactivated - Number of successfully deactivated subscriptions
   * @property {number} stillActive - Number of subscriptions still active
   * @property {Array<Object>} errors - List of errors encountered during processing
   */

  /**
   * Tracking object to aggregate statistics for expired subscription processing
   * Initializes counters and error tracking for the subscription check process
   */
  const results = {
    checked: 0,
    deactivated: 0,
    stillActive: 0,
    errors: [],
  };

  try {
    // Get current date
    const now = new Date();

    // Get premium users with expiration dates
    // Limit to a reasonable number to avoid timeout issues
    const premiumUsersSnapshot = await db.collection("users")
        .where("premium_user", "==", true)
        .where("premiumExpiryDate", "<", now)
        .limit(100)
        .get();

    if (premiumUsersSnapshot.empty) {
      logger.info("No expired premium subscriptions to process");
      return results;
    }

    logger.info(`Found ${premiumUsersSnapshot.size} expired premium subscriptions to process`);

    // Process in batches for efficiency
    const batch = db.batch();

    for (const doc of premiumUsersSnapshot.docs) {
      try {
        results.checked++;
        const user = doc.data();
        const userId = doc.id;
        const email = user.email;
        const premiumSource = user.premiumSource || "unknown";
        const expiryDate = user.premiumExpiryDate.toDate();

        // Only process if subscription is actually expired
        if (now < expiryDate) {
          results.stillActive++;
          logger.debug(`User ${userId} subscription not yet expired: ${expiryDate.toISOString()}`);
          continue;
        }

        // Update user to remove premium status
        batch.update(doc.ref, {
          premium_user: false,
          mart_premium_user: false,
          premiumDeactivatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          notes: `${user.notes || ""} Premium expired on ${expiryDate.toISOString()}`,
        });

        // Add to activity log
        const logRef = db.collection("activityLogs").doc();
        batch.set(logRef, {
          userId: userId,
          customerEmail: email,
          premiumSource: premiumSource,
          action: "subscription_auto_deactivated",
          performedBy: "system",
          adminAction: false,
          timestamp: FieldValue.serverTimestamp(),
          notes: `Auto-deactivated premium subscription after expiry date: ${expiryDate.toISOString()}`,
        });

        results.deactivated++;
      } catch (error) {
        logger.error(`Error processing expired subscription for user ${doc.id}: ${error.message}`, error);
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

    logger.info(`Expired subscriptions check complete: ${JSON.stringify(results)}`);
    return results;
  } catch (error) {
    logger.error(`Error checking expired subscriptions: ${error.message}`, error);
    return {
      error: error.message,
      results,
    };
  }
}

module.exports = {checkExpiredSubscriptions};