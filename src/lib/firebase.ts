import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyC8EuNarNKJgoKx3dcORVUy8y7_AxjzlTs",
  authDomain: "app-audio-iasd.firebaseapp.com",
  projectId: "app-audio-iasd",
  storageBucket: "app-audio-iasd.firebasestorage.app",
  messagingSenderId: "781774165339",
  appId: "1:781774165339:web:a3e74d4a388ceaa24cf67e",
  measurementId: "G-57JPM3NMN3"
};

// Initialize Firebase (Evita inicializar múltiples veces en Next.js)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Inicializamos Firestore y Storage
export const db = getFirestore(app);
export const storage = getStorage(app);

// Nota: Analytics solo funciona en el cliente (navegador), lo omitimos temporalmente
// export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;
