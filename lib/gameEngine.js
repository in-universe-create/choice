// 게임 플레이와 에디터가 공유하는 순수 게임 로직.
export function statIsUnlocked(stat, playerState = {}) {
  if (!stat) return false;
  if (stat.isBase) return true;
  if ((playerState.unlockedStats || []).includes(stat.id)) return true;
  const unlock = stat.unlockConditions || {};
  const hasUnlockCondition = (unlock.requiredFlags?.length || 0) || (unlock.requiredKeywords?.length || 0) || (unlock.requiredFaction?.length || 0);
  if (!hasUnlockCondition) return false;
  return checkCondition(unlock, playerState);
}

export function syncUnlockedStats(playerState, statDefinitions = []) {
  const next = JSON.parse(JSON.stringify(playerState));
  next.stats ||= {};
  next.unlockedStats = [...new Set(next.unlockedStats || [])];
  for (const stat of statDefinitions) {
    if (!statIsUnlocked(stat, next)) continue;
    if (!next.unlockedStats.includes(stat.id) && !stat.isBase) next.unlockedStats.push(stat.id);
    if (next.stats[stat.id] === undefined) {
      next.stats[stat.id] = Number(stat.initialValue ?? stat.min ?? 0);
    }
  }
  return next;
}

export function checkCondition(condition = {}, playerState = {}) {
  const { minStats, maxStats, requiredItems, excludedItems, requiredFlags, excludedFlags,
    requiredAbilities, excludedAbilities, requiredKeywords, excludedKeywords, minAffection, maxAffection, requiredFaction,
    requiredChoices, excludedChoices, requiredAnyChoices } = condition;
  const chosenChoices = new Set((playerState.history || []).map(step => step?.choiceId).filter(Boolean));
  if (requiredFaction && requiredFaction.length && !requiredFaction.includes(playerState.faction)) return false;
  for (const [key, val] of Object.entries(minStats || {})) {
    if (playerState.stats?.[key] === undefined) return false;
    if (playerState.stats[key] < val) return false;
  }
  for (const [key, val] of Object.entries(maxStats || {})) {
    if (playerState.stats?.[key] === undefined) return false;
    if (playerState.stats[key] > val) return false;
  }
  for (const id of requiredItems || []) if (!playerState.inventory?.includes(id)) return false;
  for (const id of excludedItems || []) if (playerState.inventory?.includes(id)) return false;
  for (const id of requiredAbilities || []) if (!playerState.abilities?.includes(id)) return false;
  for (const id of excludedAbilities || []) if (playerState.abilities?.includes(id)) return false;
  for (const id of requiredKeywords || []) if (!playerState.keywords?.includes(id)) return false;
  for (const id of excludedKeywords || []) if (playerState.keywords?.includes(id)) return false;
  for (const id of requiredFlags || []) if (!playerState.flags?.includes(id)) return false;
  for (const id of excludedFlags || []) if (playerState.flags?.includes(id)) return false;
  for (const id of requiredChoices || []) if (!chosenChoices.has(id)) return false;
  if ((requiredAnyChoices || []).length && !(requiredAnyChoices || []).some(id => chosenChoices.has(id))) return false;
  for (const id of excludedChoices || []) if (chosenChoices.has(id)) return false;
  for (const [id, val] of Object.entries(minAffection || {})) if ((playerState.affection?.[id] ?? 0) < val) return false;
  for (const [id, val] of Object.entries(maxAffection || {})) if ((playerState.affection?.[id] ?? 0) > val) return false;
  return true;
}

