/**
 * Subscription API Routes
 */

const express = require("express");
const router = express.Router();
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

const db = admin.firestore();

// Check subscription status for a user
router.get("/check", async (req, res) => {
  const email = req.query.email;
  
  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Email parameter is required",
    });
  }
  
  try {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Query for active subscriptions
    const now = new Date();
    const subscriptionsSnapshot = await db.collection("subscriptions")
      .where("customerEmail", "==", normalizedEmail)
      .where("status", "==", "active")
      .where("endDate", ">", now)
      .get();
    
    const subscriptions = subscriptionsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        partnerId: data.partnerId,
        duration: data.duration,
        startDate: data.startDate.toDate(),
        endDate: data.endDate.toDate(),
        daysRemaining: Math.ceil((data.endDate.toDate() - now) / (1000 * 60 * 60 * 24)),
      };
    });
    
    // Get partner details for each subscription
    const partnerDetails = {};
    for (const sub of subscriptions) {
      if (!partnerDetails[sub.partnerId]) {
        const partnerDoc = await db.collection("partners").doc(sub.partnerId).get();
        if (partnerDoc.exists) {
          const partnerData = partnerDoc.data();
          partnerDetails[sub.partnerId] = {
            name: partnerData.name,
            logoUrl: partnerData.logoUrl,
          };
        }
      }
      
      // Add partner details to subscription
      sub.partner = partnerDetails[sub.partnerId] || { name: "Unknown Partner" };
    }
    
    res.status(200).json({
      success: true,
      email: normalizedEmail,
      hasActiveSubscription: subscriptions.length > 0,
      subscriptionCount: subscriptions.length,
      subscriptions: subscriptions,
    });
    
  } catch (error) {
    logger.error("Error checking subscription:", error);
    res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`,
    });
  }
});

module.exports = router;