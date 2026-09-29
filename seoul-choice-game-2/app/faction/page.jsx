"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkCondition, createInitialState } from "@/lib/gameEngine";
import { loadPlayerState, savePlayerState } from "@/lib/playerState";

function loadStory(id) {
  const local = typeof window !== "undefined" ? window.localStorage.getItem(`seoul-choice-story:${id}`) : null;
  if (local) { try { return Promise.resolve(JSON.parse(local)); } catch {} }
  return fetch('/api/story?storyId=' + encodeURIComponent(id || ''))
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
}

function unlockSummary(f, story) {
  const flags = (f.unlockConditions?.requiredFlags || []).map(id => story.flags?.find(x => x.id === id)?.name || id);
  const keywords = (f.unlockConditions?.requiredKeywords || []).map(id => story.keywords?.find(x => x.id === id)?.name || id);
  return [...flags.map(x => `플래그: ${x}`), ...keywords.map(x => `키워드: ${x}`)];
}

export default function FactionPage() {
  const [story, setStory] = useState(null);
  const [player, setPlayer] = useState(null);
  const [revisit, setRevisit] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const isNewGame = sessionStorage.getItem('new-game') === '1';
    const saved = isNewGame ? null : loadPlayerState();
    const name = sessionStorage.getItem('draft-player-name');
    const id = saved?.storyId || sessionStorage.getItem('play-story-id');
    if (!id || (!name && !saved)) { router.push('/'); return; }
    setPlayer(saved || null);
    setRevisit(!isNewGame && !!saved?.storyId);
    loadStory(id).then(setStory);
  }, [router]);

  function choose(f) {
    if (!story) return;
    if (revisit && player) {
      const next = { ...player, storyId: story.id, faction: f.id, currentNodeId: f.startNodeId || player.currentNodeId };
      savePlayerState(next);
    } else {
      const name = sessionStorage.getItem('draft-player-name') || '플레이어';
      savePlayerState({ ...createInitialState(name, f, story.npcs, story.stats || []), storyId: story.id });
    }
    sessionStorage.removeItem('new-game');
    sessionStorage.removeItem('draft-player-name');
    sessionStorage.setItem('play-story-id', story.id);
    router.push('/play');
  }

  if (!story) return <p style={{ textAlign: 'center', marginTop: 100 }}>불러오는 중...</p>;
  const currentState = revisit && player ? player : { flags: [], keywords: [], stats: {}, inventory: [], abilities: [], affection: {}, faction: null };
  const unlocked = (story.factions || []).filter(f => checkCondition(f.unlockConditions || {}, currentState));
  const locked = (story.factions || []).filter(f => !checkCondition(f.unlockConditions || {}, currentState));

  return <main className="playMain" style={{ paddingTop: 60 }}>
    <h1 style={{ fontSize: 20, marginBottom: 8, textAlign: 'center' }}>
      {story.name}<br />
      <small style={{ fontSize: 13, fontWeight: 400, color: '#777' }}>{revisit ? '진영을 선택하세요' : '진영을 선택하세요'}</small>
    </h1>
    {revisit && <p style={{ textAlign: 'center', fontSize: 12, color: '#888', marginBottom: 24 }}>해금된 진영으로 전환하면 해당 진영의 시작 지점에서 새로운 루트가 시작됩니다.</p>}
    <div style={{ display: 'grid', gap: 14 }}>
      {unlocked.map(f => {
        const current = revisit && player?.faction === f.id;
        return <button key={f.id} disabled={current} onClick={() => choose(f)} style={{ padding: 17, textAlign: 'left', opacity: current ? .65 : 1 }}>
          <strong>{f.name} {current ? '· 현재 진영' : ''}</strong>
          <p style={{ fontSize: 13, margin: '7px 0 0', opacity: .7 }}>{f.description}</p>
          {!current && revisit && <small style={{ display: 'block', marginTop: 8, color: '#666' }}>이 진영으로 전환 → {f.startNodeId}</small>}
        </button>;
      })}
      {!unlocked.length && <div style={{ padding: 20, border: '1px solid #eee', borderRadius: 12, color: '#888', fontSize: 13 }}>현재 선택할 수 있는 진영이 없습니다.</div>}
    </div>
    {locked.length > 0 && <section style={{ marginTop: 24, padding: 14, border: '1px solid #eee', borderRadius: 12, background: '#fafafa' }}>
      <strong style={{ fontSize: 13 }}>아직 해금되지 않은 진영</strong>
      {locked.map(f => <div key={f.id} style={{ marginTop: 9, fontSize: 12, color: '#999' }}><b>{f.name}</b> · {(unlockSummary(f, story).join(', ') || '조건 미설정')}</div>)}
    </section>}
  </main>;
}
