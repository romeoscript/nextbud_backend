/* eslint-disable */

const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {onCall} = require('firebase-functions/v2/https');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const nodemailer = require('nodemailer');


// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  admin.initializeApp();
}
/* eslint-disable */


// SMTP Configuration
const SMTP_HOST = 'smtp.maileroo.com';
const SMTP_USER = 'info@nextbudapp.com';
const SMTP_PASS = '0a0b507d87ec5b66ba9e9c06';
const EMAIL_FROM_NAME = 'nextbud';

// Create SMTP transporter
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: 587,
  secure: false, 
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

// Cache for compiled templates
const templateCache = {};

/**
 * Loads and compiles a Handlebars template
 */
function getTemplate(templateName) {
  if (templateCache[templateName]) {
    return templateCache[templateName];
  }
  
  const templatePath = path.join(__dirname, 'templates', 'emails', `${templateName}.hbs`);
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(templateSource);
  
  templateCache[templateName] = template;
  return template;
}

/**
 * Listens for new documents in the users collection
 * Verifies email and sends welcome email if valid
 */
exports.onNewUserCreated = onDocumentCreated({
  document: 'users/{userId}',
  region: 'us-central1'
}, async (event) => {
  const snapshot = event.data;
  const context = event.params;
  
  try {
    const userData = snapshot.data();
    const userId = context.userId;
    const userEmail = userData.email;
    
    console.log(`New regular user detected in Firestore: ${userId}, ${userEmail}`);
    
    // Validate that we have an email to work with
    if (!userEmail) {
      console.error(`User ${userId} has no email address`);
      await snapshot.ref.update({
        emailCheckInProgress: false,
        emailCheckCompletedAt: FieldValue.serverTimestamp(),
        emailVerificationResult: {
          status: 'invalid',
          reason: 'No email address provided'
        },
        isEmailValid: false
      });
      return { success: false, error: 'No email address provided' };
    }
    
    // Mark the email as being checked
    await snapshot.ref.update({
      emailCheckInProgress: true,
      emailCheckStartedAt: FieldValue.serverTimestamp()
    });
    
    /* 
    // Email verification temporarily disabled
    const emailVerificationResult = await verifyEmailWithMaileroo(userEmail);
    const status = emailVerificationResult.status || 'unknown';
    */
    
    // Skip verification and assume email is valid
    const emailVerificationResult = {
      status: 'valid',
      score: 100,
      reason: 'Verification skipped',
      validation_method: 'skipped'
    };
    const status = 'valid';
    
    // Update the user document with verification result
    await snapshot.ref.update({
      emailCheckInProgress: false,
      emailCheckCompletedAt: FieldValue.serverTimestamp(),
      emailVerificationResult: emailVerificationResult,
      isEmailValid: true // Always set to true since we're skipping verification
    });
    
    // Send welcome email immediately instead of scheduling it
    try {
      await sendWelcomeEmail(userId, null, 'regular');
      console.log(`Welcome email sent immediately to ${userEmail}`);
    } catch (emailError) {
      console.error(`Error sending welcome email to user ${userId}:`, emailError);
    }
    
    return { success: true, emailStatus: status };
  } catch (error) {
    console.error('Error processing new user:', error);
    
    // Attempt to update the document to indicate failure
    try {
      await snapshot.ref.update({
        emailCheckInProgress: false,
        emailCheckCompletedAt: FieldValue.serverTimestamp(),
        emailVerificationError: error.message,
        isEmailValid: false
      });
    } catch (updateError) {
      console.error('Failed to update user document after error:', updateError);
    }
    
    return { success: false, error: error.message };
  }
});

/**
 * Listens for new documents in the influencers collection
 * Verifies email and sends welcome email if valid
 */
