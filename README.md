# AI Module Exam Prep

A small Node.js/Express web app for revising your AI module: multiple-choice
quizzes, flashcards (spaced-review style with "Again" / "Got it" buttons), a
weak-spots dashboard tracked locally in your browser, and a form to add your
own questions as you write more past-paper answers.

Content currently covers: RL fundamentals (MDPs, Q-learning), epsilon-greedy
exploration/annealing, DQN components (experience replay, target network,
model capacity), bio-inspired computing and genetic algorithms (fitness
functions, genotype/phenotype, encoding schemes, GA vs DQN trade-offs),
knowledge representation and Robot Scientists, planning, and generative/
creative AI (fine-tuning, latent space, VAEs). Add more via the "Add
Question" tab as you cover more past papers — they're saved into
`data/questions.json` on the server, so they persist across restarts (though
see the note on Azure's filesystem below).

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:8080

## Project structure

```
exam-prep-app/
  server.js            # Express server: static hosting + question API
  data/questions.json  # the question/flashcard bank (edit or extend via the UI)
  public/              # frontend: index.html, styles.css, app.js
  package.json
```

## Deploying to Azure App Service

You'll need the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
installed and logged in (`az login`).

### Option A: Zip deploy (quickest)

```bash
# From inside the exam-prep-app folder:
az group create --name exam-prep-rg --location uksouth

az appservice plan create \
  --name exam-prep-plan \
  --resource-group exam-prep-rg \
  --sku B1 \
  --is-linux

az webapp create \
  --name <choose-a-globally-unique-name> \
  --resource-group exam-prep-rg \
  --plan exam-prep-plan \
  --runtime "NODE:20-lts"

# Zip up the app (excluding node_modules — Azure will run npm install itself)
zip -r ../exam-prep-app.zip . -x "node_modules/*"

az webapp deploy \
  --resource-group exam-prep-rg \
  --name <same-name-as-above> \
  --src-path ../exam-prep-app.zip \
  --type zip
```

Azure will run `npm install` and `npm start` automatically for a Node app
(it reads `package.json`'s `start` script and the `engines.node` field).
Your app will be live at `https://<your-app-name>.azurewebsites.net`.

### Option B: Deploy from a GitHub repo (recommended if you'll keep adding questions)

1. Push this folder to a GitHub repo.
2. In the Azure Portal: create a Web App (Node 20 LTS, Linux, same as above),
   then under **Deployment Center**, connect it to your GitHub repo/branch.
   Azure will set up a GitHub Actions workflow that redeploys on every push.
3. This also means editing `data/questions.json` and pushing is a simple way
   to bulk-add questions from your laptop, rather than only using the in-app form.

### Multi-user support

Anyone who opens the deployed URL is asked for a name and a 4-6 digit PIN
before they can start a quiz or flashcard session (see the login overlay in
`public/index.html` / `public/app.js`). This is **not real authentication**
— there's no password reset, no email, nothing encrypted — it exists purely
so that if you share the link with classmates, everyone's quiz scores and
"weak spots" stay separate rather than mixing together. The PIN just stops
someone accidentally (or deliberately) typing an existing name and seeing/
resetting someone else's progress.

- `data/users.json` stores `{ username: { pin, displayName, createdAt } }`.
- `data/progress.json` stores `{ username: { questionId: {correct, incorrect} } }`.

Each browser remembers who's logged in via `localStorage` (just the
username/displayName, not the PIN), so you won't be asked to log in again on
the same device — but you will on a new device/browser, and a "Switch user"
button in the header lets you swap identities on a shared machine.

### Smart review mode

Both the Quiz and Flashcards tabs have a "Smart review (weak, new, or stale)"
checkbox. When ticked, instead of quizzing on everything in the selected
topic, it narrows the pool to questions that need attention:

- **Weak** — your recorded accuracy on that question is below 70%.
- **New** — you've never attempted it before.
- **Stale** — you got it right consistently, but haven't seen it in the
  last 3 days (a simple spaced-repetition nudge, so mastered material still
  resurfaces occasionally rather than being dropped forever).

Anything you're both doing well on *and* have reviewed recently is left out
of this mode, since that's exactly the material that doesn't need
revisiting yet. The 3-day staleness window and 70% threshold are constants
(`WEAK_ACCURACY_THRESHOLD`, `STALE_MS`) near the top of `filterToWeak()` in
`public/app.js` if you want to tune them.

This relies on `lastAttemptAt` timestamps recorded server-side in
`data/progress.json` from this point forward — any progress recorded
*before* this update won't have a timestamp, so it's treated as due for
review the first time smart review mode runs (a reasonable default, since
there's no way to know when it was actually last seen).

### Usage tracking

The **Usage** tab shows, per name: how many times the app has been opened,
and a best-effort city/region/country guess from the visitor's IP address
(via the free [ipapi.co](https://ipapi.co) lookup, cached for 24 hours per
IP to stay well within its free-tier rate limit). This is recorded
automatically on every visit — no separate opt-in — via `data/usage.json`
and `data/ip-cache.json`.

Worth knowing before you share the link with anyone:

- **IP-based location is approximate and often wrong** — it reflects the
  visitor's ISP or mobile network, not their literal address, and can be
  way off for VPNs, corporate networks, or mobile data.
- **There's no access control on the Usage tab** — anyone who's logged in
  can see everyone else's visit counts and locations. Fine for a couple of
  classmates who know this is happening; not something to enable if you
  share this more broadly without telling people.
- If you'd rather not collect this at all, delete the two `trackVisit()`
  call sites in `public/app.js` (`requireLogin()` and the login form's
  submit handler) and remove the Usage tab from `public/index.html`.

### Syncing added questions back to GitHub

Questions added via the "Add Question" tab are written to
`data/questions.json` on the live App Service, but (see "A note on
persistence" below) a future code redeploy will overwrite that file with
whatever's in your repo — silently discarding anything added through the UI
in between. The "Sync questions to GitHub" control on the **Weak Spots**
tab pushes the current live `questions.json` straight to your GitHub repo
via the GitHub Contents API, so you can do this right before redeploying
instead of manually downloading/uploading through Kudu.

**One-time setup:**

1. Create a fine-grained GitHub Personal Access Token (Settings → Developer
   settings → Personal access tokens → Fine-grained tokens) scoped to just
   this one repository, with **Contents: Read and write** permission and
   nothing else.
2. In the Azure Portal, open your Web App → **Settings → Environment
   variables** (or "Configuration → Application settings" on older portal
   layouts) and add:
   - `GITHUB_TOKEN` — the token from step 1
   - `GITHUB_REPO` — e.g. `timatinsipid/CM3020-AIExamPrep`
   - `GITHUB_FILE_PATH` — e.g. `exam-prep-app/data/questions.json` (the
     path to the file *within* the repo)
   - `GITHUB_BRANCH` — e.g. `main` (optional, defaults to `main`)
   - `SYNC_SECRET` — any string you make up; you'll need to type this into
     the app's Sync box to trigger a sync, so treat it like a password (but
     it's only protecting "who can push to your own repo", not anything
     more sensitive)
   - Optionally `AUTO_SYNC_HOURS` — e.g. `24` to auto-sync once a day
     instead of clicking the button yourself. This needs **Always On**
     enabled (Settings → Configuration → General settings), which requires
     at least a Basic (B1) App Service plan — the Free tier sleeps the app
     when idle, so a timer inside the app won't fire reliably.
3. Save, which restarts the app so it picks up the new environment
   variables.
4. In the app's Weak Spots tab, enter your `SYNC_SECRET` and click
   "Sync now". You should see a success message with a commit hash, and a
   new commit will appear in your repo's history.

Each sync overwrites the file at `GITHUB_FILE_PATH` on `GITHUB_BRANCH` with
whatever's currently live — so sync *before* you redeploy, not after, or
you'll just be pushing back the same (possibly stale) content you're about
to overwrite anyway.

### A note on persistence

The `data/` folder (`questions.json`, `users.json`, `progress.json`) lives
on the App Service's filesystem. On the free/basic tiers these persist
across app restarts, but are **not guaranteed to persist across a
redeploy** (a git push or zip deploy overwrites the app folder) and
**won't be shared across multiple instances** if you ever scale out. For a
small group revising for one exam this is fine — just remember to use the
GitHub sync above before pushing a code change, and periodically back up
`users.json`/`progress.json` via the Kudu console at
`https://<app-name>.scm.azurewebsites.net` if you want those preserved too
(the sync feature above only covers `questions.json` by design, since
progress/users are personal rather than shared content worth versioning).

### Environment variables

None required. Azure App Service sets `PORT` automatically; the server reads
`process.env.PORT` and falls back to 8080 for local runs.
