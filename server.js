const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', true); // so req.ip reflects the real client IP behind Azure's proxy
const PORT = process.env.PORT || 8080; // Azure App Service injects PORT

const QUESTIONS_PATH = path.join(__dirname, 'data', 'questions.json');
const USERS_PATH = path.join(__dirname, 'data', 'users.json');
const PROGRESS_PATH = path.join(__dirname, 'data', 'progress.json');
const USAGE_PATH = path.join(__dirname, 'data', 'usage.json');
const IP_CACHE_PATH = path.join(__dirname, 'data', 'ip-cache.json');

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
    allProgress[username][questionId].lastAttemptAt = new Date().toISOString();
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

// =========================================================
// USAGE TRACKING (name, access count, best-effort IP location)
// =========================================================

function stripPort(ip) {
  if (!ip) return ip;
  ip = ip.trim();
  // Bracketed IPv6 with a port, e.g. [::1]:54321
  if (ip.startsWith('[')) {
    const closeBracket = ip.indexOf(']');
    if (closeBracket !== -1) return ip.slice(1, closeBracket);
  }
  // IPv4 with a port, e.g. 203.0.113.5:54321 — Azure's X-Forwarded-For includes this.
  // (Plain IPv6 addresses contain multiple colons and no dot, so this only
  // matches the "one colon, and it looks like IPv4" case.)
  const parts = ip.split(':');
  if (parts.length === 2 && parts[0].includes('.')) {
    return parts[0];
  }
  return ip;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = forwarded ? forwarded.split(',')[0].trim() : req.ip;
  return stripPort(raw);
}

async function lookupLocation(ip) {
  // Skip lookups for local/private addresses (won't resolve to anything useful)
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return null;
  }
  const cache = readJson(IP_CACHE_PATH, {});
  const cached = cache[ip];
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (cached && (Date.now() - new Date(cached.cachedAt).getTime()) < oneDayMs) {
    return cached.location;
  }
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!res.ok) {
      console.error(`IP lookup HTTP error for ${ip}: status ${res.status}`);
      return cached ? cached.location : null;
    }
    const data = await res.json();
    if (data.error) {
      console.error(`IP lookup API error for ${ip}: ${data.reason || 'unknown reason'}`);
      return cached ? cached.location : null;
    }
    const location = {
      city: data.city || null,
      region: data.region || null,
      country: data.country_name || null
    };
    cache[ip] = { location, cachedAt: new Date().toISOString() };
    writeJson(IP_CACHE_PATH, cache);
    return location;
  } catch (err) {
    console.error(`IP lookup failed for ${ip}:`, err.message);
    return cached ? cached.location : null;
  }
}

app.post('/api/track-visit', async (req, res) => {
  try {
    const username = normaliseUsername(req.body.username);
    if (!username) return res.status(400).json({ error: 'username is required' });

    const ip = getClientIp(req);
    const location = await lookupLocation(ip);

    const users = readJson(USERS_PATH, {});
    const displayName = (users[username] && users[username].displayName) || username;

    const usage = readJson(USAGE_PATH, {});
    if (!usage[username]) {
      usage[username] = {
        displayName,
        accessCount: 0,
        firstAccessAt: new Date().toISOString()
      };
    }
    usage[username].displayName = displayName; // keep in sync in case it changed
    usage[username].accessCount++;
    usage[username].lastAccessAt = new Date().toISOString();
    usage[username].lastIp = ip;
    usage[username].lastLocation = location;

    writeJson(USAGE_PATH, usage);
    res.json({ tracked: true });
  } catch (err) {
    console.error('Track visit failed:', err.message);
    res.status(500).json({ error: 'Could not track visit' });
  }
});

app.get('/api/usage', (req, res) => {
  try {
    const usage = readJson(USAGE_PATH, {});
    const list = Object.entries(usage).map(([username, u]) => ({ username, ...u }));
    list.sort((a, b) => new Date(b.lastAccessAt) - new Date(a.lastAccessAt));
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load usage data' });
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

// =========================================================
// GITHUB SYNC (push data/questions.json back to your repo)
// =========================================================
// Configure via Azure App Service > Configuration > Application settings:
//   GITHUB_TOKEN        - a fine-grained PAT with Contents: Read & write on the repo
//   GITHUB_REPO         - e.g. "timatinsipid/CM3020-AIExamPrep"
//   GITHUB_FILE_PATH    - e.g. "exam-prep-app/data/questions.json" (path within the repo)
//   GITHUB_BRANCH       - e.g. "main" (defaults to main if unset)
//   SYNC_SECRET         - any string you choose; required to trigger a sync
//   AUTO_SYNC_HOURS     - optional; if set to a number > 0, auto-syncs on that interval

async function syncQuestionsToGithub() {
  const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_FILE_PATH, GITHUB_BRANCH } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO || !GITHUB_FILE_PATH) {
    throw new Error('GitHub sync is not configured (missing GITHUB_TOKEN, GITHUB_REPO, or GITHUB_FILE_PATH app settings)');
  }
  const branch = GITHUB_BRANCH || 'main';
  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'exam-prep-app-sync'
  };

  const content = fs.readFileSync(QUESTIONS_PATH, 'utf8');
  const contentBase64 = Buffer.from(content, 'utf8').toString('base64');

  // Get the current file's sha (needed to update an existing file); 404 means it doesn't exist yet.
  let sha;
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });
  if (getRes.ok) {
    const getData = await getRes.json();
    sha = getData.sha;
  } else if (getRes.status !== 404) {
    const errText = await getRes.text();
    throw new Error(`GitHub GET failed (${getRes.status}): ${errText}`);
  }

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Sync questions.json from live app (${new Date().toISOString()})`,
      content: contentBase64,
      branch,
      ...(sha ? { sha } : {})
    })
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub PUT failed (${putRes.status}): ${errText}`);
  }

  return putRes.json();
}

app.post('/api/sync-to-github', async (req, res) => {
  try {
    const { SYNC_SECRET } = process.env;
    const providedSecret = req.get('x-sync-secret') || req.body.secret;
    if (!SYNC_SECRET) {
      return res.status(501).json({ error: 'SYNC_SECRET is not configured on the server' });
    }
    if (providedSecret !== SYNC_SECRET) {
      return res.status(401).json({ error: 'Invalid or missing sync secret' });
    }
    const result = await syncQuestionsToGithub();
    res.json({ synced: true, commit: result.commit && result.commit.sha });
  } catch (err) {
    console.error('Sync to GitHub failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Optional: automatic periodic sync (requires Always On to keep the app awake)
const autoSyncHours = parseFloat(process.env.AUTO_SYNC_HOURS);
if (autoSyncHours > 0) {
  const intervalMs = autoSyncHours * 60 * 60 * 1000;
  console.log(`Auto-sync to GitHub enabled: every ${autoSyncHours} hour(s)`);
  setInterval(() => {
    syncQuestionsToGithub()
      .then(() => console.log('Auto-sync to GitHub succeeded'))
      .catch(err => console.error('Auto-sync to GitHub failed:', err.message));
  }, intervalMs);
}

app.listen(PORT, () => {
  console.log(`Exam prep app listening on port ${PORT}`);
});