exports.onNewInfluencerCreated = onDocumentCreated({
  document: 'influencers/{influencerId}',
  region: 'us-central1'
}, async (event) => {
  const snapshot = event.data;
  const context = event.params;
  
  try {
    const influencerData = snapshot.data();
    const influencerId = context.influencerId;
    const influencerEmail = influencerData.email;
    
    console.log(`New influencer detected in Firestore: ${influencerId}, ${influencerEmail}`);
    
    // Validate that we have an email to work with
    if (!influencerEmail) {
      console.error(`Influencer ${influencerId} has no email address`);
      await snapshot.ref.update({
        emailCheckInProgress: false,
        emailCheckCompletedAt: FieldValue.serverTimestamp(),
        emailVerificationResult: {
          status: 'invalid',
          reason: 'No email address provided'
        },
        isEmailValid: false
      });
      return { success: false, error: 'No email address provided' };
    }
    
    // Mark the email as being checked
    await snapshot.ref.update({
      emailCheckInProgress: true,
      emailCheckStartedAt: FieldValue.serverTimestamp()
    });
    
    /* 
    // Email verification temporarily disabled
    const emailVerificationResult = await verifyEmailWithMaileroo(influencerEmail);
    const status = emailVerificationResult.status || 'unknown';
    */
    
    // Skip verification and assume email is valid
    const emailVerificationResult = {
      status: 'valid',
      score: 100,
      reason: 'Verification skipped',
      validation_method: 'skipped'
    };
    const status = 'valid';
    
    // Update the influencer document with verification result
    await snapshot.ref.update({
      emailCheckInProgress: false,
      emailCheckCompletedAt: FieldValue.serverTimestamp(),
      emailVerificationResult: emailVerificationResult,
      isEmailValid: true // Always set to true since we're skipping verification
    });
    
    // Send welcome email immediately instead of scheduling it
    try {
      await sendWelcomeEmail(influencerId, null, 'influencer');
      console.log(`Welcome email sent immediately to influencer ${influencerEmail}`);
    } catch (emailError) {
      console.error(`Error sending welcome email to influencer ${influencerId}:`, emailError);
    }
    
    return { success: true, emailStatus: status };
  } catch (error) {
    console.error('Error processing new influencer:', error);
    
    // Attempt to update the document to indicate failure
    try {
      await snapshot.ref.update({
        emailCheckInProgress: false,
        emailCheckCompletedAt: FieldValue.serverTimestamp(),
        emailVerificationError: error.message,
        isEmailValid: false
      });
    } catch (updateError) {
      console.error('Failed to update influencer document after error:', updateError);
    }
    
    return { success: false, error: error.message };
  }
});

/**
 * Send email using SMTP with Nodemailer
 */
async function sendEmail(toEmail, toName, subject, htmlContent, textContent) {
  try {
    // Set up email options
    const mailOptions = {
      from: '"Nextbud" <info@nextbudapp.com>',
      to: toEmail,
      subject: subject,
      html: htmlContent
    };

    // Add text content if provided
    if (textContent) {
      mailOptions.text = textContent;
    }
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    
    console.log('Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email via SMTP:', error);
    throw error;
  }
}

/**
 * Scheduled function that runs every 15 minutes to check for emails that need to be sent
 * Now used for follow-up emails only
 * 
 * This version is compatible with onSchedule
 */
