// Quiz app — practice + exam + review modes
// State: { mode, sourceFilter, chapterFilter, currentIdx, answers: {qid: {chosen, correct}} }

const DATA = JSON.parse(document.getElementById('data').textContent);
const CHAPTERS = DATA.chapters;
const ALL_QS = DATA.questions;
const LIVE_QIDS = new Set(ALL_QS.map(q => q.id));
const Q_BY_ID = new Map(ALL_QS.map(q => [q.id, q]));

const CHAPTER_TITLES = {};
for (const c of CHAPTERS) CHAPTER_TITLES[c.id] = c.title;
CHAPTER_TITLES['0'] = '其他 / 未分類';

// --- study-notes deep-linking ---------------------------------------------
// study-notes.html exposes <section id="X.Y"> for every handbook section,
// plus #ch1..#ch7 chapter anchors and #appendix-1..7. studyNoteAnchor()
// resolves a question's `ref` to the best available anchor so the learner
// can jump straight to the source material for that question.
const STUDY_SECTION_IDS = new Set(["1.1","1.2","1.3","1.4","1.5","2.1","2.2","2.2.1","2.2.2","2.2.3","2.3","2.3.1","2.3.2","2.3.3","2.3.4","3.1","3.1.1","3.1.2","3.1.3","3.1.4","3.2","3.3","3.4","3.5","3.6","3.6.1","3.6.2","3.6.3","3.7","3.7.1","3.7.2","3.7.3","3.7.4","3.8","3.9","3.10","3.11","3.12","3.13","3.14","3.15","4.1","4.2","4.3","4.4","4.5","4.6","4.7","5.1","5.2","5.3","5.3.1","5.3.2","5.4","5.4.1","5.4.2","5.4.3","5.5","5.6","5.7","5.8","5.9","5.10","5.11","6.1","6.2","6.3","6.4","6.5","6.6","7.1","7.2","7.2.1","7.2.2","7.2.3","7.2.4","7.2.5","7.2.6","7.2.7","7.2.8","7.3","7.4","7.5"]);
const ROMAN_TO_NUM = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };

function studyNoteAnchor(q) {
  const ref = (q.ref || '').trim();
  // a ref may list several targets ("3.10, 3.13") — take the first resolvable one
  for (const token of ref.split(/[,，、]/).map(s => s.trim()).filter(Boolean)) {
    const appendix = token.match(/附錄\s*([IVX]+)/);
    if (appendix && ROMAN_TO_NUM[appendix[1]]) return 'appendix-' + ROMAN_TO_NUM[appendix[1]];
    const numeric = token.match(/^\d+(?:\.\d+)*/);
    if (numeric) {
      let id = numeric[0];
      if (STUDY_SECTION_IDS.has(id)) return id;
      while (id.includes('.')) {              // walk up: 3.14.2 -> 3.14 -> 3
        id = id.slice(0, id.lastIndexOf('.'));
        if (STUDY_SECTION_IDS.has(id)) return id;
      }
      const chapter = numeric[0].split('.')[0];
      if (/^[1-7]$/.test(chapter)) return 'ch' + chapter;
    }
  }
  // 操守指引 refs and anything unresolved fall back to the question's chapter
  return (q.chapter && /^[1-7]$/.test(q.chapter)) ? 'ch' + q.chapter : null;
}

function openStudyNote(anchor, label) {
  if (!anchor) return;
  const drawer = document.getElementById('note-drawer');
  const frame = document.getElementById('note-frame');
  const title = document.getElementById('note-drawer-title');
  if (!drawer || !frame) return;
  if (title) title.textContent = label || '研習資料';
  // unique query each open => the iframe always does a fresh load and lands
  // exactly on #anchor, even when reopening the same section after scrolling.
  frame.src = 'study-notes.html?_=' + Date.now() + '#' + anchor;
  drawer.classList.add('open');
  document.body.classList.add('drawer-open');
}

function closeStudyNote() {
  const drawer = document.getElementById('note-drawer');
  if (drawer) drawer.classList.remove('open');
  document.body.classList.remove('drawer-open');
}

function setupNoteDrawer() {
  const drawer = document.getElementById('note-drawer');
  if (!drawer) return;
  drawer.querySelector('.note-drawer-backdrop')?.addEventListener('click', closeStudyNote);
  drawer.querySelector('.note-drawer-close')?.addEventListener('click', closeStudyNote);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeStudyNote();
  });
}

const STORAGE_KEY = 'mpf-quiz-state-v1';

const defaultState = {
  mode: 'practice',
  sourceFilter: 'all',
  chapterFilter: 'all',
  currentIdx: 0,
  answers: {},
  exam: null, // {questions: [idx...], chosen: {qid: letter}, started: ts}
  examHistory: [], // [{id, started, finishedAt, questionIds, choices, result}]
  examReview: null, // {recordId} — wrong/skipped questions from one exam record
  resultRecordId: null,
  redoSet: null, // [qid...] — snapshot of wrong questions being redone
  redoAnswers: {}, // {qid: {chosen, correct}} — answers made inside 錯題重做
};

let state = loadState();

