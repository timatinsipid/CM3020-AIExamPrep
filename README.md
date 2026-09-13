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

### A note on persistence

`data/questions.json`, `data/users.json`, and `data/progress.json` are all
plain JSON files on the App Service's filesystem. On the free/basic tiers
these persist across app restarts, but are **not guaranteed to persist
across a redeploy** (a git push or zip deploy overwrites the app folder) and
**won't be shared across multiple instances** if you ever scale out. For a
small group revising for one exam this is fine — just avoid redeploying
mid-way through a big question-adding or quiz-taking session, and
periodically back up the `data/` folder via the Kudu console at
`https://<app-name>.scm.azurewebsites.net` if you want to be safe.

If you outgrow this (e.g. a larger group, or wanting progress to survive
redeploys reliably), swap the JSON-file reads/writes in `server.js` for
Azure Table Storage or Cosmos DB's free tier — the API shape (`/api/login`,
`/api/progress`) wouldn't need to change, only what's behind it.

### Environment variables

None required. Azure App Service sets `PORT` automatically; the server reads
`process.env.PORT` and falls back to 8080 for local runs.
