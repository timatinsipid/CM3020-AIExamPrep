// ---------- State ----------
let allQuestions = [];
let quizQueue = [];
let quizIndex = 0;
let quizScore = 0;
let flashQueue = [];
let flashIndex = 0;
let currentUser = null; // { username, displayName }

const USER_KEY = 'examPrepUser_v1';

// ---------- Login / user identity ----------
function getSavedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}
function saveUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function clearSavedUser() {
  localStorage.removeItem(USER_KEY);
}

function showLoginOverlay() {
  document.getElementById('login-overlay').classList.remove('hidden');
}
function hideLoginOverlay() {
  document.getElementById('login-overlay').classList.add('hidden');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const pin = document.getElementById('login-pin').value.trim();
  const statusEl = document.getElementById('login-status');
  statusEl.textContent = '';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin })
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || 'Login failed.';
      return;
    }
    currentUser = { username: data.username, displayName: data.displayName };
    saveUser(currentUser);
    hideLoginOverlay();
    updateUserLabel();
    trackVisit();
  } catch (err) {
    statusEl.textContent = 'Could not reach the server. Try again.';
  }
});

document.getElementById('switch-user-btn').addEventListener('click', () => {
  clearSavedUser();
  currentUser = null;
  document.getElementById('login-username').value = '';
  document.getElementById('login-pin').value = '';
  showLoginOverlay();
});

function updateUserLabel() {
  document.getElementById('current-user-label').textContent = currentUser ? currentUser.displayName : '';
}

function requireLogin() {
  const saved = getSavedUser();
  if (saved && saved.username) {
    currentUser = saved;
    updateUserLabel();
    trackVisit();
  } else {
    showLoginOverlay();
  }
}

function trackVisit() {
  if (!currentUser) return;
  fetch('/api/track-visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser.username })
  }).catch(err => console.error('Could not track visit', err));
}

// ---------- Progress (server-side, per user) ----------
async function loadStats() {
  if (!currentUser) return {};
  try {
    const res = await fetch(`/api/progress?username=${encodeURIComponent(currentUser.username)}`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

async function recordResult(questionId, correct) {
  if (!currentUser) return;
  try {
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, questionId, correct })
    });
  } catch (err) {
    console.error('Could not save progress', err);
  }
}

async function resetStats() {
  if (!currentUser) return;
  await fetch(`/api/progress?username=${encodeURIComponent(currentUser.username)}`, { method: 'DELETE' });
}

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'weak') renderWeakSpots();
    if (btn.dataset.tab === 'usage') renderUsage();
  });
});

// ---------- Fetch content ----------
async function fetchQuestions() {
  const res = await fetch('/api/questions');
  allQuestions = await res.json();
  populateTopicFilters();
}

function populateTopicFilters() {
  const topics = [...new Set(allQuestions.map(q => q.topic))].sort();
  ['quiz-topic-filter', 'flash-topic-filter'].forEach(id => {
    const sel = document.getElementById(id);
    topics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      sel.appendChild(opt);
    });
  });
}

// ---------- QUIZ ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

document.getElementById('start-quiz-btn').addEventListener('click', () => {
  const topic = document.getElementById('quiz-topic-filter').value;
  let pool = allQuestions.filter(q => q.type === 'mcq');
  if (topic) pool = pool.filter(q => q.topic === topic);
  quizQueue = shuffle(pool);
  quizIndex = 0;
  quizScore = 0;
  document.getElementById('quiz-summary').classList.add('hidden');
  if (quizQueue.length === 0) {
    alert('No multiple-choice questions for that topic yet.');
    return;
  }
  document.getElementById('quiz-card').classList.remove('hidden');
  showQuizQuestion();
});

function showQuizQuestion() {
  const q = quizQueue[quizIndex];
  document.getElementById('quiz-topic-tag').textContent = `${q.topic} — ${q.week}`;
  document.getElementById('quiz-question').textContent = q.prompt;
  document.getElementById('quiz-progress').textContent = `Question ${quizIndex + 1} / ${quizQueue.length} — Score: ${quizScore}`;
  const optionsDiv = document.getElementById('quiz-options');
  optionsDiv.innerHTML = '';
  document.getElementById('quiz-feedback').classList.add('hidden');
  document.getElementById('next-question-btn').classList.add('hidden');

  q.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => answerQuiz(idx));
    optionsDiv.appendChild(btn);
  });
}

