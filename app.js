(() => {
  const VERSION = "prod-v1";
  const MAX_PICKS = 216;
  const LS = {
    draft: `p247_live_draft_${VERSION}`,
    slot: `p247_live_slot_${VERSION}`,
    pick: `p247_live_pick_${VERSION}`
  };

  const clone = x => JSON.parse(JSON.stringify(x));
  const players = clone(window.PLAYER_DATA || []);
  const research = clone(window.RESEARCH_DATA || {});
  const teamContext = clone(window.TEAM_CONTEXT || {});
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeParse = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const canonical = n => String(n || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/d\/st/ig, "dst")
    .replace(/(sr|jr|iii|ii)\.?/ig, "")
    .replace(/[^a-z0-9]/gi, "").toLowerCase();

  let draft = safeParse(localStorage.getItem(LS.draft), []);
  if (!Array.isArray(draft)) draft = [];
  let draftSlot = Number(localStorage.getItem(LS.slot) || 1);
  let pickOverride = Number(localStorage.getItem(LS.pick) || 1);
  let selectedQuickId = null;
  let suggestionIndex = 0;

  const researchFor = p => research[p.name] || research[Object.keys(research).find(k => canonical(k) === canonical(p.name))] || {};
  const marketRank = p => Number(p.espnAdp) || Number(p.espnRank) || Number(p.estimatedMarketRank) || 350;
  const isDrafted = p => draft.some(d => d.playerId === p.id);
  const draftedRecord = p => draft.find(d => d.playerId === p.id);
  const pickUsed = pick => draft.some(d => d.pick === pick);
  const pickToTeam = pick => {
    const round = Math.ceil(pick / 12);
    const slot = ((pick - 1) % 12) + 1;
    return round % 2 ? slot : 13 - slot;
  };
  const roundForPick = pick => Math.ceil(pick / 12);
  const teamRoster = slot => draft
    .filter(d => d.teamSlot === slot)
    .sort((a, b) => a.pick - b.pick)
    .map(d => players.find(p => p.id === d.playerId)).filter(Boolean);
  const counts = slot => {
    const c = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, "D/ST": 0 };
    teamRoster(slot).forEach(p => c[p.pos] = (c[p.pos] || 0) + 1);
    return c;
  };

  function nextOpenPick(start = 1) {
    for (let p = clamp(start, 1, MAX_PICKS + 1); p <= MAX_PICKS; p++) if (!pickUsed(p)) return p;
    return MAX_PICKS + 1;
  }
  function currentPick() {
    const input = Number($("#currentPick")?.value || pickOverride || 1);
    return clamp(input, 1, MAX_PICKS + 1);
  }
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
  function save() {
    localStorage.setItem(LS.draft, JSON.stringify(draft));
    localStorage.setItem(LS.slot, String(draftSlot));
    localStorage.setItem(LS.pick, String(currentPick()));
  }

  // Replacement levels account for 12 teams and a QB-eligible OP slot.
  // A 25th-QB replacement baseline captures the league's practical QB2 demand.
  const replacementIndex = { QB: 25, RB: 34, WR: 46, TE: 16, K: 13, "D/ST": 13 };
  const replacement = {};
  Object.keys(replacementIndex).forEach(pos => {
    const list = players.filter(p => p.pos === pos && Number.isFinite(+p.customProjection)).sort((a, b) => b.customProjection - a.customProjection);
    replacement[pos] = list[Math.min(list.length - 1, replacementIndex[pos] - 1)]?.customProjection || 0;
  });
  const vorp = p => (+p.customProjection || 0) - (replacement[p.pos] || 0);
  const allVorp = players.map(vorp).sort((a, b) => a - b);
  const percentile = v => {
    if (!allVorp.length) return .5;
    let lo = 0, hi = allVorp.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (allVorp[m] < v) lo = m + 1; else hi = m; }
    return lo / Math.max(1, allVorp.length - 1);
  };

  function intelScore(p) {
    const r = researchFor(p);
    const tc = teamContext[p.team]?.impact || 0;
    const dims = ((+r.skills || 5) + (+r.opportunity || 5) + (+r.offense || 5) + (+r.upside || 5) + (+r.health || 7)) / 5;
    // expertSignal is one-source sentiment. Repeated mentions are intentionally not additive.
    return clamp((dims - 6) * 2 + (+r.expertSignal || 0) + (+r.newsImpact || 0) + tc, -35, 25);
  }

  function needBonus(p, slot = draftSlot) {
    const c = counts(slot);
    if (p.pos === "QB") {
      if (c.QB === 0) return 17;
      if (c.QB === 1) return 14;
      if (c.QB === 2) return -7;
      return -22;
    }
    if (p.pos === "RB") { if (c.RB === 0) return 9; if (c.RB === 1) return 7; if (c.RB < 4) return 3; return -1; }
    if (p.pos === "WR") { if (c.WR === 0) return 8; if (c.WR === 1) return 7; if (c.WR < 5) return 3; return -1; }
    if (p.pos === "TE") return c.TE === 0 ? 5 : -5;
    if (p.pos === "K" || p.pos === "D/ST") return draft.length < 150 ? -30 : (c[p.pos] === 0 ? 2 : -15);
    return 0;
  }

  function survivalToPick(p, targetPick) {
    if (!targetPick || targetPick <= currentPick()) return 1;
    const m = marketRank(p);
    // Market rank/ADP is used as a timing distribution, not as the player's football valuation.
    const x = (targetPick - m) / 8.2;
    const draftedByTarget = 1 / (1 + Math.exp(-x));
    return clamp(1 - draftedByTarget, .02, .98);
  }

  function relevantSurvival(p) {
    const now = currentPick();
    if (now > MAX_PICKS) return 0;
    const onClock = pickToTeam(now) === draftSlot;
    const target = onClock ? followingUserPick() : nextUserTurnFromNow();
    return survivalToPick(p, target);
  }

  function marketValue(p) {
    const m = marketRank(p);
    const projectionPick = 1 + (1 - percentile(vorp(p))) * 180;
    return clamp((m - projectionPick) / 5, -12, 12);
  }

  function opponentDemandBonus(p) {
    if (p.pos !== "QB") return 0;
    const now = currentPick();
    const target = nextUserTurnFromNow();
    if (!target || target <= now) return 0;
    const teams = new Set();
    for (let pick = now; pick < target; pick++) teams.add(pickToTeam(pick));
    teams.delete(draftSlot);
    let needsQB1 = 0, needsQB2 = 0;
    teams.forEach(slot => {
      const q = counts(slot).QB;
      if (q === 0) needsQB1++;
      else if (q === 1) needsQB2++;
    });
    return clamp(needsQB1 * 1.2 + needsQB2 * .55, 0, 10);
  }

  function scarcityBonus(p) {
    const same = players.filter(x => !isDrafted(x) && x.pos === p.pos && researchFor(x).draftable !== false)
      .sort((a, b) => vorp(b) - vorp(a));
    const i = same.findIndex(x => x.id === p.id);
    if (i < 0) return 0;
    const next = same[i + 3];
    if (!next) return 2;
    return clamp((vorp(p) - vorp(next)) / 16, 0, 7);
  }

  function recommendationScore(p) {
    const r = researchFor(p);
    if (r.draftable === false) return -999;
    const vScore = percentile(vorp(p)) * 100;
    const posList = players.filter(x => x.pos === p.pos).sort((a, b) => b.customProjection - a.customProjection);
    const posIndex = posList.findIndex(x => x.id === p.id);
    const posScore = clamp(100 - posIndex * 2.1, 0, 100);
    const survive = relevantSurvival(p);
    const urgency = (1 - survive) * 15;
    const estimatedPenalty = p.projectionEstimated ? 1.5 : 0;
    return vScore * .55 + posScore * .12 + needBonus(p) * .68 + marketValue(p) * .72 + urgency + scarcityBonus(p) + opponentDemandBonus(p) + intelScore(p) * .36 - estimatedPenalty;
  }

  function bpaScore(p) { return percentile(vorp(p)) * 100 + intelScore(p) * .15; }
  function sleeperScore(p) {
    const r = researchFor(p), m = marketRank(p);
    const cheap = clamp((m - 65) * .2, 0, 34);
    const up = (+r.upside || 5) * 3.2, opp = (+r.opportunity || 5) * 2.7, skill = (+r.skills || 5) * 1.7;
    const healthPenalty = Math.max(0, 7 - (+r.health || 7)) * 3;
    const estimatedPenalty = p.projectionEstimated ? 3 : 0;
    return clamp(cheap + up + opp + skill + (+r.newsImpact || 0) * .45 + (+r.expertSignal || 0) * 1.2 - healthPenalty - estimatedPenalty, 0, 100);
  }

  const available = () => players.filter(p => !isDrafted(p));
  const rankedNow = () => available().filter(p => researchFor(p).draftable !== false).sort((a, b) => recommendationScore(b) - recommendationScore(a));
  const bestBpa = () => available().filter(p => researchFor(p).draftable !== false).sort((a, b) => bpaScore(b) - bpaScore(a))[0];

  function reasons(p) {
    const r = researchFor(p), out = [];
    if (p.pos === "QB") out.push("1 pt/completion + 6-pt pass TD");
    if (vorp(p) > 80) out.push("Strong value over replacement");
    if (needBonus(p) >= 10) out.push("Fills QB/OP priority");
    else if (needBonus(p) >= 7) out.push("Fills starting need");
    if (relevantSurvival(p) < .30) out.push("Market says he may not reach your turn");
    if (marketValue(p) > 5) out.push("Market discount");
    if (opponentDemandBonus(p) >= 4) out.push("QB demand before your turn");
    if (scarcityBonus(p) >= 3) out.push("Positional tier drop behind him");
    if ((+r.newsImpact || 0) >= 6) out.push("Positive role/news update");
    if ((+r.newsImpact || 0) <= -8) out.push("Current injury/news risk");
    if ((+r.upside || 0) >= 9) out.push("High ceiling");
    return out.slice(0, 5);
  }

  function addPick(p) {
    const pick = currentPick();
    if (!p || isDrafted(p)) return false;
    if (pick > MAX_PICKS) { toast("Draft is complete"); return false; }
    if (pickUsed(pick)) { toast(`Pick ${pick} is already recorded`); return false; }
    const teamSlot = pickToTeam(pick);
    draft.push({ playerId: p.id, pick, teamSlot, recordedAt: new Date().toISOString() });
    draft.sort((a, b) => a.pick - b.pick);
    setCurrentPick(nextOpenPick(pick + 1));
    selectedQuickId = null;
    $("#pickEntry").value = "";
    hideSuggestions();
    save();
    render();
    toast(`${p.name} recorded at pick ${pick}`);
    setTimeout(() => $("#pickEntry").focus(), 50);
    return true;
  }

  function removePickByPlayer(id) {
    const rec = draft.find(x => x.playerId === id);
    if (!rec) return;
    draft = draft.filter(x => x.playerId !== id);
    setCurrentPick(Math.min(currentPick(), rec.pick));
    save(); render();
  }

  function undoLast() {
    if (!draft.length) return;
    const last = [...draft].sort((a, b) => b.pick - a.pick)[0];
    draft = draft.filter(x => !(x.pick === last.pick && x.playerId === last.playerId));
    setCurrentPick(last.pick);
    save(); render();
    const p = players.find(x => x.id === last.playerId);
    toast(`Undid pick ${last.pick}${p ? ` • ${p.name}` : ""}`);
  }

  const pct = v => `${Math.round(v * 100)}%`;
  const pill = (t, c = "") => `<span class="pill ${c}">${t}</span>`;

  function renderDecision() {
    const now = currentPick();
    const best = rankedNow()[0];
    const bpa = bestBpa();
    const next = nextUserTurnFromNow();
    const after = followingUserPick();
    const onClock = now <= MAX_PICKS && pickToTeam(now) === draftSlot;

    $("#bestPickLabel").textContent = onClock ? "BEST PICK RIGHT NOW" : "BEST TARGET FOR YOUR NEXT PICK";
    if (best) {
      $("#bestPickName").textContent = best.name;
      const target = onClock ? after : next;
      const survText = target ? `${pct(survivalToPick(best, target))} chance available at pick ${target}` : "final turn";
      $("#bestPickMeta").textContent = `${best.team} ${best.pos} • ${best.customProjection.toFixed(1)} projected pts • VORP ${vorp(best).toFixed(1)} • ${survText}`;
      $("#bestPickReasons").innerHTML = reasons(best).map(x => `<span class="chip">${x}</span>`).join("");
    } else {
      $("#bestPickName").textContent = "—"; $("#bestPickMeta").textContent = ""; $("#bestPickReasons").innerHTML = "";
    }
    if (bpa) {
      $("#bpaName").textContent = bpa.name;
      $("#bpaMeta").textContent = `${bpa.team} ${bpa.pos} • VORP ${vorp(bpa).toFixed(1)} • ESPN ${bpa.espnRank ? "#" + bpa.espnRank : "est. #" + Math.round(marketRank(bpa))}`;
    }
    if (next) {
      $("#nextPick").textContent = `Pick ${next}`;
      $("#nextPickMeta").textContent = onClock ? (after ? `After this pick, your following turn is ${after}` : "Final turn") : `${next - now} pick${next - now === 1 ? "" : "s"} until you are on the clock`;
    } else {
      $("#nextPick").textContent = "Draft complete"; $("#nextPickMeta").textContent = "";
    }
    const c = counts(draftSlot);
    $("#qbPlan").textContent = c.QB === 0 ? "Get QB1" : c.QB === 1 ? "QB2 is a priority" : c.QB === 2 ? "QB room set" : "QB depth only";
    $("#qbPlanMeta").textContent = `Your roster: ${c.QB} QB • ${c.RB} RB • ${c.WR} WR • ${c.TE} TE`;
  }

  function renderStatus() {
    const now = currentPick();
    const badge = $("#turnBadge"), status = $("#draftStatus");
    if (now > MAX_PICKS) {
      badge.textContent = "Draft complete";
      status.innerHTML = `<strong>${draft.length}</strong> picks recorded.`;
      return;
    }
    const slot = pickToTeam(now), round = roundForPick(now), onClock = slot === draftSlot;
    badge.textContent = `${onClock ? "YOUR TEAM" : "TEAM " + slot} • Pick ${now} • Round ${round}`;
    const next = nextUserTurnFromNow();
    const q = counts(draftSlot).QB;
    let qbRun = "";
    if (next && next > now) {
      let openQBNeed = 0;
      const seen = new Set();
      for (let p = now; p < next; p++) { const t = pickToTeam(p); if (t !== draftSlot) seen.add(t); }
      seen.forEach(t => { if (counts(t).QB < 2) openQBNeed++; });
      if (openQBNeed >= 3 && q < 2) qbRun = ` • <strong>${openQBNeed}</strong> teams picking before you still have fewer than 2 QBs`;
    }
    status.innerHTML = `<strong>${draft.length}</strong> ESPN picks recorded • <strong>${available().length}</strong> players available${qbRun}`;
  }

  function renderBoard() {
    const q = $("#search").value.trim().toLowerCase(), pf = $("#positionFilter").value;
    const onClock = currentPick() <= MAX_PICKS && pickToTeam(currentPick()) === draftSlot;
    $("#survivalHead").textContent = onClock ? "Makes next turn?" : "At your pick?";
    const rows = players
      .filter(p => pf === "ALL" || p.pos === pf)
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => isDrafted(a) !== isDrafted(b) ? (isDrafted(a) ? 1 : -1) : recommendationScore(b) - recommendationScore(a));
    $("#poolCount").textContent = `${available().length} available • ${players.length} total players • ${draft.length}/${MAX_PICKS} ESPN picks recorded`;
    $("#playerTable tbody").innerHTML = rows.map(p => {
      const r = researchFor(p), d = draftedRecord(p), surv = relevantSurvival(p), intel = intelScore(p);
      const market = p.espnRank ? `#${p.espnRank}` : `est #${Math.round(marketRank(p))}`;
      const adp = p.espnAdp ? ` • ADP ${p.espnAdp.toFixed(1)}` : "";
      const intelText = r.status || r.news || r.expert || "No major update";
      const buttonLabel = currentPick() <= MAX_PICKS && pickToTeam(currentPick()) === draftSlot ? "Take / record" : "Record pick";
      return `<tr class="${d ? "drafted" : ""}">
        <td><div class="player-name">${p.name}${r.status ? ` <span class="status">${r.status}</span>` : ""}</div><div class="subline">${p.team}${d ? ` • drafted #${d.pick} by ${d.teamSlot === draftSlot ? "Your Team" : "Team " + d.teamSlot}` : ""}</div></td>
        <td>${pill(p.pos)}</td>
        <td class="score-num">${recommendationScore(p) > -900 ? recommendationScore(p).toFixed(1) : "OUT"}</td>
        <td class="score-num ${p.projectionEstimated ? "proj-est" : ""}">${(+p.customProjection).toFixed(1)}${p.projectionEstimated ? "*" : ""}</td>
        <td class="score-num">${vorp(p).toFixed(1)}</td>
        <td>${market}${adp}</td>
        <td>${pill(pct(surv), surv < .3 ? "bad" : surv > .7 ? "good" : "warn")}</td>
        <td><span class="pill intel-badge ${intel <= -8 ? "bad" : intel >= 6 ? "good" : ""}" title="${String(intelText).replace(/"/g, '&quot;')}">${intel > 0 ? "+" : ""}${intel.toFixed(0)} • ${intelText}</span></td>
        <td>${d ? `<button class="ghost undo-one" data-id="${p.id}">Undo</button>` : r.draftable === false ? `<button class="ghost" disabled>OUT</button>` : `<button class="record-one" data-id="${p.id}">${buttonLabel}</button>`}</td>
      </tr>`;
    }).join("");
    $$(".record-one").forEach(b => b.onclick = () => addPick(players.find(p => p.id === b.dataset.id)));
    $$(".undo-one").forEach(b => b.onclick = () => removePickByPlayer(b.dataset.id));
  }

  function renderSleepers() {
    const s = available().filter(p => marketRank(p) >= 65 && researchFor(p).draftable !== false)
      .sort((a, b) => sleeperScore(b) - sleeperScore(a)).slice(0, 40);
    $("#sleeperCards").innerHTML = s.map(p => {
      const r = researchFor(p);
      return `<article class="sleeper-card"><div class="eyebrow">${p.pos} • ${p.team} • ${p.espnRank ? "ESPN #" + p.espnRank : "market est #" + Math.round(marketRank(p))}</div><h3>${p.name}</h3><div class="big-score">${Math.round(sleeperScore(p))}</div><div class="muted">Sleeper / value score</div><p class="note">${r.note || r.news || "Cheap player with a projection-driven path to value."}</p><div class="chips">${pill(`Proj ${p.customProjection.toFixed(1)}${p.projectionEstimated ? "*" : ""}`)}${pill(`VORP ${vorp(p).toFixed(1)}`)}${pill(`Availability ${pct(relevantSurvival(p))}`)}</div></article>`;
    }).join("");
  }

  function renderRosters() {
    $("#rosterGrid").innerHTML = Array.from({ length: 12 }, (_, i) => i + 1).map(slot => {
      const c = counts(slot), recs = draft.filter(d => d.teamSlot === slot).sort((a, b) => a.pick - b.pick);
      return `<article class="roster ${slot === draftSlot ? "me" : ""}"><h3>${slot === draftSlot ? "Your Team" : "Team " + slot}</h3><div class="muted">QB ${c.QB} • RB ${c.RB} • WR ${c.WR} • TE ${c.TE} • K ${c.K} • DST ${c["D/ST"]}</div><ul>${recs.map(d => { const p = players.find(x => x.id === d.playerId); return `<li><strong>#${d.pick}</strong> ${p?.name || d.playerId} <span class="muted">${p?.pos || ""}</span></li>`; }).join("") || "<li>—</li>"}</ul></article>`;
    }).join("");
  }

  function renderLog() {
    $("#draftLog").innerHTML = [...draft].sort((a, b) => a.pick - b.pick).map(d => {
      const p = players.find(x => x.id === d.playerId);
      return `<tr><td>#${d.pick}</td><td>${roundForPick(d.pick)}</td><td>${d.teamSlot === draftSlot ? "Your Team" : "Team " + d.teamSlot}</td><td>${p?.name || d.playerId}</td><td>${p?.pos || ""}</td><td><button class="ghost log-undo" data-id="${d.playerId}">Undo</button></td></tr>`;
    }).join("");
    $$(".log-undo").forEach(b => b.onclick = () => removePickByPlayer(b.dataset.id));
  }

  function renderIntel() {
    const entries = players.map(p => [p, researchFor(p)])
      .filter(([p, r]) => r.news || r.expert || teamContext[p.team])
      .sort((a, b) => String(b[1].updated || teamContext[b[0].team]?.updated || "").localeCompare(String(a[1].updated || teamContext[a[0].team]?.updated || "")))
      .slice(0, 80);
    $("#intelCards").innerHTML = entries.map(([p, r]) => `<article class="intel-card"><div class="eyebrow">${r.updated || teamContext[p.team]?.updated || "PRESEASON"} • ${p.pos} ${p.team}</div><h3>${p.name}</h3>${r.status ? `<div class="status">${r.status}</div>` : ""}<p class="note">${r.news || teamContext[p.team]?.note || ""}</p>${r.expert ? `<p class="note"><strong>Fantasy Footballers source:</strong> ${r.expert}</p>` : ""}</article>`).join("");
  }

  function quickMatches(query) {
    const q = canonical(query);
    if (!q) return [];
    return available().filter(p => researchFor(p).draftable !== false)
      .map(p => {
        const c = canonical(p.name);
        let match = 0;
        if (c === q) match = 100;
        else if (c.startsWith(q)) match = 80;
        else if (c.includes(q)) match = 55;
        else {
          const words = p.name.toLowerCase().split(/\s+/);
          if (words.some(w => canonical(w).startsWith(q))) match = 45;
        }
        return { p, match };
      })
      .filter(x => x.match > 0)
      .sort((a, b) => b.match - a.match || marketRank(a.p) - marketRank(b.p))
      .slice(0, 8).map(x => x.p);
  }

  function hideSuggestions() { $("#pickSuggestions").classList.add("hidden"); $("#pickSuggestions").innerHTML = ""; suggestionIndex = 0; }
  function renderSuggestions() {
    const matches = quickMatches($("#pickEntry").value);
    if (!matches.length) { selectedQuickId = null; $("#recordTopBtn").disabled = true; hideSuggestions(); return; }
    suggestionIndex = clamp(suggestionIndex, 0, matches.length - 1);
    selectedQuickId = matches[suggestionIndex].id;
    $("#recordTopBtn").disabled = false;
    $("#pickSuggestions").classList.remove("hidden");
    $("#pickSuggestions").innerHTML = matches.map((p, i) => `<div class="suggestion ${i === suggestionIndex ? "active" : ""}" data-id="${p.id}" data-index="${i}"><div><div class="suggestion-name">${p.name}</div><div class="suggestion-meta">${p.team} • ${p.pos} • ${p.espnRank ? "ESPN #" + p.espnRank : "market est #" + Math.round(marketRank(p))}</div></div><div class="suggestion-score">${recommendationScore(p).toFixed(0)}</div></div>`).join("");
    $$(".suggestion").forEach(el => {
      el.onmousedown = e => { e.preventDefault(); selectedQuickId = el.dataset.id; addPick(players.find(p => p.id === selectedQuickId)); };
    });
  }

  function exportState() {
    const payload = {
      app: "Picklehead247 Draft Companion",
      version: VERSION,
      exportedAt: new Date().toISOString(),
      draftSlot,
      currentPick: currentPick(),
      draft
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `picklehead247-draft-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    toast("Draft state exported");
  }

  function importState(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (!Array.isArray(payload.draft)) throw new Error("Invalid draft file");
        draft = payload.draft.filter(d => d && Number(d.pick) >= 1 && Number(d.pick) <= MAX_PICKS && players.some(p => p.id === d.playerId));
        draftSlot = clamp(Number(payload.draftSlot || 1), 1, 12);
        $("#draftSlot").value = draftSlot;
        setCurrentPick(Number(payload.currentPick || nextOpenPick(1)));
        save(); render(); toast("Draft state imported");
      } catch (e) { toast("Could not import that file"); }
    };
    reader.readAsText(file);
  }

  function render() {
    renderDecision(); renderStatus(); renderBoard(); renderSleepers(); renderRosters(); renderLog(); renderIntel();
    renderSuggestions();
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 1700);
  }

  function setup() {
    $("#draftSlot").innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
    $("#draftSlot").value = draftSlot;
    setCurrentPick(pickOverride || nextOpenPick(1));

    $("#draftSlot").onchange = e => { draftSlot = +e.target.value; save(); render(); };
    $("#currentPick").onchange = e => { setCurrentPick(+e.target.value); save(); render(); };
    $("#positionFilter").onchange = render;
    $("#search").oninput = renderBoard;
    $("#undoBtn").onclick = undoLast;
    $("#exportBtn").onclick = exportState;
    $("#importBtn").onclick = () => $("#importFile").click();
    $("#importFile").onchange = e => { if (e.target.files?.[0]) importState(e.target.files[0]); e.target.value = ""; };
    $("#resetBtn").onclick = () => {
      if (!confirm("Start a new draft? This clears all recorded ESPN picks on this device.")) return;
      draft = []; setCurrentPick(1); save(); render(); $("#pickEntry").focus();
    };

    $("#pickEntry").oninput = () => { suggestionIndex = 0; renderSuggestions(); };
    $("#pickEntry").onkeydown = e => {
      const matches = quickMatches($("#pickEntry").value);
      if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); suggestionIndex = (suggestionIndex + 1) % matches.length; renderSuggestions(); }
      else if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); suggestionIndex = (suggestionIndex - 1 + matches.length) % matches.length; renderSuggestions(); }
      else if (e.key === "Enter" && matches.length) { e.preventDefault(); const p = players.find(x => x.id === (selectedQuickId || matches[0].id)); addPick(p); }
      else if (e.key === "Escape") hideSuggestions();
    };
    $("#pickEntry").onfocus = renderSuggestions;
    $("#recordTopBtn").onclick = () => { if (selectedQuickId) addPick(players.find(p => p.id === selectedQuickId)); };
    document.addEventListener("click", e => { if (!e.target.closest(".quick-picker")) hideSuggestions(); });

    $$(".tab").forEach(btn => btn.onclick = () => {
      $$(".tab").forEach(x => x.classList.remove("active")); btn.classList.add("active");
      $$(".tab-pane").forEach(x => x.classList.add("hidden")); $(`#${btn.dataset.tab}Tab`).classList.remove("hidden");
    });

    render();
    setTimeout(() => $("#pickEntry").focus(), 100);
  }

  setup();
})();
