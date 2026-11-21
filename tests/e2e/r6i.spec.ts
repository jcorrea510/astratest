import { test, expect } from '@playwright/test';

/** R6-I: installable web app. Static build served at /astratest/. */
test('manifest, icons, iOS meta tags and service worker file are served under the base path', async ({ request, baseURL }) => {
  const html = await (await request.get('./')).text();
  for (const m of ['apple-mobile-web-app-capable', 'mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style" content="black-translucent', 'viewport-fit=cover']) expect(html).toContain(m);
  expect(html).toMatch(/rel="manifest" href="\/astratest\/manifest\.webmanifest"/);
  expect(html).toMatch(/rel="apple-touch-icon" href="\/astratest\/icons\/apple-touch-icon\.png"/);
  const res = await request.get('manifest.webmanifest');
  expect(res.status()).toBe(200);
  const man = await res.json();
  const abs = (p: string) => new URL(p, new URL('manifest.webmanifest', baseURL!)).pathname;
  expect(abs(man.start_url)).toBe('/astratest/');
  expect(abs(man.scope)).toBe('/astratest/');
  expect(man.display).toMatch(/fullscreen|standalone/);
  expect(man.display_override).toContain('standalone');
  expect(man.orientation).toBe('landscape');
  const sizes = new Set<string>(); let maskable = false;
  for (const ic of man.icons) {
    const r = await request.get(new URL(ic.src, new URL('manifest.webmanifest', baseURL!)).href);
    expect(r.status(), ic.src).toBe(200); expect(r.headers()['content-type']).toContain('image/png');
    sizes.add(ic.sizes); if (ic.purpose === 'maskable') maskable = true;
  }
  expect(sizes.has('192x192') && sizes.has('512x512') && maskable).toBe(true);
  expect((await request.get('icons/apple-touch-icon.png')).status()).toBe(200);
  const sw = await request.get('sw.js');
  expect(sw.status()).toBe(200);
  expect(await sw.text()).not.toContain('__BUILD_ID__'); // stamped per build
});

test('service worker registers on the static build when not automated, and caches the shell', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.goto('./?noshell');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe('/astratest/');
  await page.waitForFunction(async () => (await caches.keys()).some(k => k.startsWith('ma-cache-')), null, { timeout: 30_000 });
});

test('under automation (navigator.webdriver) no service worker is registered', async ({ page }) => {
  await page.goto('./?noshell');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
