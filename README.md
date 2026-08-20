# Picklehead247 Draft Companion — Production

A static 2026 fantasy-football draft companion designed to stay open beside an ESPN online mock or live draft.

## What this version does

- No simulated opponents and no fake mock engine.
- You record each real ESPN selection as it happens.
- The app assigns each pick to the correct team using a 12-team snake draft.
- Recommendations recalculate from the actual available-player pool and actual rosters.
- Custom league logic emphasizes QB because the league awards 1 point per completion, 6 points per passing TD, and allows QB in the OP slot.
- Tracks ESPN market rank/ADP as a price/timing signal rather than the decision engine.
- Includes player projections, VORP, roster needs, positional scarcity, opponent QB demand, probability a player reaches your next turn, sleepers/value logic, and preseason intelligence.
- Fantasy Footballers sentiment is treated as one source; repeated mentions are not additive. News/role changes can alter opportunity, health, and context.
- Draft state autosaves in the browser and can be exported/imported as JSON.

## Use during an ESPN mock

1. Open ESPN's mock draft in one tab/window and this companion in another.
2. Set **My ESPN draft slot** to your slot.
3. Every time ESPN makes a pick, type that player's name in **Record the next ESPN pick** and press Enter.
4. The companion automatically advances to the next snake pick and updates all recommendations.
5. When it is your turn, use **Best Pick Right Now**, the board, survival probability, and roster context to make your ESPN selection. Then record your own ESPN pick here too.

## Publish on GitHub Pages

Upload these files preserving the folder structure:

```
index.html
styles.css
app.js
data/
  players.js
  research.js
README.md
```

Then enable GitHub Pages for the repository branch/folder you uploaded.

## Important limitation

A normal static GitHub Pages site cannot directly read the live ESPN draft page because the sites run on different origins and ESPN does not expose the draft room DOM to this app. This version is therefore a fast live companion: ESPN is the source of truth, and you record each pick here. An automatic ESPN sync would require a browser extension/userscript or a supported ESPN API/integration rather than ordinary static web-app code.
