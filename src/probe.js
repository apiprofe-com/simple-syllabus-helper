// Read-only: open one course's Simple Syllabus page and save its HTML so selectors can be
// written from the real page. Expands the import banner (that only opens a panel).
import fs from 'node:fs';
import path from 'node:path';
import { launch, waitForCanvas, findSSFrame, sleep, HOME, open } from './browser.js';

const host = process.argv[2] || 'mdc.instructure.com';
const course = process.argv[3];
if (!course) { console.error('usage: probe.js <canvas-host> <course-id>'); process.exit(2); }
const out = path.join(HOME, 'probe'); fs.mkdirSync(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await launch();
const page = (await browser.pages())[0];
await page.goto(`https://${host}/courses/${course}`, { waitUntil: 'domcontentloaded' });
await waitForCanvas(page, host, log);
const tabs = await page.evaluate(async (c) => (await fetch(`/api/v1/courses/${c}/tabs`, { headers: { Accept: 'application/json' } })).json(), course);
fs.writeFileSync(path.join(out, 'tabs.json'), JSON.stringify(tabs, null, 1));
const ss = tabs.find((t) => /simple\s*syllabus/i.test(t.label));
log('Simple Syllabus tab:', ss && ss.html_url);
await open(page, `https://${host}${ss.html_url}`);
const f = await findSSFrame(page, 120_000);
log('frame url host:', new URL(f.url()).host);
await sleep(3000);
fs.writeFileSync(path.join(out, 'frame-0.html'), await f.content());
await page.screenshot({ path: path.join(out, 'shot-0.png') });
// Expand the import banner (just opens the picker panel).
const clicked = await f.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /import a syllabus|Replace with a different syllabus/i.test(e.textContent));
  if (!el) return null; el.click(); return el.textContent.trim();
});
log('banner:', clicked);
await sleep(4000);
fs.writeFileSync(path.join(out, 'frame-1.html'), await f.content());
await page.screenshot({ path: path.join(out, 'shot-1.png') });
log('saved to', out);
await sleep(2000);
await browser.close();