export function resolveNodeText(node, playerState = {}) {
  if (!node) return "";
  const variants = Array.isArray(node.conditionalTexts) ? [...node.conditionalTexts] : [];
  variants.sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0));
  let text = variants.find((variant) => checkCondition(variant.conditions || {}, playerState))?.text ?? node.text ?? "";

  // 부분 지문: 기본/조건부 본문을 유지하면서 앞·뒤 삽입, 특정 문구 교체/삭제가 가능하다.
  const fragments = Array.isArray(node.conditionalFragments) ? [...node.conditionalFragments] : [];
  fragments.sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0));
  for (const fragment of fragments) {
    if (!checkCondition(fragment.conditions || {}, playerState)) continue;
    const mode = fragment.mode || "before";
    const fragmentText = fragment.text ?? "";
    const anchor = fragment.anchor ?? "";
    if (mode === "prepend") { text = fragmentText ? `${fragmentText}\n\n${text}` : text; continue; }
    if (mode === "append") { text = fragmentText ? `${text}\n\n${fragmentText}` : text; continue; }
    if (!anchor) continue;
    const index = text.indexOf(anchor);
    if (index < 0) continue;
    if (mode === "before") text = text.slice(0, index) + fragmentText + text.slice(index);
    else if (mode === "after") text = text.slice(0, index + anchor.length) + fragmentText + text.slice(index + anchor.length);
    else if (mode === "replace") text = text.slice(0, index) + fragmentText + text.slice(index + anchor.length);
    else if (mode === "remove") text = text.slice(0, index) + text.slice(index + anchor.length);
  }
  return text;
}

export function resolveNodeRoute(story, startNodeId, playerState = {}) {
  let current = startNodeId;
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    const node = story?.nodes?.find((n) => n.id === current);
    if (!node) break;
    const routes = Array.isArray(node.conditionalRoutes) ? [...node.conditionalRoutes] : [];
    routes.sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0));
    const matched = routes.find((route) => route.nextNodeId && checkCondition(route.conditions || {}, playerState));
    if (!matched || matched.nextNodeId === current) break;
    current = matched.nextNodeId;
  }
  return current || startNodeId;
}

