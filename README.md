# Picklehead247 Draft Companion — Production V3.5

## V3.5 — draft-night layout + quick alternatives

- **My Draft Slot** is now the first control at the top of the app, with Current Pick beside it.
- **QB Pool** and **Dynamic Remaining Pool** are collapsible; each panel remembers its collapsed/open state on that browser.
- **Dynamic Remaining Pool** now shows five additional available options at QB, RB, WR and TE beneath the wait-cost cards. These alternatives use the same V3.4 objective-first recommendation policy: custom projection/value and live draft economics first, intel only as a close-call tiebreaker.
- **Record the Next ESPN Pick** now sits immediately above the full Draft Board.
- Position and Board Search controls moved beside the Draft Board, where they are used.
- Ranking math from V3.4 is unchanged.

## V3.4 — objective first, intel only as a tiebreaker

The recommendation engine now uses a strict hierarchy across **all players and all positions**:

1. Objective custom-scoring value (projection, VORP, positional projection strength).
2. Roster construction and live draft economics (need, scarcity, wait cost, tier cliff).
3. Football intel **only when the objective comparison is close**.

A recommendation-score gap greater than 0.10 or current-utility gap greater than 0.10 is treated as a clear objective edge and cannot be overturned by intel. For players at the same position, a season projection difference greater than 0.5% also wins before intel is considered. For same-position players within 0.5% of each other, the existing non-intel source ranking is consulted before intel. Intel is confidence-weighted, capped, and missing intel is neutral. Unresolved injury/role uncertainty can only affect a close-call tiebreak. Sleeper ordering follows the same policy.


## V3.4 ranking-model correction

V3.4 removes scoring-system double counting from the recommendation engine.

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
- V3.2 fixed the render crash; V3.5 supersedes prior builds and uses cache version `20260828-v3.5`.
