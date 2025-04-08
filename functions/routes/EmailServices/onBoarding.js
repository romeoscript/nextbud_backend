const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {onCall} = require('firebase-functions/v2/https');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const { FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const nodemailer = require('nodemailer');

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
  admin.initializeApp();
}



// Maileroo API configuration (for email verification only)
const MAILEROO_API_KEY = functions.config().maileroo?.api_key || '';
const MAILEROO_VERIFY_URL = functions.config().maileroo?.verify_url || 'https://verify.maileroo.net';
const MAILEROO_FROM_EMAIL = functions.config().maileroo?.from_email || '';
const MAILEROO_FROM_NAME = functions.config().maileroo?.from_name || '';

// SMTP Configuration
// const SMTP_HOST = functions.config().smtp?.host || 'smtp.maileroo.com';
// const SMTP_PORT = parseInt(functions.config().smtp?.port || '465');
// const SMTP_SECURE = functions.config().smtp?.secure === 'true';
// const SMTP_USER = functions.config().smtp?.user || '';
// const SMTP_PASS = functions.config().smtp?.pass || '';
// const EMAIL_FROM = functions.config().email?.from || MAILEROO_FROM_EMAIL;
// const EMAIL_FROM_NAME = functions.config().email?.from_name || MAILEROO_FROM_NAME;

const SMTP_HOST = 'smtp.maileroo.com';
const SMTP_PORT = '465';
const SMTP_SECURE = 'true';
const SMTP_USER = 'romeo@fb66ec3261d3c0b5.maileroo.org';
const SMTP_PASS = 'ab36b81d5adef147303ecbb0';
// const EMAIL_FROM = '60ca95.7200.2a13f46f21d8abda62fed529fcef2937@g.maileroo.net';
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


// const transporter = nodemailer.createTransport({
//   host: "smtp-relay.brevo.com",
//   port: 587,
//   auth: {
//     user: "7732de001@smtp-brevo.com",
//     pass: "vbsxdyZXEn0GzmS3",
//   },
// });

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
 * Check if an email address is valid using Maileroo's verification service
 * Falls back to basic validation if API fails
 */
async function verifyEmailWithMaileroo(emailAddress) {
  try {
    // First try Maileroo API
    const response = await axios.post(
      `${MAILEROO_VERIFY_URL}/check`,
      {
        api_key: MAILEROO_API_KEY,
        email_address: emailAddress
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Maileroo email verification response for ${emailAddress}:`, response.data);
    
    // Check if response contains expected data structure
    if (response.data && response.data.status) {
      return {
        status: response.data.status, // 'valid', 'invalid', 'risky', etc.
        score: response.data.score || 0,
        reason: response.data.reason || 'No reason provided',
        full_response: response.data
      };
    } else {
      console.log(`Maileroo API returned unexpected response format for ${emailAddress}, falling back to basic validation`);
      // Fall back to basic validation
      return performBasicEmailValidation(emailAddress);
    }
  } catch (error) {
    console.error(`Error verifying email ${emailAddress} with Maileroo:`, error.message);
    
    // Fall back to basic validation
    console.log(`Falling back to basic email validation for ${emailAddress}`);
    return performBasicEmailValidation(emailAddress);
  }
}

/**
 * Performs basic email validation when Maileroo API is unavailable
 */
function performBasicEmailValidation(emailAddress) {
  // Simple regex for basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidFormat = emailRegex.test(emailAddress);
  
  // Check for common disposable email domains (basic check)
  const disposableDomains = [
    'mailinator.com', 'yopmail.com', 'tempmail.com', 'guerrillamail.com',
    'throwawaymail.com', '10minutemail.com', 'trashmail.com'
  ];
  
  const emailDomain = emailAddress.split('@')[1].toLowerCase();
  const isPotentiallyDisposable = disposableDomains.includes(emailDomain);
  
  let status = 'unknown';
  let reason = 'Basic validation only';
  
  if (!isValidFormat) {
    status = 'invalid';
    reason = 'Invalid email format';
  } else if (isPotentiallyDisposable) {
    status = 'risky';
    reason = 'Potentially disposable email domain';
  } else {
    status = 'valid';
    reason = 'Passed basic validation';
  }
  
  return {
    status: status,
    score: status === 'valid' ? 70 : 0, // Modest confidence score for basic validation
    reason: reason,
    validation_method: 'basic',
    full_response: null
  };
}

/**
 * Send email using SMTP with Nodemailer
 */
async function sendEmail(toEmail, toName, subject, htmlContent, textContent) {
  try {
    // Set up email options
    const mailOptions = {
      from: 'romeo@fb66ec3261d3c0b5.maileroo.org',
      to: toEmail,
      subject: subject,
      html: htmlContent
    };

    // const mailOptions = {
    //   from: "support@nextbudapp.com",
    //   to: email,
    //   subject: subject,
    //   html: html,
    // };

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
 */
exports.sendScheduledEmails = onCall({
  region: 'us-central1'
}, async (context) => {
  const now = admin.firestore.Timestamp.now();
  
  try {
    // Get all scheduled emails that are due to be sent
    const scheduledEmailsSnapshot = await admin.firestore()
      .collection('scheduledEmails')
      .where('scheduledFor', '<=', now)
      .where('sent', '==', false)
      .get();
    
    if (scheduledEmailsSnapshot.empty) {
      console.log('No scheduled emails to send at this time');
      return null;
    }
    
    console.log(`Found ${scheduledEmailsSnapshot.size} scheduled emails to send`);
    
    const emailPromises = [];
    
    scheduledEmailsSnapshot.forEach(doc => {
      const scheduledEmail = doc.data();
      
      // Only process follow-up emails now, welcome emails are sent immediately
      if (scheduledEmail.emailType === 'followUp') {
        emailPromises.push(sendFollowUpEmail(
          scheduledEmail.userId, 
          doc.id,
          scheduledEmail.userType || 'regular'
        ));
      }
    });
    
    await Promise.all(emailPromises);
    
    return { success: true, emailsSent: emailPromises.length };
  } catch (error) {
    console.error('Error sending scheduled emails:', error);
    return { success: false, error: error.message };
  }
});

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
    const followUpDays = userType === 'influencer' ? 3 : 7;
    await scheduleFollowUpEmail(userId, followUpDays, userType);
    
    return true;
  } catch (error) {
    console.error(`Error sending welcome email to ${userType} ${userId}:`, error);
    return false;
  }
}

/**
 * Schedule a follow-up email
 */
async function scheduleFollowUpEmail(userId, daysDelay, userType) {
  const followUpDate = new Date();
  followUpDate.setDate(followUpDate.getDate() + daysDelay);
  
  await admin.firestore().collection('scheduledEmails').add({
    userId: userId,
    userType: userType,
    scheduledFor: new Date(followUpDate),
    emailType: 'followUp',
    sent: false,
    createdAt: FieldValue.serverTimestamp()
  });
  
  console.log(`Follow-up email scheduled for ${userType} ${userId} in ${daysDelay} days`);
  return true;
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
      'permission-denied: Only admins can verify SMTP connection'
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