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
  const [itemBusy, setItemBusy] = useState(false);
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

  function applyItemUse(itemId) {
    if (itemBusy) return;
    const item = (story.items || []).find(i => i.id === itemId);
    if (!item || !(playerState.inventory || []).includes(itemId)) return;

    if (itemId === "item_oxygen") {
      const oxygen = Number(playerState.stats?.stat_oxygen);
      if (!Number.isFinite(oxygen)) {
        setNotice(["[산소 스탯이 아직 활성화되지 않았습니다.]"]);
        return;
      }
      if (oxygen >= 100) {
        setNotice(["[산소가 이미 충분합니다.]"]);
        return;
      }
      setItemBusy(true);
      const before = playerState;
      const next = applyEffects(
        { stats: { stat_oxygen: 25 }, removeItems: ["item_oxygen"] },
        playerState,
        story.stats || []
      );
      savePlayerState(next);
      setPlayerState(next);
      const messages = effectMessages(before, next, story);
      messages.unshift("[휴대 산소 캐니스터를 사용했습니다. 산소 +25]");
      setNotice(messages);
      setItemBusy(false);
    }
  }

  function getStat(id) {
    const value = Number(playerState.stats?.[id]);
    return Number.isFinite(value) ? value : null;
  }

  function statDeviceClass(id) {
    const value = getStat(id);
    if (value === null) return "";
    if (id === "stat_oxygen") {
      if (value <= 10) return "critical";
      if (value <= 20) return "warning";
    }
    if (id === "health" || id === "mental") {
      if (value <= 10) return "critical";
      if (value <= 25) return "warning";
    }
    if (id === "money") {
      if (value <= 0) return "critical";
      if (value <= 20) return "warning";
    }
    return "";
  }

  function handleChoice(c) {
    if (processingChoice) return;
    setProcessingChoice(true);
    const before = playerState;
    let next = applyEffects(c.effects, playerState, story.stats || []);
    next.history = [...(next.history || []), { nodeId: node.id, choiceId: c.id }];

    // 산소가 활성화된 상태에서 0이 되면 다음 장면으로 진행하지 않고 즉시 산소 고갈 엔딩으로 전환한다.
    const nextOxygen = Number(next.stats?.stat_oxygen);
    if (Number.isFinite(nextOxygen) && nextOxygen <= 0 && story.nodes.some(n => n.id === "node_oxygen_death")) {
      next.stats = { ...(next.stats || {}), stat_oxygen: 0 };
      next.currentNodeId = "node_oxygen_death";
    } else {
      next.currentNodeId = resolveNodeRoute(story, c.nextNodeId, next);
    }
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
      <div className="playStatus" aria-label="현재 상태">
        {(story.stats || [])
          .filter(stat => playerState.stats?.[stat.id] !== undefined)
          .map(stat => {
            const value = Number(playerState.stats?.[stat.id]);
            const max = Number(stat.max || 100);
            const ratio = Math.max(0, Math.min(1, value / max));
            const cls = statDeviceClass(stat.id);
            return <div className={`statDevice ${cls}`} key={stat.id}>
              <div className="statDeviceHead">
                <span>{stat.name || stat.id}</span>
                <b>{value}</b>
              </div>
              <div className="statTrack"><i style={{ width: `${ratio * 100}%` }} /></div>
            </div>;
          })}
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
        {notebookTab === "items" && <div className="notebookList">{!playerState.inventory.length && <div className="notebookEmpty">소지한 아이템이 없습니다.</div>}{playerState.inventory.map(id => {
          const item=story.items.find(i=>i.id===id);
          const oxygen=Number(playerState.stats?.stat_oxygen);
          const canUseOxygen=id==="item_oxygen" && Number.isFinite(oxygen) && oxygen < 100;
          return <article className="notebookEntry" key={id}>
            <div className="notebookEntryHead"><h3>{item?.name || id}</h3>{id==="item_oxygen" && <button className="itemUseButton" disabled={!canUseOxygen || itemBusy} onClick={() => applyItemUse(id)}>사용</button>}</div>
            {item?.description?.trim() ? <p>{item.description}</p> : null}
            {id==="item_radio" && <div className="itemMeta">배터리 {getStat("money") ?? 0}/100 · 무전 선택지에서 자동 사용</div>}
            {id==="item_oxygen" && <div className="itemMeta">현재 산소 {Number.isFinite(oxygen) ? oxygen : "—"}/100</div>}
          </article>;
        })}</div>}
        {notebookTab === "flags" && <div className="notebookList">{!(playerState.flags||[]).some(id => !story.flags?.find(f => f.id === id)?.hidden) && <div className="notebookEmpty">활성화된 플래그가 없습니다.</div>}{(playerState.flags||[]).filter(id => !story.flags?.find(f => f.id === id)?.hidden).map(id => {const flag=story.flags?.find(f=>f.id===id); return <article className="notebookEntry" key={id}><h3>⚑ {flag?.name || id}</h3>{flag?.description?.trim() ? <p>{flag.description}</p> : null}</article>})}</div>}
      </div>
    </div>}

    <style jsx global>{`
      .playMain {
        width: 100%;
        box-sizing: border-box;
        padding: 18px 14px 48px;
        min-height: 100dvh;
      }
      .playSection, .choiceList {
        width: min(100%, 760px);
        margin-left: auto;
        margin-right: auto;
      }
      .playStatus {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }
      .statDevice {
        min-width: 0;
        padding: 9px 11px;
        border: 1px solid #e5e5e5;
        border-radius: 12px;
        background: #fff;
        box-sizing: border-box;
      }
      .statDeviceHead {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        line-height: 1.3;
      }
      .statTrack {
        height: 6px;
        margin-top: 7px;
        overflow: hidden;
        border-radius: 999px;
        background: #eee;
      }
      .statTrack i {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: #555;
      }
      .statDevice.warning {
        border-color: #d8c99d;
      }
      .statDevice.critical {
        border-color: #c99;
      }
      .notebookBar {
        margin: 14px 0 18px;
      }
      .notebookBar > div {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px !important;
      }
      .notebookButton {
        min-height: 48px;
        padding: 10px 8px;
        border: 1px solid #ddd;
        border-radius: 12px;
        background: #fff;
        line-height: 1.25;
        word-break: keep-all;
      }
      .storyText {
        margin: 0;
        padding: 20px 18px;
        border: 1px solid #ececec;
        border-radius: 14px;
        background: #fff;
        font-size: 15px;
        line-height: 1.9;
        letter-spacing: -0.01em;
        overflow-wrap: anywhere;
      }
      .choiceList {
        display: grid;
        gap: 12px;
        margin-top: 18px;
      }
      .choiceButton {
        width: 100%;
        min-height: 56px;
        padding: 14px 16px;
        border: 1px solid #dcdcdc;
        border-radius: 14px;
        background: #fff;
        text-align: left;
        font-size: 15px;
        line-height: 1.55;
        white-space: normal;
        word-break: keep-all;
        touch-action: manipulation;
      }
      .choiceButton.locked {
        opacity: .48;
      }
      .effectNotice {
        position: fixed;
        left: 50%;
        bottom: max(18px, env(safe-area-inset-bottom));
        z-index: 50;
        width: min(calc(100% - 28px), 620px);
        transform: translateX(-50%);
        padding: 12px 14px;
        border: 1px solid #ddd;
        border-radius: 12px;
        background: rgba(255,255,255,.96);
        box-shadow: 0 8px 30px rgba(0,0,0,.12);
        font-size: 13px;
        line-height: 1.55;
        box-sizing: border-box;
      }
      .notebookOverlay {
        padding: 14px;
        box-sizing: border-box;
      }
      .notebookPanel {
        width: min(100%, 720px);
        max-height: min(82dvh, 760px);
        overflow: auto;
        padding: 16px;
        box-sizing: border-box;
        border-radius: 16px;
      }
      .notebookTabs {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin: 12px 0 14px;
      }
      .notebookTabs button, .notebookHeader button {
        min-height: 44px;
      }
      .notebookEntry {
        padding: 15px 14px;
        margin-bottom: 10px;
        border-radius: 12px;
      }
      .notebookEntryHead {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .notebookEntryHead h3 {
        margin: 0;
      }
      .itemUseButton {
        min-width: 64px;
        min-height: 44px;
        padding: 8px 12px;
        border: 1px solid #ccc;
        border-radius: 10px;
        background: #fff;
      }
      .itemMeta {
        margin-top: 8px;
        color: #777;
        font-size: 12px;
      }
      @media (max-width: 560px) {
        .playMain {
          padding: 12px 10px 40px;
        }
        .playStatus {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 7px;
        }
        .statDevice {
          padding: 8px 9px;
        }
        .storyText {
          padding: 18px 15px;
          font-size: 15px;
          line-height: 1.95;
        }
        .choiceButton {
          min-height: 60px;
          padding: 15px 14px;
          font-size: 15px;
        }
        .notebookButton {
          min-height: 52px;
          font-size: 12px;
        }
      }
    `}</style>  </main>;
}