export function applyEffects(effects = {}, playerState, statDefinitions = []) {
  let next = JSON.parse(JSON.stringify(playerState));
  next.stats ||= {};
  next.affection ||= {};
  next.inventory = [...new Set(next.inventory || [])];
  next.abilities = [...new Set(next.abilities || [])];
  next.flags = [...new Set(next.flags || [])];
  next.keywords = [...new Set(next.keywords || [])];
  next.unlockedStats = [...new Set(next.unlockedStats || [])];

  // 랜덤 효과: 각 규칙은 선택지를 누를 때 한 번만 굴린다. 확률은 0~100%.
  // 같은 선택지에 여러 규칙을 넣으면 각각 독립적으로 판정된다.
  const triggeredRandom = (effects.randomEffects || []).reduce((acc, rule) => {
    const chance = Math.max(0, Math.min(100, Number(rule.chance ?? 100)));
    if (Math.random() * 100 >= chance) return acc;
    acc.addFlags.push(...(rule.addFlags || []));
    acc.removeFlags.push(...(rule.removeFlags || []));
    acc.addKeywords.push(...(rule.addKeywords || []));
    acc.removeKeywords.push(...(rule.removeKeywords || []));
    acc.addItems.push(...(rule.addItems || []));
    acc.removeItems.push(...(rule.removeItems || []));
    acc.addAbilities.push(...(rule.addAbilities || []));
    acc.removeAbilities.push(...(rule.removeAbilities || []));
    acc.unlockStats.push(...(rule.unlockStats || []));
    acc.lockStats.push(...(rule.lockStats || []));
    for (const [id, delta] of Object.entries(rule.stats || {})) acc.stats[id] = (acc.stats[id] || 0) + Number(delta || 0);
    for (const [id, delta] of Object.entries(rule.affection || {})) acc.affection[id] = (acc.affection[id] || 0) + Number(delta || 0);
    return acc;
  }, {addFlags:[],removeFlags:[],addKeywords:[],removeKeywords:[],addItems:[],removeItems:[],addAbilities:[],removeAbilities:[],unlockStats:[],lockStats:[],stats:{},affection:{}});

  // 확률 테이블: 각 테이블마다 1개의 결과만 선택한다.
  // 각 결과의 chance는 0~100 기준 누적 확률이며, 합계가 100보다 작으면 남은 확률은 '아무 결과 없음'이다.
  const triggeredTable = {addFlags:[],removeFlags:[],addKeywords:[],removeKeywords:[],addItems:[],removeItems:[],addAbilities:[],removeAbilities:[],unlockStats:[],lockStats:[],stats:{},affection:{}};
  for (const table of (effects.randomTables || [])) {
    const outcomes = Array.isArray(table.outcomes) ? table.outcomes : [];
    let roll = Math.random() * 100;
    let selected = null;
    for (const outcome of outcomes) {
      const chance = Math.max(0, Math.min(100, Number(outcome.chance ?? 0)));
      if (roll < chance) { selected = outcome; break; }
      roll -= chance;
    }
    if (!selected) continue;
    const e = selected.effects || {};
    triggeredTable.addFlags.push(...(e.addFlags || []));
    triggeredTable.removeFlags.push(...(e.removeFlags || []));
    triggeredTable.addKeywords.push(...(e.addKeywords || []));
    triggeredTable.removeKeywords.push(...(e.removeKeywords || []));
    triggeredTable.addItems.push(...(e.addItems || []));
    triggeredTable.removeItems.push(...(e.removeItems || []));
    triggeredTable.addAbilities.push(...(e.addAbilities || []));
    triggeredTable.removeAbilities.push(...(e.removeAbilities || []));
    triggeredTable.unlockStats.push(...(e.unlockStats || []));
    triggeredTable.lockStats.push(...(e.lockStats || []));
    for (const [id, delta] of Object.entries(e.stats || {})) triggeredTable.stats[id] = (triggeredTable.stats[id] || 0) + Number(delta || 0);
    for (const [id, delta] of Object.entries(e.affection || {})) triggeredTable.affection[id] = (triggeredTable.affection[id] || 0) + Number(delta || 0);
  }

  const resolvedEffects = {
    ...effects,
    addFlags: [...(effects.addFlags || []), ...triggeredRandom.addFlags, ...triggeredTable.addFlags],
    removeFlags: [...(effects.removeFlags || []), ...triggeredRandom.removeFlags, ...triggeredTable.removeFlags],
    addKeywords: [...(effects.addKeywords || []), ...triggeredRandom.addKeywords, ...triggeredTable.addKeywords],
    removeKeywords: [...(effects.removeKeywords || []), ...triggeredRandom.removeKeywords, ...triggeredTable.removeKeywords],
    addItems: [...(effects.addItems || []), ...triggeredRandom.addItems, ...triggeredTable.addItems],
    removeItems: [...(effects.removeItems || []), ...triggeredRandom.removeItems, ...triggeredTable.removeItems],
    addAbilities: [...(effects.addAbilities || []), ...triggeredRandom.addAbilities, ...triggeredTable.addAbilities],
    removeAbilities: [...(effects.removeAbilities || []), ...triggeredRandom.removeAbilities, ...triggeredTable.removeAbilities],
    unlockStats: [...(effects.unlockStats || []), ...triggeredRandom.unlockStats, ...triggeredTable.unlockStats],
    lockStats: [...(effects.lockStats || []), ...triggeredRandom.lockStats, ...triggeredTable.lockStats],
    stats: Object.fromEntries([...new Set([...Object.keys(effects.stats || {}), ...Object.keys(triggeredRandom.stats || {}), ...Object.keys(triggeredTable.stats || {})])].map(id => [id, Number(effects.stats?.[id] || 0) + Number(triggeredRandom.stats?.[id] || 0) + Number(triggeredTable.stats?.[id] || 0)])),
    affection: Object.fromEntries([...new Set([...Object.keys(effects.affection || {}), ...Object.keys(triggeredRandom.affection || {}), ...Object.keys(triggeredTable.affection || {})])].map(id => [id, Number(effects.affection?.[id] || 0) + Number(triggeredRandom.affection?.[id] || 0) + Number(triggeredTable.affection?.[id] || 0)])),
  };

  // 플래그/키워드 등을 먼저 반영해서 같은 선택지에서 해금되는 스탯도 즉시 생성할 수 있게 한다.
  for (const id of resolvedEffects.addFlags || []) if (!next.flags.includes(id)) next.flags.push(id);
  for (const id of resolvedEffects.removeFlags || []) next.flags = next.flags.filter((x) => x !== id);
  for (const id of resolvedEffects.addKeywords || []) if (!next.keywords.includes(id)) next.keywords.push(id);
  for (const id of resolvedEffects.removeKeywords || []) next.keywords = next.keywords.filter((x) => x !== id);

  // 명시적 해금: 작가가 원하는 루트의 선택지에서 직접 스탯을 열 수 있다.
  for (const id of resolvedEffects.unlockStats || []) {
    if (!next.unlockedStats.includes(id)) next.unlockedStats.push(id);
  }
  for (const id of resolvedEffects.lockStats || []) {
    next.unlockedStats = next.unlockedStats.filter((x) => x !== id);
    const def = statDefinitions.find((x) => x.id === id);
    if (def && !def.isBase) delete next.stats[id];
  }

  // 스탯 자체에 설정한 해금 조건(예: 특정 플래그)을 만족하면 자동 해금한다.
  next = syncUnlockedStats(next, statDefinitions);

  for (const [key, delta] of Object.entries(resolvedEffects.stats || {})) {
    const def = statDefinitions.find((x) => x.id === key);
    if (def && !statIsUnlocked(def, next)) continue;
    if (!def && next.stats[key] === undefined) continue;
    next.stats[key] = (next.stats[key] ?? 0) + Number(delta || 0);
    if (def && Number.isFinite(Number(def.min))) next.stats[key] = Math.max(Number(def.min), next.stats[key]);
    if (def && Number.isFinite(Number(def.max))) next.stats[key] = Math.min(Number(def.max), next.stats[key]);
  }
  if (typeof resolvedEffects.money === 'number' && next.stats.money !== undefined) next.stats.money = (next.stats.money ?? 0) + resolvedEffects.money;
  for (const [id, delta] of Object.entries(resolvedEffects.affection || {})) next.affection[id] = (next.affection[id] ?? 0) + Number(delta || 0);
  for (const id of resolvedEffects.addItems || []) if (!next.inventory.includes(id)) next.inventory.push(id);
  for (const id of resolvedEffects.removeItems || []) next.inventory = next.inventory.filter((x) => x !== id);
  for (const id of resolvedEffects.addAbilities || []) if (!next.abilities.includes(id)) next.abilities.push(id);
  for (const id of resolvedEffects.removeAbilities || []) next.abilities = next.abilities.filter((x) => x !== id);
  return next;
}


