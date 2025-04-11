const admin = require('firebase-admin');

// Initialize Firebase Admin with emulator settings
const initializeFirebase = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: 'nextbud-e3389'
    });
  }
  
  // Connect to Firestore emulator
  const db = admin.firestore();
  db.settings({
    host: 'localhost:8080',
    ssl: false
  });
  
  return { admin, db };
};

// Function to create test users
const createTestUsers = async (db) => {
  console.log('Creating test users...');
  
  const users = [
    {
      uid: 'test-user-london',
      name: 'London User',
      email: 'london@example.com',
      city_of_residence: 'London',
      country_of_residence: 'United Kingdom',
      created_at: Date.now().toString()
    },
    {
      uid: 'test-user-manchester',
      name: 'Manchester User',
      email: 'osbornromeo@gmail.com',
      city_of_residence: 'Manchester',
      country_of_residence: 'United Kingdom',
      created_at: Date.now().toString()
    },
    {
      uid: 'test-user-berlin',
      name: 'Berlin User',
      email: 'romeobourne211@gmail.com',
      city_of_residence: 'Berlin',
      country_of_residence: 'Germany',
      created_at: Date.now().toString()
    },
    {
      uid: 'test-poster',
      name: 'Event Poster',
      email: 'poster@example.com',
      city_of_residence: 'London',
      country_of_residence: 'United Kingdom',
      created_at: Date.now().toString()
    }
  ];
  
  // Add each user to Firestore
  const batch = db.batch();
  
  for (const user of users) {
    const userRef = db.collection('users').doc(user.uid);
    batch.set(userRef, user);
  }
  
  await batch.commit();
  console.log(`Created ${users.length} test users`);
  
  return users;
};

// Function to create a test event
const createTestEvent = async (db, eventType, posterId) => {
  console.log(`Creating test ${eventType} event...`);
  
  const now = new Date();
  const eventId = `test-event-${eventType}-${now.getTime()}`;
  
  let eventData = {
    title: `Test ${eventType} Event`,
    description: "This is a test event created for testing the notification system. Join us for an amazing time!",
    date: `${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}`,
    time: `${now.getHours()}:${now.getMinutes()}`,
    created_at: now,
    updated_at: now,
    poster_id: posterId,
    poster_name: "Event Poster",
    poster_city_of_residence: "London",
    poster_country_of_residence: "United Kingdom",
    rsvp_count: 1,
    recommended: true,
    is_allowed: true,
    is_shadow_banned: false,
    event_chat_id: `chat-${eventId}`,
    image_urls: ["https://res.cloudinary.com/demo/image/upload/sample.jpg"]
  };
  
  // Set location based on event type
  if (eventType === 'virtual') {
    eventData.state_of_event = "Virtual";
    eventData.event_location = "Nill";
  } else if (eventType === 'nill') {
    eventData.state_of_event = "Nill";
    eventData.event_location = "Nill";
  } else if (eventType === 'manchester') {
    eventData.state_of_event = "Manchester";
    eventData.event_location = "Manchester";
  }
  
  await db.collection('events').doc(eventId).set(eventData);
  console.log(`Created ${eventType} event with ID: ${eventId}`);
  
  return eventId;
};

// Main function to run our test
const runTest = async () => {
  try {
    console.log('Starting test for event notification system...');
    
    // Initialize Firebase
    const { db } = initializeFirebase();
    console.log('Firebase initialized and connected to emulator');
    
    // Create test users
    await createTestUsers(db);
    
    // Create a virtual event (should notify all users)
    await createTestEvent(db, 'virtual', 'test-poster');
    console.log('Created virtual event - should notify ALL users');
    
    // Wait a bit between operations
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Create a "Nill" location event (should notify only London users)
    await createTestEvent(db, 'nill', 'test-poster');
    console.log('Created event with "Nill" location - should notify only LONDON users');
    
    // Wait a bit between operations
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Create a Manchester event (should notify only Manchester users)
    await createTestEvent(db, 'manchester', 'test-poster');
    console.log('Created Manchester event - should notify only MANCHESTER users');
    
    console.log('\nTest complete! Check the function logs to verify that notifications were sent correctly.');
    console.log('Expected results:');
    console.log('1. Virtual event: All users should receive a notification');
    console.log('2. Nill event: Only London users should receive a notification');
    console.log('3. Manchester event: Only Manchester users should receive a notification');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
};

// Export the functions for command-line usage
module.exports = {
  runTest,
  createTestUsers,
  createTestEvent,
  initializeFirebase
};

// If this script is run directly
if (require.main === module) {
  runTest();
}