function freshDefaultState() {
  return {
    ...defaultState,
    answers: {},
    exam: null,
    examHistory: [],
    examReview: null,
    resultRecordId: null,
    redoSet: null,
    redoAnswers: {},
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshDefaultState();
    const parsed = JSON.parse(raw);
    return sanitizeState({
      ...freshDefaultState(),
      ...parsed,
      answers: parsed.answers || {},
      redoAnswers: parsed.redoAnswers || {},
      examHistory: parsed.examHistory || [],
    });
  } catch {
    return freshDefaultState();
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function computeExamResult(questionIds, choices) {
  let correct = 0, incorrect = 0, skipped = 0;
  for (const qid of questionIds || []) {
    const q = Q_BY_ID.get(qid);
    if (!q) continue;
    const choice = choices && choices[qid];
    if (!choice) { skipped++; continue; }
    if (choice === q.answer) correct++; else incorrect++;
  }
  return { correct, incorrect, skipped };
}

function normalizeExamRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const rawIds = Array.isArray(record.questionIds)
    ? record.questionIds
    : Array.isArray(record.questions)
      ? record.questions.map(idx => ALL_QS[idx] && ALL_QS[idx].id)
      : [];
  const questionIds = [];
  const seen = new Set();
  for (const rawId of rawIds) {
    const id = String(rawId || '');
    if (!LIVE_QIDS.has(id) || seen.has(id)) continue;
    questionIds.push(id);
    seen.add(id);
  }
  if (!questionIds.length) return null;

  const rawChoices = record.choices || record.chosen || {};
  const choices = {};
  for (const id of questionIds) {
    const choice = rawChoices[id];
    if (['A', 'B', 'C', 'D'].includes(choice)) choices[id] = choice;
  }

  const finishedAt = Number(record.finishedAt || record.finished || Date.now());
  const started = Number(record.started || finishedAt);
  return {
    id: String(record.id || `exam-${started}-${finishedAt}`),
    started,
    finishedAt,
    size: Number(record.size || questionIds.length),
    questionIds,
    choices,
    result: computeExamResult(questionIds, choices),
    distribution: record.distribution || null,
    sourceFilter: record.sourceFilter || 'all',
  };
}

function getExamRecordById(recordId) {
  return (state.examHistory || []).find(record => record.id === recordId) || null;
}

function getExamMistakeIds(record) {
  if (!record) return [];
  return (record.questionIds || []).filter(qid => {
    const q = Q_BY_ID.get(qid);
    return q && record.choices[qid] !== q.answer;
  });
}

function currentExamReviewRecord() {
  return state.examReview ? getExamRecordById(state.examReview.recordId) : null;
}

function currentResultRecord() {
  if (state.resultRecordId) {
    const record = getExamRecordById(state.resultRecordId);
    if (record) return record;
  }
  if (state.exam && state.exam.historyId) {
    const record = getExamRecordById(state.exam.historyId);
    if (record) return record;
  }
  if (state.exam && state.exam.finished) {
    const record = normalizeExamRecord({
      id: state.exam.historyId,
      started: state.exam.started,
      finishedAt: state.exam.finishedAt || Date.now(),
      size: state.exam.size,
      questions: state.exam.questions,
      choices: state.exam.chosen,
      distribution: state.exam.distribution,
      sourceFilter: state.exam.sourceFilter,
    });
    return record;
  }
  return null;
}

function createExamHistoryRecord(exam) {
  return normalizeExamRecord({
    id: `exam-${exam.started}-${exam.finishedAt}`,
    started: exam.started,
    finishedAt: exam.finishedAt,
    size: exam.size,
    questions: exam.questions,
    choices: exam.chosen,
    distribution: exam.distribution,
    sourceFilter: exam.sourceFilter,
  });
}

function rememberExamRecord(record) {
  if (!record) return;
  const existing = Array.isArray(state.examHistory) ? state.examHistory : [];
  state.examHistory = [record, ...existing.filter(item => item.id !== record.id)].slice(0, 30);
}

function sanitizeState(nextState) {
  let changed = false;

  const pruneAnswers = answers => {
    const out = {};
    for (const [qid, answer] of Object.entries(answers || {})) {
      if (!LIVE_QIDS.has(qid)) {
        changed = true;
        continue;
      }
      out[qid] = answer;
    }
    return out;
  };

  nextState.answers = pruneAnswers(nextState.answers);
  nextState.redoAnswers = pruneAnswers(nextState.redoAnswers);

  if (!Array.isArray(nextState.examHistory)) {
    nextState.examHistory = [];
    changed = true;
  } else {
    const normalized = [];
    const seenRecords = new Set();
    for (const record of nextState.examHistory) {
      const clean = normalizeExamRecord(record);
      if (!clean || seenRecords.has(clean.id)) {
        changed = true;
        continue;
      }
      normalized.push(clean);
      seenRecords.add(clean.id);
    }
    if (normalized.length !== nextState.examHistory.length || normalized.length > 30) changed = true;
    nextState.examHistory = normalized.slice(0, 30);
  }

  if (Array.isArray(nextState.redoSet)) {
    const filtered = nextState.redoSet.filter(id => LIVE_QIDS.has(id));
    if (filtered.length !== nextState.redoSet.length) changed = true;
    nextState.redoSet = filtered;
  } else if (nextState.redoSet) {
    nextState.redoSet = null;
    changed = true;
  }

  if (nextState.mode === 'redo' && (!nextState.redoSet || nextState.redoSet.length === 0)) {
    nextState.mode = 'practice';
    nextState.currentIdx = 0;
    changed = true;
  }

  if (nextState.exam && Array.isArray(nextState.exam.questions)) {
    const invalidExam = nextState.exam.questions.some(idx => !Number.isInteger(idx) || idx < 0 || idx >= ALL_QS.length);
    if (invalidExam) {
      nextState.exam = null;
      if (nextState.mode === 'exam') nextState.mode = 'practice';
      nextState.currentIdx = 0;
      changed = true;
    }
  }

  if (nextState.resultRecordId && !nextState.examHistory.some(record => record.id === nextState.resultRecordId)) {
    nextState.resultRecordId = null;
    changed = true;
  }

  if (nextState.examReview && !nextState.examHistory.some(record => record.id === nextState.examReview.recordId)) {
    nextState.examReview = null;
    if (nextState.mode === 'exam-review') nextState.mode = 'practice';
    nextState.currentIdx = 0;
    changed = true;
  }

  if (nextState.mode === 'exam-review') {
    const record = nextState.examReview && nextState.examHistory.find(item => item.id === nextState.examReview.recordId);
    if (!record || getExamMistakeIds(record).length === 0) {
      nextState.mode = 'practice';
      nextState.examReview = null;
      nextState.currentIdx = 0;
      changed = true;
    }
  }

  if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  return nextState;
}

// ─── filtering ───────────────────────────────────────────────
function getFilteredQs() {
  return ALL_QS.filter(q => {
    if (state.sourceFilter !== 'all' && q.source_kind !== state.sourceFilter) return false;
    if (state.chapterFilter !== 'all' && q.chapter !== state.chapterFilter) return false;
    return true;
  });
}

function getActiveList() {
  if (state.mode === 'exam' && state.exam) {
    return state.exam.questions.map(idx => ALL_QS[idx]);
  }
  if (state.mode === 'exam-review') {
    const record = currentExamReviewRecord();
    return getExamMistakeIds(record).map(qid => Q_BY_ID.get(qid)).filter(Boolean);
  }
  if (state.mode === 'review') {
    const wrongIds = Object.keys(state.answers).filter(qid => !state.answers[qid].correct);
    return ALL_QS.filter(q => wrongIds.includes(q.id));
  }
  if (state.mode === 'redo') {
    if (!state.redoSet || state.redoSet.length === 0) return [];
    const set = new Set(state.redoSet);
    return ALL_QS.filter(q => set.has(q.id));
  }
  return getFilteredQs();
}

function startRedoWrong() {
  const wrongIds = Object.keys(state.answers).filter(id => !state.answers[id].correct);
  const existingRedoIds = Array.isArray(state.redoSet) ? state.redoSet : [];
  const redoIds = wrongIds.length ? wrongIds : existingRedoIds;
  if (redoIds.length === 0) {
    alert('未有錯題可以重做');
    return;
  }
  const sameRedoSet = existingRedoIds.length === redoIds.length && existingRedoIds.every((id, idx) => id === redoIds[idx]);
  state.redoSet = redoIds;
  if (!sameRedoSet && wrongIds.length) state.redoAnswers = {};
  state.mode = 'redo';
  state.currentIdx = 0;
  saveState();
  setActiveNav('redo');
  showScreen('practice');
  renderSidebar();
  renderPanel();
}

// ─── rendering ──────────────────────────────────────────────
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function isMobileLayout() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function collapseSidebarOnMobile() {
  const sidebar = $('#sidebar');
  const menuBtn = $('#menu-toggle');
  if (!sidebar || !isMobileLayout()) return;
  sidebar.classList.add('collapsed');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
}

function showScreen(name) {
  for (const s of ['welcome', 'practice', 'exam-cover', 'exam-result']) {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = (s !== name);
  }
  const showProgress = (name === 'practice' || name === 'exam-cover');
  $('#progress').hidden = !showProgress;
}

function openPracticeMode(mode = 'practice') {
  state.mode = mode;
  state.examReview = null;
  if (mode !== 'exam' && state.exam) state.exam.finished = true;
  state.currentIdx = 0;
  saveState();
  setActiveNav(mode);
  showScreen('practice');
  renderSidebar();
  renderPanel();
}

function openExamCover() {
  setActiveNav('exam');
  showScreen('exam-cover');
  renderExamHistoryList();
}

function renderWelcome() {
  $('#stat-total').textContent = ALL_QS.length;
  $('#stat-chapters').textContent = new Set(ALL_QS.map(q => q.chapter)).size;
  $('#stat-papers').textContent = new Set(ALL_QS.map(q => q.source_short)).size;
}

function renderSidebar() {
  const sidebar = $('#sidebar');
  if (sidebar) {
    const fixedQuestionList = (state.mode === 'exam' && state.exam && !isExamFinished()) || state.mode === 'exam-review';
    sidebar.classList.toggle('exam-active', fixedQuestionList);
  }

  // chapter list
  const list = $('#topic-list');
  const counts = {};
  for (const q of getFilteredOrAllForCounts()) {
    counts[q.chapter] = (counts[q.chapter] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const chapterOrder = ['all', '1', '2', '3', '4', '5', '6', '7', '0'];
  list.innerHTML = '';
  for (const cid of chapterOrder) {
    if (cid === 'all') {
      list.appendChild(makeTopicItem('all', '全部章節', total));
      continue;
    }
    if (!counts[cid]) continue;
    list.appendChild(makeTopicItem(cid, `第 ${cid} 章 ${CHAPTER_TITLES[cid] || ''}`, counts[cid]));
  }

  // source toggle
  $$('#filter-source .mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.source === state.sourceFilter);
  });

  renderQGrid();
}

function getFilteredOrAllForCounts() {
  // For sidebar counts we filter by source only (so chapter counts respond to source switch)
  return ALL_QS.filter(q => state.sourceFilter === 'all' || q.source_kind === state.sourceFilter);
}

function makeTopicItem(cid, label, count) {
  const li = document.createElement('li');
  li.className = 'topic-item';
  if (state.chapterFilter === cid) li.classList.add('active');
  const span = document.createElement('span');
  span.style.flex = '1';
  span.style.overflow = 'hidden';
  span.style.textOverflow = 'ellipsis';
  span.style.whiteSpace = 'nowrap';
  span.textContent = label;
  const c = document.createElement('span');
  c.className = 'count num';
  c.textContent = count;
  li.appendChild(span);
  li.appendChild(c);
  li.addEventListener('click', () => {
    state.chapterFilter = cid;
    state.currentIdx = 0;
    saveState();
    renderSidebar();
    renderPanel();
    collapseSidebarOnMobile();
  });
  return li;
}

function renderQGrid() {
  const grid = $('#qgrid');
  const list = getActiveList();
  grid.innerHTML = '';
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    const btn = document.createElement('button');
    btn.className = 'qbtn num';
    btn.textContent = i + 1;
    btn.title = `第 ${i + 1} 題 · ${CHAPTER_TITLES[q.chapter] || ''}`;
    if (state.mode !== 'exam' || isExamFinished()) {
      const ans = answerForQuestion(q);
      if (ans) {
        if (ans.correct) btn.classList.add('correct');
        else btn.classList.add('incorrect');
      }
    } else if (state.exam && state.exam.chosen[q.id]) {
      btn.classList.add('correct'); // mark as answered (neutral)
      btn.style.background = 'var(--accent-soft)';
      btn.style.borderColor = 'var(--accent)';
      btn.style.color = 'var(--accent)';
    }
    if (i === state.currentIdx) btn.classList.add('current');
    btn.addEventListener('click', () => {
      state.currentIdx = i;
      saveState();
      renderPanel();
      renderQGrid();
      collapseSidebarOnMobile();
    });
    grid.appendChild(btn);
  }
}

function renderProgress() {
  const list = getActiveList();
  const total = list.length;
  let correct = 0, incorrect = 0, answered = 0;

  if (state.mode === 'exam' && state.exam && !isExamFinished()) {
    answered = Object.keys(state.exam.chosen).length;
    correct = 0; incorrect = 0;
  } else {
    for (const q of list) {
      const a = answerForQuestion(q);
      if (!a) continue;
      answered++;
      if (a.correct) correct++; else incorrect++;
    }
  }

  $('#pm-current').textContent = state.currentIdx + 1;
  $('#pm-total').textContent = total;
  $('#pm-correct').textContent = correct;
  $('#pm-incorrect').textContent = incorrect;
  const accuracyEl = $('#pm-accuracy');
  if (accuracyEl) {
    const canRevealAccuracy = !(state.mode === 'exam' && state.exam && !isExamFinished());
    if (state.mode === 'exam-review') {
      const record = currentExamReviewRecord();
      const totalInRecord = record ? record.questionIds.length : 0;
      const correctInRecord = record ? record.result.correct : 0;
      accuracyEl.textContent = totalInRecord ? `${Math.round((correctInRecord / totalInRecord) * 100)}% (${correctInRecord}/${totalInRecord})` : '—';
    } else {
      const accuracyAnswers = [];
      for (const q of ALL_QS) {
        const answer = state.mode === 'redo' ? (state.redoAnswers || {})[q.id] : state.answers[q.id];
        if (answer) accuracyAnswers.push(answer);
      }
      const allAnswered = accuracyAnswers.length;
      const allCorrect = accuracyAnswers.filter(a => a && a.correct).length;
      accuracyEl.textContent = canRevealAccuracy && allAnswered ? `${Math.round((allCorrect / allAnswered) * 100)}% (${allCorrect}/${allAnswered})` : '—';
    }
  }
  const pct = total ? (answered / total) * 100 : 0;
  $('#progress-fill').style.width = `${pct}%`;
}

function answerForQuestion(q) {
  if (state.mode === 'exam-review') {
    const record = currentExamReviewRecord();
    if (!record) return null;
    const chosen = record.choices[q.id] || null;
    return { chosen, correct: chosen === q.answer, examRecord: true };
  }
  if (state.mode === 'redo') return (state.redoAnswers || {})[q.id];
  return state.answers[q.id];
}

function studyRefLabel(q) {
  const chapter = `第 ${q.chapter === '0' ? '?' : q.chapter} 章 ${CHAPTER_TITLES[q.chapter] || ''}`.trim();
  const detailTitle = q.section_title && q.section_title !== CHAPTER_TITLES[q.chapter] ? ` ${q.section_title}` : '';
  if (q.ref === q.chapter && !detailTitle) return chapter;
  if (q.ref) return `${chapter} · ${q.ref}${detailTitle}`;
  return chapter;
}

function renderPanel() {
  const list = getActiveList();
  if (list.length === 0) {
    $('#panel-title').textContent = '沒有符合的題目';
    $('#panel-ctx').textContent = '— —';
    $('#qcard').innerHTML = '<p class="muted" style="text-align:center; padding: 40px 0;">調整左側篩選器試試。</p>';
    $('#prev-btn').disabled = true;
    $('#next-btn').disabled = true;
    $('#skip-btn').style.display = 'none';
    renderProgress();
    return;
  }
  if (state.currentIdx >= list.length) state.currentIdx = list.length - 1;
  if (state.currentIdx < 0) state.currentIdx = 0;

  const q = list[state.currentIdx];
  const chTitle = CHAPTER_TITLES[q.chapter] || '其他';
  const modeLabel = state.mode === 'exam' ? '考試模式'
    : state.mode === 'exam-review' ? '考試錯題'
    : state.mode === 'review' ? '錯題重溫'
    : state.mode === 'redo' ? '錯題重做'
    : '練習模式';

  $('#panel-mode').textContent = modeLabel;
  $('#panel-title').textContent = `第 ${state.currentIdx + 1} 題`;
  $('#panel-ctx').textContent = `${chTitle} · ${q.source_short}`;

  // render qcard
  const card = $('#qcard');
  card.innerHTML = '';

  // meta row
  const meta = document.createElement('div');
  meta.className = 'meta-row';
  const chPill = document.createElement('span');
  chPill.className = 'pill';
  chPill.textContent = `第 ${q.chapter === '0' ? '?' : q.chapter} 章`;
  meta.appendChild(chPill);
  const refTag = document.createElement('span');
  refTag.className = 'tag num';
  const liveExam = state.mode === 'exam' && !isExamFinished();
  if (liveExam) {
    // keep mock-exam integrity — no peeking at the handbook mid-exam
    refTag.textContent = studyRefLabel(q);
  } else {
    refTag.classList.add('note-tag');
    refTag.innerHTML = `${escapeHtml(studyRefLabel(q))} <span aria-hidden="true">↗</span>`;
    refTag.title = '開啟研習資料';
    refTag.addEventListener('click', () => openStudyNote(studyNoteAnchor(q), studyRefLabel(q)));
  }
  meta.appendChild(refTag);
  const srcTag = document.createElement('span');
  srcTag.className = 'tag';
  srcTag.textContent = q.source_short;
  meta.appendChild(srcTag);
  card.appendChild(meta);

  // stem
  const stem = document.createElement('p');
  stem.className = 'stem';
  stem.textContent = q.q;
  card.appendChild(stem);

  // options
  const opts = document.createElement('div');
  opts.className = 'options';
  const ans = answerForQuestion(q);
  const examMode = state.mode === 'exam' && !isExamFinished();
  const examReviewMode = state.mode === 'exam-review';
  const examChosen = examMode && state.exam && state.exam.chosen[q.id];
  const locked = examReviewMode || examChosen || (ans && ans.correct);

  for (const letter of ['A', 'B', 'C', 'D']) {
    const opt = document.createElement('button');
    opt.className = 'opt';
    if (locked) opt.classList.add('locked');

    // In exam mode (live), show chosen highlight only, no correctness reveal
    if (examMode) {
      if (state.exam && state.exam.chosen[q.id] === letter) opt.classList.add('chosen');
    } else if (ans) {
      // After answer (practice or review)
      if (letter === q.answer) opt.classList.add('correct');
      else if (letter === ans.chosen) opt.classList.add('incorrect');
    }

    const lt = document.createElement('span');
    lt.className = 'letter';
    lt.textContent = letter;
    opt.appendChild(lt);

    const txt = document.createElement('span');
    txt.className = 'text';
    txt.textContent = q.options[letter] || '';
    opt.appendChild(txt);

    if (!examMode && ans) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      if (letter === q.answer) badge.textContent = '正確答案';
      else if (letter === ans.chosen && letter !== q.answer) badge.textContent = '你的選擇';
      opt.appendChild(badge);
    }

    opt.addEventListener('click', () => handleAnswer(q, letter));
    opts.appendChild(opt);
  }
  card.appendChild(opts);

  // feedback
  if (!examMode && ans) {
    const fb = document.createElement('div');
    fb.className = 'feedback ' + (ans.correct ? 'correct' : 'incorrect');
    const verdict = ans.correct
      ? '✓ 正確答案是 ' + q.answer
      : ans.chosen
        ? '✗ 你選 ' + ans.chosen + ' · 正確答案 ' + q.answer
        : '未作答 · 正確答案 ' + q.answer;
    fb.innerHTML = `
      <div class="label">${ans.correct ? '答對了' : '答錯了'}</div>
      <div class="verdict">${verdict}</div>
      <p style="font-size:15px; color: var(--fg); line-height:1.55;">
        ${escapeHtml(q.options[q.answer])}
      </p>
      <div class="ref-row">
        <div>
          <span class="k">參考研習資料</span>
          <button type="button" class="note-jump" aria-label="開啟研習資料">
            ${escapeHtml(studyRefLabel(q))}
            <span class="note-jump-icon" aria-hidden="true">↗</span>
          </button>
        </div>
        <div>
          <span class="k">題目來源</span>
          <span>${escapeHtml(q.source)}</span>
        </div>
      </div>
    `;
    const noteBtn = fb.querySelector('.note-jump');
    if (noteBtn) {
      noteBtn.addEventListener('click', () => openStudyNote(studyNoteAnchor(q), studyRefLabel(q)));
    }
    card.appendChild(fb);
  }

  // actions
  $('#prev-btn').disabled = state.currentIdx === 0;
  $('#next-btn').disabled = state.currentIdx === list.length - 1 && !(state.mode === 'exam' && !isExamFinished());
  if (state.mode === 'exam' && !isExamFinished() && state.currentIdx === list.length - 1) {
    $('#next-btn').textContent = '交卷 →';
    $('#next-btn').disabled = false;
  } else {
    $('#next-btn').textContent = '下一題 →';
  }
  $('#skip-btn').style.display = (examReviewMode || ans || examChosen) ? 'none' : '';

  renderProgress();
  renderQGrid();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function handleAnswer(q, letter) {
  if (state.mode === 'exam-review') return;
  const examMode = state.mode === 'exam' && !isExamFinished();
  if (examMode) {
    state.exam.chosen[q.id] = letter;
    saveState();
    renderPanel();
    return;
  }
  const correct = letter === q.answer;
  const current = answerForQuestion(q);
  if (current && current.correct) return;
  if (state.mode === 'redo') {
    state.redoAnswers = state.redoAnswers || {};
    state.redoAnswers[q.id] = { chosen: letter, correct };
    if (correct) state.answers[q.id] = { chosen: letter, correct };
    saveState();
    renderPanel();
    return;
  }
  state.answers[q.id] = { chosen: letter, correct };
  saveState();
  renderPanel();
}

function isExamFinished() {
  return state.exam && state.exam.finished;
}

// ─── exam flow ──────────────────────────────────────────────
// Official MPF exam distribution: 80 Qs total
// Ch1:1 (1%) · Ch2:4 (6%) · Ch3:36 (45%) · Ch4:4 (5%) · Ch5:16 (19%) · Ch6:3 (4%) · Ch7:16 (20%)
const EXAM_DISTRIBUTION_80 = { '1': 1, '2': 4, '3': 36, '4': 4, '5': 16, '6': 3, '7': 16 };

function fisherYates(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build chapter quotas for an N-question exam by scaling official 80-Q distribution.
// Uses largest-remainder method to keep ints and ensure sum===n.
function scaleDistribution(n) {
  if (n === 80) return { ...EXAM_DISTRIBUTION_80 };
  const ratio = n / 80;
  const raw = {};
  for (const ch of Object.keys(EXAM_DISTRIBUTION_80)) {
    raw[ch] = EXAM_DISTRIBUTION_80[ch] * ratio;
  }
  const floored = {};
  let used = 0;
  for (const ch of Object.keys(raw)) {
    floored[ch] = Math.floor(raw[ch]);
    used += floored[ch];
  }
  let remaining = n - used;
  // Distribute leftover to chapters with largest fractional part (and at least Ch3 always gets one if any leftover)
  const remainders = Object.keys(raw)
    .map(ch => ({ ch, frac: raw[ch] - floored[ch] }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remaining; i++) {
    floored[remainders[i % remainders.length].ch] += 1;
  }
  // Guarantee each represented chapter has at least 1 if its official weight is >= 4%
  for (const ch of ['1', '6']) {
    if (floored[ch] === 0 && n >= 25) {
      // Steal one from Ch3 (largest)
      floored['3'] -= 1;
      floored[ch] = 1;
    }
  }
  return floored;
}

function startExam(n) {
  // Build per-chapter pool, honoring source filter
  const pool = getFilteredQs();
  const byChapter = {};
  for (const q of pool) {
    (byChapter[q.chapter] = byChapter[q.chapter] || []).push(q);
  }

  const quotas = scaleDistribution(n);
  const picked = [];
  const shortFalls = [];

  for (const ch of ['1', '2', '3', '4', '5', '6', '7']) {
    const want = quotas[ch] || 0;
    if (!want) continue;
    const avail = byChapter[ch] || [];
    const shuffled = fisherYates(avail);
    const take = shuffled.slice(0, Math.min(want, shuffled.length));
    picked.push(...take);
    if (take.length < want) shortFalls.push({ ch, missing: want - take.length });
  }

  // If any chapter ran short, fill from the largest remaining pool (Ch 3 usually)
  if (picked.length < n) {
    const pickedIds = new Set(picked.map(q => q.id));
    const fillers = fisherYates(pool.filter(q => !pickedIds.has(q.id)));
    while (picked.length < n && fillers.length) {
      picked.push(fillers.shift());
    }
  }

  // Final shuffle so chapter ordering isn't predictable
  const finalOrder = fisherYates(picked).map(q => ALL_QS.indexOf(q)).filter(i => i >= 0);

  state.exam = {
    questions: finalOrder,
    chosen: {},
    started: Date.now(),
    finished: false,
    size: n,
    distribution: quotas,
    shortFalls,
    sourceFilter: state.sourceFilter,
  };
  state.mode = 'exam';
  state.examReview = null;
  state.resultRecordId = null;
  state.currentIdx = 0;
  saveState();
  showScreen('practice');
  renderSidebar();
  renderPanel();
}

function finishExam() {
  if (!state.exam) return;
  state.exam.finished = true;
  state.exam.finishedAt = Date.now();
  // Score
  let correct = 0, incorrect = 0, skipped = 0;
  for (const idx of state.exam.questions) {
    const q = ALL_QS[idx];
    const choice = state.exam.chosen[q.id];
    if (!choice) { skipped++; continue; }
    const isRight = choice === q.answer;
    if (isRight) correct++; else incorrect++;
    // Also record into long-term answers
    state.answers[q.id] = { chosen: choice, correct: isRight };
  }
  state.exam.result = { correct, incorrect, skipped };
  const record = createExamHistoryRecord(state.exam);
  if (record) {
    state.exam.historyId = record.id;
    state.resultRecordId = record.id;
    rememberExamRecord(record);
  }
  saveState();
  showScreen('exam-result');
  renderExamResult(record || currentResultRecord());
}

function formatExamDate(ts) {
  return new Intl.DateTimeFormat('zh-Hant-HK', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts || Date.now()));
}

function renderExamResult(record) {
  if (!record) return;
  state.resultRecordId = record.id;
  const total = record.questionIds.length;
  const { correct, incorrect, skipped } = record.result;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  $('#result-pct').textContent = pct;
  $('#result-correct').textContent = correct;
  $('#result-incorrect').textContent = incorrect;
  $('#result-skipped').textContent = skipped;
  $('#result-detail').textContent = `${correct} / ${total} · ${record.size || total} 題模擬考試（依官方分卷比重隨機抽題）`;
  const recordTime = $('#result-record-time');
  if (recordTime) recordTime.textContent = formatExamDate(record.finishedAt);
  renderResultBreakdown(record);
  const mistakeCount = getExamMistakeIds(record).length;
  const reviewBtn = $('#result-review');
  reviewBtn.textContent = mistakeCount ? `查看錯題 (${mistakeCount})` : '沒有錯題';
  reviewBtn.disabled = mistakeCount === 0;
  const verdictEl = $('#result-verdict');
  if (pct >= 70) {
    verdictEl.textContent = '合格 — 繼續保持';
    verdictEl.style.color = 'oklch(40% 0.13 145)';
  } else if (pct >= 55) {
    verdictEl.textContent = '差一步 — 重溫第 3、5、7 章';
    verdictEl.style.color = 'var(--accent)';
  } else {
    verdictEl.textContent = '建議重新研習';
    verdictEl.style.color = 'var(--error)';
  }
}

function openExamResult(recordId) {
  const record = getExamRecordById(recordId);
  if (!record) return;
  state.resultRecordId = record.id;
  saveState();
  setActiveNav('exam');
  showScreen('exam-result');
  renderExamResult(record);
}

function openExamRecordReview(recordId) {
  const record = getExamRecordById(recordId);
  if (!record) return;
  const mistakeIds = getExamMistakeIds(record);
  if (!mistakeIds.length) {
    alert('這次考試沒有錯題');
    return;
  }
  state.mode = 'exam-review';
  state.examReview = { recordId: record.id };
  state.resultRecordId = record.id;
  state.currentIdx = 0;
  saveState();
  setActiveNav('exam');
  showScreen('practice');
  renderSidebar();
  renderPanel();
}

// ─── navigation ─────────────────────────────────────────────
function goPrev() {
  if (state.currentIdx > 0) {
    state.currentIdx--;
    saveState();
    renderPanel();
  }
}
function goNext() {
  const list = getActiveList();
  if (state.mode === 'exam' && !isExamFinished() && state.currentIdx === list.length - 1) {
    finishExam();
    return;
  }
  if (state.currentIdx < list.length - 1) {
    state.currentIdx++;
    saveState();
    renderPanel();
  }
}

// ─── wire up ────────────────────────────────────────────────
function wire() {
  // primary nav
  $$('#primary-nav a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const m = a.dataset.mode;
      if (m === 'exam') {
        history.replaceState(null, '', '#exam');
        openExamCover();
      } else if (m === 'redo') {
        history.replaceState(null, '', '#redo');
        startRedoWrong();
      } else {
        history.replaceState(null, '', `#${m}`);
        openPracticeMode(m);
      }
    });
  });

  // welcome
  $('#start-practice').addEventListener('click', () => {
    history.replaceState(null, '', '#practice');
    openPracticeMode('practice');
  });
  $('#start-exam').addEventListener('click', () => {
    history.replaceState(null, '', '#exam');
    openExamCover();
  });
  $('#reset-progress').addEventListener('click', () => {
    if (confirm('確定清除所有作答進度？')) {
      localStorage.removeItem(STORAGE_KEY);
      state = freshDefaultState();
      renderWelcome();
      showScreen('welcome');
    }
  });

  // exam cover
  $$('#exam-size-opts .opt-pill').forEach(b => {
    b.addEventListener('click', () => {
      $$('#exam-size-opts .opt-pill').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderDistPreview(parseInt(b.dataset.n));
    });
  });
  $('#exam-begin').addEventListener('click', () => {
    const active = $('#exam-size-opts .opt-pill.active');
    const n = parseInt(active.dataset.n);
    startExam(n);
  });
  $('#exam-back').addEventListener('click', () => {
    showScreen(state.answers && Object.keys(state.answers).length ? 'practice' : 'welcome');
  });
  // Render initial distribution preview (default 80)
  renderDistPreview(80);

  // result
  $('#result-retry').addEventListener('click', () => openExamCover());
  $('#result-home').addEventListener('click', () => showScreen('welcome'));
  $('#result-review').addEventListener('click', () => {
    const record = currentResultRecord();
    if (record) openExamRecordReview(record.id);
  });

  // source filter
  $$('#filter-source .mode-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.sourceFilter = b.dataset.source;
      state.currentIdx = 0;
      saveState();
      renderSidebar();
      renderPanel();
    });
  });

  // nav buttons
  $('#prev-btn').addEventListener('click', goPrev);
  $('#next-btn').addEventListener('click', goNext);
  $('#skip-btn').addEventListener('click', goNext);

  // mobile menu
  const menuBtn = $('#menu-toggle');
  if (menuBtn) menuBtn.addEventListener('click', () => {
    const sidebar = $('#sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed');
    menuBtn.setAttribute('aria-expanded', String(!sidebar.classList.contains('collapsed')));
  });

  // keyboard
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // ignore Cmd+C / Ctrl+C etc.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    }
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    }
    else if (['1','2','3','4','a','b','c','d','A','B','C','D'].includes(e.key)) {
      const map = {'1':'A','2':'B','3':'C','4':'D','a':'A','b':'B','c':'C','d':'D','A':'A','B':'B','C':'C','D':'D'};
      const letter = map[e.key];
      const list = getActiveList();
      const q = list[state.currentIdx];
      if (q && q.options[letter]) handleAnswer(q, letter);
    }
  }, { capture: true });
}