async function answerQuiz(selectedIdx) {
  const q = quizQueue[quizIndex];
  const correct = selectedIdx === q.answer;
  await recordResult(q.id, correct);
  if (correct) quizScore++;

  document.querySelectorAll('.option-btn').forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.answer) btn.classList.add('correct');
    else if (idx === selectedIdx) btn.classList.add('incorrect');
  });

  const feedback = document.getElementById('quiz-feedback');
  feedback.classList.remove('hidden');
  feedback.textContent = (correct ? '✓ Correct. ' : '✗ Not quite. ') + (q.explanation || '');

  document.getElementById('next-question-btn').classList.remove('hidden');
  document.getElementById('quiz-progress').textContent = `Question ${quizIndex + 1} / ${quizQueue.length} — Score: ${quizScore}`;
}

document.getElementById('next-question-btn').addEventListener('click', () => {
  quizIndex++;
  if (quizIndex >= quizQueue.length) {
    document.getElementById('quiz-card').classList.add('hidden');
    const summary = document.getElementById('quiz-summary');
    summary.classList.remove('hidden');
    const pct = Math.round((quizScore / quizQueue.length) * 100);
    summary.innerHTML = `<h2>Quiz complete</h2><p>Score: ${quizScore} / ${quizQueue.length} (${pct}%)</p>`;
  } else {
    showQuizQuestion();
  }
});

// ---------- FLASHCARDS ----------
document.getElementById('shuffle-flash-btn').addEventListener('click', startFlashcards);
document.getElementById('flash-topic-filter').addEventListener('change', startFlashcards);

function startFlashcards() {
  const topic = document.getElementById('flash-topic-filter').value;
  let pool = allQuestions.filter(q => q.type === 'flash');
  if (topic) pool = pool.filter(q => q.topic === topic);
  flashQueue = shuffle(pool);
  flashIndex = 0;
  if (flashQueue.length === 0) {
    document.getElementById('flash-card').classList.add('hidden');
    return;
  }
  document.getElementById('flash-card').classList.remove('hidden');
  showFlashcard();
}

function showFlashcard() {
  const q = flashQueue[flashIndex];
  document.getElementById('flash-topic-tag').textContent = `${q.topic} — ${q.week}`;
  document.getElementById('flash-front').textContent = q.prompt;
  document.getElementById('flash-back').textContent = q.hint || '';
  document.getElementById('flash-back').classList.add('hidden');
  document.getElementById('flash-progress').textContent = `Card ${flashIndex + 1} / ${flashQueue.length}`;
}

document.getElementById('flip-btn').addEventListener('click', () => {
  document.getElementById('flash-back').classList.toggle('hidden');
});

document.getElementById('flash-again-btn').addEventListener('click', async () => {
  await recordResult(flashQueue[flashIndex].id, false);
  advanceFlash();
});
document.getElementById('flash-good-btn').addEventListener('click', async () => {
  await recordResult(flashQueue[flashIndex].id, true);
  advanceFlash();
});
document.getElementById('flash-next-btn').addEventListener('click', advanceFlash);

function advanceFlash() {
  flashIndex++;
  if (flashIndex >= flashQueue.length) flashIndex = 0;
  showFlashcard();
}

