import { getApp, getApps, initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
let foregroundListenerReady = false;

export function isFirebasePushConfigured() {
  return Object.values(config).every(Boolean) && Boolean(vapidKey);
}

export async function requestBrowserPushToken() {
  if (!isFirebasePushConfigured()) {
    throw new Error("Firebase web config is missing. Fill in the VITE_FIREBASE_* values in the frontend .env file.");
  }
  if (!(await isSupported())) {
    throw new Error("This browser does not support Firebase web push notifications.");
  }
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("This browser does not support notifications or service workers.");
  }

  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted in the browser.");
  }

  const firebaseConfig = Object.fromEntries(
    Object.entries(config).filter(([, value]) => Boolean(value)),
  );
  const workerUrl = new URL("/firebase-messaging-sw.js", window.location.origin);
  for (const [key, value] of Object.entries(firebaseConfig)) {
    workerUrl.searchParams.set(key, value as string);
  }
  const registration = await navigator.serviceWorker.register(workerUrl);
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const messaging = getMessaging(app);
  if (!foregroundListenerReady) {
    onMessage(messaging, (payload) => {
      const notification = payload.notification;
      if (notification && Notification.permission === "granted") {
        new Notification(notification.title || "HeatKshetra heat alert", {
          body: notification.body || "A heat-risk update is available.",
          icon: notification.icon || "/favicon.ico",
          tag: "heatkshetra-extreme-demo",
        });
      }
    });
    foregroundListenerReady = true;
  }
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error("Firebase did not return a browser registration token.");
  return token;
}
