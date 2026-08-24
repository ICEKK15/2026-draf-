PICKLEHEAD247 DRAFT COMPANION — GITHUB DEPLOYMENT V2
Baseline intelligence reviewed through: 2026-08-23

WHAT CHANGED
============
1. LIVE-DRAFT SPEED
- Opponent picks now register through a fast path.
- The app updates the pick number, owner, availability, visible drafted row, status, log/roster if open, and input immediately.
- Heavy recommendation recalculation is deferred while other teams are picking.
- Full analysis refreshes automatically when your team reaches the clock.
- Full analysis also refreshes on draft-slot change, undo, manual Current Pick change, import, reset, or the Refresh recommendations button.
- Draft/player indexes and recommendation values are cached instead of recomputing the full board repeatedly.
- Board button handling uses event delegation instead of rebinding hundreds of click handlers.
- Local-storage persistence is slightly deferred after each normal pick so the UI responds first; state is still saved automatically and again on page exit.

2. LIVE-DRAFT UI
- Draft / mark action column moved to the FAR LEFT before Player.
- The action column remains sticky when horizontally scrolling, especially useful on mobile.
- New prominent status cards: CURRENT PICK, MY NEXT PICK, PICKS UNTIL MY TURN.
- Controls now use the requested labels: My Draft Slot and Current Pick.
- Position filter and Board Search remain separate from the live-pick entry workflow.
- Explicit Refresh recommendations button added.
- Analysis status tells you when recommendations are current vs deferred in fast-entry mode.

3. CUMULATIVE INTELLIGENCE MODEL
- All previously reviewed research is compressed into one cumulative baseline through 2026-08-23.
- A new article does not automatically move a player.
- New facts are weighted against the existing prior.
- The same underlying event is grouped by eventId, so repeated articles do not stack linearly.
- Independent corroboration raises confidence modestly rather than creating duplicate impact.
- Evidence weighting favors official diagnosis/starter decisions and direct usage over opinion or generic hype.
- ADP/market price remains separate from football outlook.
- Unresolved high-impact cases are marked WAIT/risk rather than assigned fake certainty.
- Intel cards show status, score, confidence, market stance, team context, and new source details when post-baseline events are added.

4. DATA SAFETY
- Existing player/projection data was preserved.
- The original research data remains available for skills/opportunity/upside context, but legacy expert/news signals are not double-counted for players covered by the cumulative prior.
- Seven names referenced in the research but absent from players.js were added as RECORD-ONLY entries with NO invented projection/ranking:
  Jaylen Wright, Zachariah Branch, Isaac TeSlaa, Jaylin Noel, Shedeur Sanders, Rashod Bateman, Kirk Cousins.
  They can be recorded if ESPN drafts them, but they cannot become recommendations until real projection/market data is supplied.

5. STATE MIGRATION
- The app reads the previous prod-v1 local draft state if present, then saves into the new prod-v2 state namespace.
- Import/export remains supported.

DEPLOY TO GITHUB
================
Replace these files in the existing repository:
  /index.html
  /styles.css
  /app.js
  /data/players.js
  /data/research.js

Keep the same folder structure.
Commit the changes to the branch used by GitHub Pages.
The new index.html uses cache-busting query strings (?v=20260823-v2), so browsers should fetch the updated assets after deployment.

FILES IN THIS PACKAGE
=====================
index.html
styles.css
app.js
data/players.js
data/research.js
README-DEPLOY.txt

SMOKE CHECKS PERFORMED
======================
- app.js syntax: PASS
- data/players.js syntax: PASS
- data/research.js syntax: PASS
- All JavaScript #id selectors used by app.js exist in index.html: PASS
- Player IDs unique: PASS
- Cumulative-intel player names all resolve to the player database: PASS
