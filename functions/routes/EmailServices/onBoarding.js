const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {onCall} = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

// Maileroo API configuration
const MAILEROO_API_KEY = process.env.MAILEROO_API_KEY;
const MAILEROO_SMTP_URL = 'https://smtp.maileroo.com';
const MAILEROO_VERIFY_URL = 'https://verify.maileroo.net';
const MAILEROO_FROM_EMAIL = process.env.MAILEROO_FROM_EMAIL || 'noreply@yourapp.com';
const MAILEROO_FROM_NAME = process.env.MAILEROO_FROM_NAME || 'YourApp';

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
    
    // Mark the email as being checked
    await snapshot.ref.update({
      emailCheckInProgress: true,
      emailCheckStartedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Check if the email is valid using Maileroo
    const emailVerificationResult = await verifyEmailWithMaileroo(userEmail);
    
    // Update the user document with verification result
    await snapshot.ref.update({
      emailCheckInProgress: false,
      emailCheckCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      emailVerificationResult: emailVerificationResult,
      isEmailValid: emailVerificationResult.status === 'valid'
    });
    
    // If email is valid, send welcome email
    if (emailVerificationResult.status === 'valid') {
      // Schedule welcome email to be sent immediately
      await admin.firestore().collection('scheduledEmails').add({
        userId: userId,
        userType: 'regular',
        scheduledFor: admin.firestore.FieldValue.serverTimestamp(),
        emailType: 'welcome',
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      console.log(`Email ${userEmail} was found to be invalid or risky, not sending welcome email`);
    }
    
    return { success: true, emailStatus: emailVerificationResult.status };
  } catch (error) {
    console.error('Error processing new user:', error);
    return null;
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
    
    // Mark the email as being checked
    await snapshot.ref.update({
      emailCheckInProgress: true,
      emailCheckStartedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Check if the email is valid using Maileroo
    const emailVerificationResult = await verifyEmailWithMaileroo(influencerEmail);
    
    // Update the influencer document with verification result
    await snapshot.ref.update({
      emailCheckInProgress: false,
      emailCheckCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      emailVerificationResult: emailVerificationResult,
      isEmailValid: emailVerificationResult.status === 'valid'
    });
    
    // If email is valid, send welcome email
    if (emailVerificationResult.status === 'valid') {
      // Schedule welcome email to be sent immediately
      await admin.firestore().collection('scheduledEmails').add({
        userId: influencerId,
        userType: 'influencer',
        scheduledFor: admin.firestore.FieldValue.serverTimestamp(),
        emailType: 'welcome',
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      console.log(`Email ${influencerEmail} was found to be invalid or risky, not sending welcome email`);
    }
    
    return { success: true, emailStatus: emailVerificationResult.status };
  } catch (error) {
    console.error('Error processing new influencer:', error);
    return null;
  }
});

/**
 * Check if an email address is valid using Maileroo's verification service
 */
async function verifyEmailWithMaileroo(emailAddress) {
  try {
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
    
    return {
      status: response.data.status, // 'valid', 'invalid', 'risky', etc.
      score: response.data.score,   // Confidence score
      reason: response.data.reason, // Reason for status
      full_response: response.data  // Store full response for reference
    };
  } catch (error) {
    console.error(`Error verifying email ${emailAddress} with Maileroo:`, error);
    
    // Return a fallback result in case of API error
    return {
      status: 'unknown',
      score: 0,
      reason: 'API error',
      error: error.message,
      full_response: null
    };
  }
}

/**
 * Send email using Maileroo API with HTML content
 */
async function sendMailerooEmail(toEmail, toName, subject, htmlContent, textContent) {
  try {
    const form = new FormData();
    
    // Set required fields
    form.append('from', `${MAILEROO_FROM_NAME} <${MAILEROO_FROM_EMAIL}>`);
    form.append('to', `${toName} <${toEmail}>`);
    form.append('subject', subject);
    form.append('html', htmlContent);
    
    if (textContent) {
      form.append('text', textContent);
    }
    
    // Send request to Maileroo
    const response = await axios.post(`${MAILEROO_SMTP_URL}/send`, form, {
      headers: {
        ...form.getHeaders(),
        'X-API-Key': MAILEROO_API_KEY
      }
    });
    
    console.log('Maileroo send response:', response.data);
    return { success: true, messageId: response.data.id };
  } catch (error) {
    console.error('Error sending email via Maileroo:', error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Scheduled function that runs every 15 minutes to check for emails that need to be sent
 */
exports.sendScheduledEmails = async (context) => {
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
      
      if (scheduledEmail.emailType === 'welcome') {
        emailPromises.push(sendWelcomeEmail(
          scheduledEmail.userId, 
          doc.id,
          scheduledEmail.userType || 'regular'
        ));
      } else if (scheduledEmail.emailType === 'followUp') {
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
};

/**
 * Send welcome email after email verification check
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
      ? 'Welcome to YourApp Creator Program!'
      : 'Welcome to YourApp!';
      
    // Prepare template variables
    const templateData = {
      firstName: userName.split(' ')[0] || userName,
      fullName: userName,
      appUrl: 'https://yourapp.com',
      profileUrl: `https://yourapp.com/${userType === 'influencer' ? 'creator' : 'user'}/profile`,
      dashboardUrl: `https://yourapp.com/${userType === 'influencer' ? 'creator-dashboard' : 'dashboard'}`,
      analyticsUrl: `https://yourapp.com/analytics`,
      userType: userType === 'influencer' ? 'Creator' : 'User',
      currentYear: new Date().getFullYear(),
      email: userEmail
    };
    
    // Get the appropriate template
    const templateName = userType === 'influencer' ? 'welcome-influencer' : 'welcome-user';
    const template = getTemplate(templateName);
    
    // Render the template
    const htmlContent = template(templateData);
    
    // Send email via Maileroo
    await sendMailerooEmail(userEmail, userName, subject, htmlContent);
    
    console.log(`Welcome email sent to ${userEmail} (${userType}) via Maileroo`);
    
    // Mark the scheduled email as sent
    await admin.firestore().collection('scheduledEmails').doc(scheduledEmailId).update({
      sent: true,
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update user record
    await admin.firestore().collection(collectionName).doc(userId).update({
      welcomeEmailSent: true,
      welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
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
    scheduledFor: admin.firestore.Timestamp.fromDate(followUpDate),
    emailType: 'followUp',
    sent: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
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
      ? 'Maximize Your Reach on YourApp'
      : 'How are you enjoying YourApp?';
      
    // Calculate days since signup
    const daysSinceSignup = userType === 'influencer' ? 3 : 7;
    
    // Prepare template variables
    const templateData = {
      firstName: userName.split(' ')[0] || userName,
      fullName: userName,
      appUrl: 'https://yourapp.com',
      discoverUrl: 'https://yourapp.com/discover',
      eventsUrl: 'https://yourapp.com/events',
      createUrl: 'https://yourapp.com/create',
      analyticsUrl: 'https://yourapp.com/analytics',
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
    
    // Send email via Maileroo
    await sendMailerooEmail(userEmail, userName, subject, htmlContent);
    
    console.log(`Follow-up email sent to ${userEmail} (${userType}) via Maileroo`);
    
    // Mark the scheduled email as sent
    await admin.firestore().collection('scheduledEmails').doc(scheduledEmailId).update({
      sent: true,
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update user record
    await admin.firestore().collection(collectionName).doc(userId).update({
      followUpEmailSent: true,
      followUpEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error(`Error sending follow-up email to ${userType} ${userId}:`, error);
    return false;
  }
}

/**
 * Manual function to check an email's validity (admin only)
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
    const result = await verifyEmailWithMaileroo(email);
    return { success: true, result };
  } catch (error) {
    throw new Error(`internal: ${error.message}`);
  }
});

/**
 * Manual function to test sending an email (admin only)
 */
exports.testEmail = onCall({
  region: 'us-central1'
}, async (request) => {
  // Security check
  const {data, auth} = request;
  if (!auth || !auth.token.admin) {
    throw new Error(
      'permission-denied: Only admins can test emails'
    );
  }
  
  const { email, name, templateName, subject, templateData } = data;
  
  if (!email || !templateName) {
    throw new Error(
      'invalid-argument: Email and templateName are required'
    );
  }
  
  try {
    // Get the template
    const template = getTemplate(templateName);
    
    // Render the template with provided data or default data
    const htmlContent = template(templateData || {
      firstName: name || 'Test',
      fullName: name || 'Test User',
      appUrl: 'https://yourapp.com',
      profileUrl: 'https://yourapp.com/user/profile',
      dashboardUrl: 'https://yourapp.com/dashboard',
      analyticsUrl: 'https://yourapp.com/analytics',
      currentYear: new Date().getFullYear(),
      email: email
    });
    
    // Send email
    const result = await sendMailerooEmail(
      email,
      name || 'Test User',
      subject || 'Test Email from YourApp',
      htmlContent
    );
    
    return { success: true, result };
  } catch (error) {
    throw new Error(`internal: ${error.message}`);
  }
});

module.exports = exports;