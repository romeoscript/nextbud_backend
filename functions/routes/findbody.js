// routes/users.js - Create this file in your routes directory
const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");

/**
 * Route to filter users based on various criteria
 * POST /users/filter
 */

const isDevelopment = process.env.NODE_ENV === 'development' || process.env.FUNCTIONS_EMULATOR === 'true';
router.post("/filter", async (req, res) => {
    try {
        let userId;
        
        // DEVELOPMENT ONLY: Allow test mode with explicit user ID
        if (isDevelopment && req.body.testMode === true && req.body.testUserId) {
          console.log('WARNING: Using test mode authentication');
          userId = req.body.testUserId;
        } else {
          // Normal authentication flow
          const authHeader = req.headers.authorization;
          
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
              success: false, 
              error: 'Unauthorized. Missing or invalid authentication token.'
            });
          }
          
          const idToken = authHeader.split('Bearer ')[1];
          let decodedToken;
          
          try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
          } catch (error) {
            return res.status(401).json({ 
              success: false, 
              error: 'Unauthorized. Invalid authentication token.'
            });
          }
          
          userId = decodedToken.uid;
        }
    
    // Get filter parameters from request body
    const {
      ageRanges = [], 
      genders = [], 
      seekingFriendship = false,
      openToRelationship = false, 
      maritalStatuses = [], 
      nonHomeCountry = false,
      lastDoc = null,
      limit = 20,
      userLocation = null,
      maxDistance = 100,
    } = req.body;
    
    // Get the current user's info to exclude them from results
    const currentUserDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!currentUserDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Current user profile not found'
      });
    }
    
    const currentUserData = currentUserDoc.data();
    
    // Start building the query
    let query = admin.firestore().collection('users');
    
    // Don't include the current user in results
    query = query.where('uid', '!=', userId);
    
    // Filter out deleted users
    query = query.where('is_deleted', '==', false);
    
    // Apply age range filters if specified
    if (ageRanges && ageRanges.length > 0) {
      // If only one age range is selected, we can filter directly in the query
      if (ageRanges.length === 1) {
        query = query.where('visibility_profile.age_group', '==', ageRanges[0]);
      }
      // If multiple age ranges, we'll filter in memory after retrieving data
    }
    
    // Add pagination if a last document is provided
    if (lastDoc) {
      const lastDocSnapshot = await admin.firestore().collection('users').doc(lastDoc).get();
      if (lastDocSnapshot.exists) {
        query = query.startAfter(lastDocSnapshot);
      }
    }
    
    // Apply limit
    query = query.limit(limit * 3); // Get more than needed to account for in-memory filtering
    
    // Execute the query
    const querySnapshot = await query.get();
    
    if (querySnapshot.empty) {
      return res.status(200).json({ 
        success: true, 
        users: [], 
        lastDoc: null,
        totalResults: 0
      });
    }
    
    // Process results and apply remaining filters in memory
    let filteredUsers = [];
    
    querySnapshot.forEach(doc => {
      const userData = doc.data();
      let include = true;
      
      if (genders && genders.length > 0) {
        // Convert UI gender values to database format (e.g., "Male" -> "Gender.male")
        const dbFormatGenders = genders.map(gender => {
          const lowerCaseGender = gender.toLowerCase();
          if (lowerCaseGender === 'male') return 'Gender.male';
          if (lowerCaseGender === 'female') return 'Gender.female';
          if (lowerCaseGender === 'others') return 'Gender.others';
          return gender; // return as-is if no mapping found
        });
        
        // Check if user's gender matches any selected gender
        if (!userData.visibility_profile || 
            !userData.visibility_profile.gender || 
            !dbFormatGenders.includes(userData.visibility_profile.gender)) {
          include = false;
        }
      }
      
      if (maritalStatuses && maritalStatuses.length > 0) {
        // Convert UI marital status values to database format (e.g., "Single" -> "MaritalStatus.single")
        const dbFormatMaritalStatuses = maritalStatuses.map(status => {
          const lowerCaseStatus = status.toLowerCase();
          if (lowerCaseStatus === 'single') return 'MaritalStatus.single';
          if (lowerCaseStatus === 'married') return 'MaritalStatus.married';
          if (lowerCaseStatus === 'divorced') return 'MaritalStatus.divorced';
          if (lowerCaseStatus === 'widowed') return 'MaritalStatus.widowed';
          if (lowerCaseStatus === 'in a relationship') return 'MaritalStatus.inRelationship';
          if (lowerCaseStatus === 'complicated') return 'MaritalStatus.complicated';
          return status; 
        });
        
        if (!userData.visibility_profile || 
            !userData.visibility_profile.status || 
            !dbFormatMaritalStatuses.includes(userData.visibility_profile.status)) {
          include = false;
        }
      }
      
      // Apply friendship filter
      if (seekingFriendship) {
        // Check if user has seeking_friendship set to true in visibility_profile
        if (!userData.visibility_profile || 
            userData.visibility_profile.seeking_friendship !== true) {
          include = false;
        }
      }
      
      // Apply relationship filter
      if (openToRelationship) {
        // Check if user has open_to_relationship set to true in visibility_profile
        if (!userData.visibility_profile || 
            userData.visibility_profile.open_to_relationship !== true) {
          include = false;
        }
      }
      
      // Apply non-home country filter
      if (nonHomeCountry && currentUserData.country_of_residence) {
        // Check if user's country is different from current user's
        if (!userData.country_of_residence || 
            userData.country_of_residence === currentUserData.country_of_residence) {
          include = false;
        }
      }
      
      // Apply all age range filters if multiple selected
      if (ageRanges && ageRanges.length > 1) {
        let matchesAgeRange = false;
        
        if (userData.visibility_profile && userData.visibility_profile.age_group) {
          const userAgeGroup = userData.visibility_profile.age_group;
          matchesAgeRange = ageRanges.includes(userAgeGroup);
        }
        
        if (!matchesAgeRange) {
          include = false;
        }
      }
      
      // Location-based filtering (if requested)
      if (userLocation && userData.location && include) {
        // Calculate distance using Haversine formula
        const distance = calculateDistance(
          userLocation.latitude, 
          userLocation.longitude,
          userData.location.latitude,
          userData.location.longitude
        );
        
        if (distance > maxDistance) {
          include = false;
        }
        
        // Add distance to user data for sorting
        userData.distance = distance;
      }
      
      // If user passes all filters, include them
      if (include) {
        // Add user to results, excluding sensitive fields
        const safeUserData = sanitizeUserData(userData);
        safeUserData.id = doc.id;
        filteredUsers.push(safeUserData);
      }
    });
    
    // Sort users (by distance if location filtering was used)
    if (userLocation) {
      filteredUsers.sort((a, b) => a.distance - b.distance);
    }
    
    // Limit results to requested size
    filteredUsers = filteredUsers.slice(0, limit);
    
    // Get the last document ID for pagination
    const lastVisible = filteredUsers.length > 0 ? filteredUsers[filteredUsers.length - 1].id : null;
    
    return res.status(200).json({
      success: true,
      users: filteredUsers,
      lastDoc: lastVisible,
      totalResults: filteredUsers.length
    });
    
  } catch (error) {
    console.error('Error filtering users:', error);
    return res.status(500).json({ 
      success: false, 
      error: `Error filtering users: ${error.message}`
    });
  }
});

/**
 * Helper function to calculate distance between two coordinates
 * Using Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const distance = R * c; // Distance in km
  return distance;
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

/**
 * Helper function to sanitize user data before returning
 * Removes sensitive information
 */
function sanitizeUserData(userData) {
  // Create a copy of the user data
  const safeData = { ...userData };
  
  // Remove sensitive fields
  const sensitiveFields = [
    'email', 
    'phone_number',
    'full_address',
    'password',
    'authentication_methods',
    'private_notes',
    'private_settings',
    'payment_info',
    'id_verification_documents',
    'token' // Firebase messaging token
  ];
  
  sensitiveFields.forEach(field => {
    if (safeData.hasOwnProperty(field)) {
      delete safeData[field];
    }
  });
  
  return safeData;
}

module.exports = router;