export function normalizePlayerStateForStory(playerState, story) {
  if (!playerState || !story) return playerState;
  const defs = story.stats || [];
  let next = JSON.parse(JSON.stringify(playerState));
  next.stats ||= {};
  const canonicalize = (values, defs = []) => {
    const byId = new Map(defs.map(x => [x.id, x.id]));
    const byName = new Map(defs.map(x => [x.name, x.id]));
    return [...new Set((Array.isArray(values) ? values : []).map(v => byId.get(v) || byName.get(v)).filter(Boolean))];
  };
  next.flags = canonicalize(next.flags, story.flags || []);
  next.keywords = canonicalize(next.keywords, story.keywords || []);
  next.inventory = canonicalize(next.inventory, story.items || []);
  next.abilities = canonicalize(next.abilities, story.abilities || []);
  next.unlockedStats = [...new Set(next.unlockedStats || [])];
  next.history = Array.isArray(next.history) ? next.history : [];
  // 기존 버전에서 커스텀 스탯이 이미 저장되어 있던 경우, 해금 기록이 없으면 숨긴다.
  const activeIds = new Set();
  for (const stat of defs) {
    if (stat.isBase || statIsUnlocked(stat, next)) activeIds.add(stat.id);
  }
  for (const id of Object.keys(next.stats)) if (!activeIds.has(id)) delete next.stats[id];
  next = syncUnlockedStats(next, defs);
  return next;
}

export function interpolateText(text, playerState) {
  return (text || '').replace(/\{([\w]+)\}/g, (m, key) => key === 'playerName' ? (playerState.playerName || '플레이어') : m);
}

export function createInitialState(playerName, faction, npcs = [], statDefinitions = []) {
  const definitions = statDefinitions?.length ? statDefinitions : [
    {id:'health',name:'체력',min:0,max:100,initialValue:70,isBase:true},
    {id:'mental',name:'멘탈',min:0,max:100,initialValue:60,isBase:true},
    {id:'money',name:'돈',min:0,max:999999,initialValue:500,isBase:true}
  ];
  const affection = {};
  for (const npc of npcs) affection[npc.id] = faction.startingAffection?.[npc.id] ?? npc.defaultAffection ?? 0;
  const stats = {};
  const unlockedStats = [];
  for (const stat of definitions) {
    if (stat.isBase) {
      stats[stat.id] = Number(faction.startingStats?.[stat.id] ?? stat.initialValue ?? stat.min ?? 0);
    }
  }
  const state = { playerName, faction: faction.id, currentNodeId: faction.startNodeId, day: 1,
    stats, unlockedStats, affection, inventory: [...(faction.startingItems || [])], abilities: [], flags: [], keywords: [], history: [] };
  return state;
}

