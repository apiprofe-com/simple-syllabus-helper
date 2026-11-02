// One persistent, visible Chrome profile just for this helper. You log in to Canvas
// yourself the first time; "stay signed in" carries later runs. Nothing is sent anywhere.
import puppeteer from 'puppeteer-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const HOME = path.join(os.homedir(), '.ss-helper');
export const PROFILE = path.join(HOME, 'chrome-profile');

export async function launch() {
  fs.mkdirSync(PROFILE, { recursive: true });
  return puppeteer.launch({
    channel: 'chrome',
    headless: false,
    userDataDir: PROFILE,
    defaultViewport: null,
    args: ['--window-size=1400,950'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until the tab is back on Canvas after SSO/MFA (the person does the login).
export async function waitForCanvas(page, canvasHost, log, timeoutMs = 10 * 60_000) {
  const start = Date.now();
  let told = false;
  while (Date.now() - start < timeoutMs) {
    const u = new URL(page.url());
    if (u.host === canvasHost && !/\/login/.test(u.pathname)) return true;
    if (!told) { log('Please log in to Canvas in the Chrome window (MFA too). Waiting...'); told = true; }
    await sleep(1500);
  }
  throw new Error('Timed out waiting for Canvas login');
}

// The Simple Syllabus editor runs in an iframe inside the Canvas tool page.
export async function findSSFrame(page, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const f = page.frames().find((fr) => /simplesyllabus\.com/.test(fr.url()));
    if (f) {
      try {
        const txt = await f.evaluate(() => document.body?.innerText || '');
        if (/could not locate this section/i.test(txt)) {
          throw Object.assign(new Error('Simple Syllabus has no syllabus for this section yet (it says "could not locate this section"). Usually the College hasn\'t synced it; check again in a day or ask CIOL.'), { notFound: true });
        }
        const ok = /Spring|Summer|Fall|Winter/.test(txt);
        // Simple Syllabus sometimes reloads itself right after opening; make sure the frame stays.
        if (ok) { await sleep(2500); if (!f.detached && page.frames().includes(f)) return f; }
      } catch (e) { if (e.notFound) throw e; /* frame still loading */ }
    }
    await sleep(1000);
  }
  throw new Error('Simple Syllabus did not load in this course');
}

// Canvas LTI launches are slow and keep loading; don't fail on the load event.
export async function open(page, url) {
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 }); }
  catch (e) { if (e.name !== 'TimeoutError') throw e; }
}
