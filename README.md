# Picklehead247 Draft Companion

Static GitHub Pages fantasy-football draft companion for a 12-team snake league with 1 QB + 1 QB-eligible OP, 1 point per pass completion, 6-point passing TDs and full PPR.

## Core philosophy

The app does **not** simply sort ESPN or FantasyPros rankings.

1. **Football value** — skills, projected workload/opportunity, offense, role security, health, upside and projection support.
2. **League value** — custom QB scoring and roster construction.
3. **Market cost** — ESPN rank/ADP and FantasyPros rankings.
4. **Draft decision** — roster need, positional scarcity, opponent QB demand and probability the player survives to your next pick.

It intentionally displays both **Best Player Available** and **Best Pick Right Now**.

## Deploy on GitHub Pages

1. Upload all files to your repo, preserving the `data/` folder.
2. Commit to `main`.
3. Go to **Settings → Pages**.
4. Choose **Deploy from a branch**.
5. Select `main` and `/ (root)`.
6. Save.

When you commit updates later, the same web-app URL updates automatically. You do not need to add it to your iPhone Home Screen again.

## Data files

- `data/players.js` holds ESPN ADP/rank, FantasyPros Draft ECR, FantasyPros ROS ECR and optional custom values.
- `data/research.js` holds the evidence layer that should be refreshed close to draft day.

Research fields are 0-10 ratings:

```js
{
  opportunity: 9,
  skills: 9,
  offense: 8,
  roleSecurity: 8,
  upside: 9,
  health: 8,
  projectionEdge: 9,
  confidence: 8,
  notes: "Short evidence-based thesis."
}
```

## Important: live web research

GitHub Pages is static. Do not expose API keys in frontend JavaScript. The safe workflow is to refresh `research.js` before the draft or later connect the app to a secure serverless endpoint.

## Apostrophe bug fixed

Internal player IDs strip punctuation, so names such as `Ja'Marr Chase`, `De'Von Achane` and `Tre' Harris` work without altering displayed names.
