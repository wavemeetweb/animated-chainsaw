import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your Firebase config (wave-meett project)
const firebaseConfig = {
  apiKey: "AIzaSyBsMMxOpiriP1UfQ45yvs-aR6SgQblO7Nc",
  authDomain: "wave-meett.firebaseapp.com",
  projectId: "wave-meett",
  storageBucket: "wave-meett.firebasestorage.app",
  messagingSenderId: "866825007815",
  appId: "1:866825007815:web:7074f02f551a232889c4e2",
  measurementId: "G-66NYD0XK9J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
