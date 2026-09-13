const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080; // Azure App Service injects PORT

const QUESTIONS_PATH = path.join(__dirname, 'data', 'questions.json');
const USERS_PATH = path.join(__dirname, 'data', 'users.json');
const PROGRESS_PATH = path.join(__dirname, 'data', 'progress.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- small helpers ---
function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// =========================================================
// QUESTIONS
// =========================================================

app.get('/api/questions', (req, res) => {
  try {
    const all = readJson(QUESTIONS_PATH, []);
    const { topic, week, type } = req.query;
    let result = all;
    if (topic) result = result.filter(q => q.topic === topic);
    if (week) result = result.filter(q => q.week === week);
    if (type) result = result.filter(q => q.type === type);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load questions' });
  }
});

app.get('/api/topics', (req, res) => {
  try {
    const all = readJson(QUESTIONS_PATH, []);
    const topics = {};
    all.forEach(q => {
      if (!topics[q.topic]) topics[q.topic] = new Set();
      topics[q.topic].add(q.week);
    });
    const out = Object.entries(topics).map(([topic, weeks]) => ({
      topic,
      weeks: Array.from(weeks)
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load topics' });
  }
});

app.post('/api/questions', (req, res) => {
  try {
    const all = readJson(QUESTIONS_PATH, []);
    const nextId = all.length ? Math.max(...all.map(q => q.id)) + 1 : 1;
    const newQuestion = { id: nextId, ...req.body };
    if (!newQuestion.topic || !newQuestion.prompt || !newQuestion.type) {
      return res.status(400).json({ error: 'topic, prompt and type are required' });
    }
    all.push(newQuestion);
    writeJson(QUESTIONS_PATH, all);
    res.status(201).json(newQuestion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save question' });
  }
});

// =========================================================
// USERS (lightweight name+PIN — not real security, just keeps
// different people's progress on this shared deployment separate)
// =========================================================

function normaliseUsername(name) {
  return String(name || '').trim().toLowerCase();
}

app.post('/api/login', (req, res) => {
  try {
    const rawName = req.body.username;
    const pin = String(req.body.pin || '').trim();
    const username = normaliseUsername(rawName);

    if (!username || !pin) {
      return res.status(400).json({ error: 'Username and PIN are required' });
    }
    if (!/^[a-z0-9._-]{2,30}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 2-30 characters: letters, numbers, . _ -' });
    }
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    }

    const users = readJson(USERS_PATH, {});

    if (users[username]) {
      if (users[username].pin !== pin) {
        return res.status(401).json({ error: 'That username exists with a different PIN. Try a different username, or the matching PIN.' });
      }
    } else {
      users[username] = { pin, displayName: String(rawName).trim(), createdAt: new Date().toISOString() };
      writeJson(USERS_PATH, users);
    }

    res.json({ username, displayName: users[username].displayName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// =========================================================
// PROGRESS (per-user, server-side)
// =========================================================

app.get('/api/progress', (req, res) => {
  try {
    const username = normaliseUsername(req.query.username);
    if (!username) return res.status(400).json({ error: 'username is required' });
    const allProgress = readJson(PROGRESS_PATH, {});
    res.json(allProgress[username] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load progress' });
  }
});

app.post('/api/progress', (req, res) => {
  try {
    const username = normaliseUsername(req.body.username);
    const { questionId, correct } = req.body;
    if (!username || questionId === undefined || typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'username, questionId, and correct are required' });
    }
    const allProgress = readJson(PROGRESS_PATH, {});
    if (!allProgress[username]) allProgress[username] = {};
    if (!allProgress[username][questionId]) allProgress[username][questionId] = { correct: 0, incorrect: 0 };
    if (correct) allProgress[username][questionId].correct++;
    else allProgress[username][questionId].incorrect++;
    writeJson(PROGRESS_PATH, allProgress);
    res.json(allProgress[username]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save progress' });
  }
});

app.delete('/api/progress', (req, res) => {
  try {
    const username = normaliseUsername(req.query.username);
    if (!username) return res.status(400).json({ error: 'username is required' });
    const allProgress = readJson(PROGRESS_PATH, {});
    delete allProgress[username];
    writeJson(PROGRESS_PATH, allProgress);
    res.json({ cleared: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reset progress' });
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`Exam prep app listening on port ${PORT}`);
});