// ---------- WEAK SPOTS ----------
async function renderWeakSpots() {
  const list = document.getElementById('weak-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  const stats = await loadStats();
  list.innerHTML = '';

  const rows = Object.entries(stats).map(([id, s]) => {
    const q = allQuestions.find(q => q.id === Number(id));
    if (!q) return null;
    const total = s.correct + s.incorrect;
    const accuracy = total ? Math.round((s.correct / total) * 100) : 0;
    return { q, accuracy, total };
  }).filter(Boolean)
    .filter(r => r.total > 0)
    .sort((a, b) => a.accuracy - b.accuracy);

  if (rows.length === 0) {
    list.innerHTML = '<p class="muted">No quiz/flashcard attempts recorded yet — start a quiz or review some flashcards.</p>';
    return;
  }

  rows.forEach(r => {
    const div = document.createElement('div');
    div.className = 'weak-row';
    div.innerHTML = `<span>${r.q.topic}: ${r.q.prompt.slice(0, 60)}${r.q.prompt.length > 60 ? '…' : ''}</span><span>${r.accuracy}% (${r.total} tries)</span>`;
    list.appendChild(div);
  });
}

document.getElementById('reset-progress-btn').addEventListener('click', async () => {
  if (confirm(`Clear all quiz/flashcard progress for "${currentUser.displayName}"?`)) {
    await resetStats();
    renderWeakSpots();
  }
});

// ---------- USAGE ----------
async function renderUsage() {
  const tbody = document.querySelector('#usage-table tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';
  try {
    const res = await fetch('/api/usage');
    const rows = await res.json();
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No visits recorded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const loc = r.lastLocation
        ? [r.lastLocation.city, r.lastLocation.region, r.lastLocation.country].filter(Boolean).join(', ')
        : 'Unknown';
      const lastSeen = r.lastAccessAt ? new Date(r.lastAccessAt).toLocaleString() : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.displayName || r.username}</td><td>${r.accessCount}</td><td>${loc}</td><td>${lastSeen}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Could not load usage data.</td></tr>';
  }
}

// ---------- GITHUB SYNC ----------
document.getElementById('sync-github-btn').addEventListener('click', async () => {
  const secret = document.getElementById('sync-secret').value.trim();
  const statusEl = document.getElementById('sync-status');
  if (!secret) {
    statusEl.textContent = 'Enter the sync secret first.';
    return;
  }
  statusEl.textContent = 'Syncing…';
  try {
    const res = await fetch('/api/sync-to-github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': secret },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (res.ok) {
      statusEl.textContent = `Synced to GitHub successfully${data.commit ? ` (commit ${data.commit.slice(0, 7)})` : ''}.`;
    } else {
      statusEl.textContent = `Sync failed: ${data.error || 'unknown error'}`;
    }
  } catch (err) {
    statusEl.textContent = 'Could not reach the server to sync.';
  }
});

// ---------- ADD QUESTION ----------
document.getElementById('add-type').addEventListener('change', (e) => {
  const isMcq = e.target.value === 'mcq';
  document.getElementById('add-mcq-fields').classList.toggle('hidden', !isMcq);
  document.getElementById('add-flash-fields').classList.toggle('hidden', isMcq);
});

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.getElementById('add-type').value;
  const topic = document.getElementById('add-topic').value.trim();
  const week = document.getElementById('add-week').value.trim() || 'General';
  const prompt = document.getElementById('add-prompt').value.trim();
  const explanation = document.getElementById('add-explanation').value.trim();

  const body = { type, topic, week, prompt, explanation };

  if (type === 'mcq') {
    const opts = [...document.querySelectorAll('.add-opt')].map(i => i.value.trim()).filter(Boolean);
    const answerLetter = document.getElementById('add-answer').value.trim().toUpperCase();
    const answerIdx = 'ABCD'.indexOf(answerLetter);
    if (opts.length < 2 || answerIdx === -1) {
      document.getElementById('add-status').textContent = 'Please provide at least 2 options and a valid correct-option letter.';
      return;
    }
    body.options = opts;
    body.answer = answerIdx;
  } else {
    body.hint = document.getElementById('add-hint').value.trim();
  }

  const res = await fetch('/api/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    document.getElementById('add-status').textContent = 'Saved! It will appear next time you start a quiz/flashcard session.';
    document.getElementById('add-form').reset();
    await fetchQuestions();
  } else {
    document.getElementById('add-status').textContent = 'Something went wrong saving that question.';
  }
});

// ---------- Init ----------
requireLogin();
fetchQuestions();
