/**
 * Authentication middleware functions
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
  const partnerSlug = req.params.partnerSlug || req.query.partnerSlug;

  if (!partnerSlug) {
    return res.status(400).json({ 
      success: false, 
      error: "Missing partner slug",
    });
  }
  
  
  try {
    // Verify the partner exists and API key is valid
    const partnerDoc = await db.collection("partners").doc(partnerSlug).get();
    
    if (!partnerDoc.exists) {
      logger.error(`Partner ${partnerSlug} not found`);
      return res.status(404).json({ 
        success: false, 
        error: "Partner not found",
      });
    }
    
    const partnerData = partnerDoc.data();
    
    // Verify API key
    if (apiKey !== partnerData.apiKey) {
      logger.error(`Invalid API key for partner: ${partnerSlug}`);
      return res.status(401).json({ 
        success: false, 
        error: "Invalid API key",
      });
    }
    
    // Attach partner data to request for route handlers
    req.partner = partnerData;
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

// Helper function to validate email format
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

module.exports = {
  authenticateAdmin,
  authenticatePartner,
  isValidEmail
};