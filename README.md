# Picklehead247 Draft Companion — Production V3.2

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
- Cache-busting asset version updated to 20260828-v3.2.
