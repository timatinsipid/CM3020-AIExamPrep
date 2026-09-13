const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080; // Azure App Service injects PORT

const QUESTIONS_PATH = path.join(__dirname, 'data', 'questions.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API: all questions (optionally filtered by topic/week) ---
app.get('/api/questions', (req, res) => {
  try {
    const all = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
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

// --- API: distinct topics/weeks, for building the picker UI ---
app.get('/api/topics', (req, res) => {
  try {
    const all = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
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

// --- API: add a new question/flashcard (lets you extend the bank over time) ---
app.post('/api/questions', (req, res) => {
  try {
    const all = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
    const nextId = all.length ? Math.max(...all.map(q => q.id)) + 1 : 1;
    const newQuestion = { id: nextId, ...req.body };
    if (!newQuestion.topic || !newQuestion.prompt || !newQuestion.type) {
      return res.status(400).json({ error: 'topic, prompt and type are required' });
    }
    all.push(newQuestion);
    fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(all, null, 2));
    res.status(201).json(newQuestion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save question' });
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`Exam prep app listening on port ${PORT}`);
});
