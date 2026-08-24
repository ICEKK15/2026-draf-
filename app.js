(() => {
  const APP_VERSION = "prod-v2.2-cumulative-fast-entry";
  const MAX_PICKS = 216;
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
  const baselineDate = window.CUMULATIVE_INTEL_BASELINE_DATE || "2026-08-23";

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
  const projectionPosIndex = new Map();
  Object.keys(replacementIndex).forEach(pos => {
    players.filter(p => p.pos === pos).sort((a,b) => b.customProjection - a.customProjection)
      .forEach((p,i) => projectionPosIndex.set(p.id,i));
  });

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
      // The cumulative prior already includes all reviewed evidence through the baseline date.
      priorScore = (prior.outlook || 0) * (.65 + .35*confidence);
    } else {
      const dims = ((+base.skills||5)+(+base.opportunity||5)+(+base.offense||5)+(+base.upside||5)+(+base.health||7))/5;
      const team = teamContext[p.team]?.impact || 0;
      priorScore = clamp((dims-6)*1.6 + (+base.expertSignal||0)*.20 + (+base.newsImpact||0)*.25 + team, -10, 10);
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

  function needBonusFromCounts(p, c) {
    if (p.pos === "QB") { if (c.QB===0) return 17; if (c.QB===1) return 14; if (c.QB===2) return -7; return -22; }
    if (p.pos === "RB") { if (c.RB===0) return 9; if (c.RB===1) return 7; if (c.RB<4) return 3; return -1; }
    if (p.pos === "WR") { if (c.WR===0) return 8; if (c.WR===1) return 7; if (c.WR<5) return 3; return -1; }
    if (p.pos === "TE") return c.TE===0 ? 5 : -5;
    if (p.pos === "K" || p.pos === "D/ST") return draft.length < 150 ? -30 : (c[p.pos]===0 ? 2 : -15);
    return 0;
  }
  function survivalToPick(p, targetPick, fromPick = currentPick()) {
    if (!targetPick || targetPick <= fromPick) return 1;
    const x = (targetPick - marketRank(p))/8.2;
    return clamp(1 - (1/(1+Math.exp(-x))), .02, .98);
  }
  function marketValue(p) {
    const projectionPick = 1 + (1-percentile(vorp(p)))*180;
    return clamp((marketRank(p)-projectionPick)/5,-12,12);
  }
  function computeOpponentQBDemand(now, target) {
    if (!target || target <= now) return 0;
    const teams = new Set();
    for (let pick=now; pick<target; pick++) teams.add(pickToTeam(pick));
    teams.delete(draftSlot);
    let qb1=0, qb2=0;
    teams.forEach(slot => { const q=counts(slot).QB; if (q===0) qb1++; else if (q===1) qb2++; });
    return clamp(qb1*1.2 + qb2*.55,0,10);
  }

  function rebuildAnalysisCache() {
    const now = currentPick();
    const onClock = isMyTurn(now);
    const next = nextUserTurnFromNow();
    const following = followingUserPick();
    const target = onClock ? following : next;
    const myCounts = counts(draftSlot);
    const opponentQB = computeOpponentQBDemand(now,next);
    const byPos = {};

    Object.keys(replacementIndex).forEach(pos => {
      byPos[pos] = players
        .filter(p => p.pos===pos && !isDrafted(p) && !p.recordOnly && researchFor(p).draftable !== false)
        .sort((a,b)=>vorp(b)-vorp(a));
    });

    analysisCache = new Map();
    for (const p of players) {
      const r = researchFor(p);
      if (isDrafted(p) || r.draftable === false || p.recordOnly) {
        analysisCache.set(p.id,{ score:-999, survival:0, need:0, scarcity:0, opponentQB:0, intel:intelScore(p), market:marketValue(p) });
        continue;
      }
      const posList = byPos[p.pos] || [];
      const idx = posList.findIndex(x=>x.id===p.id);
      const nextTier = idx >= 0 ? posList[idx+3] : null;
      const scarcity = idx < 0 ? 0 : !nextTier ? 2 : clamp((vorp(p)-vorp(nextTier))/16,0,7);
      const survival = survivalToPick(p,target,now);
      const need = needBonusFromCounts(p,myCounts);
      const intel = intelScore(p);
      const vScore = percentile(vorp(p))*100;
      const posIndex = projectionPosIndex.get(p.id) ?? 999;
      const posScore = clamp(100-posIndex*2.1,0,100);
      const urgency = (1-survival)*15;
      const estimatedPenalty = p.projectionEstimated ? 1.5 : 0;
      const unresolvedPenalty = r.unresolved ? 5 : 0;
      const qbDemand = p.pos === "QB" ? opponentQB : 0;
      const score = vScore*.55 + posScore*.12 + need*.68 + marketValue(p)*.72 + urgency + scarcity + qbDemand + intel*.36 - estimatedPenalty - unresolvedPenalty;
      analysisCache.set(p.id,{score,survival,need,scarcity,opponentQB:qbDemand,intel,market:marketValue(p)});
    }

    rankedIds = players.filter(p => !isDrafted(p) && !p.recordOnly && researchFor(p).draftable !== false)
      .sort((a,b)=>(analysisCache.get(b.id)?.score ?? -999)-(analysisCache.get(a.id)?.score ?? -999)).map(p=>p.id);
    bpaIds = players.filter(p => !isDrafted(p) && !p.recordOnly && researchFor(p).draftable !== false)
      .sort((a,b)=>(percentile(vorp(b))*100+intelScore(b)*.15)-(percentile(vorp(a))*100+intelScore(a)*.15)).map(p=>p.id);
    analysisRevision = stateRevision;
  }

  function analysisFor(p) {
    return analysisCache.get(p.id) || { score:-999, survival:0, need:0, scarcity:0, opponentQB:0, intel:intelScore(p), market:marketValue(p) };
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
    if (p.pos==="QB") out.push("1 pt/completion + 6-pt pass TD");
    if (vorp(p)>80) out.push("Strong value over replacement");
    if (a.need>=10) out.push("Fills QB/OP priority"); else if (a.need>=7) out.push("Fills starting need");
    if (a.survival<.30) out.push("Market says he may not reach your turn");
    if (a.market>5) out.push("Market discount");
    if (a.opponentQB>=4) out.push("QB demand before your turn");
    if (a.scarcity>=3) out.push("Positional tier drop behind him");
    if (intelScore(p)>=5) out.push("Cumulative evidence positive");
    if (intelScore(p)<=-5) out.push("Cumulative risk elevated");
    if (r.unresolved) out.push("Unresolved high-impact uncertainty");
    if ((+r.upside||0)>=9) out.push("High ceiling");
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
    if (now>MAX_PICKS) { badge.textContent="Draft complete"; status.innerHTML=`<strong>${draft.length}</strong> picks recorded.`; return; }
    const slot=pickToTeam(now), round=roundForPick(now), onClock=slot===draftSlot;
    badge.textContent=`${onClock?"YOUR TEAM":"TEAM "+slot} • Pick ${now} • Round ${round}`;
    const next=nextUserTurnFromNow(), q=counts(draftSlot).QB;
    let qbRun="";
    if (next && next>now) {
      const seen=new Set(); for (let p=now;p<next;p++){const t=pickToTeam(p);if(t!==draftSlot)seen.add(t);}
      let openQBNeed=0; seen.forEach(t=>{if(counts(t).QB<2)openQBNeed++;});
      if (openQBNeed>=3 && q<2) qbRun=` • <strong>${openQBNeed}</strong> teams before you still have fewer than 2 QBs`;
    }
    status.innerHTML=`<strong>${draft.length}</strong> ESPN picks recorded • <strong>${available().length}</strong> players available${qbRun}`;
  }

  function renderDecision() {
    const now=currentPick(), best=bestCachedAvailable(rankedIds), bpa=bestCachedAvailable(bpaIds);
    const next=nextUserTurnFromNow(), after=followingUserPick(), onClock=isMyTurn(now);
    $("#bestPickLabel").textContent=onClock?"BEST PICK RIGHT NOW":"BEST TARGET FOR YOUR NEXT PICK";
    if (best) {
      const target=onClock?after:next;
      const a=analysisFor(best);
      const survText=target?`${pct(a.survival)} chance available at pick ${target}`:"final turn";
      $("#bestPickName").textContent=best.name;
      $("#bestPickMeta").textContent=`${best.team} ${best.pos} • ${best.customProjection.toFixed(1)} projected pts • VORP ${vorp(best).toFixed(1)} • ${survText}`;
      $("#bestPickReasons").innerHTML=reasons(best).map(x=>`<span class="chip">${esc(x)}</span>`).join("");
    } else { $("#bestPickName").textContent="—"; $("#bestPickMeta").textContent=""; $("#bestPickReasons").innerHTML=""; }
    if (bpa) {
      $("#bpaName").textContent=bpa.name;
      $("#bpaMeta").textContent=`${bpa.team} ${bpa.pos} • VORP ${vorp(bpa).toFixed(1)} • ESPN ${bpa.espnRank?"#"+bpa.espnRank:"est. #"+Math.round(marketRank(bpa))}`;
    } else { $("#bpaName").textContent="—"; $("#bpaMeta").textContent=""; }
    if (next) {
      $("#nextPick").textContent=`Pick ${next}`;
      $("#nextPickMeta").textContent=onClock?(after?`After this pick, your following turn is ${after}`:"Final turn"):`${next-now} pick${next-now===1?"":"s"} until you are on the clock`;
    } else { $("#nextPick").textContent="Draft complete"; $("#nextPickMeta").textContent=""; }
    const c=counts(draftSlot);
    $("#qbPlan").textContent=c.QB===0?"Get QB1":c.QB===1?"QB2 is a priority":c.QB===2?"QB room set":"QB depth only";
    $("#qbPlanMeta").textContent=`Your roster: ${c.QB} QB • ${c.RB} RB • ${c.WR} WR • ${c.TE} TE`;
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
    return `<tr data-row-id="${esc(p.id)}" class="${d?"drafted":""}">
      <td class="action-col">${d?`<button class="ghost undo-one" data-id="${esc(p.id)}">Undo</button>`:p.recordOnly?`<button class="record-one" data-id="${esc(p.id)}">Record</button>`:r.draftable===false?`<button class="ghost" disabled>OUT</button>`:`<button class="record-one" data-id="${esc(p.id)}">${buttonLabel}</button>`}</td>
      <td><div class="player-name">${esc(p.name)}${r.status?` <span class="status">${esc(r.status)}</span>`:""}</div><div class="subline">${esc(p.team)}${p.recordOnly&&!d?" • record-only • no projection":""}${d?` • drafted #${d.pick} by ${d.teamSlot===draftSlot?"Your Team":"Team "+d.teamSlot}`:""}</div></td>
      <td>${pill(p.pos)}</td>
      <td class="score-num">${p.recordOnly?"NR":a.score>-900?a.score.toFixed(1):"OUT"}</td>
      <td class="score-num ${p.projectionEstimated?"proj-est":""}">${(+p.customProjection).toFixed(1)}${p.projectionEstimated?"*":""}</td>
      <td class="score-num">${vorp(p).toFixed(1)}</td>
      <td>${market}${adp}</td>
      <td>${pill(pct(a.survival),a.survival<.3?"bad":a.survival>.7?"good":"warn")}</td>
      <td><span class="pill intel-badge ${intelBadgeClass(a.intel,r.unresolved)}" title="${esc(intelText)}">${r.unresolved?"WAIT • ":a.intel>0?"+":""}${a.intel.toFixed(0)} • ${esc(r.status||"HOLD")}</span></td>
    </tr>`;
  }

  function renderBoard() {
    const q=$("#search").value.trim().toLowerCase(), pf=$("#positionFilter").value;
    $("#survivalHead").textContent=isMyTurn(currentPick())?"Makes next turn?":"At your pick?";
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
    $("#sleeperCards").innerHTML=s.map(p=>{const r=researchFor(p),a=analysisFor(p);return `<article class="sleeper-card"><div class="eyebrow">${esc(p.pos)} • ${esc(p.team)} • ${p.espnRank?"ESPN #"+p.espnRank:"market est #"+Math.round(marketRank(p))}</div><h3>${esc(p.name)}</h3><div class="big-score">${Math.round(sleeperScore(p))}</div><div class="muted">Sleeper / value score</div><p class="note">${esc(r.cumulativeNote||r.note||r.news||"Cheap player with a projection-driven path to value.")}</p><div class="chips">${pill(`Proj ${p.customProjection.toFixed(1)}${p.projectionEstimated?"*":""}`)}${pill(`VORP ${vorp(p).toFixed(1)}`)}${pill(`Availability ${pct(a.survival)}`)}</div></article>`;}).join("");
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
    input.focus({preventScroll:true});

    // Heavy recommendation work is intentionally deferred between the user's turns.
    if(isMyTurn(currentPick())) requestAnimationFrame(()=>refreshAnalysis({forceBoard:true}));
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
    $("#undoBtn").onclick=undoLast;
    $("#exportBtn").onclick=exportState;
    $("#importBtn").onclick=()=>$("#importFile").click();
    $("#importFile").onchange=e=>{if(e.target.files?.[0])importState(e.target.files[0]);e.target.value="";};
    $("#resetBtn").onclick=()=>{if(!confirm("Start a new draft? This clears all recorded ESPN picks on this device."))return;draft=[];setCurrentPick(1);rebuildDraftIndexes();stateRevision++;markDirtyAfterDraftChange();saveNow();refreshAnalysis({forceBoard:true});renderActiveTab();$("#pickEntry").focus();};

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
    setTimeout(()=>$("#pickEntry").focus(),100);
  }

  setup();
})();
