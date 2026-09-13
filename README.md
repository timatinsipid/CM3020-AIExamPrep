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

### A note on persistence

The "Add Question" form and quiz/flashcard answer tracking use two different
storage locations:

- **New questions you add** are written to `data/questions.json` on the App
  Service's filesystem. On the free/basic tiers this file persists across
  app restarts, but it is **not guaranteed to persist across a redeploy**
  (a git push or zip deploy overwrites the app folder) and **won't be shared
  across multiple instances** if you ever scale out. For a single person
  revising for one exam this is fine — just avoid redeploying mid-way through
  a big question-adding session, or download `data/questions.json`
  periodically as a backup (`az webapp ssh` or the Kudu console at
  `https://<app-name>.scm.azurewebsites.net`).
- **Your quiz scores and "weak spots" tracking** are stored in your browser's
  `localStorage`, not on the server — so they're private to you and won't be
  lost by a redeploy, but also won't follow you to a different browser/device.

If you outgrow this (e.g. want progress synced across devices), swap the
`localStorage` calls in `public/app.js` for a small `/api/progress` endpoint
backed by Azure Table Storage or Cosmos DB's free tier — the server already
has the same JSON-file pattern you can copy for that.

### Environment variables

None required. Azure App Service sets `PORT` automatically; the server reads
`process.env.PORT` and falls back to 8080 for local runs.
