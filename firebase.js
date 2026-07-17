import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase's client config values are meant to be public — they identify
// your project, not a secret. Real protection comes from the Authentication
// requirement and the Firestore security rules, not from hiding these.
//
// Replace every "REPLACE_ME" below with the values from your Firebase
// project: Project settings (gear icon) → General → "Your apps" → the web
// app's config snippet.
const firebaseConfig = {
  apiKey: "AIzaSyAyXo9AMSq6iSZ_72w7j7pWAkmFI5MSb7M",
  authDomain: "besely-schedule.firebaseapp.com",
  projectId: "besely-schedule",
  storageBucket: "besely-schedule.firebasestorage.app",
  messagingSenderId: "476680231004",
  appId: "1:476680231004:web:08fc373cb868124332ee99",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