export function computeStateAtNode(story, faction, npcs, targetHistory) {
  let state = createInitialState('플레이어', faction, npcs, story.stats || []);
  for (const step of targetHistory) {
    const node = story.nodes.find((n) => n.id === step.nodeId); const choice = node?.choices.find((c) => c.id === step.choiceId);
    if (choice) { state = applyEffects(choice.effects, state, story.stats || []); state.history = [...(state.history || []), { nodeId: step.nodeId, choiceId: step.choiceId }]; state.currentNodeId = resolveNodeRoute(story, choice.nextNodeId, state); }
  }
  return state;
}

export function findPathToNode(story, startNodeId, targetNodeId, factionId) {
  if (startNodeId === targetNodeId) return [];
  const queue = [{ nodeId: startNodeId, path: [] }], visited = new Set([startNodeId]);
  while (queue.length) {
    const { nodeId, path } = queue.shift(); const node = story.nodes.find((n) => n.id === nodeId); if (!node) continue;
    for (const choice of node.choices || []) {
      const rf = choice.conditions?.requiredFaction; if (rf?.length && !rf.includes(factionId)) continue;
      if (!choice.nextNodeId) continue; const nextPath = [...path, { nodeId, choiceId: choice.id }];
      if (choice.nextNodeId === targetNodeId) return nextPath;
      if (!visited.has(choice.nextNodeId)) { visited.add(choice.nextNodeId); queue.push({ nodeId: choice.nextNodeId, path: nextPath }); }
    }
  }
  return null;
}

export function conditionSummary(condition = {}, lookup = {}) {
  const out=[]; const item=(id)=>lookup.items?.find(x=>x.id===id)?.name||id; const npc=(id)=>lookup.npcs?.find(x=>x.id===id)?.name||id; const stat=(id)=>lookup.stats?.find(x=>x.id===id)?.name||id; const flag=(id)=>lookup.flags?.find(x=>x.id===id)?.name||id;
  for (const [k,v] of Object.entries(condition.minStats||{})) out.push(`${stat(k)} ≥ ${v}`);
  for (const [k,v] of Object.entries(condition.maxStats||{})) out.push(`${stat(k)} ≤ ${v}`);
  for (const id of condition.requiredItems||[]) out.push(`${item(id)} 보유`);
  for (const id of condition.excludedItems||[]) out.push(`${item(id)} 미보유`);
  for (const id of condition.requiredAbilities||[]) out.push(`${id} 보유`);
  for (const id of condition.requiredFlags||[]) out.push(`플래그 ${flag(id)}`);
  for (const id of condition.excludedFlags||[]) out.push(`플래그 ${flag(id)} 없음`);
  for (const id of condition.requiredKeywords||[]) out.push(`키워드 ${lookup.keywords?.find(x=>x.id===id)?.name||id}`);
  for (const id of condition.excludedKeywords||[]) out.push(`키워드 ${lookup.keywords?.find(x=>x.id===id)?.name||id} 없음`);
  for (const id of condition.requiredChoices||[]) out.push(`선택 '${lookup.choices?.find(x=>x.id===id)?.label||id}' 경험`);
  for (const id of condition.requiredAnyChoices||[]) out.push(`선택 중 하나: '${lookup.choices?.find(x=>x.id===id)?.label||id}'`);
  for (const id of condition.excludedChoices||[]) out.push(`선택 '${lookup.choices?.find(x=>x.id===id)?.label||id}' 미경험`);
  for (const [id,v] of Object.entries(condition.minAffection||{})) out.push(`${npc(id)} 호감도 ≥ ${v}`);
  for (const [id,v] of Object.entries(condition.maxAffection||{})) out.push(`${npc(id)} 호감도 ≤ ${v}`);
  if (condition.requiredFaction?.length) out.push(`진영: ${condition.requiredFaction.join(', ')}`);
  return out;
}
