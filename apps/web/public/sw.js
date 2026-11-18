// FinPlan's service worker: a small script the browser keeps running between visits
// and puts in front of every request this site makes.
//
// It does one thing: when a page cannot be reached because the device is offline, it
// shows /offline.html instead of the browser's own error. It must never store pages or
// data, because they hold someone's finances and a phone or laptop may be shared.

// Change this when offline.html changes, so installed apps fetch the new copy.
const VERSION = 'v1';
const CACHE = `finplan-offline-${VERSION}`;
const OFFLINE_URL = '/offline.html';

// Runs once, when this version of the script is first installed.
self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' skips the browser's normal cache, so we store a fresh copy.
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))),
  );
  // Take over straight away instead of waiting for every open tab to close.
  self.skipWaiting();
});

// Runs when this version takes over: removes caches left by earlier versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Runs for every request a FinPlan page makes: pages, scripts, images, form posts...
self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only whole-page loads. Images, scripts, form posts and OAuth calls are left alone:
  // returning without respondWith() lets the browser handle them as if we did not exist.
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  event.respondWith(
    // Network first, always. Responses are never stored: they hold someone's finances.
    // Only when the network cannot be reached at all do we show the offline page.
    fetch(request).catch(() => caches.match(OFFLINE_URL).then((page) => page ?? Response.error())),
  );
});
