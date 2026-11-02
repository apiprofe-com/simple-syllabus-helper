// Everything that touches the Simple Syllabus page. Selectors live here, in one place.
// Rule: this file never clicks an import card, Save, Submit or Publish. It only filters, reads and highlights.
import { sleep } from './browser.js';

export const SEL = {
  search: 'input[aria-label="Search"]',
  card: '.big-button[role="button"]',
  cardTitle: '.import-section-name',
  cardTerm: '.import-term-name',
  next: 'button[aria-label="Next page"]',
  prev: 'button[aria-label="Previous page"]',
  range: '.mat-mdc-paginator-range-label',
  termSelect: 'mat-select.mat-mdc-select-multiple',
  termPanel: '.term-selector-select-panel',
};

export async function pageState(frame) {
  return frame.evaluate(() => {
    const t = document.body.innerText;
    const header = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^(Winter|Spring|Summer|Fall) \d{4} [A-Z]{3}/.test(e.textContent.trim()));
    return {
      header: header ? header.textContent.trim() : null,
      empty: /Would you like to import a syllabus\?/i.test(t),
      imported: /Replace with a different syllabus\?/i.test(t),
      pickerOpen: /Select a syllabus to copy from/i.test(t),
      modality: (t.match(/Modality:\s*([A-Za-z -]+?)\s*(?:\||\n)/) || [])[1] || null,
      bottom: (t.match(/(This cannot be submitted[^\n]*|Syllabus cannot be submitted[^\n]*)/) || [])[1] || null,
    };
  });
}

export async function openPicker(frame) {
  // The panel can take 10-30 s to appear. Only click the banner when the panel is really closed.
  const isOpen = () => frame.$(SEL.search).then(Boolean).catch(() => false);
  const clickBanner = () => frame.evaluate(() => {
    if (/Select a syllabus to copy from/i.test(document.body.innerText)) return 'opening';
    const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /import a syllabus\?|Replace with a different syllabus\?/i.test(e.textContent));
    if (!el) return 'no-banner';
    el.click();
    return 'clicked';
  });
  for (let i = 0; i < 80; i++) {
    if (await isOpen()) { await sleep(1500); return true; }
    if (i % 20 === 0) await clickBanner().catch(() => {});
    await sleep(500);
  }
  return false;
}

// Choose which term groups the picker searches. Default: Current only (this term's syllabi).
// Unticks the others so Future/Historic cards don't crowd the list.
export async function setTerms(frame, wanted = ['Current']) {
  await frame.click(SEL.termSelect);
  await sleep(800);
  const changed = await frame.evaluate((panelSel, wanted) => {
    const panel = document.querySelector(panelSel);
    if (!panel) return 'no-panel';
    const done = [];
    for (const name of ['Future', 'Current', 'Historic']) {
      const label = [...panel.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === name);
      if (!label) continue;
      const row = label.closest('mat-option, mat-optgroup, .mat-mdc-optgroup-label, label, div');
      const box = row && (row.querySelector('input[type=checkbox]') || row.parentElement?.querySelector('input[type=checkbox]'));
      const checked = box ? box.checked : /mdc-checkbox--selected|mat-pseudo-checkbox-checked/.test(row.innerHTML);
      if (checked !== wanted.includes(name)) { (box || label).click(); done.push(`${wanted.includes(name) ? '+' : '-'}${name}`); }
    }
    return done.join(',') || 'unchanged';
  }, SEL.termPanel, wanted);
  await sleep(500);
  await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await sleep(1500);
  return changed;
}

async function readCards(frame) {
  return frame.evaluate((S) => [...document.querySelectorAll(S.card)].map((c) => ({
    title: c.querySelector(S.cardTitle)?.textContent.trim() || '',
    term: c.querySelector(S.cardTerm)?.textContent.trim() || '',
  })).filter((c) => c.title), SEL);
}

async function range(frame) {
  const t = await frame.$eval(SEL.range, (e) => e.textContent).catch(() => '');
  const m = /(\d+)\s*[–-]\s*(\d+)\s*of\s*(\d+)/.exec(t);
  return m ? { from: +m[1], to: +m[2], total: +m[3] } : { from: 0, to: 0, total: 0 };
}

// The cards and the "1 – 5 of N" counter update at different moments. Wait until the
// counter shows the page we expect AND the cards read the same twice in a row.
async function waitPage(frame, expectFrom, timeoutMs = 20_000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    await sleep(600);
    const r = await range(frame);
    const cards = await readCards(frame);
    const sig = JSON.stringify([cards, r]);
    if ((expectFrom == null || r.from === expectFrom || r.total === 0) && sig === last) return { r, cards };
    last = sig;
  }
  return { r: await range(frame), cards: await readCards(frame) };
}

