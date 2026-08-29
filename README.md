# Picklehead247 Draft Companion — FINAL Production V3.6

## Draft-night build
- Confirmed snake slot: **1.06**. The build applies slot 6 once on first load so older mock-draft browser state cannot silently leave the wrong slot selected.
- ESPN projection pages **1–6** are integrated. For the supplied rows, ESPN's displayed **FPTS** is treated as the exact custom-scoring season projection baseline.
- 250 supplied ESPN projection rows were refreshed and 31 missing late-board players/units were added to the database.
- ESPN ADP/rank is still **timing only**, never a player-quality input.

## QB / Superflex policy
- QB + OP means two weekly QB starters are structurally preferred.
- Replacement baseline remains **QB25** for a 12-team two-QB environment.
- The companion now derives the preferred **QB1–24** pool directly from objective custom projections plus confirmed job security, instead of relying on hand-authored QB tier labels.
- A third-QB bench cliff around **QB30** is tracked conceptually; target three QBs, but do not force QB3 before the pool becomes thin/critical.
- Unresolved starting jobs (Las Vegas, Atlanta) are not counted as secure QB3 options.

## Ranking hierarchy
1. Exact custom-scoring projection / VORP / positional projection strength.
2. Live roster construction, scarcity, wait cost and turn survival.
3. Football intel only as a close-call tiebreaker.

Same-position players with >0.5% projection separation are ordered by projection first. Within 0.5%, the existing non-intel source order acts as the next objective signal before any intel tiebreak.

## Draft-night UX retained
- Sticky Draft/mark action on the far left.
- Fast opponent-pick entry with deferred heavy recalculation between your turns.
- Current pick / next pick / picks-until-turn cards.
- Collapsible QB pool and dynamic remaining pool.
- Five alternatives at QB/RB/WR/TE.
- Player analysis modal with verdict, target range, probabilities, risks and custom-scoring note.
- Import/export and localStorage state persistence.
- Exactly one K and one D/ST; specialists held until the final roster slots.

## Files
- `index.html`
- `styles.css`
- `app.js`
- `data/players.js`
- `data/research.js`
- `data/guidance.js`
- `.nojekyll`
- `backup-single.html` — emergency offline/single-file backup

## Deploy
Replace the prior GitHub Pages files with this entire folder, preserving the `data/` directory. The cache-bust version is `20260829-v3.6`.

Before the live draft, press **New draft** once if your browser still contains mock-draft picks. The V3.6 slot migration changes only the slot to 6; it intentionally does not delete saved picks.
