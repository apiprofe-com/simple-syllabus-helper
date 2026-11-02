// Pure logic: parse Simple Syllabus card labels and rank past syllabi for the one you're editing.
// Card label examples: "ART 1201C 7626" + "Fall 2026", "ARH-ONL 1000 8412" + "Fall 2026".

const SEASONS = { winter: 0, spring: 1, summer: 2, fall: 3 };

export function parseTerm(s) {
  const m = /(Winter|Spring|Summer|Fall)\s+(\d{4})/i.exec(s || '');
  if (!m) return null;
  return { label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`, order: Number(m[2]) * 4 + SEASONS[m[1].toLowerCase()] };
}

// "ARH-ONL 1000 8412" -> { subject: 'ARH', number: '1000', online: true, section: '8412' }
// Also handles the header form "ART 1201C 6403" and Canvas form "ART1201C-2273-6403".
export function parseCourse(s) {
  const m = /\b([A-Z]{3})(-ONL)?\s*-?\s*(\d{4}[A-Z]?)(?:[\s-]+(?:\d{4}[\s-]+)?(\d{3,6}))?/.exec((s || '').toUpperCase());
  if (!m) return null;
  return { subject: m[1], number: m[3], online: Boolean(m[2]), section: m[4] || null, code: `${m[1]} ${m[3]}` };
}

/**
 * candidates: [{ title: "ART 1201C 7626", term: "Fall 2026", index }]
 * target: { course: parseCourse(...), term: parseTerm(...) }
 * prefs: { pinnedTerm?: "Fall 2025", remembered?: "ART 1201C 7626|Fall 2026" }
 * Returns the exact-course matches, best first, each with a plain-language reason.
 */
export function rank(candidates, target, prefs = {}) {
  const pinned = prefs.pinnedTerm ? parseTerm(prefs.pinnedTerm) : null;
  const out = [];
  for (const c of candidates) {
    const course = parseCourse(c.title);
    const term = parseTerm(c.term);
    if (!course || !term || course.code !== target.course.code) continue; // exact course only
    if (target.term && term.order >= target.term.order) continue;           // only earlier terms
    let score = term.order;                                                  // newer is better
    const why = [];
    const key = `${c.title}|${term.label}`;
    if (prefs.remembered === key) { score += 1e6; why.push('your pick last time'); }
    if (pinned && term.order === pinned.order) { score += 1e5; why.push(`your import-from term (${pinned.label})`); }
    if (course.online === target.course.online) { score += 2; why.push(course.online ? 'same format (online)' : 'same format (not online)'); }
    else why.push(course.online ? 'online section' : 'not an online section');
    out.push({ ...c, course, termInfo: term, score, why });
  }
  out.sort((a, b) => b.score - a.score);
  if (out[0]) out[0].why.unshift(out[0].why.includes('your pick last time') ? 'best match' : 'most recent same course');
  return out;
}
