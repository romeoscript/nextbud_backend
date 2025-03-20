/**
 * Main Firebase Functions entry point that combines all routes
 */

const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");


// Initialize Firebase Admin SDK
admin.initializeApp();

// Create Express app
const app = express();

// Middleware
app.use(cors({origin: true}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import route modules
const adminRoutes = require("./routes/admin");
const partnerRoutes = require("./routes/partners");
const subscriptionRoutes = require("./routes/subscriptions");


// Use routes
app.use("/admin", adminRoutes);
app.use("/partners", partnerRoutes);
app.use("/api/subscriptions", subscriptionRoutes);


// Export the Express API as Firebase Functions
exports.api = onRequest({
  cors: true,
  maxInstances: 10,
  timeoutSeconds: 300,
  memory: '1GB',
}, app);