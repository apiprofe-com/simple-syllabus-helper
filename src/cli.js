#!/usr/bin/env node
// Simple Syllabus import helper: for each course, finds the right past syllabus to import,
// highlights it, and waits for YOU to click it. It never clicks import, Save or Submit itself.
//
//   node src/cli.js --term "Spring 2027"            all your teacher courses in that term
//   node src/cli.js 12345 67890                      specific Canvas course IDs
//   options: --canvas mdc.instructure.com  --from "Fall 2025" (pin the import-from term)
//            --redo (also offer courses that already have a syllabus imported)
import fs from 'node:fs';
import path from 'node:path';
import { launch, waitForCanvas, findSSFrame, open, sleep, HOME } from './browser.js';
import * as ss from './ss.js';
import { rank, parseCourse, parseTerm } from './rank.js';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv.splice(i, 2)[1] : dflt; };
const flag = (name) => { const i = argv.indexOf(`--${name}`); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const host = opt('canvas', 'mdc.instructure.com');
const termWanted = opt('term', null);
const fromTerm = opt('from', null);
const redo = flag('redo');
const startAt = Number(opt('start', '1'));
const ids = argv.filter((a) => /^\d+$/.test(a));
if (!termWanted && !ids.length) {
  console.log('usage: ss-helper --term "Spring 2027"   or   ss-helper <course id> [...]');
  process.exit(2);
}

const PREFS = path.join(HOME, 'prefs.json');
const prefs = fs.existsSync(PREFS) ? JSON.parse(fs.readFileSync(PREFS, 'utf8')) : { remembered: {} };
if (fromTerm) prefs.pinnedTerm = fromTerm;
const savePrefs = () => fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 1));
const RUN = path.join(HOME, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(RUN, { recursive: true });
const log = (...a) => { const line = `${new Date().toTimeString().slice(0, 8)} ${a.join(' ')}`; console.log(line); fs.appendFileSync(path.join(RUN, 'log.txt'), line + '\n'); };

// ---- control panel on the Canvas page (buttons talk back through an exposed function) ----
let pending = null;
async function panel(page, html) {
  await page.evaluate((html) => {
    let p = document.getElementById('ssh-panel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'ssh-panel';
      p.setAttribute('role', 'region');
      p.setAttribute('aria-label', 'Simple Syllabus helper');
      p.style.cssText = 'position:fixed;left:12px;bottom:12px;width:330px;max-height:70vh;overflow:auto;z-index:2147483647;background:#0a0e27;color:#e0e6f0;border:2px solid #f59e0b;border-radius:12px;padding:12px 14px;font:14px/1.45 system-ui;box-shadow:0 6px 24px rgba(0,0,0,.4)';
      document.body.appendChild(p);
      p.addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b) window.sshAction(b.dataset.a, b.dataset.v || ''); });
    }
    p.innerHTML = '<div style="font-weight:700;margin-bottom:6px">Simple Syllabus helper</div>' + html;
    p.querySelectorAll('button').forEach((b) => { b.style.cssText = 'margin:4px 6px 0 0;padding:5px 10px;border-radius:7px;border:0;background:#4a9eff;color:#04122a;font:600 13px system-ui;cursor:pointer'; });
  }, html).catch(() => {});
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function nextAction() { const a = pending; pending = null; return a; }

