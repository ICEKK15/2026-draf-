Picklehead247 Draft Companion v2.3

Fixes after mock-draft review:

1. K/DST are no longer normal VORP/ADP positions.
   - Hard max: 1 kicker, 1 D/ST.
   - Neither can be recommended before your final two roster selections.
   - If the remaining roster spots are exactly the missing specialist slots,
     other positions are blocked so the roster can be completed legally.
   - K/DST market urgency and scarcity bonuses are disabled.

2. QB/OP structure is explicitly modeled.
   - Target is two starting QBs: QB + OP.
   - QB1 and QB2 receive structural starter bonuses.
   - Ordinary ESPN 1-QB ADP is no longer used by itself for QB survival timing.
   - QB timing uses a league-adjusted projection-rank curve and adapts to actual
     QB draft behavior in the room.
   - Completion-heavy / 6-point passing-TD scoring remains inside custom projections.

3. Recommendation freshness.
   - Opponent picks still use the fast path.
   - After your own pick, recommendations are re-ranked because roster needs changed.
   - They are also refreshed immediately as your next turn arrives.

4. iPhone contact-autofill issue.
   - Removed programmatic focus after recording a pick and on initial page load.
   - Player search is now a search-type input with mobile autocomplete/autocorrect
     suppression attributes.

Primary deployment remains the modular GitHub build.
