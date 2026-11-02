import assert from 'node:assert/strict';
import { rank, parseCourse, parseTerm } from './rank.js';

assert.deepEqual(parseCourse('ARH-ONL 1000 8412'), { subject: 'ARH', number: '1000', online: true, section: '8412', code: 'ARH 1000' });
assert.equal(parseCourse('ART1201C-2273-6403').code, 'ART 1201C');
assert.equal(parseCourse('Spring 2027 ART 1201C 6403').section, '6403');
assert.ok(parseTerm('Fall 2026').order > parseTerm('Spring 2026').order);

const cards = [
  ['ART 2600C 8166', 'Fall 2026'], ['ART 1201C 7626', 'Fall 2026'], ['ART 2600C 8970', 'Spring 2026'],
  ['ART 1201C 7833', 'Spring 2026'], ['ART 1201C 7832', 'Spring 2026'], ['ART 1201C 9368', 'Fall 2025'],
  ['ART 1201C 6403', 'Spring 2027'],
].map(([title, term], index) => ({ title, term, index }));
const target = { course: parseCourse('ART 1201C 6403'), term: parseTerm('Spring 2027') };

let r = rank(cards, target);
assert.equal(r[0].title, 'ART 1201C 7626', 'newest same course wins');
assert.ok(r.every((x) => x.course.code === 'ART 1201C'), 'no ART 2600C');
assert.ok(!r.some((x) => x.term === 'Spring 2027'), 'never itself or later');
r = rank(cards, target, { pinnedTerm: 'Fall 2025' });
assert.equal(r[0].title, 'ART 1201C 9368', 'pinned term wins');
r = rank(cards, target, { remembered: 'ART 1201C 7832|Spring 2026' });
assert.equal(r[0].title, 'ART 1201C 7832', 'remembered pick wins');
const onl = rank([{ title: 'ARH-ONL 1000 8412', term: 'Fall 2026' }, { title: 'ARH 1000 9417', term: 'Fall 2026' }],
  { course: parseCourse('ARH 1000 12558'), term: parseTerm('Spring 2027') });
assert.equal(onl[0].title, 'ARH 1000 9417', 'same format preferred');
console.log('rank tests: ok');
