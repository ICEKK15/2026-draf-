Picklehead247 Draft Companion v2.4 — Dynamic Pool / Two-Pick Lookahead

Algorithm changes

1. Intrinsic player value is separated from market timing.
   - Value = static VORP + modest cumulative-intel adjustment - uncertainty penalties.
   - ESPN ADP/rank no longer adds points to recommendation value.
   - ADP is used only to estimate whether a player survives to a future pick.
   - This directly fixes cases where a cheaper but lower-projected player could rank above a superior player solely because of ADP.

2. Dynamic remaining-pool analysis.
   - Drafted players are removed from each position in real time.
   - For QB/RB/WR/TE, the app displays best value now, expected best value at the relevant future turn, and Wait Cost.
   - Wait Cost = best value now - expected best value later.

3. Probabilistic expected-best calculation.
   - For every remaining player, the app estimates make-it-back probability.
   - It calculates the probability that each player would be the best surviving option at the future pick and uses those probabilities to estimate the future positional pool.

4. Two-pick expected value.
   - On your turn, the recommendation score is the utility of the player selected now + expected value of the best legal selection at your following turn.
   - This captures the exact logic: a 50-value RB with a 49-value likely fallback may be less urgent than a 35-value WR whose next-turn pool collapses to 10.

5. Dynamic room timing.
   - The app learns whether QB/RB/WR/TE are being drafted earlier or later than baseline in the actual room.
   - QB retains its custom OP/completion/6-point-TD timing baseline.

6. Tier cliffs.
   - Immediate same-position value gaps are measured against that position's typical current gaps and flagged when unusually large.

7. Existing safeguards remain.
   - Exactly one K and one D/ST, final two roster selections only.
   - QB + OP roster structure.
   - Fast opponent-pick entry and automatic refresh on your turn.
   - iPhone focus/autofill suppression.

UI additions
- New Dynamic Remaining Pool panel for QB/RB/WR/TE.
- Board now shows 2-pick EV, intrinsic Value, Wait Cost and expected positional value next turn.
