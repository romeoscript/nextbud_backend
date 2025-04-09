/* eslint-disable */
const {onDocumentCreated, onDocumentUpdated} = require('firebase-functions/v2/firestore');
const {FieldValue} = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const nodemailer = require('nodemailer');

// Initialize Firebase Admin if not already done elsewhere
if (!admin.apps.length) {
  admin.initializeApp();
}

// SMTP Configuration (reusing your existing configuration)
const SMTP_HOST = 'smtp.maileroo.com';
const SMTP_USER = 'romeo@fb66ec3261d3c0b5.maileroo.org';
const SMTP_PASS = 'ab36b81d5adef147303ecbb0';
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
 * Send email using SMTP with Nodemailer
 */
async function sendEmail(toEmail, toName, subject, htmlContent, textContent) {
  try {
    // Set up email options
    const mailOptions = {
      from: `"${EMAIL_FROM_NAME}" <${SMTP_USER}>`,
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
    
    console.log('Connection email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending connection email via SMTP:', error);
    throw error;
  }
}

/**
 * Function that triggers when a new connection document is created
 * Sends an email notification to the receiver of the connection request
 */
exports.onNewConnectionRequest = onDocumentCreated({
  document: 'connections/{connectionId}',
  region: 'us-central1'
}, async (event) => {
  const snapshot = event.data;
  const context = event.params;
  
  try {
    const connectionData = snapshot.data();
    const connectionId = context.connectionId;
    
    console.log(`New connection request detected: ${connectionId}`);
    
    // Only process new connection requests (with pending status)
    if (connectionData.connection_status !== 'ConnectionStatus.pending') {
      console.log(`Connection ${connectionId} is not a new pending request. Status: ${connectionData.connection_status}`);
      return { success: false, reason: 'Not a pending connection request' };
    }

    // Get the receiver's data to obtain their email
    const receiverId = connectionData.receiver_id;
    const receiverDoc = await admin.firestore().collection('users').doc(receiverId).get();
    
    if (!receiverDoc.exists) {
      console.error(`Receiver user ${receiverId} not found`);
      return { success: false, error: 'Receiver user not found' };
    }
    
    const receiverData = receiverDoc.data();
    const receiverEmail = receiverData.email;
    
    // Skip if no email or email is not valid
    if (!receiverEmail || receiverData.isEmailValid === false) {
      console.log(`Skipping connection email for invalid or missing email: ${receiverEmail || 'none'}`);
      return { success: false, reason: 'Invalid or missing receiver email' };
    }
    
    // Get requester data for more context in the email
    const requesterId = connectionData.requester_id;
    const requesterDoc = await admin.firestore().collection('users').doc(requesterId).get();
    let requesterData = { displayName: connectionData.requester_name };
    
    if (requesterDoc.exists) {
      requesterData = requesterDoc.data();
    }
    
    // Prepare email subject and content
    const subject = `${requesterData.displayName || 'Someone'} wants to connect with you on NextBud`;
    
    // Prepare template variables
    const templateData = {
      receiverName: receiverData.displayName || receiverData.username || connectionData.receiver_name,
      requesterName: requesterData.displayName || connectionData.requester_name,
      requesterUsername: requesterData.username || null,
      requesterImageUrl: requesterData.profileImageUrl || null,
      connectionId: connectionId,
      connectionDate: connectionData.requested_at ? new Date(connectionData.requested_at).toLocaleDateString() : new Date().toLocaleDateString(),
      appUrl: 'https://nextbudapp.com',
      connectionsUrl: 'https://nextbudapp.com/connections',
      profileUrl: `https://nextbudapp.com/user/${requesterId}`,
      currentYear: new Date().getFullYear()
    };
    
    // Get the template for connection requests
    const template = getTemplate('connection-request');
    
    // Render the template
    const htmlContent = template(templateData);
    
    // Send email via SMTP
    await sendEmail(receiverEmail, templateData.receiverName, subject, htmlContent);
    
    console.log(`Connection request email sent to ${receiverEmail}`);
    
    // Update connection document to mark email as sent
    await snapshot.ref.update({
      notificationEmailSent: true,
      notificationEmailSentAt: FieldValue.serverTimestamp()
    });
    
    return { success: true, emailSent: true };
  } catch (error) {
    console.error('Error sending connection request email:', error);
    
    // Attempt to update the document to indicate failure
    try {
      await snapshot.ref.update({
        notificationEmailSent: false,
        notificationEmailError: error.message
      });
    } catch (updateError) {
      console.error('Failed to update connection document after error:', updateError);
    }
    
    return { success: false, error: error.message };
  }
});

/**
 * Function that triggers when a connection document is updated
 * Sends notification emails when connections are accepted or rejected
 */
exports.onConnectionStatusChanged = onDocumentUpdated({
  document: 'connections/{connectionId}',
  region: 'us-central1'
}, async (event) => {
  const snapshot = event.data;
  const context = event.params;
  const before = snapshot.before.data();
  const after = snapshot.after.data();
  
  try {
    const connectionId = context.connectionId;
    
    // Only proceed if the connection status has changed
    if (before.connection_status === after.connection_status) {
      return { success: false, reason: 'Connection status unchanged' };
    }
    
    console.log(`Connection status changed for ${connectionId}: ${before.connection_status} -> ${after.connection_status}`);
    
    // Handle accepted connections
    if (after.connection_status === 'ConnectionStatus.accepted') {
      // Notify the requester that their connection was accepted
      await sendConnectionAcceptedEmail(after, connectionId);
    }
    
    // Handle rejected connections
    if (after.connection_status === 'ConnectionStatus.rejected') {
      // Optionally notify the requester that their connection was rejected
      // This is commented out as many platforms don't notify on rejections
      // await sendConnectionRejectedEmail(after, connectionId);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error processing connection status change:', error);
    return { success: false, error: error.message };
  }
});

/**
 * Send email notification when a connection request is accepted
 */
async function sendConnectionAcceptedEmail(connectionData, connectionId) {
  try {
    // Get the requester's data to obtain their email
    const requesterId = connectionData.requester_id;
    const requesterDoc = await admin.firestore().collection('users').doc(requesterId).get();
    
    if (!requesterDoc.exists) {
      console.error(`Requester user ${requesterId} not found`);
      return false;
    }
    
    const requesterData = requesterDoc.data();
    const requesterEmail = requesterData.email;
    
    // Skip if no email or email is not valid
    if (!requesterEmail || requesterData.isEmailValid === false) {
      console.log(`Skipping connection accepted email for invalid or missing email: ${requesterEmail || 'none'}`);
      return false;
    }
    
    // Get receiver data for the email
    const receiverId = connectionData.receiver_id;
    const receiverDoc = await admin.firestore().collection('users').doc(receiverId).get();
    let receiverData = { displayName: connectionData.receiver_name };
    
    if (receiverDoc.exists) {
      receiverData = receiverDoc.data();
    }
    
    // Prepare email subject
    const subject = `${receiverData.displayName || connectionData.receiver_name} accepted your connection on NextBud`;
    
    // Prepare template variables
    const templateData = {
      requesterName: requesterData.displayName || requesterData.username || connectionData.requester_name,
      receiverName: receiverData.displayName || connectionData.receiver_name,
      receiverUsername: receiverData.username || null,
      receiverImageUrl: receiverData.profileImageUrl || null,
      connectionId: connectionId,
      acceptedDate: connectionData.accepted_at ? new Date(connectionData.accepted_at).toLocaleDateString() : new Date().toLocaleDateString(),
      appUrl: 'https://nextbudapp.com',
      connectionsUrl: 'https://nextbudapp.com/connections',
      profileUrl: `https://nextbudapp.com/user/${receiverId}`,
      chatUrl: `https://nextbudapp.com/chat/${connectionId}`,
      currentYear: new Date().getFullYear()
    };
    
    // Get the template for accepted connections
    const template = getTemplate('connection-accepted');
    
    // Render the template
    const htmlContent = template(templateData);
    
    // Send email via SMTP
    await sendEmail(requesterEmail, templateData.requesterName, subject, htmlContent);
    
    console.log(`Connection accepted email sent to ${requesterEmail}`);
    
    // Update connection document
    await admin.firestore().collection('connections').doc(connectionId).update({
      acceptedEmailSent: true,
      acceptedEmailSentAt: FieldValue.serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error(`Error sending connection accepted email for connection ${connectionId}:`, error);
    return false;
  }
}

module.exports = exports;