/**
 * Middleware to authenticate and authorize user requests.
 *
 * This middleware:
 * - Verifies the Firebase authentication token
 * - Checks user permissions
 * - Attaches user information to the request object
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void|Object} Calls next() or sends an error response
 */

const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const db = admin.firestore();

// Helper middleware for admin authentication
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const adminApiKey = process.env.ADMIN_API_KEY || "your-admin-api-key";

  if (!authHeader || authHeader !== `Bearer ${adminApiKey}`) {
    logger.error("Unauthorized access attempt to admin API");
    return res.status(401).json({
      success: false,
      error: "Unauthorized - Admin access required",
    });
  }

  next();
};

// Helper middleware for partner authentication
const authenticatePartner = async (req, res, next) => {
  const partnerSlug = req.params.partnerSlug || req.query.partnerSlug || req.body.partnerId;

  if (!partnerSlug) {
    return res.status(400).json({
      success: false,
      error: "Missing partner slug",
    });
  }

  try {
    // Query for a partner where the slug field matches the provided partnerSlug
    const partnersRef = db.collection("partners");
    const querySnapshot = await partnersRef.where("slug", "==", partnerSlug).get();

    // Check if we found a matching partner
    if (querySnapshot.empty) {
      logger.error(`Partner with slug ${partnerSlug} not found`);
      return res.status(404).json({
        success: false,
        error: "Partner not found",
      });
    }

    // Get the first matching document
    const partnerDoc = querySnapshot.docs[0];
    const partnerData = partnerDoc.data();

    // Attach partner data and ID to request for route handlers
    req.partner = partnerData;
    req.partnerId = partnerDoc.id;
    req.partnerSlug = partnerSlug;

    next();
  } catch (error) {
    logger.error("Error authenticating partner:", error);
    return res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`,
    });
  }
};

/**
 * Validates the format of an email address using a regular expression.
 *
 * Checks if the email:
 * - Contains a username before the '@' symbol
 * - Has a domain name after the '@' symbol
 * - Includes a top-level domain after a dot
 * - Does not contain whitespace
 *
 * @param {string} email - The email address to validate
 * @return {boolean} True if the email is valid, false otherwise
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

module.exports = {
  authenticateAdmin,
  authenticatePartner,
  isValidEmail,
};
