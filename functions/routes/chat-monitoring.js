// chat-monitoring.js
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

// Define secrets for email credentials
const emailUser = defineSecret("EMAIL_USER");
const emailPassword = defineSecret("EMAIL_PASSWORD");

/**
 * Monitors each participant's message_count in the participants subcollection
 * and sends emails when it's greater than or equal to 5
 */
exports.monitorParticipantMessageCount = onDocumentUpdated({
  document: "chats/{chatId}/participants/{participantId}",
  secrets: [emailUser, emailPassword],
  timeoutSeconds: 120,
  memory: "256MiB",
  maxInstances: 10,
}, async (event) => {
  const chatId = event.params.chatId;
  const participantId = event.params.participantId;
  
  // Get before and after data
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();
  
  // Check if message_count field exists and has just reached or exceeded 5
  // We only want to trigger if it JUST crossed the threshold
  if (!afterData.message_count || 
      afterData.message_count < 5 || 
      (beforeData.message_count && beforeData.message_count >= 5)) {
    return;
  }
  
  console.log(`Participant ${participantId} in chat ${chatId} now has ${afterData.message_count} messages (≥ 5)`);
  
  try {
    const db = admin.firestore();
    
    // Check if notification has already been sent for this chat to this participant
    const notificationCheck = await db
      .collection("chat_notifications")
      .where("chat_id", "==", chatId)
      .where("participant_id", "==", participantId)
      .where("notification_type", "==", "message_threshold")
      .where("threshold", "==", 5)
      .limit(1)
      .get();
    
    if (!notificationCheck.empty) {
      console.log(`Notification already sent to participant ${participantId} for chat ${chatId}`);
      return;
    }
    
    // Get the chat document
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) {
      console.log(`Chat ${chatId} not found`);
      return;
    }
    
    const chatData = chatDoc.data();
    
    // Get the participant's user data
    const userDoc = await db.collection("users").doc(participantId).get();
    if (!userDoc.exists) {
      console.log(`User ${participantId} not found`);
      return;
    }
    
    const userData = userDoc.data();
    
    // Skip if no email found
    if (!userData.email) {
      console.log(`No email found for user ${participantId}`);
      return;
    }
    
    // Get chat details for the email
    let chatName = "";
    if (chatData.group_chat && chatData.group_chat_name) {
      chatName = chatData.group_chat_name;
    } else {
      // For direct messages, try to get the other participant's name
      const otherParticipantIds = chatData.participant_ids.filter(id => id !== participantId);
      if (otherParticipantIds.length > 0) {
        const otherUserDocs = await Promise.all(
          otherParticipantIds.map(id => db.collection("users").doc(id).get())
        );
        
        const otherUserNames = otherUserDocs
          .filter(doc => doc.exists)
          .map(doc => {
            const data = doc.data();
            return data.name || data.display_name || data.username || "User";
          });
        
        chatName = `Conversation with ${otherUserNames.join(" and ")}`;
      } else {
        chatName = "Your conversation";
      }
    }
    
    // Configure email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail", // Or another service
      auth: {
        user: emailUser.value(),
        pass: emailPassword.value()
      }
    });
    
    // Prepare and send email
    const userName = userData.name || userData.display_name || userData.username || "User";
    const mailOptions = {
      from: "Your App <noreply@yourdomain.com>",
      to: userData.email,
      subject: `Your conversation has reached 5 messages`,
      html: `
        <h2>Conversation Update</h2>
        <p>Hello ${userName},</p>
        <p>Your conversation "${chatName}" has reached 5 messages!</p>
        <p>You can continue the conversation by logging into the app.</p>
        <br>
        <p>Thank you for using our platform!</p>
      `
    };
    
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully to ${userData.email} for chat ${chatId}`);
      
      // Record that notification was sent
      await db.collection("chat_notifications").add({
        chat_id: chatId,
        participant_id: participantId,
        notification_type: "message_threshold",
        threshold: 5,
        sent_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
    } catch (error) {
      console.error("Error sending email:", error);
    }
  } catch (error) {
    console.error(`Error processing participant ${participantId} for chat ${chatId}:`, error);
  }
});

/**
 * Test function to check a participant's message count
 */
exports.checkParticipantMessageCount = onCall({
  timeoutSeconds: 60,
  memory: "256MiB",
  maxInstances: 5,
}, async (request) => {
  // Ensure user is authenticated
  if (!request.auth) {
    throw new Error("Unauthorized");
  }
  
  const { chatId, participantId } = request.data;
  if (!chatId || !participantId) {
    throw new Error("The function must be called with both 'chatId' and 'participantId' arguments.");
  }
  
  try {
    const db = admin.firestore();
    
    // Get the participant document
    const participantRef = db
      .collection("chats")
      .doc(chatId)
      .collection("participants")
      .doc(participantId);
    
    const participantDoc = await participantRef.get();
    
    if (!participantDoc.exists) {
      throw new Error(`Participant ${participantId} not found in chat ${chatId}`);
    }
    
    const participantData = participantDoc.data();
    
    // Check if notification was already sent
    const notificationCheck = await db
      .collection("chat_notifications")
      .where("chat_id", "==", chatId)
      .where("participant_id", "==", participantId)
      .where("notification_type", "==", "message_threshold")
      .where("threshold", "==", 5)
      .limit(1)
      .get();
    
    return {
      success: true,
      chatId: chatId,
      participantId: participantId,
      messageCount: participantData.message_count || 0,
      hasReachedThreshold: (participantData.message_count || 0) >= 5,
      notificationSent: !notificationCheck.empty
    };
  } catch (error) {
    console.error("Error checking participant message count:", error);
    throw new Error(error.message);
  }
});

/**
 * Function to manually send a notification to a participant
 */
exports.manualSendNotification = onCall({
  timeoutSeconds: 120,
  memory: "256MiB",
  maxInstances: 5,
  secrets: [emailUser, emailPassword],
}, async (request) => {
  // Ensure user is authenticated
  if (!request.auth) {
    throw new Error("Unauthorized");
  }
  
  const { chatId, participantId, force } = request.data;
  if (!chatId || !participantId) {
    throw new Error("The function must be called with both 'chatId' and 'participantId' arguments.");
  }
  
  try {
    const db = admin.firestore();
    
    // Get the participant document
    const participantRef = db
      .collection("chats")
      .doc(chatId)
      .collection("participants")
      .doc(participantId);
    
    const participantDoc = await participantRef.get();
    
    if (!participantDoc.exists) {
      throw new Error(`Participant ${participantId} not found in chat ${chatId}`);
    }
    
    const participantData = participantDoc.data();
    
    // Check if message count is >= 5 unless force=true
    if (!force && (!participantData.message_count || participantData.message_count < 5)) {
      return {
        success: false,
        message: `Message count is only ${participantData.message_count || 0}, which is below threshold 5.`,
        requiresForce: true
      };
    }
    
    // Check if notification has already been sent unless force=true
    if (!force) {
      const notificationCheck = await db
        .collection("chat_notifications")
        .where("chat_id", "==", chatId)
        .where("participant_id", "==", participantId)
        .where("notification_type", "==", "message_threshold")
        .where("threshold", "==", 5)
        .limit(1)
        .get();
      
      if (!notificationCheck.empty) {
        return {
          success: false,
          message: "Notification has already been sent to this participant.",
          requiresForce: true
        };
      }
    }
    
    // Get the chat document
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists) {
      throw new Error(`Chat ${chatId} not found`);
    }
    
    const chatData = chatDoc.data();
    
    // Get the participant's user data
    const userDoc = await db.collection("users").doc(participantId).get();
    if (!userDoc.exists) {
      throw new Error(`User ${participantId} not found`);
    }
    
    const userData = userDoc.data();
    
    // Skip if no email found
    if (!userData.email) {
      throw new Error(`No email found for user ${participantId}`);
    }
    
    // Get chat details for the email
    let chatName = "";
    if (chatData.group_chat && chatData.group_chat_name) {
      chatName = chatData.group_chat_name;
    } else {
      // For direct messages, try to get the other participant's name
      const otherParticipantIds = chatData.participant_ids.filter(id => id !== participantId);
      if (otherParticipantIds.length > 0) {
        const otherUserDocs = await Promise.all(
          otherParticipantIds.map(id => db.collection("users").doc(id).get())
        );
        
        const otherUserNames = otherUserDocs
          .filter(doc => doc.exists)
          .map(doc => {
            const data = doc.data();
            return data.name || data.display_name || data.username || "User";
          });
        
        chatName = `Conversation with ${otherUserNames.join(" and ")}`;
      } else {
        chatName = "Your conversation";
      }
    }
    
    // Configure email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail", // Or another service
      auth: {
        user: emailUser.value(),
        pass: emailPassword.value()
      }
    });
    
    // Prepare and send email
    const userName = userData.name || userData.display_name || userData.username || "User";
    const mailOptions = {
      from: "Your App <noreply@yourdomain.com>",
      to: userData.email,
      subject: `Your conversation has reached 5 messages`,
      html: `
        <h2>Conversation Update</h2>
        <p>Hello ${userName},</p>
        <p>Your conversation "${chatName}" has reached 5 messages!</p>
        <p>You can continue the conversation by logging into the app.</p>
        <br>
        <p>Thank you for using our platform!</p>
      `
    };
    
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully to ${userData.email} for chat ${chatId}`);
      
      // Record that notification was sent
      await db.collection("chat_notifications").add({
        chat_id: chatId,
        participant_id: participantId,
        notification_type: "message_threshold",
        threshold: 5,
        sent_at: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return {
        success: true,
        message: `Notification email sent to ${userData.email}.`,
        chatId: chatId,
        participantId: participantId
      };
    } catch (error) {
      console.error("Error sending email:", error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  } catch (error) {
    console.error("Error in manual notification:", error);
    throw new Error(error.message);
  }
});