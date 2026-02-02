const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// THE FIX: Check if apps.length is 0 before initializing
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

module.exports = admin;