function setActiveNav(mode) {
  $$('#primary-nav a').forEach(a => a.classList.toggle('active', a.dataset.mode === mode));
}

// ─── exam distribution preview + result breakdown ──────────
function renderExamHistoryList() {
  const card = $('#exam-history-card');
  const list = $('#exam-history-list');
  const count = $('#exam-history-count');
  if (!card || !list) return;

  const history = Array.isArray(state.examHistory) ? state.examHistory : [];
  card.hidden = history.length === 0;
  if (count) count.textContent = history.length ? `${history.length} 次` : '';
  list.innerHTML = '';

  for (const record of history.slice(0, 12)) {
    const total = record.questionIds.length;
    const pct = total ? Math.round((record.result.correct / total) * 100) : 0;
    const mistakeCount = getExamMistakeIds(record).length;
    const row = document.createElement('div');
    row.className = 'exam-history-row';

    const main = document.createElement('div');
    main.className = 'exam-history-main';
    main.innerHTML = `
      <div class="exam-history-title num">${formatExamDate(record.finishedAt)}</div>
      <div class="exam-history-meta">
        <span class="num">${record.result.correct}/${total}</span>
        <span class="num">${pct}%</span>
        <span>錯題 <span class="num">${mistakeCount}</span></span>
      </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'exam-history-actions';
    const resultBtn = document.createElement('button');
    resultBtn.className = 'btn btn-secondary';
    resultBtn.textContent = '成績';
    resultBtn.addEventListener('click', () => openExamResult(record.id));
    actions.appendChild(resultBtn);

    const mistakesBtn = document.createElement('button');
    mistakesBtn.className = 'btn btn-primary';
    mistakesBtn.textContent = '錯題';
    mistakesBtn.disabled = mistakeCount === 0;
    mistakesBtn.addEventListener('click', () => openExamRecordReview(record.id));
    actions.appendChild(mistakesBtn);

    row.appendChild(main);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

function renderDistPreview(n) {
  const grid = document.getElementById('dist-grid');
  if (!grid) return;
  const quotas = scaleDistribution(n);
  document.getElementById('dist-total').textContent = `${n} 題`;
  grid.innerHTML = '';
  for (const ch of ['1','2','3','4','5','6','7']) {
    const meta = CHAPTERS.find(c => c.id === ch) || {};
    const cell = document.createElement('div');
    cell.className = 'dist-cell';
    cell.innerHTML = `
      <div class="ch-lbl">第 ${ch} 章</div>
      <div class="ch-n num">${quotas[ch] || 0}</div>
      <div class="ch-w num">${meta.weight || ''}</div>
    `;
    grid.appendChild(cell);
  }
}

function renderResultBreakdown(record = currentResultRecord()) {
  if (!record) return;
  const grid = document.getElementById('result-ch-grid');
  if (!grid) return;
  const passLineEl = document.getElementById('result-pass-line');
  const total = record.questionIds.length;
  const passNeeded = Math.ceil(total * 0.7);
  if (passLineEl) passLineEl.textContent = `合格線 ${passNeeded}/${total}`;

  // tally per chapter
  const stats = {};
  for (const qid of record.questionIds) {
    const q = Q_BY_ID.get(qid);
    if (!q) continue;
    const ch = q.chapter || '?';
    stats[ch] = stats[ch] || { total: 0, correct: 0, answered: 0 };
    stats[ch].total++;
    const choice = record.choices[q.id];
    if (choice) {
      stats[ch].answered++;
      if (choice === q.answer) stats[ch].correct++;
    }
  }

  grid.innerHTML = '';
  for (const ch of ['1','2','3','4','5','6','7']) {
    const meta = CHAPTERS.find(c => c.id === ch) || {};
    const s = stats[ch];
    if (!s || s.total === 0) {
      const cell = document.createElement('div');
      cell.className = 'dist-cell';
      cell.innerHTML = `
        <div class="ch-lbl">第 ${ch} 章</div>
        <div class="ch-n num" style="color:var(--muted)">—</div>
        <div class="ch-w num">${meta.weight || ''}</div>
      `;
      grid.appendChild(cell);
      continue;
    }
    const pct = s.total ? Math.round((s.correct / s.total) * 100) : 0;
    const cell = document.createElement('div');
    cell.className = 'dist-cell has-score' + (pct < 50 && s.total >= 2 ? ' weak' : (pct >= 80 ? ' strong' : ''));
    cell.innerHTML = `
      <div class="ch-lbl">第 ${ch} 章</div>
      <div class="ch-n num">${s.correct}<span style="font-size:13px; color:var(--muted)">/${s.total}</span></div>
      <div class="ch-w num">${meta.weight || ''}</div>
      <div class="ch-score num">${pct}%</div>
    `;
    grid.appendChild(cell);
  }
}

// ─── boot ───────────────────────────────────────────────────
function init() {
  renderWelcome();
  wire();

  const hashMode = window.location.hash.replace('#', '');
  if (hashMode === 'practice' || hashMode === 'review') {
    openPracticeMode(hashMode);
    return;
  }
  if (hashMode === 'redo') {
    startRedoWrong();
    return;
  }
  if (hashMode === 'exam') {
    openExamCover();
    return;
  }

  // Resume previous session if there's progress
  if (state.exam && !state.exam.finished) {
    setActiveNav('exam');
    showScreen('practice');
    renderSidebar();
    renderPanel();
  } else if (state.mode === 'exam-review' && currentExamReviewRecord()) {
    setActiveNav('exam');
    showScreen('practice');
    renderSidebar();
    renderPanel();
  } else if (Object.keys(state.answers).length > 0) {
    setActiveNav(state.mode);
    showScreen('practice');
    renderSidebar();
    renderPanel();
  } else {
    showScreen('welcome');
  }
}

setupNoteDrawer();
init();