async function canvasJSON(page, url) {
  return page.evaluate(async (url) => {
    const out = [];
    let next = url;
    while (next) {
      const r = await fetch(next, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Canvas ${r.status} on ${next}`);
      const body = await r.json();
      if (!Array.isArray(body)) return body;
      out.push(...body);
      const link = r.headers.get('link') || r.headers.get('Link') || '';
      const m = link.split(',').find((p) => /rel="next"/i.test(p));
      next = m ? m.match(/<([^>]+)>/)[1] : null;
    }
    return out;
  }, url);
}

const browser = await launch();
const page = (await browser.pages())[0];
await page.exposeFunction('sshAction', (a, v) => { pending = { a, v }; });
await open(page, `https://${host}/`);
await waitForCanvas(page, host, log);

// ---- which courses ----
let courses;
if (ids.length) {
  courses = [];
  for (const id of ids) courses.push(await canvasJSON(page, `/api/v1/courses/${id}?include[]=term`));
} else {
  const all = await canvasJSON(page, '/api/v1/courses?enrollment_type=teacher&include[]=term&per_page=100&state[]=available&state[]=unpublished');
  const want = parseTerm(termWanted);
  courses = all.filter((c) => { const t = parseTerm((c.term?.name || '').replace(/\s*Term\s*/i, ' ')); return t && want && t.order === want.order; });
  if (!courses.length) log('Terms seen:', [...new Set(all.map((c) => c.term?.name))].join(' | '));
}
log(`Courses: ${courses.map((c) => c.course_code || c.name).join(', ') || 'none'}`);
if (!courses.length) { await panel(page, 'No matching courses found.'); await sleep(8000); await browser.close(); process.exit(1); }

const summary = [];
for (const [n, course] of courses.entries()) {
  if (n + 1 < startAt) continue;
  const tag = `${n + 1}/${courses.length} ${course.course_code || course.name}`;
  let result = 'skipped';
  try {
    const tabs = await canvasJSON(page, `/api/v1/courses/${course.id}/tabs`);
    const tab = tabs.find((t) => /simple\s*syllabus/i.test(t.label));
    if (!tab) { log(tag, 'no Simple Syllabus tab'); summary.push([tag, 'no Simple Syllabus tab']); continue; }
    await open(page, `https://${host}${tab.html_url}`);
    await panel(page, `<b>${esc(tag)}</b><br>Opening Simple Syllabus…`);
    let frame = await findSSFrame(page, 120_000);
    await sleep(4000); // let Simple Syllabus finish drawing
    let st = await ss.pageState(frame);
    // Course from Canvas (reliable); the Simple Syllabus header is only a fallback.
    const target = {
      course: parseCourse(course.course_code) || parseCourse(course.name) || parseCourse(st.header),
      term: parseTerm((course.term?.name || '').replace(/\s*Term\s*/i, ' ')) || parseTerm(st.header),
    };
    st.header = st.header || `${target.term?.label || ''} ${course.course_code}`;
    if (!target.course) throw new Error(`could not read the course code from "${course.course_code}"`);
    if (st.modality && /online/i.test(st.modality)) target.course.online = true;
    await page.screenshot({ path: path.join(RUN, `${course.id}-before.png`) });

    if (st.imported && !redo) {
      await panel(page, `<b>${esc(tag)}</b><br>This syllabus already has content imported ("Replace with a different syllabus?").<br><button data-a="go">Pick one anyway</button><button data-a="skip">Skip</button>`);
      let a;
      while (!(a = nextAction())) await sleep(500);
      if (a.a === 'skip') { log(tag, 'already imported, skipped'); summary.push([tag, 'already imported (skipped)']); continue; }
    }
    const wasImported = st.imported;

    await panel(page, `<b>${esc(tag)}</b><br>Finding past ${esc(target.course.code)} syllabi (all terms)…`);
    if (!(await ss.openPicker(frame))) throw new Error('import panel not found');
    // Look in the Current term first (e.g. Fall 2026 while you prep Spring 2027). Only search
    // older terms if nothing matches there, or if you pinned an import-from term.
    const prefKey = `${target.course.code}|${target.course.online ? 'online' : 'other'}`;
    const rprefs = { pinnedTerm: prefs.pinnedTerm, remembered: prefs.remembered[prefKey] };
    const scope = prefs.pinnedTerm ? ['Current', 'Historic'] : ['Current'];
    log(tag, 'terms:', scope.join('+'), await ss.setTerms(frame, scope));
    await ss.search(frame, target.course.number);
    let cards = await ss.collectAll(frame);
    let ranked = rank(cards, target, rprefs);
    if (!ranked.length && scope.length === 1) {
      log(tag, 'nothing in Current; adding Historic');
      await ss.setTerms(frame, ['Current', 'Historic']);
      await ss.search(frame, target.course.number);
      cards = await ss.collectAll(frame);
      ranked = rank(cards, target, rprefs);
    }
    log(tag, `${cards.length} search results, ${ranked.length} exact ${target.course.code}`);
    if (!ranked.length) {
      await panel(page, `<b>${esc(tag)}</b><br>No earlier ${esc(target.course.code)} syllabus found.<br><button data-a="skip">Next course</button>`);
      while (!nextAction()) await sleep(500);
      summary.push([tag, 'no earlier syllabus found']);
      continue;
    }

    let choice = 0;
    const show = async (i) => {
      const c = ranked[i];
      await ss.showCard(frame, c.title, c.term, target.course.number);
      await ss.highlight(frame, c.title, c.term, `Import this one: ${c.title} · ${c.term}`);
      const list = ranked.slice(0, 5).map((r, j) => `<li style="margin:4px 0${j === i ? ';color:#fbbf24;font-weight:700' : ''}">${esc(r.title)} · ${esc(r.term)}<br><span style="font-size:12px;color:#a8b8d8">${esc(r.why.join(', '))}</span>${j === i ? '' : `<br><button data-a="show" data-v="${j}">Show this one</button>`}</li>`).join('');
      await panel(page, `<b>${esc(tag)}</b> → ${esc(st.header)}<br><b style="color:#fbbf24">Click the outlined card</b> in Simple Syllabus to import it. (The helper won't click it for you.)<ol style="padding-left:18px;margin:8px 0">${list}</ol><button data-a="skip">Skip this course</button>`);
    };
    await show(choice);
    log(tag, 'suggested:', ranked[0].title, ranked[0].term);

    // Wait for the person: either they click a card (import) or use the panel.
    let picked = null;
    for (;;) {
      await sleep(1000);
      const a = nextAction();
      if (a?.a === 'skip') { result = 'skipped'; break; }
      if (a?.a === 'show') {
        choice = +a.v;
        try { frame = await findSSFrame(page, 30_000); await ss.openPicker(frame); await show(choice); }
        catch (e) { log(tag, 'show failed:', e.message); }
        continue;
      }
      picked = (await ss.pickedCard(frame).catch(() => null)) || picked;
      try { frame = await findSSFrame(page, 15_000); st = await ss.pageState(frame); } catch { continue; }
      if (picked && st.imported && (!wasImported || !st.pickerOpen)) { result = `imported ${picked.title} · ${picked.term}`; break; }
      if (!wasImported && st.imported) { result = 'imported (card not recorded)'; break; }
    }

    if (result.startsWith('imported')) {
      if (picked) { prefs.remembered[prefKey] = `${picked.title}|${parseTerm(picked.term)?.label || picked.term}`; savePrefs(); }
      await sleep(3000);
      frame = await findSSFrame(page, 60_000);
      st = await ss.pageState(frame);
      const notes = await ss.accessibilityNotes(frame);
      await page.screenshot({ path: path.join(RUN, `${course.id}-after.png`) });
      log(tag, result, notes.length ? `| a11y: ${notes.join(' / ')}` : '');
      await panel(page, `<b>${esc(tag)}</b><br>✅ ${esc(result)}<br>${st.bottom ? `<span style="color:#fbbf24">${esc(st.bottom)}</span><br>` : ''}${notes.map((x) => `• ${esc(x)}`).join('<br>')}<br><span style="font-size:12px;color:#a8b8d8">Fix anything above, then Save/Submit yourself when ready.</span><br><button data-a="next">${n + 1 < courses.length ? 'Next course' : 'Finish'}</button>`);
      while (!nextAction()) await sleep(500);
      summary.push([tag, result + (notes.length ? ` — ${notes.length} accessibility note(s)` : '')]);
    } else {
      log(tag, result);
      summary.push([tag, result]);
    }
  } catch (e) {
    // A Simple Syllabus reload mid-step: retry this course once from the top.
    if (/detached Frame/i.test(e.message) && !course.__retried) {
      course.__retried = true;
      log(tag, 'page reloaded, retrying this course');
      courses.splice(n + 1, 0, course);
      continue;
    }
    log(tag, 'ERROR', e.message);
    await page.screenshot({ path: path.join(RUN, `${course.id}-error.png`) }).catch(() => {});
    await panel(page, `<b>${esc(tag)}</b><br>Stopped on this course: ${esc(e.message)}<br><button data-a="next">Next course</button>`);
    while (!nextAction()) await sleep(500);
    summary.push([tag, `error: ${e.message}`]);
  }
}

const text = summary.map(([t, r]) => `${t}: ${r}`).join('\n');
fs.writeFileSync(path.join(RUN, 'summary.txt'), text + '\n');
log('DONE\n' + text + `\nScreenshots and log: ${RUN}`);
await panel(page, `<b>All done.</b><pre style="white-space:pre-wrap;font-size:12px">${esc(text)}</pre><button data-a="close">Close</button>`);
for (let i = 0; i < 600 && !nextAction(); i++) await sleep(500);
await browser.close();
