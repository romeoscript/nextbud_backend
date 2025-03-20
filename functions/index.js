/**
 * Main Firebase Functions entry point that combines all routes
 */

const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
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


// Use routes
app.use("/admin", adminRoutes);
app.use("/partners", partnerRoutes);


// Export the Express API as Firebase Functions
exports.api = onRequest({
  cors: true,
  maxInstances: 10,
  timeoutSeconds: 300,
  memory: '1GB',
}, app);

// Import the pending activations check function
const { checkPendingActivations } = require('./pending-activations-cron');

// Export the scheduled function to check for pending activations
exports.checkPendingActivationsScheduled = onSchedule({
  schedule: "every 1 hours",
  timeoutSeconds: 300,
  memory: '512MiB',
  retryCount: 3,
  region: 'us-central1' // Specify your preferred region
}, checkPendingActivations);