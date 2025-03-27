/**
 * Referral API Routes
 */

const express = require("express");
const router = express.Router();
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

// Make sure Firebase Admin is properly initialized before accessing Firestore
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Configure transporter for sending emails
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  auth: {
    user: "7732de001@smtp-brevo.com",
    pass: "vbsxdyZXEn0GzmS3",
  },
});

/**
 * Send a free trial activation confirmation email to the user
 */
const sendFreeTrialActivationEmail = async (userData, trialDetails) => {
  try {
    // Extract user information
    const { email, name, firstName = name?.split(' ')[0] || 'Valued Customer' } = userData;
    
    // Extract trial details
    const { 
      planName = 'Premium', 
      activationDate = new Date(),
      durationDays = 30,
      referralCode = ""
    } = trialDetails;
    
    // Calculate expiry date
    const expiryDate = new Date(activationDate.getTime() + (durationDays * 24 * 60 * 60 * 1000));
    
    // Format dates for display
    const formattedActivationDate = activationDate.toLocaleDateString('en-US', { 
      year: 'numeric', month: 'long', day: 'numeric' 
    });
    const formattedExpiryDate = expiryDate.toLocaleDateString('en-US', { 
      year: 'numeric', month: 'long', day: 'numeric' 
    });
    
    // Create duration text based on days
    let durationText = "";
    if (durationDays === 30 || durationDays === 31) {
      durationText = "One Month";
    } else if (durationDays === 7) {
      durationText = "One Week";
    } else if (durationDays === 14) {
      durationText = "Two Weeks";
    } else if (durationDays === 90) {
      durationText = "Three Months";
    } else {
      durationText = `${durationDays} Days`;
    }

    // Create email options
    const mailOptions = {
      from: 'support@nextbudapp.com',
      to: email,
      subject: `🎉 Your ${durationText} Free ${planName} Trial is Now Active!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <div style="text-align: center; margin-bottom: 30px;">
           
            <h1 style="color: #2c44fd; margin-top: 20px;">Your Free Trial is Active!</h1>
          </div>
          
          <p>Hello ${firstName},</p>
          
          <p>Congratulations! Your <strong>${durationText} free trial</strong> of our <strong>${planName}</strong> plan has been successfully activated! You now have complete access to all premium features at no cost.</p>
          
          <div style="background-color: #f7f9ff; border-left: 4px solid #2c44fd; padding: 15px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #2c44fd;">Trial Details:</h3>
            <ul style="padding-left: 20px;">
              <li><strong>Plan:</strong> ${planName}</li>
              <li><strong>Free Trial Duration:</strong> ${durationText}</li>
              <li><strong>Start Date:</strong> ${formattedActivationDate}</li>
              <li><strong>End Date:</strong> ${formattedExpiryDate}</li>
              ${referralCode ? `<li><strong>Activated with Referral Code:</strong> ${referralCode}</li>` : ''}
            </ul>
          </div>
          
          <p>To start exploring your premium features, simply log into your account and enjoy all the benefits for the next ${durationText.toLowerCase()} - completely free!</p>
          
         
          <div style="background-color: #fff4e5; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Important:</strong> Your free trial will automatically expire on ${formattedExpiryDate}. Don't worry - we'll send you a reminder before it ends with options to continue your premium access.</p>
          </div>
          
          <p>If you have any questions about your trial or need assistance, please don't hesitate to contact our support team at <a href="mailto:support@yourcompany.com" style="color: #2c44fd;">support@yourcompany.com</a>.</p>
          
          <p>Thank you for choosing our service!</p>
          
          <p>Best regards,<br>The Team at Your Company</p>
          
          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #888; text-align: center;">
            <p>This is an automated email. Please do not reply directly to this message.</p>
            <p>© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
          </div>
        </div>
      `,
      text: `
        YOUR FREE TRIAL IS ACTIVE!
        
        Hello ${firstName},
        
        Congratulations! Your ${durationText} free trial of our ${planName} plan has been successfully activated! You now have complete access to all premium features at no cost.
        
        TRIAL DETAILS:
        - Plan: ${planName}
        - Free Trial Duration: ${durationText}
        - Start Date: ${formattedActivationDate}
        - End Date: ${formattedExpiryDate}
        ${referralCode ? `- Activated with Referral Code: ${referralCode}` : ''}
        
        To start exploring your premium features, simply log into your account and enjoy all the benefits for the next ${durationText.toLowerCase()} - completely free!
        
        IMPORTANT: Your free trial will automatically expire on ${formattedExpiryDate}. Don't worry - we'll send you a reminder before it ends with options to continue your premium access.
        
        If you have any questions about your trial or need assistance, please don't hesitate to contact our support team at support@nextbudapp.com.
        
        Thank you for choosing our service!
        
        Best regards,
        The Team at NextBud
        
        This is an automated email. Please do not reply directly to this message.
        © ${new Date().getFullYear()} NextBud. All rights reserved.
      `
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    logger.info("Free trial activation email sent successfully:", info.messageId);
    return info;
    
  } catch (error) {
    logger.error("Error sending free trial activation email:", error);
    throw error;
  }
};

// Process referral code
router.post("/process", async (req, res) => {
  try {
    // Extract and validate request data
    const { email, referralCode, duration } = req.body;

    if (!email || !referralCode) {
      return res.status(400).json({
        success: false,
        error: "Both email and referral code are required"
      });
    }
    
    // Validate duration if provided
    const premiumDuration = duration ? parseInt(duration) : 30; // Default to 30 days if not specified
    if (isNaN(premiumDuration) || premiumDuration <= 0) {
      return res.status(400).json({
        success: false,
        error: "Duration must be a positive number"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    
    logger.info(`Processing referral code: ${referralCode} for email: ${normalizedEmail}`);

    // Find user with the provided email
    const usersSnapshot = await db.collection("users")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    // Check if user exists
    if (usersSnapshot.empty) {
      logger.error(`User with email ${normalizedEmail} not found`);
      return res.status(404).json({
        success: false,
        error: "User not registered. Please sign up first before using a referral code."
      });
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    // Check if user is already premium
    if (userData.premium_user ) {
      logger.info(`User ${userId} already has premium access`);
      return res.status(400).json({
        success: false,
        message: "You already have premium access",
        alreadyPremium: true
      });
    }

    // Check registration date (within 7 days)
    const createdAt = userData.created_at?.toDate() || new Date();

    const daysSinceRegistration = Math.floor((new Date() - createdAt) / (1000 * 60 * 60 * 24));
    console.log(daysSinceRegistration, 'boom')
    if (daysSinceRegistration > 7) {
      logger.error(`User registration (${daysSinceRegistration} days ago) exceeds 7-day eligibility period`);
      return res.status(400).json({
        success: false,
        message: "Referral code can only be used within 7 days of registration",
        expired: true,
        daysSinceRegistration
      });
    }

    // Find influencer with the provided referral code
    const influencersSnapshot = await db.collection("influencers")
      .where("referralCode", "==", referralCode)
      .limit(1)
      .get();

    // Check if influencer exists
    if (influencersSnapshot.empty) {
      logger.error(`No influencer found with referral code: ${referralCode}`);
      return res.status(404).json({
        success: false,
        error: "Invalid referral code"
      });
    }

    const influencerDoc = influencersSnapshot.docs[0];
    const influencerId = influencerDoc.id;
    
    // Calculate premium expiry date based on the provided or default duration
    const now = new Date();
    const endDate = new Date();
    endDate.setDate(now.getDate() + premiumDuration);

    // Start a batch write
    const batch = db.batch();
    
    // Update influencer stats
    batch.update(influencerDoc.ref, {
      subscriberCount: FieldValue.increment(1),
      totalReferrals: FieldValue.increment(1),
      lastReferralDate: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    
    // Update user to premium
    batch.update(userDoc.ref, {
      premium_user: true,
      mart_premium_user: true,
      premiumUpdatedAt: FieldValue.serverTimestamp(),
      premiumExpiryDate: endDate,
      premiumSource: `referral_${influencerId}`,
      referredBy: influencerId,
      referralCode: referralCode,
      updatedAt: FieldValue.serverTimestamp()
    });
    
    // Log the referral activity
    const activityLogRef = db.collection("activityLogs").doc();
    batch.set(activityLogRef, {
      userId,
      influencerId,
      referralCode,
      action: "referral_premium_granted",
      timestamp: FieldValue.serverTimestamp(),
      premiumDuration,
      premiumExpiryDate: endDate,
      daysSinceRegistration
    });
    
    // Commit all the changes
    await batch.commit();
    
    logger.info(`Successfully processed referral code ${referralCode} for user ${userId}. Premium granted for ${premiumDuration} days.`);
    
    // Send confirmation email
    try {
      // Get influencer name if available
      const influencerData = influencerDoc.data();
      const influencerName = influencerData?.name || influencerData?.displayName || 'an influencer';

      // Prepare email data
      const emailUserData = {
        email: normalizedEmail,
        name: userData.name || userData.displayName || 'Valued Customer',
      };
      
      const trialDetails = {
        planName: 'Premium',
        activationDate: now,
        durationDays: premiumDuration,
        referralCode: referralCode,
        influencerName: influencerName
      };
      
      // Send the email
    //   await sendFreeTrialActivationEmail(emailUserData, trialDetails);
      logger.info(`Sent premium activation email to ${normalizedEmail}`);
    } catch (emailError) {
      // Log error but don't fail the request if email sending fails
      logger.error(`Error sending activation email: ${emailError.message}`, emailError);
    }
    
    // Return success response
    return res.status(200).json({
      success: true,
      message: "Premium access activated successfully!",
      premiumDuration,
      expiryDate: endDate,
      influencerId
    });
    
  } catch (error) {
    logger.error(`Error processing referral code: ${error.message}`, error);
    
    // Return error response
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process referral code"
    });
  }
});

// Check referral eligibility
router.post("/check-eligibility", async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required"
      });
    }
    
    const normalizedEmail = email.trim().toLowerCase();
    
    // Find user with the provided email
    const usersSnapshot = await db.collection("users")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();
    
    // Check if user exists
    if (usersSnapshot.empty) {
      return res.status(200).json({
        eligible: false,
        message: "User not registered",
        reason: "not_registered"
      });
    }
    
    const userData = usersSnapshot.docs[0].data();
    
    // Check if already premium
    if (userData.premium_user || userData.mart_premium_user) {
      return res.status(200).json({
        eligible: false,
        message: "User already has premium access",
        reason: "already_premium"
      });
    }
    
    // Check registration date
    const createdAt = userData.createdAt?.toDate() || new Date();
    const daysSinceRegistration = Math.floor((new Date() - createdAt) / (1000 * 60 * 60 * 24));
    
    if (daysSinceRegistration > 7) {
      return res.status(200).json({
        eligible: false,
        message: "Referral can only be used within 7 days of registration",
        reason: "expired",
        daysSinceRegistration
      });
    }
    
    // User is eligible
    return res.status(200).json({
      eligible: true,
      message: "User is eligible for referral premium",
      daysSinceRegistration
    });
    
  } catch (error) {
    logger.error(`Error checking referral eligibility: ${error.message}`, error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to check referral eligibility"
    });
  }
});

module.exports = router;