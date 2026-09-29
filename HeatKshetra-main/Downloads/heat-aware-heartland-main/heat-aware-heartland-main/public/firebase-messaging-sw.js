/* Firebase's compat service-worker SDK displays messages while this tab is in the background. */
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;
const config = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  storageBucket: params.get("storageBucket"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

firebase.initializeApp(config);
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  self.registration.showNotification(notification.title || "HeatKshetra heat alert", {
    body: notification.body || "A heat-risk update is available.",
    icon: notification.icon || "/favicon.ico",
    badge: notification.badge || "/favicon.ico",
    tag: notification.tag || "heatkshetra-alert",
    data: { link: payload.data?.link || "/?risk-preview=extreme#city-actions" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.link || "/?risk-preview=extreme#city-actions";
  event.waitUntil(clients.openWindow(target));
});
