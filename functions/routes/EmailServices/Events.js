/* eslint-disable */
const {onDocumentCreated} = require('firebase-functions/v2/firestore');
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
    
    console.log('Event notification email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending event notification email via SMTP:', error);
    throw error;
  }
}

/**
 * Function that triggers when a new event document is created
 * Sends an email notification to users in the same location
 */
exports.onNewEventCreated = onDocumentCreated({
  document: 'events/{eventId}',
  region: 'us-central1'
}, async (event) => {
  const snapshot = event.data;
  const context = event.params;
  
  try {
    const eventData = snapshot.data();
    const eventId = context.eventId;
    
    console.log(`New event detected: ${eventId}`);
    
    // Get event location details
    const eventLocation = eventData.state_of_event;
    const posterCity = eventData.poster_city_of_residence || '';
    
    // Skip processing if event location data is not properly set
    if (!eventLocation) {
      console.log(`Event ${eventId} has no location data. Skipping notifications.`);
      return { success: false, reason: 'Missing event location data' };
    }
    
    // Find users in the same location as the event
    let usersQuery = admin.firestore().collection('users');
    
    // For virtual events, we can notify all users
    // For physical events but "Nill" location, use poster's city
    // For physical events with specific location, use event location
    if (eventLocation === 'Virtual') {
      // Notify everyone for virtual events
      console.log('Virtual event detected. All users will be notified.');
    } else if (eventLocation === 'Nill' && posterCity) {
      // If location is "Nill", use poster's city as fallback
      console.log(`Event location is Nill. Using poster's city: ${posterCity}`);
      usersQuery = usersQuery.where('city_of_residence', '==', posterCity);
    } else {
      // Use the event location for filtering
      console.log(`Filtering users by event location: ${eventLocation}`);
      usersQuery = usersQuery.where('city_of_residence', '==', eventLocation);
    }
    
    const usersSnapshot = await usersQuery.get();
    
    if (usersSnapshot.empty) {
      console.log(`No users found in the location`);
      return { success: false, reason: 'No users found in this location' };
    }
    
    console.log(`Found ${usersSnapshot.size} users in the location`);
    
    // Prepare email content
    const emailPromises = [];
    
    // Format the event date and time for display
    const eventDate = eventData.date || 'TBA';
    const eventTime = eventData.time || 'TBA';
    
    // Get the image URL (first one in the array)
    const eventImageUrl = eventData.image_urls && eventData.image_urls.length > 0 
      ? eventData.image_urls[0] 
      : null;
    
    // Send email to each matching user
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userEmail = userData.email;
      
      // Skip if email is missing or user is the event creator
      if (!userEmail || userData.uid === eventData.poster_id) {
        continue;
      }
      
      // Skip if the user doesn't have an email
      if (!userEmail) {
        console.log(`User ${userDoc.id} doesn't have an email address. Skipping notification.`);
        continue;
      }
      
      // Prepare email subject
      const subject = `New Event Alert: ${eventData.title}`;
      
      // Check if the event matches any of the user's interests
      const matchesInterests = checkEventInterestMatch(eventData, userData);
      
      // Determine the location to display in the email
      let displayLocation = eventLocation;
      
      // If it's "Nill", show the poster's city instead
      if (eventLocation === 'Nill') {
        displayLocation = posterCity || 'Unknown Location';
      }
      
      // Prepare template data
      const templateData = {
        userName: userData.name || 'NextBud User',
        eventTitle: eventData.title,
        eventDescription: eventData.description || 'No description provided',
        eventDate: eventDate,
        eventTime: eventTime,
        eventLocation: displayLocation,
        eventImageUrl: eventImageUrl,
        posterName: eventData.poster_name || 'A NextBud User',
        rsvpCount: eventData.rsvp_count || 0,
        eventPageUrl: `https://nextbudapp.com/events/${eventId}`,
        appUrl: 'https://nextbudapp.com',
        currentYear: new Date().getFullYear(),
        matchesInterests: matchesInterests
      };
      
      try {
        // Get the template for event notifications
        const template = getTemplate('event-notification');
        
        // Render the template with the data
        const htmlContent = template(templateData);
        
        // Send email
        emailPromises.push(
          sendEmail(userEmail, templateData.userName, subject, htmlContent)
            .then(() => ({ userId: userDoc.id, success: true }))
            .catch(error => ({ userId: userDoc.id, success: false, error: error.message }))
        );
      } catch (templateError) {
        console.error(`Error processing template for user ${userDoc.id}:`, templateError);
      }
    }
    
    // Wait for all emails to be sent
    const emailResults = await Promise.allSettled(emailPromises);
    
    // Count successful emails
    const successfulEmails = emailResults.filter(result => 
      result.status === 'fulfilled' && result.value.success
    ).length;
    
    console.log(`Successfully sent ${successfulEmails} out of ${emailPromises.length} event notification emails`);
    
    // Update the event document to track notification status
    await snapshot.ref.update({
      notificationEmailsSent: successfulEmails,
      notificationEmailsSentAt: FieldValue.serverTimestamp()
    });
    
    return { 
      success: true, 
      emailsSent: successfulEmails,
      totalUsers: usersSnapshot.size
    };
  } catch (error) {
    console.error('Error sending event notification emails:', error);
    
    // Attempt to update the document to indicate failure
    try {
      await snapshot.ref.update({
        notificationEmailsError: error.message
      });
    } catch (updateError) {
      console.error('Failed to update event document after error:', updateError);
    }
    
    return { success: false, error: error.message };
  }
});

/**
 * Helper function to check if an event matches the user's interests
 */
function checkEventInterestMatch(eventData, userData) {
  // If we don't have enough data to check, return false
  if (!eventData.description || !userData.interests || !userData.interests.length) {
    return false;
  }
  
  // Extract all interests from the user data
  const userInterests = [];
  userData.interests.forEach(category => {
    if (category.category_interests && Array.isArray(category.category_interests)) {
      userInterests.push(...category.category_interests);
    }
  });
  

  if (userInterests.length === 0) {
    return false;
  }
  

  const eventText = (eventData.title + ' ' + eventData.description).toLowerCase();
  
  for (const interest of userInterests) {
    if (eventText.includes(interest.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

/**
 * Create the event notification template in the filesystem
 */
exports.createEventNotificationTemplate = () => {

  const eventTemplateContent = fs.readFileSync(path.join(__dirname, 'event-notification.hbs'), 'utf8');
  
  // Write this template to the templates directory
  const templateDir = path.join(__dirname, 'templates', 'emails');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(templateDir)) {
    fs.mkdirSync(templateDir, { recursive: true });
  }
  
  const templatePath = path.join(templateDir, 'event-notification.hbs');
  
  // Only write if the file doesn't exist
  if (!fs.existsSync(templatePath)) {
    fs.writeFileSync(templatePath, eventTemplateContent);
    console.log('Created event notification template at:', templatePath);
  }
};

module.exports = exports;