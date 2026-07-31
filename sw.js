const CACHE_NAME = 'mon-carnet-test-search-iphone-v9-fine-presentation';
const TEST_CACHE_PREFIX = 'mon-carnet-test-';
const APP_SHELL = ['./', './index.html', './mon-carnet-v17.png', './search-enhancement.js'];
const SEARCH_SCRIPT = '<script src="./search-enhancement.js?v=1.0.7.1-iphone-fine-presentation"></script>';

function optimizeStartup(html) {
  let optimized = html;

  optimized = optimized.replace(
    /function\s+renderAll\s*\(\)\s*\{\s*renderHome\(\);\s*renderRecipes\(\);\s*renderMenus\(\);\s*renderPlanner\(\);\s*renderSettings\(\);\s*\}/,
    'function renderAll() { renderHome(); renderMenus(); renderPlanner(); renderSettings(); }'
  );

  optimized = optimized.replace(
    /if\s*\(\s*view\s*===\s*['"]recipes['"]\s*\)\s*renderRecipes\(\);/,
    "if (view === 'recipes' && $('#recipeSearch').value.trim()) renderRecipes();"
  );

  return optimized;
}

function injectSearchScript(html) {
  let enhanced = optimizeStartup(html);

  if (enhanced.includes('search-enhancement.js')) return enhanced;

  const lower = enhanced.toLowerCase();
  const closingBody = lower.lastIndexOf('</body>');

  if (closingBody < 0) return `${enhanced}\n${SEARCH_SCRIPT}`;

  return `${enhanced.slice(0, closingBody)}${SEARCH_SCRIPT}\n${enhanced.slice(closingBody)}`;
}

function withSearchEnhancement(response) {
  if (!response || !response.ok) return response;

  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  return response.text().then(html => {
    const enhanced = injectSearchScript(html);
    const headers = new Headers(response.headers);
    headers.delete('content-length');

    return new Response(enhanced, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

async function fetchEnhancedPage(request) {
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    const enhanced = await withSearchEnhancement(fresh);

    if (enhanced && enhanced.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put('./index.html', enhanced.clone());
      await cache.put('./', enhanced.clone());
    }

    return enhanced;
  } catch (_) {
    return (await caches.match('./index.html')) ||
      (await caches.match('./')) ||
      Response.error();
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    for (const url of APP_SHELL) {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (!response.ok) continue;

        const pathname = new URL(response.url).pathname;
        const stored = /(?:^|\/)index\.html$/.test(pathname) || url === './'
          ? await withSearchEnhancement(response)
          : response;

        await cache.put(url, stored);
      } catch (_) {}
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();

    await Promise.all(
      names
        .filter(name => name.startsWith(TEST_CACHE_PREFIX) && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || /\/index\.html$/.test(url.pathname)) {
    event.respondWith(fetchEnhancedPage(request));
    return;
  }

  if (/\/search-enhancement\.js$/.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });

        if (fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, fresh.clone());
        }

        return fresh;
      } catch (_) {
        return (await caches.match(request)) || Response.error();
      }
    })());

    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const fresh = await fetch(request);

    if (fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, fresh.clone());
    }

    return fresh;
  })());
});
