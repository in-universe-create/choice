"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkCondition, applyEffects, interpolateText, normalizePlayerStateForStory, resolveNodeRoute, resolveNodeText } from "@/lib/gameEngine";
import { loadPlayerState, savePlayerState } from "@/lib/playerState";
import BgmPlayer from "@/components/BgmPlayer";


function renderRichText(text) {
  const lines = String(text || '').split('\n');
  return lines.map((line, li) => {
    const parts = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0, m;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(<strong key={`b-${li}-${m.index}`}>{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    if (!parts.length) parts.push(line);
    return <span key={`line-${li}`}>{parts}{li < lines.length - 1 && <br />}</span>;
  });
}

function effectMessages(before, after, story) {
  const messages = [];
  const nameStat = id => story.stats?.find(x => x.id === id)?.name || id;
  const isAffectionStat = id => {
    const name = nameStat(id);
    return id === "stat_favor" || String(id).toLowerCase().includes("favor") || String(name).includes("호감");
  };
  const nameItem = id => story.items?.find(x => x.id === id)?.name || id;
  const nameFlag = id => story.flags?.find(x => x.id === id)?.name || id;
  const isHiddenFlag = id => !!story.flags?.find(x => x.id === id)?.hidden;
  const nameKeyword = id => story.keywords?.find(x => x.id === id)?.name || id;

  for (const [id, value] of Object.entries(after.stats || {})) {
    const delta = Number(value || 0) - Number(before.stats?.[id] || 0);
    if (!delta || isAffectionStat(id)) continue;
    messages.push(`[${nameStat(id)} ${delta > 0 ? "상승" : "감소"}!]`);
  }
  for (const id of after.inventory || []) if (!(before.inventory || []).includes(id)) messages.push(`[아이템: '${nameItem(id)}' 획득!]`);
  for (const id of before.inventory || []) if (!(after.inventory || []).includes(id)) messages.push(`[아이템: '${nameItem(id)}' 제거!]`);
  for (const id of after.keywords || []) if (!(before.keywords || []).includes(id)) messages.push(`[키워드: '${nameKeyword(id)}' 획득!]`);
  for (const id of before.keywords || []) if (!(after.keywords || []).includes(id)) messages.push(`[키워드: '${nameKeyword(id)}' 삭제!]`);
  for (const id of after.flags || []) if (!(before.flags || []).includes(id) && !isHiddenFlag(id)) messages.push(`[기록: '${nameFlag(id)}' 확인!]`);
  for (const id of before.flags || []) if (!(after.flags || []).includes(id) && !isHiddenFlag(id)) messages.push(`[기록: '${nameFlag(id)}' 해제!]`);
  const unlockedBefore = before.unlockedStats || [];
  for (const id of after.unlockedStats || []) if (!unlockedBefore.includes(id)) messages.push(`[새 스탯: '${nameStat(id)}' 해금!]`);
  return messages;
}

export default function PlayPage() {
  const [story, setStory] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [notice, setNotice] = useState([]);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookTab, setNotebookTab] = useState("keywords");
  const [processingChoice, setProcessingChoice] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const saved = loadPlayerState();
    if (!saved) { router.push("/"); return; }
    setPlayerState(saved);
    const id = saved.storyId || sessionStorage.getItem("play-story-id") || "";
    const local = typeof window !== "undefined" ? window.localStorage.getItem(`seoul-choice-story:${id}`) : null;
    if (local) { try { const raw=JSON.parse(local); const s={...raw,stats:(Array.isArray(raw.stats)&&raw.stats.length?raw.stats:[{id:"health",name:"체력",min:0,max:100,initialValue:70,isBase:true},{id:"mental",name:"멘탈",min:0,max:100,initialValue:60,isBase:true},{id:"money",name:"돈",min:0,max:999999,initialValue:500,isBase:true}])}; const normalized=normalizePlayerStateForStory(saved,s); savePlayerState(normalized); setPlayerState(normalized); setStory(s); return; } catch {} }
    fetch("/api/story?storyId=" + encodeURIComponent(id))
      .then(r => r.ok ? r.json() : null).then(raw => { if (raw) { const s={...raw,stats:(Array.isArray(raw.stats)&&raw.stats.length?raw.stats:[{id:"health",name:"체력",min:0,max:100,initialValue:70,isBase:true},{id:"mental",name:"멘탈",min:0,max:100,initialValue:60,isBase:true},{id:"money",name:"돈",min:0,max:999999,initialValue:500,isBase:true}])}; const normalized=normalizePlayerStateForStory(saved,s); savePlayerState(normalized); setPlayerState(normalized); setStory(s); } else setStory(null); }).catch(() => setStory(null));
  }, [router]);

  useEffect(() => {
    if (!story || !playerState?.currentNodeId) return;
    const resolved = resolveNodeRoute(story, playerState.currentNodeId, playerState);
    if (resolved && resolved !== playerState.currentNodeId) {
      const next = { ...playerState, currentNodeId: resolved };
      savePlayerState(next);
      setPlayerState(next);
    }
  }, [story, playerState?.currentNodeId]);

  useEffect(() => {
    if (!notice.length) return;
    const timer = setTimeout(() => setNotice([]), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!story || !playerState) return <p style={{ textAlign: "center", marginTop: 100 }}>불러오는 중...</p>;
  const node = story.nodes.find(n => n.id === playerState.currentNodeId);
  if (!node) return <main className="playMain"><p>스토리 노드를 찾을 수 없습니다: {playerState.currentNodeId}</p></main>;

  function handleChoice(c) {
    if (processingChoice) return;
    setProcessingChoice(true);
    const before = playerState;
    let next = applyEffects(c.effects, playerState, story.stats || []);
    next.history = [...(next.history || []), { nodeId: node.id, choiceId: c.id }];
    next.currentNodeId = resolveNodeRoute(story, c.nextNodeId, next);
    savePlayerState(next);
    setPlayerState(next);
    const messages = effectMessages(before, next, story);
    const newlyUnlocked = (story.factions || []).filter(f => {
      const was = checkCondition(f.unlockConditions || {}, before);
      const now = checkCondition(f.unlockConditions || {}, next);
      return !was && now;
    });
    for (const f of newlyUnlocked) messages.push(`[새 진영: '${f.name}' 해금!]`);
    if (messages.length) setNotice(messages);

    // 작가가 이 선택지에 "진영 선택 화면 열기" 효과를 넣었을 때만 진입한다.
    if (c.effects?.openFactionSelection) {
      sessionStorage.setItem('faction-selection-return', 'play');
      setTimeout(() => router.push('/faction'), 250);
    } else {
      setProcessingChoice(false);
    }
  }

  const keywords = story.keywords || [];
  const discovered = (playerState.keywords || []).map(id => keywords.find(k => k.id === id) || { id, name: id, description: "" });

  return <main className="playMain">
    {node.bgm?.youtubeUrl && <BgmPlayer url={node.bgm.youtubeUrl} nodeId={node.id} />}

    {notice.length > 0 && <div className="effectNotice" aria-live="polite">{notice.map((m, i) => <div key={`${m}-${i}`}>{m}</div>)}</div>}

    <section className="playSection">
      <div className="playStatus">
        {(story.stats || []).filter(stat => playerState.stats?.[stat.id] !== undefined).map(stat => <span key={stat.id}>{stat.name || stat.id} <b>{playerState.stats?.[stat.id]}</b></span>)}
      </div>

      <div className="notebookBar">
        <div style={{display:'flex',gap:8}}>
          <button className="notebookButton" onClick={() => {setNotebookTab("keywords");setNotebookOpen(true)}}>📖 조사 노트 <b>{discovered.length}</b></button><button className="notebookButton" onClick={() => {setNotebookTab("items");setNotebookOpen(true)}}>🎒 소지품 <b>{playerState.inventory.length}</b></button><button className="notebookButton" onClick={() => {setNotebookTab("flags");setNotebookOpen(true)}}>⚑ 활성 플래그 <b>{(playerState.flags||[]).filter(id => !story.flags?.find(f => f.id === id)?.hidden).length}</b></button>

        </div>
      </div>

      <p className="storyText">{renderRichText(interpolateText(resolveNodeText(node, playerState), playerState))}</p>
    </section>

    <section className="choiceList">
      {node.choices.length === 0 && <p style={{ color: "#999", fontSize: 13 }}>이후 이야기는 아직 준비 중입니다.</p>}
      {node.choices.map(c => {
        const available = checkCondition(c.conditions, playerState);
        return <button className={'choiceButton ' + (!available ? 'locked' : '')} key={c.id} disabled={!available || processingChoice} onClick={() => handleChoice(c)}>{c.text}</button>;
      })}
    </section>

    {notebookOpen && <div className="notebookOverlay" onClick={() => setNotebookOpen(false)}>
      <div className="notebookPanel" onClick={e => e.stopPropagation()}>
        <div className="notebookHeader"><div><strong>{notebookTab === "keywords" ? "조사 노트" : notebookTab === "items" ? "소지품" : "활성 플래그"}</strong></div><button onClick={() => setNotebookOpen(false)}>닫기</button></div>
        <div className="notebookTabs"><button className={notebookTab === "keywords" ? "active" : ""} onClick={() => setNotebookTab("keywords")}>🔎 조사 노트 {discovered.length}</button><button className={notebookTab === "items" ? "active" : ""} onClick={() => setNotebookTab("items")}>🎒 소지품 {playerState.inventory.length}</button><button className={notebookTab === "flags" ? "active" : ""} onClick={() => setNotebookTab("flags")}>⚑ 플래그 {(playerState.flags||[]).filter(id => !story.flags?.find(f => f.id === id)?.hidden).length}</button></div>
        {notebookTab === "keywords" && <>{!discovered.length && <div className="notebookEmpty">아직 기록된 키워드가 없습니다.</div>}<div className="notebookList">{discovered.map(k => <article className="notebookEntry" key={k.id}><h3>{k.name}</h3>{k.description?.trim() ? <p>{k.description}</p> : null}</article>)}</div></>}
        {notebookTab === "items" && <div className="notebookList">{!playerState.inventory.length && <div className="notebookEmpty">소지한 아이템이 없습니다.</div>}{playerState.inventory.map(id => {const item=story.items.find(i=>i.id===id); return <article className="notebookEntry" key={id}><h3>{item?.name || id}</h3>{item?.description?.trim() ? <p>{item.description}</p> : null}</article>})}</div>}
        {notebookTab === "flags" && <div className="notebookList">{!(playerState.flags||[]).some(id => !story.flags?.find(f => f.id === id)?.hidden) && <div className="notebookEmpty">활성화된 플래그가 없습니다.</div>}{(playerState.flags||[]).filter(id => !story.flags?.find(f => f.id === id)?.hidden).map(id => {const flag=story.flags?.find(f=>f.id===id); return <article className="notebookEntry" key={id}><h3>⚑ {flag?.name || id}</h3>{flag?.description?.trim() ? <p>{flag.description}</p> : null}</article>})}</div>}
      </div>
    </div>}
  </main>;
}
