(() => {
  const APP_VERSION = "prod-v3.3-modular";
  const MAX_PICKS = 216;
  const LEAGUE = Object.freeze({
    teams: 12,
    rosterSize: 18,
    requiredStartingQBs: 2, // QB + OP. With this scoring, OP should overwhelmingly be a QB.
    maxK: 1,
    maxDST: 1,
    specialistSlots: 2,     // exactly one K and one D/ST
    completionPoints: 1,
    passingTdPoints: 6
  });
  const STATE_KEY = "prod-v2";
  const LEGACY_STATE_KEY = "prod-v1";
  const LS = {
    draft: `p247_live_draft_${STATE_KEY}`,
    slot: `p247_live_slot_${STATE_KEY}`,
    pick: `p247_live_pick_${STATE_KEY}`
  };
  const LEGACY_LS = {
    draft: `p247_live_draft_${LEGACY_STATE_KEY}`,
    slot: `p247_live_slot_${LEGACY_STATE_KEY}`,
    pick: `p247_live_pick_${LEGACY_STATE_KEY}`
  };

  const clone = x => JSON.parse(JSON.stringify(x));
  const players = clone(window.PLAYER_DATA || []);
  const research = clone(window.RESEARCH_DATA || {});
  const cumulativeIntel = clone(window.CUMULATIVE_INTEL || {});
  const teamContext = clone(window.TEAM_CONTEXT || {});
  const intelEvents = clone(window.INTEL_EVENTS || []);
  const qbGuidance = clone(window.QB_GUIDANCE || {});
  const playerGuidance = clone(window.PLAYER_GUIDANCE || {});
  Object.entries(clone(window.FINAL_INTEL_OVERRIDES || {})).forEach(([name,patch]) => { cumulativeIntel[name] = { ...(cumulativeIntel[name] || {}), ...patch }; });
  const baselineDate = window.CUMULATIVE_INTEL_BASELINE_DATE || "2026-08-28";

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeParse = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const canonical = n => String(n || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/d\/st/ig, "dst")
    .replace(/(sr|jr|iii|ii)\.?/ig, "")
    .replace(/[^a-z0-9]/gi, "").toLowerCase();

  const firstStored = (newKey, oldKey, fallback) => localStorage.getItem(newKey) ?? localStorage.getItem(oldKey) ?? fallback;
  let draft = safeParse(firstStored(LS.draft, LEGACY_LS.draft, "[]"), []);
  if (!Array.isArray(draft)) draft = [];
  let draftSlot = Number(firstStored(LS.slot, LEGACY_LS.slot, "1") || 1);
  let pickOverride = Number(firstStored(LS.pick, LEGACY_LS.pick, "1") || 1);
  let selectedQuickId = null;
  let suggestionIndex = 0;
  let activeTab = "board";
  let persistTimer = null;
  let stateRevision = 0;
  let analysisRevision = -1;
  let analysisCache = new Map();
  let positionMetricsCache = new Map();
  let analysisContext = { onClock:false, selectionPick:null, waitTarget:null };
  let rankedIds = [];
  let bpaIds = [];
  let intelViewCache = new Map();
  let researchViewCache = new Map();
  let draftByPlayer = new Map();
  let usedPicks = new Set();
  let teamDrafts = Array.from({ length: 13 }, () => []);
  let teamCounts = Array.from({ length: 13 }, () => ({ QB:0,RB:0,WR:0,TE:0,K:0,"D/ST":0 }));
  const dirty = { board:true, sleepers:true, rosters:true, log:true, intel:true };

  players.forEach(p => {
    p._canonical = canonical(p.name);
    p._words = p.name.toLowerCase().split(/\s+/).map(canonical);
  });
  const playerById = new Map(players.map(p => [p.id, p]));
  const researchCanonical = new Map(Object.keys(research).map(k => [canonical(k), research[k]]));
  const cumulativeCanonical = new Map(Object.keys(cumulativeIntel).map(k => [canonical(k), cumulativeIntel[k]]));
  const qbGuidanceCanonical = new Map(Object.keys(qbGuidance).map(k => [canonical(k), qbGuidance[k]]));
  const playerGuidanceCanonical = new Map(Object.keys(playerGuidance).map(k => [canonical(k), playerGuidance[k]]));
  const qbGuideFor = p => qbGuidance[p?.name] || qbGuidanceCanonical.get(canonical(p?.name)) || null;
  const specificGuideFor = p => playerGuidance[p?.name] || playerGuidanceCanonical.get(canonical(p?.name)) || null;
  const QB_TIER_NUM = Object.freeze({ ELITE:1, GREAT:2, GOOD:3, OKAY:4, UNPLAYABLE:5 });
  const qbTierNum = p => QB_TIER_NUM[qbGuideFor(p)?.tier] || 6;

  function lookupByCanonical(store, canonicalStore, name) {
    return store[name] || canonicalStore.get(canonical(name)) || null;
  }

  function rebuildDraftIndexes() {
    draftByPlayer = new Map();
    usedPicks = new Set();
    teamDrafts = Array.from({ length: 13 }, () => []);
    teamCounts = Array.from({ length: 13 }, () => ({ QB:0,RB:0,WR:0,TE:0,K:0,"D/ST":0 }));

    draft = draft
      .filter(d => d && Number(d.pick) >= 1 && Number(d.pick) <= MAX_PICKS && players.some(p => p.id === d.playerId))
      .sort((a,b) => a.pick - b.pick);

    const seenPlayer = new Set();
    const seenPick = new Set();
    draft = draft.filter(d => {
      if (seenPlayer.has(d.playerId) || seenPick.has(Number(d.pick))) return false;
      seenPlayer.add(d.playerId); seenPick.add(Number(d.pick));
      return true;
    });

    draft.forEach(d => {
      d.pick = Number(d.pick);
      d.teamSlot = Number(d.teamSlot || pickToTeam(d.pick));
      draftByPlayer.set(d.playerId, d);
      usedPicks.add(d.pick);
      teamDrafts[d.teamSlot].push(d);
      const p = playerById.get(d.playerId);
      if (p) teamCounts[d.teamSlot][p.pos] = (teamCounts[d.teamSlot][p.pos] || 0) + 1;
    });
  }

  const marketRank = p => Number(p.espnAdp) || Number(p.espnRank) || Number(p.estimatedMarketRank) || 350;
  const isDrafted = p => draftByPlayer.has(p.id);
  const draftedRecord = p => draftByPlayer.get(p.id);
  const pickUsed = pick => usedPicks.has(Number(pick));
  const pickToTeam = pick => {
    const round = Math.ceil(pick / 12);
    const slot = ((pick - 1) % 12) + 1;
    return round % 2 ? slot : 13 - slot;
  };
  const roundForPick = pick => Math.ceil(pick / 12);
  const counts = slot => teamCounts[slot] || { QB:0,RB:0,WR:0,TE:0,K:0,"D/ST":0 };
  const teamRoster = slot => (teamDrafts[slot] || []).map(d => playerById.get(d.playerId)).filter(Boolean);

  const myRosterCount = () => (teamDrafts[draftSlot] || []).length;
  const rosterSpotsRemaining = () => Math.max(0, LEAGUE.rosterSize - myRosterCount());
  const isSpecialist = p => p.pos === "K" || p.pos === "D/ST";
  const missingSpecialists = c => (c.K < LEAGUE.maxK ? 1 : 0) + (c["D/ST"] < LEAGUE.maxDST ? 1 : 0);

  function recommendationEligibility(p, c = counts(draftSlot), rosterCount = myRosterCount()) {
    const spotsLeft = Math.max(0, LEAGUE.rosterSize - rosterCount);
    const missing = missingSpecialists(c);

    if (p.pos === "K") {
      if (c.K >= LEAGUE.maxK) return { eligible:false, reason:"K roster limit reached" };
      // Do not spend a bench slot on K before the final two roster selections.
      if (spotsLeft > LEAGUE.specialistSlots) return { eligible:false, reason:"K reserved for final two roster picks" };
      return { eligible:true, reason:"K due late" };
    }
    if (p.pos === "D/ST") {
      if (c["D/ST"] >= LEAGUE.maxDST) return { eligible:false, reason:"D/ST roster limit reached" };
      if (spotsLeft > LEAGUE.specialistSlots) return { eligible:false, reason:"D/ST reserved for final two roster picks" };
      return { eligible:true, reason:"D/ST due late" };
    }

    // If every remaining roster slot is needed to fill missing K/DST, block skill players.
    if (spotsLeft > 0 && spotsLeft <= missing) {
      return { eligible:false, reason:"Must fill remaining K/D/ST slot(s)" };
    }
    return { eligible:true, reason:"" };
  }

  function nextOpenPick(start = 1) {
    for (let p = clamp(start, 1, MAX_PICKS + 1); p <= MAX_PICKS; p++) if (!pickUsed(p)) return p;
    return MAX_PICKS + 1;
  }
  function currentPick() { return clamp(Number(pickOverride) || 1, 1, MAX_PICKS + 1); }
  function setCurrentPick(n) {
    pickOverride = clamp(Number(n) || 1, 1, MAX_PICKS + 1);
    if ($("#currentPick")) $("#currentPick").value = pickOverride;
  }
  function nextUserPick(after, includeAfter = true) {
    const start = includeAfter ? after : after + 1;
    for (let p = Math.max(1, start); p <= MAX_PICKS; p++) if (pickToTeam(p) === draftSlot) return p;
    return null;
  }
  function nextUserTurnFromNow() {
    const now = currentPick();
    if (now > MAX_PICKS) return null;
    return nextUserPick(now, true);
  }
  function followingUserPick() {
    const first = nextUserTurnFromNow();
    if (!first) return null;
    return nextUserPick(first, false);
  }
  const isMyTurn = pick => pick <= MAX_PICKS && pickToTeam(pick) === draftSlot;

  function saveNow() {
    localStorage.setItem(LS.draft, JSON.stringify(draft));
    localStorage.setItem(LS.slot, String(draftSlot));
    localStorage.setItem(LS.pick, String(currentPick()));
  }
  function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(saveNow, 35);
  }

  // Replacement levels account for 12 teams and a QB-eligible OP slot.
  const replacementIndex = { QB:25, RB:34, WR:46, TE:16, K:13, "D/ST":13 };
  const replacement = {};
  Object.keys(replacementIndex).forEach(pos => {
    const list = players.filter(p => p.pos === pos && Number.isFinite(+p.customProjection)).sort((a,b) => b.customProjection - a.customProjection);
    replacement[pos] = list[Math.min(list.length - 1, replacementIndex[pos] - 1)]?.customProjection || 0;
  });
  const vorp = p => (+p.customProjection || 0) - (replacement[p.pos] || 0);
  const allVorp = players.map(vorp).sort((a,b) => a-b);
  const percentile = v => {
    if (!allVorp.length) return .5;
    let lo=0, hi=allVorp.length;
    while (lo < hi) { const m=(lo+hi)>>1; if (allVorp[m] < v) lo=m+1; else hi=m; }
    return lo / Math.max(1, allVorp.length - 1);
  };

  // Cross-position recommendation value should be dominated by the user's supplied
  // custom-scoring board, not by raw VORP alone. Raw VORP is still displayed and used
  // as one component, but deep replacement cutoffs can otherwise overstate positions
  // such as WR relative to elite QB/RB options.
  const coreVorp = players
    .filter(p => !p.recordOnly && ["QB","RB","WR","TE"].includes(p.pos))
    .map(vorp)
    .sort((a,b) => a-b);

  function coreVorpPercentile(v) {
    if (!coreVorp.length) return .5;
    let lo=0, hi=coreVorp.length;
    while (lo < hi) { const m=(lo+hi)>>1; if (coreVorp[m] < v) lo=m+1; else hi=m; }
    return lo / Math.max(1, coreVorp.length - 1);
  }

  function customBoardRankScore(p) {
    const rank = Number(p.sourceOrder);
    if (!Number.isFinite(rank) || rank <= 0 || rank >= 9999) return 0;
    // Smooth curve: preserves meaningful separation at the top without making rank
    // differences overwhelming later in the draft.
    return 100 * Math.exp(-(rank - 1) / 80);
  }
  const projectionPosIndex = new Map();
  Object.keys(replacementIndex).forEach(pos => {
    players.filter(p => p.pos === pos).sort((a,b) => b.customProjection - a.customProjection)
      .forEach((p,i) => projectionPosIndex.set(p.id,i));
  });


  const projectionPosCount = new Map();
  Object.keys(replacementIndex).forEach(pos => {
    projectionPosCount.set(pos, players.filter(p => p.pos === pos && !p.recordOnly).length);
  });

  function positionalProjectionScore(p) {
    if (!["QB","RB","WR","TE"].includes(p.pos)) return 0;
    const idx = projectionPosIndex.get(p.id);
    const count = projectionPosCount.get(p.pos) || 1;
    if (idx === undefined || idx === null) return 0;
    return 100 * (1 - idx / Math.max(1, count - 1));
  }


  // ESPN's ordinary ADP/rank is largely a 1-QB market signal. This league has a QB-eligible
  // OP slot plus 1 point per completion and 6 points per passing TD, so QB timing must be
  // pulled materially earlier. The curve below is intentionally moderate and then adapts
  // to what this actual room does with QBs.
  const qbProjectionRank = p => (projectionPosIndex.get(p.id) ?? 99) + 1;
  const baselineLeagueQBTimingRank = p => {
    if (p.pos !== "QB") return marketRank(p);
    const g=qbGuideFor(p);
    // ESPN's Aug. 28 superflex board is a much better timer than ordinary 1-QB ADP.
    // timingAdjust then nudges completion-volume QBs earlier for this league's scoring.
    if (g?.superflexOverall) return clamp(g.superflexOverall + (Number(g.timingAdjust)||0),1,MAX_PICKS);
    return clamp(7 + (qbProjectionRank(p) - 1) * 4.4, 1, MAX_PICKS);
  };
  const baselineTimingRank = p => p.pos === "QB" ? Math.min(marketRank(p), baselineLeagueQBTimingRank(p)) : marketRank(p);

  // Learn how this specific room is drafting each position. A negative shift means
  // the room is taking the position earlier than its baseline market expectation.
  function observedPositionTimingShift(pos) {
    const samples = draft
      .map(d => ({ d, p: playerById.get(d.playerId) }))
      .filter(x => x.p?.pos === pos && !x.p.recordOnly && baselineTimingRank(x.p) < 350)
      .map(x => x.d.pick - baselineTimingRank(x.p))
      .sort((a,b) => a-b);
    if (samples.length < 3) return 0;
    const mid = Math.floor(samples.length / 2);
    const median = samples.length % 2 ? samples[mid] : (samples[mid-1] + samples[mid]) / 2;
    return clamp(median, -24, 24);
  }
  function draftTimingRank(p) {
    if (isSpecialist(p)) return marketRank(p);
    return clamp(baselineTimingRank(p) + observedPositionTimingShift(p.pos), 1, MAX_PICKS);
  }


  const INTEL_WEIGHTS = {
    official_transaction:1.00, official_diagnosis:1.00, official_starter:1.00,
    direct_game_usage:.95, direct_practice_usage:.88, medical_report:.90,
    beat_report:.78, coach_quote:.70, projection_model:.58, market_move:.48,
    analyst_opinion:.42, preseason_boxscore:.34, generic_buzz:.28
  };
  const SOURCE_REPUTATION = {
    "NFL/Team":1.05, "ESPN Beat":1.00, "PFF Nathan Jahnke":1.00,
    "Fantasy Life Dwain McFarland":1.00, "ESPN Mike Clay":.92,
    "CBS Fantasy":.86, "Fantasy Footballers":.78, "PFF Opinion":.80,
    "Other Reputable Beat":.88, "Unknown":.70
  };

  function daysBetween(a,b) {
    const x = new Date(`${a}T12:00:00Z`), y = new Date(`${b}T12:00:00Z`);
    return Math.max(0, (y-x)/86400000);
  }
  function recencyMultiplier(event, asOf = new Date().toISOString().slice(0,10)) {
    if (event.sticky) return 1;
    const halfLife = {
      official_transaction:90, official_diagnosis:90, official_starter:45,
      direct_game_usage:18, direct_practice_usage:12, medical_report:30,
      beat_report:14, coach_quote:14, projection_model:28, market_move:7,
      analyst_opinion:21, preseason_boxscore:10, generic_buzz:7
    }[event.type] || 14;
    return Math.pow(.5, daysBetween(event.date, asOf)/halfLife);
  }
  function rawEventWeight(event, asOf) {
    const typeWeight = INTEL_WEIGHTS[event.type] ?? .35;
    const rep = SOURCE_REPUTATION[event.source] ?? SOURCE_REPUTATION.Unknown;
    return clamp(typeWeight * rep * clamp(event.specificity ?? .85,.25,1) * clamp(event.confidence ?? .85,.25,1) * recencyMultiplier(event,asOf),0,1.15);
  }
  function aggregateEventGroups(playerName, asOf = new Date().toISOString().slice(0,10)) {
    const events = intelEvents.filter(e => canonical(e.player) === canonical(playerName));
    const groups = new Map();
    events.forEach(e => { if (!groups.has(e.eventId)) groups.set(e.eventId,[]); groups.get(e.eventId).push(e); });
    const summaries = [];
    for (const [eventId, items] of groups.entries()) {
      const weighted = items.map(e => ({e,w:rawEventWeight(e,asOf)})).sort((a,b)=>b.w-a.w);
      if (!weighted.length) continue;
      const primary = weighted[0];
      const independent = new Set([primary.e.sourceFamily]);
      let numerator = primary.e.impact * primary.w;
      let denominator = primary.w;
      let corroboration = 0;
      for (let i=1;i<weighted.length;i++) {
        const {e,w} = weighted[i];
        if (independent.has(e.sourceFamily)) {
          numerator += e.impact*w*.10; denominator += w*.10;
        } else {
          independent.add(e.sourceFamily);
          numerator += e.impact*w*.35; denominator += w*.35; corroboration += w*.12;
        }
      }
      const impact = denominator ? numerator/denominator : 0;
      summaries.push({
        eventId, impact, confidence:clamp(primary.w + Math.min(.20,corroboration),0,1.10),
        independentSources:independent.size, latestDate:items.map(x=>x.date).sort().at(-1),
        sources:items.map(x=>x.source), notes:items.map(x=>x.note)
      });
    }
    return summaries.sort((a,b)=>String(b.latestDate).localeCompare(String(a.latestDate)));
  }

  function priorFor(p) { return lookupByCanonical(cumulativeIntel, cumulativeCanonical, p.name); }
  function baseResearchFor(p) { return lookupByCanonical(research, researchCanonical, p.name) || {}; }

  function intelView(p) {
    if (intelViewCache.has(p.id)) return intelViewCache.get(p.id);
    const prior = priorFor(p);
    const base = baseResearchFor(p);
    const groups = aggregateEventGroups(p.name);
    let priorScore = 0;
    let confidence = prior?.confidence ?? .45;

    if (prior) {
      // V3.3: only FOOTBALL information may numerically modify the projection.
      // `outlook` remains available for display/backward compatibility, while
      // `rankingOutlook` is the explicit projection-changing component.
      // Scoring-format narratives (completions, rushing points, PPR fit, etc.)
      // are already captured in customProjection and must NOT be counted again.
      const rankingOutlook = Number(prior.rankingOutlook ?? prior.outlook ?? 0);
      priorScore = rankingOutlook * (.65 + .35*confidence);
    } else {
      // Legacy analyst/skills/opportunity grades remain useful explanatory context,
      // but they no longer move rankings numerically. This prevents generic opinions
      // and projection-derived traits from becoming a second vote on the same value.
      priorScore = teamContext[p.team]?.impact || 0;
      confidence = base && Object.keys(base).length ? .45 : .35;
    }

    const eventScore = groups.reduce((s,g)=>s + g.impact*g.confidence,0);
    const score = clamp(priorScore + eventScore, -35, 35);
    const latest = groups[0]?.latestDate || base.updated || baselineDate;
    const view = {
      score,
      confidence:clamp(Math.max(confidence, groups.length ? Math.min(1, groups.reduce((s,g)=>s+g.confidence,0)/groups.length) : confidence),0,1),
      status:prior?.status || base.status || (score>=5?"UP":score<=-5?"DOWN":"HOLD"),
      market:prior?.market || "",
      unresolved:!!prior?.unresolved,
      note:prior?.note || base.news || base.note || teamContext[p.team]?.note || "",
      latestDate:latest,
      groups,
      base
    };
    intelViewCache.set(p.id,view);
    return view;
  }

  function researchFor(p) {
    if (researchViewCache.has(p.id)) return researchViewCache.get(p.id);
    const base = baseResearchFor(p);
    const iv = intelView(p);
    const merged = {
      ...base,
      status:iv.status,
      market:iv.market,
      unresolved:iv.unresolved,
      confidence:iv.confidence,
      cumulativeScore:iv.score,
      updated:iv.latestDate,
      cumulativeNote:iv.note,
      news:iv.note || base.news || ""
    };
    researchViewCache.set(p.id, merged);
    return merged;
  }
  const intelScore = p => intelView(p).score;

  function invalidateIntelCache() {
    intelViewCache.clear(); researchViewCache.clear(); analysisRevision = -1;
    dirty.intel = true; dirty.board = true; dirty.sleepers = true;
  }

  window.P247Intel = {
    baselineDate,
    addEvent(event) {
      const required = ["player","eventId","source","sourceFamily","type","date","impact","note"];
      required.forEach(k => { if (event[k] === undefined || event[k] === null || event[k] === "") throw new Error(`Missing intel event field: ${k}`); });
      intelEvents.push({ specificity:.85, confidence:.85, sticky:false, ...event });
      invalidateIntelCache();
      return true;
    },
    viewFor(name) {
      const p = players.find(x => x._canonical === canonical(name));
      return p ? intelView(p) : null;
    }
  };


  function qbPoolSnapshot(c = counts(draftSlot)) {
    const now=currentPick(), onClock=isMyTurn(now);
    const returnPick=onClock ? followingUserPick() : nextUserTurnFromNow();
    const start=onClock ? now+1 : now;
    const teams=new Set();
    if (returnPick) for(let pick=start;pick<returnPick;pick++){ const t=pickToTeam(pick); if(t!==draftSlot) teams.add(t); }
    let demand=0;
    teams.forEach(t=>{
      const q=counts(t).QB;
      demand += q===0 ? .98 : q===1 ? .88 : q===2 ? .30 : .04;
    });
    const roomShift=observedPositionTimingShift("QB");
    const multiplier=roomShift<0 ? 1+Math.min(.35,Math.abs(roomShift)/45) : 1-Math.min(.20,roomShift/60);
    const expectedTaken=Math.max(0,Math.round(demand*multiplier));
    const draftedQBs=draft.filter(d=>playerById.get(d.playerId)?.pos==="QB").length;
    const goodRemaining=players.filter(p=>p.pos==="QB"&&!isDrafted(p)&&qbTierNum(p)<=3&&qbGuideFor(p)?.job==="SECURE").sort((a,b)=>(qbGuideFor(a)?.rank||99)-(qbGuideFor(b)?.rank||99));
    const usableRemaining=players.filter(p=>p.pos==="QB"&&!isDrafted(p)&&qbTierNum(p)<=4&&["SECURE","SECURE_RISK"].includes(qbGuideFor(p)?.job)).sort((a,b)=>(qbGuideFor(a)?.rank||99)-(qbGuideFor(b)?.rank||99));
    const survivalMargin=goodRemaining.length-expectedTaken;
    let level="GREEN";
    if(c.QB>=3) level="SECURED";
    else if(c.QB<2){
      if(draftedQBs>=20||goodRemaining.length<=6||survivalMargin<=2) level="RED";
      else if(draftedQBs>=16||goodRemaining.length<=10||survivalMargin<=5) level="YELLOW";
    } else {
      if(draftedQBs>=23||goodRemaining.length<=4||survivalMargin<=1) level="RED";
      else if(draftedQBs>=20||goodRemaining.length<=7||survivalMargin<=3) level="YELLOW";
    }
    return {level,draftedQBs,goodRemaining,usableRemaining,expectedTaken,survivalMargin,teamsBefore:teams.size,returnPick,roomShift};
  }

  function aggregateExpertTag(p) {
    const direct = specificGuideFor(p);
    const verdict = String(direct?.verdict || "").toUpperCase();
    if (verdict.includes("AVOID") || verdict.includes("FADE")) return "FADE";
    if (verdict.includes("WAIT") || verdict.includes("PRICE SENSITIVE")) return "WAIT";
    if (verdict.includes("BREAKOUT")) return "BREAKOUT";
    if (verdict.includes("SLEEPER")) return "SLEEPER";
    if (verdict.includes("VALUE") || verdict.includes("PRIORITY")) return "VALUE";

    const iv = intelView(p);
    const status = String(iv?.status || "HOLD").toUpperCase();
    if (status.includes("OUT")) return "DOWN";
    if (status.includes("FADE")) return "FADE";
    if (status.includes("WAIT")) return "WAIT";
    if (status.includes("DOWN")) return "DOWN";
    if (status.includes("UP")) return "UP";

    const signal = Number(researchFor(p)?.expertSignal || 0);
    if (signal >= 3) return "UP";
    if (signal <= -3) return "DOWN";
    return "HOLD";
  }

  function expertTagClass(tag) {
    const t = String(tag || "").toUpperCase();
    if (["VALUE","BREAKOUT","SLEEPER","UP"].includes(t)) return "good";
    if (["FADE","DOWN"].includes(t)) return "bad";
    if (t === "WAIT") return "warn";
    return "";
  }

  function guidanceView(p){
    const direct=specificGuideFor(p), qg=qbGuideFor(p), r=researchFor(p), iv=intelView(p);
    if(direct) return direct;
    const verdict=qg ? `${qg.tier} QB` : (aggregateExpertTag(p)||iv.status||"HOLD");
    const tags=qg ? [qg.tier, qg.job==="SECURE"?"SECURE STARTER":qg.job] : [iv.status||"HOLD"];
    return {
      verdict,
      target:qg ? `Custom QB tier: ${qg.tier}${qg.rank?` • rank ${qg.rank}`:""}` : "Use live recommendation + availability; no fixed reach range stored.",
      summary:qg?.summary || iv.note || r.note || r.news || "Projection-led player. Use the live board, positional wait cost and market timing together.",
      why:r.note || iv.note || "Custom projection and current role are the primary inputs.",
      risks:r.unresolved ? "High-impact uncertainty remains unresolved." : (intelScore(p)<=-5 ? "Cumulative risk is elevated." : "No additional player-specific risk note stored; use the Intel tab for current context."),
      outcomes:[],tags,custom:qg ? "QB value is adjusted for 1 point per completion, 6-point passing TDs and the QB-eligible OP slot." : "Custom projections remain the primary player-value input.",
      confidence:`${Math.round((iv.confidence||.65)*100)}%`,source:`Cumulative model through ${baselineDate}`
    };
  }

  function openPlayerGuide(id){
    const p=playerById.get(id); if(!p) return;
    const g=guidanceView(p), qg=qbGuideFor(p);
    $("#guideEyebrow").textContent=`${p.pos} • ${p.team} • ${g.verdict||"GUIDANCE"}`;
    $("#guideName").textContent=p.name;
    const tagList=[...(g.tags||[])]; if(qg) tagList.unshift(`${qg.tier} QB`);
    $("#guideTags").innerHTML=[...new Set(tagList)].map(t=>pill(t,qg&&String(t).includes(qg.tier)?`qb-tier-${qg.tier.toLowerCase()}`:"" )).join("");
    $("#guideSummary").textContent=g.summary||"";
    $("#guideTarget").textContent=g.target||g.verdict||"";
    $("#guideCustom").textContent=g.custom||"Custom projection drives the board.";
    $("#guideWhy").textContent=g.why||"";
    $("#guideRisks").textContent=g.risks||"";
    $("#guideOutcomes").innerHTML=(g.outcomes||[]).map(x=>pill(x)).join("");
    $("#guideFooter").textContent=`Confidence: ${g.confidence||"MODEL"} • ${g.source||`Model through ${baselineDate}`} • ESPN/market price is a timing signal, not a second vote on football quality.`;
    $("#playerGuideModal").classList.remove("hidden");
    document.body.style.overflow="hidden";
  }
  function closePlayerGuide(){ $("#playerGuideModal")?.classList.add("hidden"); document.body.style.overflow=""; }

  function renderQBScarcity(){
    const panel=$("#qbScarcityPanel"); if(!panel) return;
    const c=counts(draftSlot), s=qbPoolSnapshot(c);
    panel.className=`panel qb-scarcity qb-${s.level.toLowerCase()}`;
    const label=s.level==="SECURED"?"QB ROOM • 3 QBs SECURED":`QB POOL • ${s.level==="RED"?"CRITICAL":s.level==="YELLOW"?"THINNING":"HEALTHY"}`;
    $("#qbAlertLabel").textContent=label;
    let title,meta;
    if(s.level==="SECURED") { title="QB3 objective complete"; meta="Do not force QB4. Only take a fourth if a secure Good-tier starter becomes an extreme value."; }
    else if(c.QB<2 && s.level==="RED") { title="🚨 Take a starting QB now"; meta=`You have ${c.QB} QB. ${s.goodRemaining.length} preferred Good+ QBs remain; ~${s.expectedTaken} could go before your return.`; }
    else if(c.QB<2 && s.level==="YELLOW") { title="QB1/QB2 priority is rising"; meta=`${s.draftedQBs} QBs are gone and ${s.goodRemaining.length} preferred Good+ options remain.`; }
    else if(c.QB===2 && s.level==="RED") { title="🚨 QB3 ALERT — take the QB"; meta=`Preferred pool is near the cliff: ${s.goodRemaining.length} Good+ QBs remain; ~${s.expectedTaken} are expected before your next turn.`; }
    else if(c.QB===2 && s.level==="YELLOW") { title="Start considering QB3 now"; meta=`QB${s.draftedQBs+1} range is approaching the cliff. A Great/Good QB3 can justify a Round 5–7 reach.`; }
    else if(c.QB===2) { title="QB3 can wait — for now"; meta=`${s.goodRemaining.length} Good+ QBs remain. Keep exploiting RB/WR value until the pool turns yellow.`; }
    else { title="QB pool still healthy"; meta=`${s.goodRemaining.length} Good+ QBs remain; live room demand before your return is ~${s.expectedTaken}.`; }
    $("#qbAlertTitle").textContent=title; $("#qbAlertMeta").textContent=meta;
    $("#qbDraftedCount").textContent=String(s.draftedQBs); $("#qbGoodRemaining").textContent=String(s.goodRemaining.length); $("#qbExpectedBeforeNext").textContent=String(s.expectedTaken);
    const names=s.goodRemaining.slice(0,8).map(p=>{ const g=qbGuideFor(p); return pill(`${p.name} • ${g.tier}`,`qb-tier-${g.tier.toLowerCase()}`); }).join("");
    $("#qbRemainingNames").innerHTML=names || pill("Preferred Good+ tier exhausted","bad");
  }

  function needBonusFromCounts(p, c, rosterCount = myRosterCount()) {
    // Roster fit matters, but it must not overpower player quality. QB1/QB2 bonuses
    // escalate only if the roster develops without filling the QB + OP structure.
    if (p.pos === "QB") {
      const g=qbGuideFor(p), tier=qbTierNum(p);
      if (g?.job==="BACKUP") return -40;
      if (g?.job==="DANGER") return c.QB<2 ? -14 : -24;
      if (c.QB === 0) {
        if (rosterCount <= 1) return 10;
        if (rosterCount <= 3) return 15;
        return 22;
      }
      if (c.QB === 1) {
        if (rosterCount <= 2) return 8;
        if (rosterCount <= 4) return 14;
        return 21;
      }
      if (c.QB === 2) {
        const qs=qbPoolSnapshot(c);
        const earlyPenalty=rosterCount<4?8:rosterCount<5?2:0; // don't default to QB3 before Round 5
        let bonus= tier<=2 ? -3 : tier===3 ? -7 : -13;
        if(qs.level==="YELLOW") bonus=tier<=2?7:tier===3?4:-5;
        if(qs.level==="RED") bonus=tier<=2?11:tier===3?9:tier===4?1:-16;
        return bonus-earlyPenalty;
      }
      return -24;
    }
    if (p.pos === "RB") { if (c.RB===0) return 7; if (c.RB===1) return 5; if (c.RB<4) return 2; return -2; }
    if (p.pos === "WR") { if (c.WR===0) return 7; if (c.WR===1) return 5; if (c.WR<5) return 2; return -2; }
    if (p.pos === "TE") return c.TE===0 ? 3 : -4;

    if (p.pos === "K" || p.pos === "D/ST") {
      const key = p.pos;
      if (c[key] >= 1) return -100;
      const spotsLeft = Math.max(0, LEAGUE.rosterSize - rosterCount);
      const missing = missingSpecialists(c);
      if (spotsLeft > LEAGUE.specialistSlots) return -100;
      if (spotsLeft <= missing) return 80;
      return 28;
    }
    return 0;
  }

  function survivalToPick(p, targetPick, fromPick = currentPick()) {
    if (!targetPick || targetPick <= fromPick) return 1;
    if (isSpecialist(p)) return 1;
    const x = (targetPick - draftTimingRank(p))/8.2;
    return clamp(1 - (1/(1+Math.exp(-x))), .02, .98);
  }

  // V3.3 standalone value: projection-first and non-duplicative.
  //
  // 65% = normalized VORP from the USER'S custom-scoring projections
  // 35% = projection rank within the player's own position
  //
  // IMPORTANT: There is no extra "QB scoring fit" or QB-tier premium here.
  // Completion points, passing-TD points, rushing, receptions, etc. are already
  // inside customProjection. Positional scarcity belongs in wait-cost / QB-pool
  // logic, not in a second scoring bonus. ESPN ADP remains timing-only.
  function intrinsicValue(p) {
    const r = researchFor(p);
    const vorpScore = ["QB","RB","WR","TE"].includes(p.pos)
      ? coreVorpPercentile(vorp(p)) * 100
      : 0;
    const positionProjection = positionalProjectionScore(p);

    // intelScore is now FOOTBALL INTEL ONLY: health, role, usage, starter status,
    // suspension/availability, depth-chart and other projection-changing evidence.
    const intelAdjustment = clamp(intelScore(p), -15, 15) * .25;
    const unresolvedPenalty = r.unresolved ? 4 : 0;
    const estimatedPenalty = p.projectionEstimated ? 1.5 : 0;

    return (
      vorpScore * .65 +
      positionProjection * .35 +
      intelAdjustment -
      unresolvedPenalty -
      estimatedPenalty
    );
  }

  function selectionUtility(p, c = counts(draftSlot), rosterCount = myRosterCount()) {
    return intrinsicValue(p) + needBonusFromCounts(p, c, rosterCount);
  }

  function simulatedRosterAfterPick(p, c, rosterCount) {
    const next = { ...c, [p.pos]:(c[p.pos]||0)+1 };
    return { counts:next, rosterCount:rosterCount+1 };
  }

  function expectedMaximum(candidates, targetPick, fromPick, valueFn, excludeId = null) {
    if (!targetPick || targetPick <= fromPick) {
      const first = candidates.filter(p=>p.id!==excludeId).sort((a,b)=>valueFn(b)-valueFn(a))[0];
      return { value:first ? valueFn(first) : 0, likely:first || null, confidence:first ? 1 : 0 };
    }
    const sorted = candidates
      .filter(p => p.id !== excludeId)
      .map(p => ({ p, value:valueFn(p), survival:survivalToPick(p,targetPick,fromPick) }))
      .sort((a,b)=>b.value-a.value);
    let none = 1, ev = 0, likely = null, likelyProb = -1;
    for (const item of sorted) {
      const probBest = none * item.survival;
      ev += probBest * item.value;
      if (probBest > likelyProb) { likelyProb = probBest; likely = item.p; }
      none *= (1-item.survival);
      if (none < .0005) break;
    }
    return { value:ev, likely, confidence:clamp(1-none,0,1) };
  }

  function tierStats(list) {
    const values=list.slice(0,24).map(intrinsicValue);
    const gaps=[];
    for(let i=0;i<values.length-1;i++) gaps.push(Math.max(0,values[i]-values[i+1]));
    const sorted=[...gaps].sort((a,b)=>a-b);
    const median=sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
    return { threshold:Math.max(4,median*2.0), medianGap:median };
  }

  function positionWaitMetrics(pos, list, targetPick, fromPick) {
    if (!list?.length) return { pos, best:null, bestValue:0, expectedNext:0, waitCost:0, immediateGap:0, tierCliff:false, likelyNext:null };
    const sorted=[...list].sort((a,b)=>intrinsicValue(b)-intrinsicValue(a));
    const best=sorted[0], bestValue=intrinsicValue(best);
    const next=expectedMaximum(sorted,targetPick,fromPick,intrinsicValue);
    const immediateGap=sorted[1] ? Math.max(0,bestValue-intrinsicValue(sorted[1])) : 0;
    const stats=tierStats(sorted);
    return {
      pos,best,bestValue,expectedNext:next.value,
      waitCost:Math.max(0,bestValue-next.value),
      immediateGap,tierCliff:immediateGap>=stats.threshold,
      cliffThreshold:stats.threshold, likelyNext:next.likely
    };
  }

  function expectedBestOverallAfterPick(candidate, targetPick, fromPick, myCounts, myRosterN, pool) {
    if (!targetPick) return { value:0, likely:null, confidence:1 };
    const sim = simulatedRosterAfterPick(candidate,myCounts,myRosterN);
    const future = pool.filter(q => {
      if (q.id===candidate.id) return false;
      return recommendationEligibility(q,sim.counts,sim.rosterCount).eligible;
    });
    return expectedMaximum(
      future,
      targetPick,
      fromPick,
      q => selectionUtility(q,sim.counts,sim.rosterCount),
      candidate.id
    );
  }

  function rebuildAnalysisCache() {
    const now = currentPick();
    const onClock = isMyTurn(now);
    const next = nextUserTurnFromNow();
    const following = followingUserPick();
    const selectionPick = onClock ? now : next;
    const waitTarget = following;
    const myCounts = counts(draftSlot);
    const myRosterN = myRosterCount();
    const pool = players.filter(p => !isDrafted(p) && !p.recordOnly && researchFor(p).draftable !== false);
    const byPos = {};

    Object.keys(replacementIndex).forEach(pos => {
      byPos[pos] = pool.filter(p=>p.pos===pos).sort((a,b)=>intrinsicValue(b)-intrinsicValue(a));
    });

    const eligibleCurrentUtilities = pool
      .filter(p => recommendationEligibility(p,myCounts,myRosterN).eligible)
      .map(p => selectionUtility(p,myCounts,myRosterN));
    const topCurrentUtility = eligibleCurrentUtilities.length ? Math.max(...eligibleCurrentUtilities) : 0;

    positionMetricsCache = new Map();
    for (const pos of ["QB","RB","WR","TE","K","D/ST"]) {
      // On your turn: cost of waiting until your following turn. Between turns: what the pool
      // is expected to look like by your next pick.
      const posTarget = onClock ? waitTarget : selectionPick;
      positionMetricsCache.set(pos,positionWaitMetrics(pos,byPos[pos],posTarget,now));
    }
    analysisContext = { onClock, selectionPick, waitTarget };

    analysisCache = new Map();
    for (const p of players) {
      const r = researchFor(p);
      const eligibility = recommendationEligibility(p,myCounts,myRosterN);
      if (isDrafted(p) || r.draftable===false || p.recordOnly || !eligibility.eligible) {
        analysisCache.set(p.id,{score:-999,pairEV:-999,intrinsic:intrinsicValue(p),currentUtility:-999,survival:0,waitCost:0,expectedPosNext:0,tierGap:0,tierCliff:false,intel:intelScore(p),blockedReason:eligibility.reason||""});
        continue;
      }

      const posMetric = positionMetricsCache.get(p.pos) || { waitCost:0,expectedNext:0 };
      const posList = byPos[p.pos] || [];
      const posIndex = posList.findIndex(x=>x.id===p.id);
      const nextAtPos = posIndex>=0 ? posList[posIndex+1] : null;
      const tierGap = nextAtPos ? Math.max(0,intrinsicValue(p)-intrinsicValue(nextAtPos)) : 0;
      const stats = tierStats(posList.slice(Math.max(0,posIndex),Math.max(0,posIndex)+24));
      const tierCliff = !!nextAtPos && tierGap>=stats.threshold;
      const currentUtility = selectionUtility(p,myCounts,myRosterN);
      const selectionSurvival = onClock ? 1 : survivalToPick(p,selectionPick,now);
      const future = expectedBestOverallAfterPick(p,waitTarget,selectionPick || now,myCounts,myRosterN,pool);
      const pairEV = currentUtility + future.value;

      // v2.7: Remaining-pool/tier pressure is explicitly SECONDARY.
      // It is allowed to separate genuinely close choices, but it fades to zero as the
      // candidate falls behind the best current standalone/roster-adjusted option.
      const qualityGap = Math.max(0, topCurrentUtility - currentUtility);
      const closeCallFactor = clamp(1 - qualityGap / 8, 0, 1);

      const waitBonusRaw = clamp(posMetric.waitCost * .12, 0, 3);
      const tierBonusRaw = tierCliff ? clamp(tierGap * .08, 0, 1.5) : 0;
      const waitBonus = waitBonusRaw * closeCallFactor;
      const tierBonus = tierBonusRaw * closeCallFactor;
      const baseRecommendation = currentUtility + waitBonus + tierBonus;

      // Between turns, survival only measures whether this target can realistically
      // reach your next selection. On the clock, availability does not change player quality.
      const score = onClock
        ? baseRecommendation
        : baseRecommendation * (.30 + .70*Math.sqrt(selectionSurvival));

      analysisCache.set(p.id,{
        score,pairEV,intrinsic:intrinsicValue(p),currentUtility,
        waitBonus,tierBonus,qualityGap,closeCallFactor,
        survival:selectionSurvival,waitCost:posMetric.waitCost,
        expectedPosNext:posMetric.expectedNext,tierGap,tierCliff,
        likelyPosNext:posMetric.likelyNext || null,
        nextBestOverall:future.likely || null,nextBestOverallValue:future.value,
        intel:intelScore(p),blockedReason:""
      });
    }

    rankedIds = pool
      .filter(p => (analysisCache.get(p.id)?.score ?? -999)>-900 && recommendationEligibility(p,myCounts,myRosterN).eligible)
      .sort((a,b)=>{
        const scoreDiff=(analysisCache.get(b.id)?.score??-999)-(analysisCache.get(a.id)?.score??-999);
        if (Math.abs(scoreDiff) > .15) return scoreDiff;
        const intrinsicDiff=intrinsicValue(b)-intrinsicValue(a);
        if (Math.abs(intrinsicDiff) > .05) return intrinsicDiff;
        const projectionDiff=(+b.customProjection||0)-(+a.customProjection||0);
        if (Math.abs(projectionDiff) > .01) return projectionDiff;
        if (a.pos==="QB" && b.pos==="QB") return (qbGuideFor(a)?.rank||99)-(qbGuideFor(b)?.rank||99);
        return marketRank(a)-marketRank(b);
      })
      .map(p=>p.id);
    bpaIds = pool.sort((a,b)=>intrinsicValue(b)-intrinsicValue(a)).map(p=>p.id);
    analysisRevision = stateRevision;
  }

  function analysisFor(p) {
    return analysisCache.get(p.id) || {score:-999,pairEV:-999,intrinsic:intrinsicValue(p),currentUtility:-999,waitBonus:0,tierBonus:0,qualityGap:0,closeCallFactor:0,survival:0,waitCost:0,expectedPosNext:0,tierGap:0,tierCliff:false,intel:intelScore(p),blockedReason:""};
  }
  function bestCachedAvailable(ids) {
    for (const id of ids) { const p=playerById.get(id); if (p && !isDrafted(p) && researchFor(p).draftable !== false) return p; }
    return null;
  }
  const available = () => players.filter(p => !isDrafted(p));
  const recommendationScore = p => analysisFor(p).score;

  function sleeperScore(p) {
    const r=researchFor(p), m=marketRank(p);
    if (r.draftable===false) return 0;
    const cheap=clamp((m-65)*.2,0,34), up=(+r.upside||5)*3.2, opp=(+r.opportunity||5)*2.7, skill=(+r.skills||5)*1.7;
    const healthPenalty=Math.max(0,7-(+r.health||7))*3;
    const estimatedPenalty=p.projectionEstimated?3:0;
    const cumulative=clamp(intelScore(p),-20,20)*.55;
    const unresolvedPenalty=r.unresolved?5:0;
    return clamp(cheap+up+opp+skill+cumulative-healthPenalty-estimatedPenalty-unresolvedPenalty,0,100);
  }

  function reasons(p) {
    const r=researchFor(p), a=analysisFor(p), out=[];
    if (p.pos==="QB") out.push("QB + OP • 1 pt/completion • 6-pt pass TD");
    if (a.intrinsic>=90) out.push("Elite standalone value"); else if (a.intrinsic>=75) out.push("Strong standalone value");
    if (a.waitCost>=18) out.push(`Large ${p.pos} drop if you wait (secondary)`);
    else if (a.waitCost>=8) out.push(`${p.pos} wait cost is meaningful`);
    if (a.tierCliff) out.push(`Immediate ${p.pos} tier cliff`);
    if (a.survival<.30 && !analysisContext.onClock) out.push("Unlikely to reach your pick");
    if (p.pos==="QB" && counts(draftSlot).QB<2) out.push("Fills QB/OP starting structure");
    if (p.pos==="QB" && counts(draftSlot).QB===2) { const qs=qbPoolSnapshot(); if(qs.level==="RED") out.push("QB3 scarcity is CRITICAL"); else if(qs.level==="YELLOW") out.push("QB3 pool is thinning"); }
    if (a.nextBestOverall) out.push(`Next-turn fallback: ${a.nextBestOverall.name}`);
    if (intelScore(p)>=5) out.push("Football intel raises projection confidence");
    if (intelScore(p)<=-5) out.push("Football intel lowers projection confidence");
    if (r.unresolved) out.push("Unresolved high-impact uncertainty");
    return out.slice(0,5);
  }

  const pct = v => `${Math.round(v*100)}%`;
  const pill = (t,c="") => `<span class="pill ${c}">${esc(t)}</span>`;

  function renderTurnPanel() {
    const now=currentPick();
    if (now>MAX_PICKS) {
      $("#currentPickBig").textContent="Complete";
      $("#currentPickOwner").textContent=`${draft.length} picks recorded`;
      $("#myNextPickBig").textContent="—"; $("#myNextPickMeta").textContent="Draft complete";
      $("#picksUntilBig").textContent="0";
      updateAnalysisFreshness();
      return;
    }
    const owner=pickToTeam(now), round=roundForPick(now), next=nextUserTurnFromNow();
    $("#currentPickBig").textContent=`#${now}`;
    $("#currentPickOwner").textContent=`${owner===draftSlot?"YOUR TEAM":"Team "+owner} • Round ${round}`;
    if (next) {
      $("#myNextPickBig").textContent=`#${next}`;
      $("#myNextPickMeta").textContent=next===now?"You are on the clock":`Round ${roundForPick(next)} • Slot ${draftSlot}`;
      $("#picksUntilBig").textContent=String(Math.max(0,next-now));
    } else {
      $("#myNextPickBig").textContent="—"; $("#myNextPickMeta").textContent="No picks remaining"; $("#picksUntilBig").textContent="0";
    }
    updateAnalysisFreshness();
  }

  function updateAnalysisFreshness() {
    const el=$("#analysisFreshness");
    if (!el) return;
    const fresh=analysisRevision===stateRevision;
    if (fresh) { el.textContent="Recommendations current"; el.className="metric-meta analysis-live"; }
    else { el.textContent="Fast-entry mode • refresh deferred"; el.className="metric-meta analysis-stale"; }
  }

  function renderStatus() {
    const now=currentPick(), badge=$("#turnBadge"), status=$("#draftStatus");
    if (now>MAX_PICKS) { badge.textContent="Draft complete"; status.innerHTML=`<strong>${draft.length}</strong> picks recorded.`; renderQBScarcity(); return; }
    const slot=pickToTeam(now), round=roundForPick(now), onClock=slot===draftSlot;
    badge.textContent=`${onClock?"YOUR TEAM":"TEAM "+slot} • Pick ${now} • Round ${round}`;
    const next=nextUserTurnFromNow(), q=counts(draftSlot).QB;
    let qbRun="";
    if (next && next>now) {
      const seen=new Set(); for (let p=now;p<next;p++){const t=pickToTeam(p);if(t!==draftSlot)seen.add(t);}
      let openQBNeed=0; seen.forEach(t=>{if(counts(t).QB<2)openQBNeed++;});
      if (openQBNeed>=3 && q<2) qbRun=` • <strong>${openQBNeed}</strong> teams before you still have fewer than 2 QBs`;
    }
    const qs=qbPoolSnapshot();
    status.innerHTML=`<strong>${draft.length}</strong> ESPN picks recorded • <strong>${available().length}</strong> players available${qbRun} • QB pool: <strong>${qs.draftedQBs} drafted / ${qs.goodRemaining.length} Good+ left</strong>`;
    renderQBScarcity();
  }

  function renderPositionOutlook() {
    const el=$("#positionOutlookGrid");
    if(!el) return;
    const positions=["QB","RB","WR","TE"];
    el.innerHTML=positions.map(pos=>{
      const m=positionMetricsCache.get(pos);
      if(!m?.best) return `<article class="position-outlook-card"><div class="eyebrow">${pos}</div><h3>—</h3></article>`;
      const nextName=m.likelyNext?.name || "replacement tier";
      const cls=m.waitCost>=18?"bad":m.waitCost>=8?"warn":"good";
      return `<article class="position-outlook-card">
        <div class="eyebrow">${pos} WAIT COST</div>
        <h3>${esc(m.best.name)}</h3>
        <div class="position-value-row"><strong>${m.bestValue.toFixed(1)}</strong><span>best value now</span></div>
        <div class="position-value-row"><strong>${m.expectedNext.toFixed(1)}</strong><span>expected at next turn</span></div>
        <div class="chips">${pill(`Wait cost ${m.waitCost.toFixed(1)}`,cls)}${m.tierCliff?pill(`Tier gap ${m.immediateGap.toFixed(1)}`,"warn"):""}</div>
        <p class="note">Likely best ${pos} then: ${esc(nextName)}</p>
      </article>`;
    }).join("");
  }

  function renderDecision() {
    const now=currentPick(), best=bestCachedAvailable(rankedIds), bpa=bestCachedAvailable(bpaIds);
    const next=nextUserTurnFromNow(), after=followingUserPick(), onClock=isMyTurn(now);
    $("#bestPickLabel").textContent=onClock?"BEST PICK RIGHT NOW":"BEST REALISTIC TARGET FOR YOUR NEXT PICK";
    if (best) {
      const a=analysisFor(best);
      const posNext=a.likelyPosNext?.name || `${best.pos} pool`;
      $("#bestPickName").textContent=best.name;
      $("#bestPickMeta").textContent=`${best.team} ${best.pos} • Recommendation ${a.score.toFixed(1)} • Standalone ${a.intrinsic.toFixed(1)} • ${best.pos} wait cost ${a.waitCost.toFixed(1)} • expected ${best.pos} next turn ${a.expectedPosNext.toFixed(1)} • 2-pick outlook ${a.pairEV.toFixed(1)}${onClock?"":` • ${pct(a.survival)} chance to reach pick ${next}`}`;
      $("#bestPickReasons").innerHTML=reasons(best).map(x=>`<span class="chip">${esc(x)}</span>`).join("");
      $("#bestPickGuideBtn").disabled=false; $("#bestPickGuideBtn").dataset.guideId=best.id;
    } else { $("#bestPickName").textContent="—"; $("#bestPickMeta").textContent=""; $("#bestPickReasons").innerHTML=""; $("#bestPickGuideBtn").disabled=true; $("#bestPickGuideBtn").removeAttribute("data-guide-id"); }
    if (bpa) {
      const a=analysisFor(bpa);
      $("#bpaName").textContent=bpa.name;
      $("#bpaMeta").textContent=`${bpa.team} ${bpa.pos} • standalone value ${intrinsicValue(bpa).toFixed(1)} • raw VORP ${vorp(bpa).toFixed(1)} • ESPN ${bpa.espnRank?"#"+bpa.espnRank:"est. #"+Math.round(marketRank(bpa))}`;
    } else { $("#bpaName").textContent="—"; $("#bpaMeta").textContent=""; }
    if (next) {
      $("#nextPick").textContent=`Pick ${next}`;
      $("#nextPickMeta").textContent=onClock?(after?`Wait-cost model checks pick ${after} as secondary context`:"Final turn"):`${next-now} pick${next-now===1?"":"s"} until you are on the clock`;
    } else { $("#nextPick").textContent="Draft complete"; $("#nextPickMeta").textContent=""; }
    const c=counts(draftSlot), qs=qbPoolSnapshot(c);
    $("#qbPlan").textContent=c.QB===0?"QB1 is a structural priority":c.QB===1?"QB2 / OP is a structural priority":c.QB===2?(qs.level==="RED"?"🚨 Take QB3 now":qs.level==="YELLOW"?"QB3 decision zone":"Two starters secured • watch QB3"):c.QB===3?"Three-QB objective secured":"QB4 only at extreme value";
    $("#qbPlanMeta").textContent=`Preferred roster: 3 QBs • ${qs.draftedQBs} league QBs drafted • ${qs.goodRemaining.length} Good+ remain • Your roster: ${c.QB} QB • ${c.RB} RB • ${c.WR} WR • ${c.TE} TE`;
    renderPositionOutlook();
  }

  function intelBadgeClass(score, unresolved) {
    if (unresolved || score<=-5) return "bad";
    if (score>=5) return "good";
    return "";
  }

  function boardRowHtml(p) {
    const r=researchFor(p), d=draftedRecord(p), a=analysisFor(p), market=p.espnRank?`#${p.espnRank}`:`est #${Math.round(marketRank(p))}`;
    const adp=p.espnAdp?` • ADP ${p.espnAdp.toFixed(1)}`:"";
    const intelText=r.cumulativeNote || r.news || "No major update";
    const buttonLabel=isMyTurn(currentPick())?"Draft":"Record";
    const eligibility = recommendationEligibility(p);
    const scoreLabel = (!eligibility.eligible && !d) ? "LATE" : (p.recordOnly?"NR":a.score>-900?a.score.toFixed(1):"OUT");
    const posNext=a.expectedPosNext||0;
    return `<tr data-row-id="${esc(p.id)}" class="${d?"drafted":""}">
      <td class="action-col">${d?`<button class="ghost undo-one" data-id="${esc(p.id)}">Undo</button>`:p.recordOnly?`<button class="record-one" data-id="${esc(p.id)}">Record</button>`:r.draftable===false?`<button class="ghost" disabled>OUT</button>`:`<button class="record-one" data-id="${esc(p.id)}">${buttonLabel}</button>`}</td>
      <td><div class="player-name">${esc(p.name)}${r.status?` <span class="status">${esc(r.status)}</span>`:""}</div><div class="subline">${esc(p.team)}${p.recordOnly&&!d?" • record-only • no projection":""}${d?` • drafted #${d.pick} by ${d.teamSlot===draftSlot?"Your Team":"Team "+d.teamSlot}`:""}</div></td>
      <td>${pill(p.pos)}</td>
      <td class="guide-cell">${(()=>{const g=guidanceView(p),qg=qbGuideFor(p);return `<button class="ghost guide-btn guide-one" data-guide-id="${esc(p.id)}">ⓘ ${esc(qg?qg.tier:(g.verdict||"Analysis"))}</button><div class="guide-target">${esc(g.target||"")}</div>`;})()}</td>
      <td class="score-num" title="Two-pick expected value; ADP only affects availability">${scoreLabel}</td>
      <td class="score-num">${a.intrinsic.toFixed(1)}</td>
      <td class="score-num ${a.waitCost>=18?"metric-bad":a.waitCost>=8?"metric-warn":""}">${a.waitCost.toFixed(1)}</td>
      <td class="score-num">${posNext.toFixed(1)}</td>
      <td class="score-num ${p.projectionEstimated?"proj-est":""}">${(+p.customProjection).toFixed(1)}${p.projectionEstimated?"*":""}</td>
      <td class="score-num">${vorp(p).toFixed(1)}</td>
      <td>${market}${adp}</td>
      <td>${pill(aggregateExpertTag(p),expertTagClass(aggregateExpertTag(p)))}</td>
      <td>${pill(pct(a.survival),a.survival<.3?"bad":a.survival>.7?"good":"warn")}</td>
    </tr>`;
  }

  function renderBoard() {
    const q=$("#search").value.trim().toLowerCase(), pf=$("#positionFilter").value;
    $("#survivalHead").textContent=isMyTurn(currentPick())?"Make back?":"At your pick?";
    const rows=players
      .filter(p=>pf==="ALL"||p.pos===pf)
      .filter(p=>!q||p.name.toLowerCase().includes(q))
      .sort((a,b)=>isDrafted(a)!==isDrafted(b)?(isDrafted(a)?1:-1):recommendationScore(b)-recommendationScore(a));
    $("#poolCount").textContent=`${available().length} available • ${players.length} total players • ${draft.length}/${MAX_PICKS} ESPN picks recorded`;
    $("#playerTable tbody").innerHTML=rows.map(boardRowHtml).join("");
    dirty.board=false;
  }

  function patchBoardAfterPick(p) {
    $("#poolCount").textContent=`${available().length} available • ${players.length} total players • ${draft.length}/${MAX_PICKS} ESPN picks recorded`;
    const row=document.querySelector(`tr[data-row-id="${p.id}"]`);
    if (!row) { dirty.board=true; return; }
    row.classList.add("drafted");
    const rec=draftedRecord(p), action=row.querySelector(".action-col"), sub=row.querySelector(".subline");
    if (action) action.innerHTML=`<button class="ghost undo-one" data-id="${esc(p.id)}">Undo</button>`;
    if (sub && rec) sub.textContent=`${p.team} • drafted #${rec.pick} by ${rec.teamSlot===draftSlot?"Your Team":"Team "+rec.teamSlot}`;
    dirty.board=true; // order/scores are stale until the next full analysis refresh
  }

  function renderSleepers() {
    const s=available().filter(p=>!p.recordOnly&&marketRank(p)>=65&&researchFor(p).draftable!==false).sort((a,b)=>sleeperScore(b)-sleeperScore(a)).slice(0,40);
    $("#sleeperCards").innerHTML=s.map(p=>{const r=researchFor(p),a=analysisFor(p);return `<article class="sleeper-card"><div class="eyebrow">${esc(p.pos)} • ${esc(p.team)} • ${p.espnRank?"ESPN #"+p.espnRank:"market est #"+Math.round(marketRank(p))}</div><h3>${esc(p.name)}</h3><div class="big-score">${Math.round(sleeperScore(p))}</div><div class="muted">Sleeper / value score</div><p class="note">${esc(r.cumulativeNote||r.note||r.news||"Cheap player with a projection-driven path to value.")}</p><div class="chips">${pill(`Proj ${p.customProjection.toFixed(1)}${p.projectionEstimated?"*":""}`)}${pill(`VORP ${vorp(p).toFixed(1)}`)}${pill(`Availability ${pct(a.survival)}`)}</div><button class="ghost guide-cta guide-one" data-guide-id="${esc(p.id)}">ⓘ Player guidance</button></article>`;}).join("");
    dirty.sleepers=false;
  }

  function renderRosters() {
    $("#rosterGrid").innerHTML=Array.from({length:12},(_,i)=>i+1).map(slot=>{const c=counts(slot),recs=teamDrafts[slot]||[];return `<article class="roster ${slot===draftSlot?"me":""}"><h3>${slot===draftSlot?"Your Team":"Team "+slot}</h3><div class="muted">QB ${c.QB} • RB ${c.RB} • WR ${c.WR} • TE ${c.TE} • K ${c.K} • DST ${c["D/ST"]}</div><ul>${recs.map(d=>{const p=playerById.get(d.playerId);return `<li><strong>#${d.pick}</strong> ${esc(p?.name||d.playerId)} <span class="muted">${esc(p?.pos||"")}</span></li>`;}).join("")||"<li>—</li>"}</ul></article>`;}).join("");
    dirty.rosters=false;
  }

  function renderLog() {
    $("#draftLog").innerHTML=[...draft].sort((a,b)=>a.pick-b.pick).map(d=>{const p=playerById.get(d.playerId);return `<tr><td>#${d.pick}</td><td>${roundForPick(d.pick)}</td><td>${d.teamSlot===draftSlot?"Your Team":"Team "+d.teamSlot}</td><td>${esc(p?.name||d.playerId)}</td><td>${esc(p?.pos||"")}</td><td><button class="ghost log-undo" data-id="${esc(d.playerId)}">Undo</button></td></tr>`;}).join("");
    dirty.log=false;
  }

  function renderIntel() {
    const entries=players.map(p=>[p,intelView(p)]).filter(([p,v])=>priorFor(p)||v.groups.length||teamContext[p.team]).sort((a,b)=>{
      const u=Number(b[1].unresolved)-Number(a[1].unresolved); if(u)return u;
      const d=String(b[1].latestDate||"").localeCompare(String(a[1].latestDate||"")); if(d)return d;
      return Math.abs(b[1].score)-Math.abs(a[1].score);
    }).slice(0,90);
    $("#intelCards").innerHTML=entries.map(([p,v])=>{
      const tc=teamContext[p.team];
      const sourceDetails=v.groups.length?v.groups.map(g=>`${g.eventId}: ${g.sources.join(", ")} (${g.independentSources} independent source${g.independentSources===1?"":"s"})`).join(" • "):"";
      return `<article class="intel-card"><div class="eyebrow">${esc(v.latestDate||baselineDate)} • ${esc(p.pos)} ${esc(p.team)}</div><h3>${esc(p.name)}</h3><div class="status">${esc(v.status)} • intel ${v.score.toFixed(1)} • ${Math.round(v.confidence*100)}% confidence</div><p class="note">${esc(v.note||"No cumulative note yet.")}</p>${v.market?`<p class="note"><strong>Market:</strong> ${esc(v.market)}</p>`:""}${v.unresolved?`<p class="note"><strong>Unresolved:</strong> keep a wider range of outcomes; do not force a precise rank.</p>`:""}${tc?`<p class="note"><strong>Team context:</strong> ${esc(tc.note)}</p>`:""}${sourceDetails?`<p class="note"><strong>New source detail:</strong> ${esc(sourceDetails)}</p>`:""}</article>`;
    }).join("");
    dirty.intel=false;
  }

  function quickMatches(query) {
    const q=canonical(query); if(!q)return [];
    return available().filter(p=>researchFor(p).draftable!==false || p.recordOnly).map(p=>{
      const c=p._canonical; let match=0;
      if(c===q)match=100; else if(c.startsWith(q))match=80; else if(c.includes(q))match=55; else if(p._words.some(w=>w.startsWith(q)))match=45;
      return {p,match};
    }).filter(x=>x.match>0).sort((a,b)=>b.match-a.match || (analysisFor(b.p).score-analysisFor(a.p).score) || marketRank(a.p)-marketRank(b.p)).slice(0,8).map(x=>x.p);
  }
  function hideSuggestions(){const el=$("#pickSuggestions");el.classList.add("hidden");el.innerHTML="";suggestionIndex=0;}
  function renderSuggestions() {
    const matches=quickMatches($("#pickEntry").value);
    if(!matches.length){selectedQuickId=null;$("#recordTopBtn").disabled=true;hideSuggestions();return;}
    suggestionIndex=clamp(suggestionIndex,0,matches.length-1);selectedQuickId=matches[suggestionIndex].id;$("#recordTopBtn").disabled=false;
    $("#pickSuggestions").classList.remove("hidden");
    $("#pickSuggestions").innerHTML=matches.map((p,i)=>`<div class="suggestion ${i===suggestionIndex?"active":""}" data-id="${esc(p.id)}" data-index="${i}"><div><div class="suggestion-name">${esc(p.name)}</div><div class="suggestion-meta">${esc(p.team)} • ${esc(p.pos)} • ${p.recordOnly?"record-only entry":p.espnRank?"ESPN #"+p.espnRank:"market est #"+Math.round(marketRank(p))}</div></div><div class="suggestion-score">${p.recordOnly?"record only":analysisFor(p).score>-900?analysisFor(p).score.toFixed(0):"—"}</div></div>`).join("");
  }

  function markDirtyAfterDraftChange() { dirty.sleepers=true;dirty.rosters=true;dirty.log=true;dirty.board=true; }

  function fastRenderAfterPick(p) {
    renderTurnPanel(); renderStatus(); renderDecision(); patchBoardAfterPick(p); renderSuggestions();
    if(activeTab==="log")renderLog();
    if(activeTab==="rosters")renderRosters();
  }

  function refreshAnalysis({forceBoard=false}={}) {
    rebuildAnalysisCache();
    renderTurnPanel(); renderStatus(); renderDecision();
    if(forceBoard || activeTab==="board") renderBoard();
    if(activeTab==="sleepers") renderSleepers();
    updateAnalysisFreshness();
  }

  function addPick(p) {
    const pick=currentPick();
    if(!p||isDrafted(p))return false;
    if(pick>MAX_PICKS){toast("Draft is complete");return false;}
    if(pickUsed(pick)){toast(`Pick ${pick} is already recorded`);return false;}
    const teamSlot=pickToTeam(pick);
    draft.push({playerId:p.id,pick,teamSlot,recordedAt:new Date().toISOString()});
    setCurrentPick(nextOpenPick(pick+1));
    rebuildDraftIndexes(); stateRevision++; selectedQuickId=null;
    const input=$("#pickEntry"); input.value=""; hideSuggestions();

    markDirtyAfterDraftChange();
    // Perceived speed first: update the visible draft state immediately, before persistence or heavy re-ranking.
    fastRenderAfterPick(p);
    persistSoon();
    toast(`${p.name} recorded at pick ${pick}`);

    // Opponent picks stay on the fast path. After YOUR pick, refresh the next-target
    // recommendation because roster needs changed; also refresh immediately before your turn.
    if(teamSlot===draftSlot || isMyTurn(currentPick())) requestAnimationFrame(()=>refreshAnalysis({forceBoard:true}));
    else updateAnalysisFreshness();
    return true;
  }

  function removePickByPlayer(id) {
    const rec=draftByPlayer.get(id); if(!rec)return;
    draft=draft.filter(x=>x.playerId!==id); setCurrentPick(Math.min(currentPick(),rec.pick));
    rebuildDraftIndexes(); stateRevision++; markDirtyAfterDraftChange();
    saveNow(); refreshAnalysis({forceBoard:true});
    if(activeTab==="log")renderLog(); if(activeTab==="rosters")renderRosters();
  }
  function undoLast() {
    if(!draft.length)return;
    const last=[...draft].sort((a,b)=>b.pick-a.pick)[0];
    draft=draft.filter(x=>!(x.pick===last.pick&&x.playerId===last.playerId)); setCurrentPick(last.pick);
    rebuildDraftIndexes(); stateRevision++; markDirtyAfterDraftChange(); saveNow(); refreshAnalysis({forceBoard:true});
    if(activeTab==="log")renderLog(); if(activeTab==="rosters")renderRosters();
    const p=playerById.get(last.playerId); toast(`Undid pick ${last.pick}${p?` • ${p.name}`:""}`);
  }

  function exportState() {
    saveNow();
    const payload={app:"Picklehead247 Draft Companion",version:APP_VERSION,exportedAt:new Date().toISOString(),draftSlot,currentPick:currentPick(),draft};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`picklehead247-draft-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href);toast("Draft state exported");
  }
  function importState(file) {
    const reader=new FileReader();
    reader.onload=()=>{try{const payload=JSON.parse(reader.result);if(!Array.isArray(payload.draft))throw new Error("Invalid draft file");draft=payload.draft;draftSlot=clamp(Number(payload.draftSlot||1),1,12);$("#draftSlot").value=draftSlot;setCurrentPick(Number(payload.currentPick||1));rebuildDraftIndexes();if(!payload.currentPick)setCurrentPick(nextOpenPick(1));stateRevision++;markDirtyAfterDraftChange();saveNow();refreshAnalysis({forceBoard:true});renderActiveTab();toast("Draft state imported");}catch(e){toast("Could not import that file");}};
    reader.readAsText(file);
  }

  function renderActiveTab() {
    if(activeTab==="board" && dirty.board) renderBoard();
    else if(activeTab==="sleepers" && dirty.sleepers) renderSleepers();
    else if(activeTab==="rosters" && dirty.rosters) renderRosters();
    else if(activeTab==="log" && dirty.log) renderLog();
    else if(activeTab==="intel" && dirty.intel) renderIntel();
  }

  function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.remove("hidden");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.add("hidden"),1500);}

  function setup() {
    rebuildDraftIndexes();
    $("#draftSlot").innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
    draftSlot=clamp(draftSlot,1,12); $("#draftSlot").value=draftSlot;
    setCurrentPick(pickOverride || nextOpenPick(1));

    $("#draftSlot").onchange=e=>{draftSlot=+e.target.value;stateRevision++;saveNow();markDirtyAfterDraftChange();refreshAnalysis({forceBoard:true});renderActiveTab();};
    $("#currentPick").onchange=e=>{setCurrentPick(+e.target.value);stateRevision++;saveNow();refreshAnalysis({forceBoard:true});};
    $("#positionFilter").onchange=()=>renderBoard();
    $("#search").oninput=()=>renderBoard();
    $("#refreshBtn").onclick=()=>{refreshAnalysis({forceBoard:true});toast("Recommendations refreshed");};
    $("#bestPickGuideBtn").onclick=e=>{ const id=e.currentTarget.dataset.guideId; if(id) openPlayerGuide(id); };
    $("#guideCloseBtn").onclick=closePlayerGuide;
    document.addEventListener("click",e=>{ const b=e.target.closest(".guide-one"); if(!b) return; const id=b.dataset.guideId; if(id) openPlayerGuide(id); });
    $("#playerGuideModal").addEventListener("click",e=>{ if(e.target?.dataset?.closeGuide) closePlayerGuide(); });
    document.addEventListener("keydown",e=>{ if(e.key==="Escape") closePlayerGuide(); });
    $("#undoBtn").onclick=undoLast;
    $("#exportBtn").onclick=exportState;
    $("#importBtn").onclick=()=>$("#importFile").click();
    $("#importFile").onchange=e=>{if(e.target.files?.[0])importState(e.target.files[0]);e.target.value="";};
    $("#resetBtn").onclick=()=>{if(!confirm("Start a new draft? This clears all recorded ESPN picks on this device."))return;draft=[];setCurrentPick(1);rebuildDraftIndexes();stateRevision++;markDirtyAfterDraftChange();saveNow();refreshAnalysis({forceBoard:true});renderActiveTab();};

    $("#pickEntry").oninput=()=>{suggestionIndex=0;renderSuggestions();};
    $("#pickEntry").onkeydown=e=>{
      const matches=quickMatches($("#pickEntry").value);
      if(e.key==="ArrowDown"&&matches.length){e.preventDefault();suggestionIndex=(suggestionIndex+1)%matches.length;renderSuggestions();}
      else if(e.key==="ArrowUp"&&matches.length){e.preventDefault();suggestionIndex=(suggestionIndex-1+matches.length)%matches.length;renderSuggestions();}
      else if(e.key==="Enter"&&matches.length){e.preventDefault();const p=playerById.get(selectedQuickId||matches[0].id);addPick(p);}
      else if(e.key==="Escape")hideSuggestions();
    };
    $("#pickEntry").onfocus=renderSuggestions;
    $("#recordTopBtn").onclick=()=>{if(selectedQuickId)addPick(playerById.get(selectedQuickId));};
    $("#pickSuggestions").onmousedown=e=>{const el=e.target.closest(".suggestion");if(!el)return;e.preventDefault();selectedQuickId=el.dataset.id;addPick(playerById.get(selectedQuickId));};

    // Event delegation avoids rebinding hundreds of row handlers after every board render.
    $("#playerTable tbody").onclick=e=>{
      const record=e.target.closest(".record-one"), undo=e.target.closest(".undo-one");
      if(record){const p=playerById.get(record.dataset.id);addPick(p);}
      else if(undo)removePickByPlayer(undo.dataset.id);
    };
    $("#draftLog").onclick=e=>{const b=e.target.closest(".log-undo");if(b)removePickByPlayer(b.dataset.id);};
    document.addEventListener("click",e=>{if(!e.target.closest(".quick-picker"))hideSuggestions();});

    $$(".tab").forEach(btn=>btn.onclick=()=>{
      activeTab=btn.dataset.tab;
      $$(".tab").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
      $$(".tab-pane").forEach(x=>x.classList.add("hidden"));$(`#${activeTab}Tab`).classList.remove("hidden");
      renderActiveTab();
    });

    window.addEventListener("beforeunload",saveNow);

    // Initial full analysis; subsequent opponent picks use the fast path.
    stateRevision++;
    refreshAnalysis({forceBoard:true});
    renderStatus(); renderTurnPanel();
  }

  setup();
})();