export async function search(frame, text) {
  await frame.click(SEL.search, { clickCount: 3 });
  await (await frame.$(SEL.search)).press('Backspace');
  await frame.type(SEL.search, text, { delay: 50 });
  await sleep(1500);
  return waitPage(frame, 1);
}

// Read every page of results (deduplicated).
export async function collectAll(frame) {
  const seen = new Map();
  let { r, cards } = await waitPage(frame, 1);
  for (let page = 0; page < 60; page++) {
    cards.forEach((c) => seen.set(`${c.title}|${c.term}`, c));
    if (!r.total || r.to >= r.total) break;
    const expect = r.to + 1;
    await frame.click(SEL.next);
    ({ r, cards } = await waitPage(frame, expect));
    if (r.from !== expect) break; // paging didn't move; stop rather than loop
  }
  return [...seen.values()];
}

// Bring one card onto the screen without a second search: if it's showing, done; otherwise
// re-run the same course-number search and page forward until it appears.
export async function showCard(frame, title, term, searchText) {
  const visible = async () => (await readCards(frame)).some((c) => c.title === title && c.term === term);
  if (await visible()) return true;
  let { r } = await search(frame, searchText);
  for (let i = 0; i < 60; i++) {
    if (await visible()) return true;
    if (!r.total || r.to >= r.total) break;
    const expect = r.to + 1;
    await frame.click(SEL.next);
    ({ r } = await waitPage(frame, expect));
  }
  return visible();
}

// Outline the chosen card, dim the rest, and remember what the person actually clicks.
export async function highlight(frame, title, term, label) {
  return frame.evaluate((S, title, term, label) => {
    document.querySelectorAll('.ssh-badge').forEach((b) => b.remove());
    if (!window.__sshWatch) {
      window.__sshWatch = true;
      document.addEventListener('click', (e) => {
        const c = e.target.closest(S.card);
        if (c) window.__sshPicked = { title: c.querySelector(S.cardTitle)?.textContent.trim(), term: c.querySelector(S.cardTerm)?.textContent.trim() };
      }, true);
    }
    let found = false;
    for (const c of document.querySelectorAll(S.card)) {
      const t = c.querySelector(S.cardTitle)?.textContent.trim();
      const tm = c.querySelector(S.cardTerm)?.textContent.trim();
      const hit = t === title && tm === term;
      c.style.outline = hit ? '5px solid #f59e0b' : '';
      c.style.outlineOffset = hit ? '4px' : '';
      c.style.opacity = hit ? '1' : '0.35';
      if (hit) {
        found = true;
        c.style.position = 'relative';
        const b = document.createElement('div');
        b.className = 'ssh-badge';
        b.textContent = label;
        b.style.cssText = 'position:absolute;top:-30px;left:0;right:0;background:#f59e0b;color:#1a1300;font:600 13px system-ui;padding:4px 8px;border-radius:6px;text-align:center;pointer-events:none;z-index:9';
        c.appendChild(b);
        c.scrollIntoView({ block: 'center' });
      }
    }
    return found;
  }, SEL, title, term, label);
}

export async function pickedCard(frame) {
  return frame.evaluate(() => window.__sshPicked || null).catch(() => null);
}

// After import: find tables whose header row is empty or only placeholder (the grading-scale problem).
export async function accessibilityNotes(frame) {
  return frame.evaluate(() => {
    const notes = [];
    document.querySelectorAll('table').forEach((tb) => {
      const rows = [...tb.rows];
      if (rows.length < 2) return;
      const first = [...rows[0].cells];
      const second = [...rows[1].cells];
      const firstEmpty = first.every((c) => !c.textContent.trim());
      const secondLooksHeader = second.length && second.every((c) => c.tagName === 'TD' && (c.querySelector('strong,b') || getComputedStyle(c).fontWeight >= 600));
      const label = second.map((c) => c.textContent.trim()).join(' | ').slice(0, 60);
      if (firstEmpty) {
        notes.push(`Table "${label}": the real header row is EMPTY. Fix: type ${second.map((c) => `"${c.textContent.trim()}"`).join(' and ')} into the empty top row, then delete the bold row under it.`);
      } else if (secondLooksHeader && rows[0].cells[0].tagName === 'TH') {
        notes.push(`Table "${label}": two header-looking rows. Keep the top (real) header row, delete the bold row under it.`);
      }
    });
    return notes;
  }).catch(() => []);
}
