import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCYBHSRmkw3h3ajZQeOG5YDRQrvMELNGZ0",
  authDomain: "aquaguard-iot-14188.firebaseapp.com",
  databaseURL: "https://aquaguard-iot-14188-default-rtdb.firebaseio.com",
  projectId: "aquaguard-iot-14188",
  storageBucket: "aquaguard-iot-14188.firebasestorage.app",
  messagingSenderId: "830391961441",
  appId: "1:830391961441:web:cbd4295e0a00c7ea71a720"
};

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Create Realtime Database instance
const db = getDatabase(app);

// Export database
export { db };