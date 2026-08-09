#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const landing = fs.readFileSync(path.join(root, 'landing.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function normalize(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function duplicateChoiceKey(value) {
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function bigrams(value) {
  const text = normalize(value);
  const result = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    result.push(text.slice(index, index + 2));
  }
  return result;
}

function dice(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length && !b.length) return 1;
  const counts = new Map();
  for (const gram of a) counts.set(gram, (counts.get(gram) || 0) + 1);
  let matches = 0;
  for (const gram of b) {
    if (!counts.get(gram)) continue;
    matches += 1;
    counts.set(gram, counts.get(gram) - 1);
  }
  return (2 * matches) / (a.length + b.length);
}

function optionSimilarity(left, right) {
  const candidates = Object.values(right.options);
  const used = new Set();
  let total = 0;
  for (const option of Object.values(left.options)) {
    let bestScore = -1;
    let bestIndex = -1;
    candidates.forEach((candidate, index) => {
      if (used.has(index)) return;
      const score = dice(option, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      total += bestScore;
    }
  }
  return total / 4;
}

assert(Array.isArray(data.chapters) && data.chapters.length === 7, 'Expected seven chapter records.');
assert(Array.isArray(data.questions), 'questions.json must contain a questions array.');
assert(data.questions.length === 691, `Expected 691 curated questions; found ${data.questions.length}.`);

const letters = ['A', 'B', 'C', 'D'];
const ids = new Set();
const stems = new Map();
const counts = {};
const forbiddenText = /(?:WEWW|1122|4110日|寫選|法定條本|7月1日\s+如一個|^制性供款的陳述|白願|連纘|涵藍|薰事|繁貼|隙述|項自|歸爵|簽暑|僨券|成分綦金|受託入|合夥人意|期問來寫|債{4,}|為但陪针|而休悍|<\/?script|\d+\.\d+(?:\.\d+)?註|及監禁\s+及監禁|增補利豁|最低強積金利餘|職業休計劃|以上所皆是|所有成分基金的平均投資期|[蓖蔥队燙顆椙瓷黡个独恋复创疋鸟谁]|^[,，。．、:：;；]|^\(\s*[a-d]\s*\))/u;
const romanLabels = ['i', 'ii', 'iii', 'iv'];
const romanCounts = { paper4: 0, mpf_mock: 0 };

for (const question of data.questions) {
  const required = ['id', 'source', 'source_short', 'source_kind', 'chapter', 'ref', 'section_title', 'q'];
  for (const field of required) {
    assert(typeof question[field] === 'string' && question[field].trim(), `${question.id || '(missing id)'}: missing ${field}.`);
  }
  assert(!ids.has(question.id), `${question.id}: duplicate ID.`);
  ids.add(question.id);

  const stemKey = normalize(question.q);
  assert(!stems.has(stemKey), `${question.id}: duplicate stem also used by ${stems.get(stemKey)}.`);
  stems.set(stemKey, question.id);

  assert(['paper4', 'mpf_mock'].includes(question.source_kind), `${question.id}: invalid source_kind.`);
  assert(/^[1-7]$/.test(question.chapter), `${question.id}: invalid chapter ${question.chapter}.`);
  counts[question.chapter] = (counts[question.chapter] || 0) + 1;

  assert(question.q.trim().length >= 6, `${question.id}: question stem is too short.`);
  assert(!forbiddenText.test(question.q), `${question.id}: suspicious or incomplete question text.`);
  assert(!/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/u.test(question.q), `${question.id}: broken Chinese word spacing in question text.`);
  assert(question.options && typeof question.options === 'object', `${question.id}: missing options.`);
  assert(letters.includes(question.answer), `${question.id}: answer must be A-D.`);

  const choiceValues = [];
  for (const letter of letters) {
    const value = question.options && question.options[letter];
    assert(typeof value === 'string' && value.trim(), `${question.id}: option ${letter} is incomplete.`);
    if (typeof value === 'string') {
      assert(!forbiddenText.test(value), `${question.id}: suspicious text in option ${letter}.`);
      assert(!/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/u.test(value), `${question.id}: broken Chinese word spacing in option ${letter}.`);
      choiceValues.push(duplicateChoiceKey(value));
    }
  }
  assert(new Set(choiceValues).size === 4, `${question.id}: contains duplicate answer choices.`);
  assert(typeof question.options[question.answer] === 'string', `${question.id}: answer does not resolve to an option.`);

  const statements = [...question.q.matchAll(/^\((i|ii|iii|iv)\)\s*(.+)$/gmu)];
  const romanChoiceCount = Object.values(question.options)
    .filter(value => /^\s*\((?:i|ii|iii|iv)\)/u.test(value)).length;
  const isRomanCombination = statements.length > 0 || romanChoiceCount > 0;
  if (isRomanCombination) {
    romanCounts[question.source_kind] += 1;
    assert(statements.length === 4, `${question.id}: Roman-numeral question must contain four complete statements.`);
    assert(
      statements.map(match => match[1]).join('|') === romanLabels.join('|'),
      `${question.id}: Roman statements must be labelled (i) through (iv) once and in order.`,
    );
    for (const match of statements) {
      assert(match[2].trim().length >= 2, `${question.id}: statement (${match[1]}) is incomplete.`);
    }

    const combinations = [];
    for (const letter of letters) {
      const option = question.options[letter];
      const references = [...option.matchAll(/\((i|ii|iii|iv)\)/gu)].map(match => match[1]);
      const residue = option
        .replace(/\((?:i|ii|iii|iv)\)/gu, '')
        .replace(/[\s,，、及]+/gu, '');
      assert(references.length > 0 && residue === '', `${question.id}: option ${letter} is not an explicit Roman-numeral combination.`);
      assert(new Set(references).size === references.length, `${question.id}: option ${letter} repeats a Roman-numeral statement.`);
      assert(references.every(label => romanLabels.includes(label)), `${question.id}: option ${letter} references an unknown statement.`);
      combinations.push(references.join('|'));
    }
    assert(new Set(combinations).size === 4, `${question.id}: Roman-numeral answer combinations are not all distinct.`);
  }
}

assert(romanCounts.paper4 === 72, `Expected 72 curated Paper 4 Roman-numeral questions; found ${romanCounts.paper4}.`);
assert(romanCounts.mpf_mock === 24, `Expected 24 source-PDF Roman-numeral questions; found ${romanCounts.mpf_mock}.`);

const officialQuota = { '1': 1, '2': 4, '3': 36, '4': 4, '5': 16, '6': 3, '7': 16 };
for (const [chapter, needed] of Object.entries(officialQuota)) {
  assert((counts[chapter] || 0) >= needed, `Chapter ${chapter} cannot fill an 80-question official mock exam.`);
}

for (let leftIndex = 0; leftIndex < data.questions.length; leftIndex += 1) {
  const left = data.questions[leftIndex];
  for (let rightIndex = leftIndex + 1; rightIndex < data.questions.length; rightIndex += 1) {
    const right = data.questions[rightIndex];
    const stemScore = dice(left.q, right.q);
    if (stemScore < 0.9) continue;
    const choicesScore = optionSimilarity(left, right);
    if (choicesScore < 0.9) continue;
    assert(false, `${left.id} and ${right.id}: high-confidence duplicate or conflicting copy (${stemScore.toFixed(2)}/${choicesScore.toFixed(2)}).`);
  }
}

const inlineMatch = index.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>\s*<!-- study-notes/);
assert(inlineMatch, 'index.html is missing its inline question data block.');
if (inlineMatch) {
  try {
    const inlineData = JSON.parse(inlineMatch[1]);
    assert(JSON.stringify(inlineData) === JSON.stringify(data), 'index.html question data is out of sync with questions.json.');
  } catch (error) {
    failures.push(`index.html inline question data is invalid JSON: ${error.message}`);
  }
}

const answerSpotChecks = {
  'P4-2019年12月-3': 'A',
  'P4-2019年12月-35': 'D',
  'P4-2019年12月-59': 'C',
  'P4-2019年10月-61': 'B',
  'P4-2019年10月-76': 'C',
  'P4-2019年10月-77': 'D',
  'P4-2019年8月(1)-32': 'A',
  'P4-2019年5月-48': 'A',
  'P4-2019年5月-68': 'C',
  'P4-2019年8月(2)-42': 'D',
  'P4-2019年12月-55': 'D',
  'P4-2019年12月-70': 'A',
  'P4-2019年12月-69': 'A',
  'P4-2019年8月(1)-28': 'B',
  'MM-3-x164': 'D',
};
const byId = new Map(data.questions.map(question => [question.id, question]));
for (const [id, expected] of Object.entries(answerSpotChecks)) {
  assert(byId.get(id)?.answer === expected, `${id}: expected source-confirmed answer ${expected}.`);
}

const sourcePdfRomanAnswers = {
  'MM-1-x9': 'A',
  'MM-2-x1': 'B',
  'MM-2-x16': 'D',
  'MM-2-x17': 'A',
  'MM-2-x21': 'A',
  'MM-2-x22': 'C',
  'MM-3-x5': 'B',
  'MM-3-x6': 'B',
  'MM-3-x13': 'B',
  'MM-3-x20': 'B',
  'MM-3-x31': 'B',
  'MM-3-x32': 'C',
  'MM-3-x33': 'D',
  'MM-3-x40': 'D',
  'MM-3-x48': 'B',
  'MM-4-x1': 'C',
  'MM-4-x22': 'C',
  'MM-5-x76': 'D',
  'MM-5-x94': 'A',
  'MM-6-x3': 'C',
  'MM-7-x4': 'D',
  'MM-7-x7': 'C',
  'MM-7-x17': 'A',
  'MM-7-x21': 'D',
};
for (const [id, expected] of Object.entries(sourcePdfRomanAnswers)) {
  assert(byId.get(id)?.answer === expected, `${id}: expected answer ${expected} from the scanned source bank.`);
}

assert(byId.get('P4-2019年10月-77')?.q.includes('(iv) 附屬中介人不再是主事中介人的負責人員'), 'P4-2019年10月-77: statement (iv) is incomplete.');
assert(byId.get('P4-2019年8月(1)-32')?.options.A === '(ii), (iii), (iv)', 'P4-2019年8月(1)-32: the handbook-supported answer combination is missing.');
assert(byId.get('P4-2019年8月(1)-20')?.options.D === '7月1日', 'P4-2019年8月(1)-20: option D contains spillover question text.');
assert(byId.get('MM-3-x161')?.options.A === '10日', 'MM-3-x161: option A still contains an OCR number artifact.');
assert(byId.get('MM-5-x65')?.options.B === '債券基金', 'MM-5-x65: option B still contains repeated OCR characters.');
assert(byId.get('MM-5-x67')?.options.C === '70%', 'MM-5-x67: option C still contains an OCR answer-label artifact.');

assert(!/(?:692|693|694|747)/.test(landing), 'landing.html still advertises an outdated question count.');
assert(!/(?:692|693|694|747)/.test(readme), 'README.md still advertises an outdated question count.');

if (failures.length) {
  console.error(`Quiz audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Quiz audit passed: ${data.questions.length} questions, ${ids.size} unique IDs, no incomplete choices or high-confidence duplicates.`);
console.log(`Chapter coverage: ${Object.entries(counts).map(([chapter, count]) => `${chapter}:${count}`).join(' · ')}`);
console.log(`Roman-numeral audit: ${romanCounts.paper4 + romanCounts.mpf_mock} questions (${romanCounts.paper4} Paper 4 · ${romanCounts.mpf_mock} scanned source bank), all structurally complete; 24 scanned-source keys locked.`);
