# Picklehead247 Draft Companion — Production V3.3

## V3.3 ranking-model correction

V3.3 removes scoring-system double counting from the recommendation engine.

- **Custom projection** is the only place where league scoring traits are valued (1 point/completion, 6-point passing TDs, PPR, rushing, etc.).
- **Football intel** can numerically adjust rankings only for projection-changing evidence: injuries, role/usage, starter status, suspension/availability, depth-chart changes, offensive-line context, and similar facts.
- **Draft economics** (QB scarcity, expected survival, wait cost, roster construction, tier cliffs) determine *when* to take a player and remain separate from projected production.
- Legacy analyst/expert grades remain visible as context but no longer add a second numerical vote.
- QB tier labels remain guidance/scarcity inputs; they no longer add an extra hidden scoring premium inside intrinsic player value.
- Close recommendation ties are resolved deterministically by standalone value, custom projection, and then QB guidance rank.

This specifically prevents cases such as Joe Burrow receiving custom-scoring credit in his projection and then receiving the same completion-volume credit again through narrative intel.

Recommended GitHub Pages production structure.

## Files
- `index.html` — application shell / UI markup
- `styles.css` — responsive/mobile styling
- `app.js` — live draft engine, recommendation logic, QB scarcity alerts, persistence
- `data/players.js` — player/projection/ESPN market data
- `data/research.js` — cumulative evidence model, team context, post-baseline intel events
- `data/guidance.js` — QB tiers and player-specific actionable guidance
- `.nojekyll` — serves the repository directly through GitHub Pages
- `backup-single.html` — emergency self-contained backup; not the recommended production entry point

## Deploy
Upload/replace the files at the repository root preserving the `data/` folder. GitHub Pages should point to the branch/root containing `index.html`.

Do **not** rename or flatten the `data/` directory unless you also change the script paths in `index.html`.

## Why this is the recommended build
The modular layout lets the browser cache large player/intelligence files independently, makes last-minute news updates safer, and keeps app logic separate from data. Runtime draft speed remains effectively the same after initial load.

## Draft-night state
Draft state is stored in browser localStorage and the app retains Import/Export controls. Before replacing an already-used build, export state if you have a live/valuable mock draft you want to preserve.


## V3.2 hotfix
- Fixed a startup render crash in the Expert column caused by omitted aggregateExpertTag/expertTagClass helpers during the V3.1 modular split.
- Verified PLAYER_DATA loads 421 players and the initial Draft Board renders successfully.
- V3.2 fixed the render crash; V3.3 supersedes it and uses cache version `20260828-v3.3`.
