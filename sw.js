const CACHE_NAME = 'pdfcraft-cache-v42';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/merge-pdf.html',
  '/split-pdf.html',
  '/sign-pdf.html',
  '/rotate-pdf.html',
  '/delete-pages.html',
  '/reorder-pdf.html',
  '/images-to-pdf.html',
  '/compress-pdf.html',
  '/pdf-to-images.html',
  '/protect-pdf.html',
  '/unlock-pdf.html',
  '/number-pdf.html',
  '/watermark-pdf.html',
  '/edit-pdf-text.html',

  '/security.html',
  '/privacy.html',
  '/about.html',
  '/contact.html',

  '/how-to/safe-online-pdf-tools-confidential-documents.html',
  '/how-to/merge-and-split-pdf-without-uploading.html',
  '/how-to/organize-pdf-pages.html',
  '/how-to/convert-between-pdf-and-images.html',
  '/how-to/compress-pdf-without-losing-text.html',
  '/how-to/protect-pdf-with-password.html',
  '/how-to/redact-and-remove-pdf-content.html',
  '/how-to/edit-existing-pdf-text.html',
  '/how-to/add-watermark-to-pdf.html',
  '/how-to/merge-password-protected-pdfs.html',
  '/lib/jszip-3.10.1.min.js',
  '/lib/lucide-1.31.0.min.js',
  '/lib/pdf-3.4.120.min.js',
  '/lib/pdf-lib-1.17.1.esm.js',
  '/lib/pdf-lib-1.17.1.min.js',
  '/lib/pdf.worker-3.4.120.min.js',
  '/manifest.json',
  '/app.js?v=35',
  '/styles.css?v=35',
  '/pdf-tools.js?v=35',
  '/icon.svg',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/favicon-48x48.png',
  '/favicon-96x96.png',
  '/favicon-192x192.png',
  '/favicon-512x512.png',
  '/apple-touch-icon.png',
  '/og-image.jpg',
  '/pdf-crypto.js?v=35'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching vital assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Vercel answers /page.html with a 308 to /page, so the precached pages are stored
// as redirected responses. Safari and Firefox refuse those for a page load, so
// hand back a plain copy.
function withoutRedirect(response) {
  if (!response || !response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

// Fetch Event (Network-First for Local, Cache-First for CDN)
self.addEventListener('fetch', (e) => {
  // Only cache GET requests (ignore analytics tracking calls)
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Exclude Google Analytics calls from caching
  if (url.origin.includes('google-analytics') ||
      url.origin.includes('googletagmanager')) {
    return;
  }

  // Check if it is a local asset on the same origin
  const isLocalAsset = url.origin === self.location.origin;

  if (isLocalAsset) {
    // Network-First, Cache-Fallback for local HTML/JS/CSS assets
    e.respondWith(
      fetch(e.request).then((networkResponse) => {
        // If response is valid, update cache and return
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback to cache if network is unavailable
        return caches.match(e.request).then((cachedResponse) => {
          if (cachedResponse) {
            return withoutRedirect(cachedResponse);
          }
          // Dynamic clean URL resolution for offline PWA fallback
          if (e.request.mode === 'navigate' || !url.pathname.includes('.')) {
            const cleanUrlMatch = url.pathname.endsWith('/') ? url.pathname : url.pathname + '.html';
            return caches.match(cleanUrlMatch).then((fallbackHtmlResponse) => {
              if (fallbackHtmlResponse) {
                return withoutRedirect(fallbackHtmlResponse);
              }
              // Fallback for offline navigation
              if (e.request.mode === 'navigate') {
                return caches.match('/index.html').then(withoutRedirect);
              }
            });
          }
        });
      })
    );
  } else {
    // Cache-First, Network-Fallback for external static CDN assets
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
  }
});