exports.sendScheduledEmails = async (event) => {
  const now = Timestamp.now();
  
  try {
    console.log(`Checking for scheduled emails at ${now.toDate()}`);
    
    // Get all scheduled emails that are due to be sent
    const scheduledEmailsSnapshot = await admin.firestore()
      .collection('scheduledEmails')
      .where('scheduledFor', '<=', now)
      .where('sent', '==', false)
      .get();
    
    if (scheduledEmailsSnapshot.empty) {
      console.log('No scheduled emails to send at this time');
      return { success: true, emailsSent: 0 };
    }
    
    console.log(`Found ${scheduledEmailsSnapshot.size} scheduled emails to send`);
    
    const emailPromises = [];
    
    scheduledEmailsSnapshot.forEach(doc => {
      const scheduledEmail = doc.data();
      console.log(`Processing scheduled email: ${doc.id}, type: ${scheduledEmail.emailType}, scheduled for: ${scheduledEmail.scheduledFor.toDate ? scheduledEmail.scheduledFor.toDate() : new Date(scheduledEmail.scheduledFor)}`);
      
      // Process all email types
      if (scheduledEmail.emailType === 'followUp') {
        emailPromises.push(sendFollowUpEmail(
          scheduledEmail.userId, 
          doc.id,
          scheduledEmail.userType || 'regular'
        ));
      }
    });
    
    const results = await Promise.all(emailPromises);
    const sentCount = results.filter(result => result === true).length;
    
    console.log(`Successfully sent ${sentCount} out of ${emailPromises.length} scheduled emails`);
    
    return { success: true, emailsSent: sentCount };
  } catch (error) {
    console.error('Error sending scheduled emails:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send welcome email immediately after email verification check
 * Modified to work with or without a scheduledEmailId
 */
async function sendWelcomeEmail(userId, scheduledEmailId, userType) {
  try {
    // Get user data from the appropriate collection
    const collectionName = userType === 'influencer' ? 'influencers' : 'users';
    const userDoc = await admin.firestore().collection(collectionName).doc(userId).get();
    
    if (!userDoc.exists) {
      console.error(`${userType} ${userId} not found`);
      return false;
    }
    
    const userData = userDoc.data();
    
    // Skip if email is not valid
    if (userData.isEmailValid !== true) {
      console.log(`Skipping welcome email for invalid email: ${userData.email}`);
      return false;
    }
    
    const userEmail = userData.email;
    const userName = userData.displayName || userData.username || 'there';
    
    // Set email subject based on user type
    const subject = userType === 'influencer'
      ? 'Welcome to NextBud Creator!'
      : 'Welcome to NextBud!';
      
    // Prepare template variables
    const templateData = {
      firstName: userName.split(' ')[0] || userName,
      fullName: userName,
      appUrl: 'https://nextbudapp.com',
      profileUrl: `https://nextbudapp.com/${userType === 'influencer' ? 'creator' : 'user'}/profile`,
      dashboardUrl: `https://nextbudapp.com/${userType === 'influencer' ? 'creator-dashboard' : 'dashboard'}`,
      analyticsUrl: `https://nextbudapp.com/analytics`,
      userType: userType === 'influencer' ? 'Creator' : 'User',
      currentYear: new Date().getFullYear(),
      email: userEmail
    };
    
    // Get the appropriate template
    const templateName = userType === 'influencer' ? 'welcome-influencer' : 'welcome-user';
    const template = getTemplate(templateName);
    
    // Render the template
    const htmlContent = template(templateData);
    
    // Send email via SMTP
    await sendEmail(userEmail, userName, subject, htmlContent);
    
    console.log(`Welcome email sent to ${userEmail} (${userType}) via SMTP`);
    
    // If this was from a scheduled email, mark it as sent
    if (scheduledEmailId) {
      await admin.firestore().collection('scheduledEmails').doc(scheduledEmailId).update({
        sent: true,
        sentAt: FieldValue.serverTimestamp()
      });
    }
    
    // Update user record
    await admin.firestore().collection(collectionName).doc(userId).update({
      welcomeEmailSent: true,
      welcomeEmailSentAt: FieldValue.serverTimestamp()
    });
    
    // Schedule follow-up email
    // Set the follow-up time based on user type
    const followUpDays = userType === 'influencer' ? 3 : 7;
    await scheduleFollowUpEmail(userId, followUpDays, userType, false);
    
    return true;
  } catch (error) {
    console.error(`Error sending welcome email to ${userType} ${userId}:`, error);
    return false;
  }
}

/**
 * Schedule a follow-up email
 */
async function scheduleFollowUpEmail(userId, timeDelay, userType, isMinutes = false) {
  try {
    // Create a Firestore timestamp for the scheduled time
    let scheduledDate;
    const now = new Date();
    
    if (isMinutes) {
      // Add minutes (for testing)
      now.setMinutes(now.getMinutes() + timeDelay);
      scheduledDate = now;
      console.log(`Setting follow-up for ${timeDelay} minutes from now: ${scheduledDate}`);
    } else {
      // Add days (for production)
      now.setDate(now.getDate() + timeDelay);
      scheduledDate = now;
      console.log(`Setting follow-up for ${timeDelay} days from now: ${scheduledDate}`);
    }
    
    // Convert to Firestore Timestamp
    const scheduledTimestamp = admin.firestore.Timestamp.fromDate(scheduledDate);
    
    // Save to Firestore
    await admin.firestore().collection('scheduledEmails').add({
      userId: userId,
      userType: userType,
      scheduledFor: scheduledTimestamp,
      emailType: 'followUp',
      sent: false,
      createdAt: FieldValue.serverTimestamp()
    });
    
    const timeUnit = isMinutes ? 'minutes' : 'days';
    console.log(`Follow-up email scheduled for ${userType} ${userId} in ${timeDelay} ${timeUnit}`);
    return true;
  } catch (error) {
    console.error(`Error scheduling follow-up email: ${error.message}`);
    return false;
  }
}

/**
 * Send follow-up email
 */
async function sendFollowUpEmail(userId, scheduledEmailId, userType) {
  try {
    // Get user data from the appropriate collection
    const collectionName = userType === 'influencer' ? 'influencers' : 'users';
    const userDoc = await admin.firestore().collection(collectionName).doc(userId).get();
    
    if (!userDoc.exists) {
      console.error(`${userType} ${userId} not found`);
      return false;
    }
    
    const userData = userDoc.data();
    
    // Skip if email is not valid
    if (userData.isEmailValid !== true) {
      console.log(`Skipping follow-up email for invalid email: ${userData.email}`);
      return false;
    }
    
    const userEmail = userData.email;
    const userName = userData.displayName || userData.username || 'there';
    
    // Set email subject based on user type
    const subject = userType === 'influencer'
      ? 'Maximize Your Reach on Nextbud'
      : 'How are you enjoying Nextbud?';
      
    // Calculate days since signup
    const daysSinceSignup = userType === 'influencer' ? 3 : 7;
    
    // Prepare template variables
    const templateData = {
      firstName: userName.split(' ')[0] || userName,
      fullName: userName,
      appUrl: 'https://nextbudapp.com',
      discoverUrl: 'https://nextbudapp.com/discover',
      eventsUrl: 'https://nextbudapp.com/events',
      createUrl: 'https://nextbudapp.com/create',
      analyticsUrl: 'https://nextbudapp.com/analytics',
      daysSinceSignup: daysSinceSignup,
      userType: userType === 'influencer' ? 'Creator' : 'User',
      currentYear: new Date().getFullYear(),
      email: userEmail
    };
    
    // Get the appropriate template
    const templateName = userType === 'influencer' ? 'followup-influencer' : 'followup-user';
    const template = getTemplate(templateName);
    
    // Render the template
    const htmlContent = template(templateData);
    
    // Send email via SMTP
    await sendEmail(userEmail, userName, subject, htmlContent);
    
    console.log(`Follow-up email sent to ${userEmail} (${userType}) via SMTP`);
    
    // Mark the scheduled email as sent
    await admin.firestore().collection('scheduledEmails').doc(scheduledEmailId).update({
      sent: true,
      sentAt: FieldValue.serverTimestamp()
    });
    
    // Update user record
    await admin.firestore().collection(collectionName).doc(userId).update({
      followUpEmailSent: true,
      followUpEmailSentAt: FieldValue.serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error(`Error sending follow-up email to ${userType} ${userId}:`, error);
    return false;
  }
}

/**
 * Manual function to check an email's validity (admin only)
 * This function is currently disabled
 */
exports.checkEmailValidity = onCall({
  region: 'us-central1'
}, async (request) => {
  // Security check
  const {data, auth} = request;
  if (!auth || !auth.token.admin) {
    throw new Error(
      'permission-denied: Only admins can manually check email validity'
    );
  }
  
  const { email } = data;
  
  if (!email) {
    throw new Error(
      'invalid-argument: Email is required'
    );
  }
  
  try {
    // Email verification is disabled, return a dummy result
    return { 
      success: true, 
      result: {
        status: 'valid',
        score: 100,
        reason: 'Verification skipped',
        validation_method: 'skipped'
      }
    };
    
    // Original code:
    // const result = await verifyEmailWithMaileroo(email);
    // return { success: true, result };
  } catch (error) {
    throw new Error(`internal: ${error.message}`);
  }
});

/**
 * Verify SMTP connection
 */
exports.verifySmtpConnection = onCall({
  region: 'us-central1'
}, async (request) => {
  // Security check
  const {auth} = request;
  if (!auth || !auth.token.admin) {
    throw new Error(
      'permission-denied: Only admins can manually check email validity'
    );
  }
  
  try {
    // Verify SMTP connection
    await transporter.verify();
    return { success: true, message: 'SMTP connection verified successfully' };
  } catch (error) {
    console.error('SMTP verification error:', error);
    return { 
      success: false, 
      error: error.message,
      details: {
        code: error.code,
        command: error.command
      }
    };
  }
});

// Export functions
module.exports = exports;