"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CodeGate from "@/components/CodeGate";
import { checkCondition, computeStateAtNode, conditionSummary, findPathToNode, resolveNodeText } from "@/lib/gameEngine";
import { loadPlayerState } from "@/lib/playerState";

const LOCAL_BOOK_KEY = "seoul-choice-editor-book";
const card = { border:"1px solid #e2e2e2", borderRadius:12, padding:16, background:"#fff" };
const label = { display:"block", fontSize:12, color:"#666", marginBottom:6, fontWeight:600 };
const input = { width:"100%" };

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function normalizeBook(raw){ return raw?.stories ? raw : {stories:[{id:'story_local',name:raw?.name||'로컬 스토리',description:raw?.description||'',accessCodes:raw?.accessCodes||[],...raw}],activeStoryId:'story_local'}; }
function parseObject(v, fallback={}){ try { const x=JSON.parse(v); return x && typeof x === "object" ? x : fallback; } catch { return fallback; } }
function downloadJson(filename, data){ const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }
function idName(list,id){ return list?.find(x=>x.id===id)?.name || id; }
function wrapSelection(textarea, before="**", after="**") {
  if (!textarea) return null;
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  const selected = textarea.value.slice(start, end);
  if (!selected) return { value: textarea.value, start, end };
  return { value: textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end), start: start + before.length, end: end + before.length + selected.length };
}

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

function normalizeStory(raw){
  const s=clone(raw||{});
  const baseStats=[{id:"health",name:"체력",description:"",min:0,max:100,initialValue:70,isBase:true},{id:"mental",name:"멘탈",description:"",min:0,max:100,initialValue:60,isBase:true},{id:"money",name:"돈",description:"",min:0,max:999999,initialValue:500,isBase:true}];
  s.stats=(Array.isArray(s.stats)&&s.stats.length?s.stats:baseStats).map((x,i)=>({...x,isBase:x.isBase??(i<3&&["health","mental","money"].includes(x.id)),initialValue:x.initialValue??x.min??0,unlockConditions:{requiredFlags:[...(x.unlockConditions?.requiredFlags||[])],requiredKeywords:[...(x.unlockConditions?.requiredKeywords||[])],requiredFaction:[...(x.unlockConditions?.requiredFaction||[])]}}));
  s.flags=Array.isArray(s.flags)?s.flags:[];
  s.keywords=Array.isArray(s.keywords)?s.keywords:[];
  s.factions=(s.factions||[]).map(f=>({...f,startingStats:{...(f.startingStats||{})},unlockConditions:{requiredFlags:[...(f.unlockConditions?.requiredFlags||[])],requiredKeywords:[...(f.unlockConditions?.requiredKeywords||[])]}}));
  s.npcs=s.npcs||[]; s.items=s.items||[]; s.abilities=s.abilities||[]; s.nodes=s.nodes||[]; s.accessCodes=s.accessCodes||[];
  return s;
}

function StoryManager({stories,story,setStories,setStoryId,setStory,refreshStories,setMsg}){
  function patch(patch){ setStory(s=>({...s,...patch})); }
  async function addStory(){
    const id=`story_${Date.now()}`;
    const firstNode={id:"node_001",text:"새 스토리의 시작입니다.",bgm:{youtubeUrl:""},choices:[],position:{x:100,y:80}};
    const firstFaction={id:"faction_001",name:"기본 진영",description:"플레이어가 선택할 기본 진영입니다.",startNodeId:"node_001",startingStats:{health:70,mental:60,money:500},startingItems:[],startingAffection:{},npcIds:[],unlockConditions:{requiredFlags:[],requiredKeywords:[]}};
    const s={id,name:"새 스토리",description:"",accessCodes:[],stats:[{id:"health",name:"체력",description:"",min:0,max:100,initialValue:70,isBase:true},{id:"mental",name:"멘탈",description:"",min:0,max:100,initialValue:60,isBase:true},{id:"money",name:"돈",description:"",min:0,max:999999,initialValue:500,isBase:true}],flags:[],factions:[firstFaction],npcs:[],items:[],abilities:[],nodes:[firstNode]};
    try {
      const r=await fetch('/api/story',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});
      if(!r.ok) throw Error();
      setMsg?.("새 스토리를 만들고 저장했습니다. 접근 코드를 설정한 뒤 '플레이 반영 저장'을 눌러주세요.");
    } catch {
      setMsg?.("새 스토리를 로컬에서 만들었습니다. 서버 저장은 나중에 다시 시도할 수 있습니다.");
    }
    setStory(s); setStoryId(id); setStories(prev=>[...prev,{id,name:s.name,description:s.description,accessCodes:s.accessCodes}]);
    window.localStorage.setItem(`seoul-choice-story:${id}`,JSON.stringify(s));
  }
  async function remove(){
    if(stories.length<=1){ alert("스토리는 최소 1개가 필요합니다."); return; }
    if(!confirm(`'${story.name}' 스토리를 삭제할까요?`)) return;
    try { await fetch(`/api/story?storyId=${encodeURIComponent(story.id)}`,{method:'DELETE'}); } catch {}
    window.localStorage.removeItem(`seoul-choice-story:${story.id}`);
    const nextStories=stories.filter(x=>x.id!==story.id);
    setStories(nextStories);
    window.localStorage.setItem("seoul-choice-editor-stories",JSON.stringify(nextStories));
    refreshStories(nextStories[0]?.id);
  }
  if(!story)return null;
  return <section style={{...card,marginBottom:16}}>
    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <select value={story.id} onChange={e=>setStoryId(e.target.value)} style={{minWidth:190}}>{stories.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <button onClick={addStory}>+ 스토리</button><button onClick={remove} disabled={stories.length<=1}>스토리 삭제</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:12}}>
      <div><label style={label}>스토리 이름</label><input style={input} value={story.name||""} onChange={e=>patch({name:e.target.value})}/></div>
      <div><label style={label}>접근 코드 (쉼표로 여러 개)</label><input style={input} value={(story.accessCodes||[]).join(", ")} onChange={e=>patch({accessCodes:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})}/></div>
    </div>
    <div style={{marginTop:10}}><label style={label}>설명</label><textarea rows={2} style={input} value={story.description||""} onChange={e=>patch({description:e.target.value})}/></div>
  </section>;
}

function ConditionEffectForm({choice,story,onChange}){
  const [open,setOpen]=useState(false);
  const [cond,setCond]=useState(choice.conditions||{}); const [eff,setEff]=useState(choice.effects||{});
  useEffect(()=>{setCond(choice.conditions||{});setEff(choice.effects||{})},[choice.id]);
  function commitC(next){setCond(next);onChange({conditions:next})} function commitE(next){setEff(next);onChange({effects:next})}
  const stats=story.stats||[];
  const toggleArray=(obj,key,id,on)=>{const a=[...(obj[key]||[])]; const n=on?(a.includes(id)?a:[...a,id]):a.filter(x=>x!==id); commitC({...obj,[key]:n})};
  const toggleEffect=(obj,key,id,on)=>{const a=[...(obj[key]||[])]; const n=on?(a.includes(id)?a:[...a,id]):a.filter(x=>x!==id); commitE({...obj,[key]:n})};
  function patchRandomRule(index, patch){
    const rules=[...(eff.randomEffects||[])];
    rules[index]={...(rules[index]||{}),...patch};
    commitE({...eff,randomEffects:rules});
  }
  function toggleRandomArray(index,key,id,on){
    const rule=eff.randomEffects?.[index]||{};
    const a=[...(rule[key]||[])];
    const next=on?(a.includes(id)?a:[...a,id]):a.filter(x=>x!==id);
    patchRandomRule(index,{[key]:next});
  }
  function setRandomStat(index,id,value){
    const rule=eff.randomEffects?.[index]||{};
    const stats={...(rule.stats||{})};
    if(Number(value)===0) delete stats[id]; else stats[id]=Number(value);
    patchRandomRule(index,{stats});
  }
  function addRandomRule(){
    commitE({...eff,randomEffects:[...(eff.randomEffects||[]),{chance:50,addFlags:[],removeFlags:[],unlockStats:[],stats:{}}]});
  }
  function addRandomTable(){
    const table={id:`table_${Date.now()}`,name:`확률 테이블 ${(eff.randomTables||[]).length+1}`,outcomes:[]};
    commitE({...eff,randomTables:[...(eff.randomTables||[]),table]});
  }
  function patchRandomTable(index,patch){
    const tables=[...(eff.randomTables||[])]; tables[index]={...(tables[index]||{}),...patch};
    commitE({...eff,randomTables:tables});
  }
  function addTableOutcome(tableIndex){
    const tables=clone(eff.randomTables||[]);
    const table=tables[tableIndex]||{};
    table.outcomes=[...(table.outcomes||[]),{id:`outcome_${Date.now()}`,name:`결과 ${(table.outcomes||[]).length+1}`,chance:0,effects:{}}];
    tables[tableIndex]=table; commitE({...eff,randomTables:tables});
  }
  function patchTableOutcome(tableIndex,outcomeIndex,patch){
    const tables=clone(eff.randomTables||[]); const table=tables[tableIndex]||{}; const outcomes=[...(table.outcomes||[])];
    outcomes[outcomeIndex]={...(outcomes[outcomeIndex]||{}),...patch}; table.outcomes=outcomes; tables[tableIndex]=table; commitE({...eff,randomTables:tables});
  }
  function toggleTableOutcomeArray(tableIndex,outcomeIndex,key,id,on){
    const table=eff.randomTables?.[tableIndex]||{}; const outcome=table.outcomes?.[outcomeIndex]||{}; const e=outcome.effects||{}; const a=[...(e[key]||[])];
    const next=on?(a.includes(id)?a:[...a,id]):a.filter(x=>x!==id); patchTableOutcome(tableIndex,outcomeIndex,{effects:{...e,[key]:next}});
  }
  function setTableOutcomeStat(tableIndex,outcomeIndex,id,value){
    const table=eff.randomTables?.[tableIndex]||{}; const outcome=table.outcomes?.[outcomeIndex]||{}; const stats={...(outcome.effects?.stats||{})};
    if(Number(value)===0) delete stats[id]; else stats[id]=Number(value); patchTableOutcome(tableIndex,outcomeIndex,{effects:{...(outcome.effects||{}),stats}});
  }
  return <div style={{marginTop:10}}>
    <button type="button" onClick={()=>setOpen(v=>!v)} style={{fontSize:12}}>{open?"▲ 조건/효과 접기":"▼ 조건/효과 폼 편집"}</button>
    {open&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:10}}>
      <div style={{...card,padding:12,background:"#fafafa"}}><strong style={{fontSize:13}}>조건</strong>
        {stats.map(stat=><div key={stat.id} style={{display:"flex",gap:6,alignItems:"center",marginTop:8}}><span style={{width:90,fontSize:12}}>{stat.name||stat.id}</span><select value={cond.minStats?.[stat.id]!==undefined?">=":""} onChange={e=>{const m={...(cond.minStats||{})}; if(e.target.value)m[stat.id]=Number(m[stat.id]??0);else delete m[stat.id];commitC({...cond,minStats:m})}}><option value="">조건 없음</option><option value=">=">이상</option></select>{cond.minStats?.[stat.id]!==undefined&&<input type="number" value={cond.minStats[stat.id]} onChange={e=>commitC({...cond,minStats:{...(cond.minStats||{}),[stat.id]:Number(e.target.value)}})} style={{width:75}}/>}</div>)}
        <div style={{marginTop:10}}><label style={label}>필수 아이템</label>{story.items.map(it=><label key={it.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(cond.requiredItems||[]).includes(it.id)} onChange={e=>toggleArray(cond,"requiredItems",it.id,e.target.checked)}/> {it.name}</label>)}</div>
        <div style={{marginTop:10}}><label style={label}>필수 플래그</label><input style={input} placeholder="flag_a, flag_b" value={(cond.requiredFlags||[]).join(", ")} onChange={e=>commitC({...cond,requiredFlags:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})}/></div><div style={{marginTop:10}}><label style={label}>필수 키워드</label>{(story.keywords||[]).map(k=><label key={k.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(cond.requiredKeywords||[]).includes(k.id)} onChange={e=>toggleArray(cond,"requiredKeywords",k.id,e.target.checked)}/> {k.name||k.id}</label>)}{!(story.keywords||[]).length&&<div style={{fontSize:12,color:"#888"}}>설정 탭에서 키워드를 먼저 추가하세요.</div>}</div>
        <div style={{marginTop:10}}><label style={label}>필수 능력</label>{story.abilities.map(it=><label key={it.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(cond.requiredAbilities||[]).includes(it.id)} onChange={e=>toggleArray(cond,"requiredAbilities",it.id,e.target.checked)}/> {it.name}</label>)}</div>
        <div style={{marginTop:10}}><label style={label}>필수 진영</label>{story.factions.map(f=><label key={f.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(cond.requiredFaction||[]).includes(f.id)} onChange={e=>toggleArray(cond,"requiredFaction",f.id,e.target.checked)}/> {f.name}</label>)}</div>
        <div style={{marginTop:10}}><label style={label}>이전에 고른 선택지 (모두 필요)</label>{story.nodes.flatMap(n=>(n.choices||[]).map(c=>({id:c.id,label:`${n.id} · ${c.text||c.id}`}))).map(c=><label key={c.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(cond.requiredChoices||[]).includes(c.id)} onChange={e=>toggleArray(cond,"requiredChoices",c.id,e.target.checked)}/> {c.label}</label>)}</div>
        <div style={{marginTop:10}}><label style={label}>이전에 고른 적이 없어야 하는 선택지</label>{story.nodes.flatMap(n=>(n.choices||[]).map(c=>({id:c.id,label:`${n.id} · ${c.text||c.id}`}))).map(c=><label key={c.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(cond.excludedChoices||[]).includes(c.id)} onChange={e=>toggleArray(cond,"excludedChoices",c.id,e.target.checked)}/> {c.label}</label>)}</div>
      </div>
      <div style={{...card,padding:12,background:"#fafafa"}}><strong style={{fontSize:13}}>효과</strong>
        <label style={{...label,marginTop:10}}>스탯 해금</label>{stats.filter(stat=>!stat.isBase).map(stat=><label key={stat.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(eff.unlockStats||[]).includes(stat.id)} onChange={e=>toggleEffect(eff,"unlockStats",stat.id,e.target.checked)}/> {stat.name||stat.id}</label>)}{!stats.some(stat=>!stat.isBase)&&<div style={{fontSize:12,color:"#888"}}>커스텀 스탯을 먼저 추가하세요.</div>}<label style={{...label,marginTop:10}}>스탯 변화</label>{stats.map(stat=><div key={stat.id} style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}><span style={{width:90,fontSize:12}}>{stat.name||stat.id}</span><input type="number" value={eff.stats?.[stat.id]??0} onChange={e=>commitE({...eff,stats:{...(eff.stats||{}),[stat.id]:Number(e.target.value)}})} style={{width:85}} placeholder="변화량"/></div>)}
        <label style={{...label,marginTop:10}}>아이템 획득/제거</label>{story.items.map(it=><div key={it.id} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5,fontSize:12}}><span style={{flex:1}}>{it.name}</span><button type="button" onClick={()=>toggleEffect(eff,"addItems",it.id,true)} disabled={(eff.addItems||[]).includes(it.id)}>+ 획득</button><button type="button" onClick={()=>toggleEffect(eff,"removeItems",it.id,true)} disabled={(eff.removeItems||[]).includes(it.id)}>− 제거</button></div>)}
        <label style={{...label,marginTop:10}}>NPC 호감도 변화</label>{story.npcs.map(n=><div key={n.id} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5}}><span style={{flex:1,fontSize:12}}>{n.name}</span><input type="number" value={eff.affection?.[n.id]??0} onChange={e=>commitE({...eff,affection:{...(eff.affection||{}),[n.id]:Number(e.target.value)}})} style={{width:75}}/></div>)}
        <div style={{marginTop:14,padding:10,border:'1px solid #e5e5e5',borderRadius:10,background:'#f5f8ff'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
            <strong style={{fontSize:13}}>🎲 랜덤 효과</strong>
            <button type="button" onClick={addRandomRule}>+ 랜덤 효과 추가</button>
          </div>
          <div style={{fontSize:11,color:'#777',margin:'5px 0 8px'}}>선택지를 누르는 순간 각 규칙의 확률을 한 번 굴립니다. 여러 규칙을 넣으면 각각 독립적으로 판정됩니다.</div>
          {(eff.randomEffects||[]).map((rule,index)=><div key={index} style={{border:'1px solid #ddd',borderRadius:9,padding:9,marginTop:8,background:'#fff'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <b style={{fontSize:12}}>랜덤 효과 {index+1}</b>
              <label style={{fontSize:12}}>확률 <input type="number" min="0" max="100" value={rule.chance??50} onChange={e=>patchRandomRule(index,{chance:Math.max(0,Math.min(100,Number(e.target.value)))})} style={{width:65}}/> %</label>
              <button type="button" onClick={()=>commitE({...eff,randomEffects:(eff.randomEffects||[]).filter((_,i)=>i!==index)})}>삭제</button>
            </div>
            <div style={{fontSize:11,fontWeight:700,marginTop:8}}>플래그 획득</div>
            {(story.flags||[]).map(flag=><label key={flag.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:4}}><input type="checkbox" checked={(rule.addFlags||[]).includes(flag.id)} onChange={e=>toggleRandomArray(index,'addFlags',flag.id,e.target.checked)}/> {flag.name||flag.id}</label>)}
            <div style={{fontSize:11,fontWeight:700,marginTop:7}}>플래그 제거</div>
            {(story.flags||[]).map(flag=><label key={flag.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:4}}><input type="checkbox" checked={(rule.removeFlags||[]).includes(flag.id)} onChange={e=>toggleRandomArray(index,'removeFlags',flag.id,e.target.checked)}/> {flag.name||flag.id}</label>)}
            <div style={{fontSize:11,fontWeight:700,marginTop:7}}>스탯 변화</div>
            {stats.map(stat=><label key={stat.id} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,margin:'4px 10px 0 0'}}><span>{stat.name||stat.id}</span><input type="number" value={rule.stats?.[stat.id]??0} onChange={e=>setRandomStat(index,stat.id,e.target.value)} style={{width:65}} placeholder="±0"/></label>)}
            <div style={{fontSize:11,fontWeight:700,marginTop:7}}>스탯 해금</div>
            {stats.filter(stat=>!stat.isBase).map(stat=><label key={stat.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:4}}><input type="checkbox" checked={(rule.unlockStats||[]).includes(stat.id)} onChange={e=>toggleRandomArray(index,'unlockStats',stat.id,e.target.checked)}/> {stat.name||stat.id}</label>)}
          </div>)}
          {!(eff.randomEffects||[]).length&&<div style={{fontSize:11,color:'#999'}}>등록된 랜덤 효과가 없습니다.</div>}
        </div>

        <div style={{marginTop:14,padding:10,border:'1px solid #e5e5e5',borderRadius:10,background:'#f3fff7'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
            <strong style={{fontSize:13}}>🎰 확률 테이블</strong>
            <button type="button" onClick={addRandomTable}>+ 확률 테이블 추가</button>
          </div>
          <div style={{fontSize:11,color:'#777',margin:'5px 0 8px'}}>테이블 하나당 결과는 최대 1개만 선택됩니다. 각 결과의 확률은 0~100%로 직접 입력하고, 합계가 100%보다 작으면 남은 확률은 '아무 결과 없음'으로 처리됩니다.</div>
          {(eff.randomTables||[]).map((table,tIndex)=>{
            const total=(table.outcomes||[]).reduce((sum,o)=>sum+Number(o.chance||0),0);
            const over=total>100;
            return <div key={table.id||tIndex} style={{border:'1px solid #ddd',borderRadius:9,padding:9,marginTop:8,background:'#fff'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <input value={table.name||''} onChange={e=>patchRandomTable(tIndex,{name:e.target.value})} style={{flex:1}} placeholder="테이블 이름"/>
                <b style={{fontSize:11,color:over?'#c00':total===100?'#16803c':'#777'}}>합계 {total}%</b>
                <button type="button" onClick={()=>commitE({...eff,randomTables:(eff.randomTables||[]).filter((_,i)=>i!==tIndex)})}>삭제</button>
              </div>
              {over&&<div style={{fontSize:11,color:'#c00',marginTop:5}}>⚠ 확률 합계가 100%를 초과했습니다. 100% 이하로 맞춰주세요.</div>}
              {(table.outcomes||[]).map((outcome,oIndex)=>{
                const oe=outcome.effects||{};
                return <div key={outcome.id||oIndex} style={{border:'1px solid #eee',borderRadius:8,padding:8,marginTop:8,background:'#fafafa'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input value={outcome.name||''} onChange={e=>patchTableOutcome(tIndex,oIndex,{name:e.target.value})} style={{flex:1}} placeholder="결과 이름"/>
                    <label style={{fontSize:11}}>확률 <input type="number" min="0" max="100" step="0.1" value={outcome.chance??0} onChange={e=>patchTableOutcome(tIndex,oIndex,{chance:Math.max(0,Math.min(100,Number(e.target.value)))})} style={{width:65}}/> %</label>
                    <button type="button" onClick={()=>{const ts=clone(eff.randomTables||[]);ts[tIndex].outcomes=ts[tIndex].outcomes.filter((_,i)=>i!==oIndex);commitE({...eff,randomTables:ts})}}>삭제</button>
                  </div>
                  <div style={{fontSize:11,fontWeight:700,marginTop:8}}>플래그</div>
                  {(story.flags||[]).map(flag=><label key={flag.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:4}}><input type="checkbox" checked={(oe.addFlags||[]).includes(flag.id)} onChange={e=>toggleTableOutcomeArray(tIndex,oIndex,'addFlags',flag.id,e.target.checked)}/> +{flag.name||flag.id}</label>)}
                  {(story.flags||[]).map(flag=><label key={`rm-${flag.id}`} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:4}}><input type="checkbox" checked={(oe.removeFlags||[]).includes(flag.id)} onChange={e=>toggleTableOutcomeArray(tIndex,oIndex,'removeFlags',flag.id,e.target.checked)}/> −{flag.name||flag.id}</label>)}
                  <div style={{fontSize:11,fontWeight:700,marginTop:7}}>키워드</div>
                  {(story.keywords||[]).map(k=><label key={k.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:4}}><input type="checkbox" checked={(oe.addKeywords||[]).includes(k.id)} onChange={e=>toggleTableOutcomeArray(tIndex,oIndex,'addKeywords',k.id,e.target.checked)}/> +{k.name||k.id}</label>)}
                  <div style={{fontSize:11,fontWeight:700,marginTop:7}}>스탯 변화</div>
                  {stats.map(stat=><label key={stat.id} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,margin:'4px 10px 0 0'}}><span>{stat.name||stat.id}</span><input type="number" value={oe.stats?.[stat.id]??0} onChange={e=>setTableOutcomeStat(tIndex,oIndex,stat.id,e.target.value)} style={{width:65}} placeholder="±0"/></label>)}
                  <div style={{fontSize:11,fontWeight:700,marginTop:7}}>스탯 해금</div>
                  {stats.filter(stat=>!stat.isBase).map(stat=><label key={stat.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:4}}><input type="checkbox" checked={(oe.unlockStats||[]).includes(stat.id)} onChange={e=>toggleTableOutcomeArray(tIndex,oIndex,'unlockStats',stat.id,e.target.checked)}/> {stat.name||stat.id}</label>)}
                  <div style={{fontSize:11,fontWeight:700,marginTop:7}}>아이템</div>
                  {(story.items||[]).map(it=><span key={it.id} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,margin:'4px 10px 0 0'}}><button type="button" onClick={()=>toggleTableOutcomeArray(tIndex,oIndex,'addItems',it.id,true)} disabled={(oe.addItems||[]).includes(it.id)}>+{it.name}</button><button type="button" onClick={()=>toggleTableOutcomeArray(tIndex,oIndex,'removeItems',it.id,true)} disabled={(oe.removeItems||[]).includes(it.id)}>−</button></span>)}
                </div>
              })}
              <button type="button" onClick={()=>addTableOutcome(tIndex)} style={{marginTop:8}}>+ 결과 추가</button>
            </div>;
          })}
          {!(eff.randomTables||[]).length&&<div style={{fontSize:11,color:'#999'}}>등록된 확률 테이블이 없습니다.</div>}
        </div>
        <div style={{marginTop:14,padding:10,border:'1px solid #e5e5e5',borderRadius:10,background:'#fff8e8'}}>
          <label style={{display:'flex',gap:8,alignItems:'center',fontSize:12,fontWeight:700,cursor:'pointer'}}>
            <input type="checkbox" checked={!!eff.openFactionSelection} onChange={e=>commitE({...eff,openFactionSelection:e.target.checked})}/>
            이 선택지 후에 진영 선택 화면 열기
          </label>
          <div style={{fontSize:11,color:'#888',marginTop:5}}>체크하면 선택지를 누른 뒤 효과를 적용하고, 원하는 시점에만 진영 선택 페이지로 이동합니다.</div>
        </div>
        <label style={{...label,marginTop:10}}>플래그 추가</label>{(story.flags||[]).map(flag=><label key={flag.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(eff.addFlags||[]).includes(flag.id)} onChange={e=>toggleEffect(eff,"addFlags",flag.id,e.target.checked)}/> {flag.name||flag.id}</label>)}{!(story.flags||[]).length&&<div style={{fontSize:12,color:"#888"}}>설정 탭에서 플래그를 먼저 추가하세요.</div>}<label style={{...label,marginTop:10}}>플래그 해제</label>{(story.flags||[]).map(flag=><label key={flag.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(eff.removeFlags||[]).includes(flag.id)} onChange={e=>toggleEffect(eff,"removeFlags",flag.id,e.target.checked)}/> {flag.name||flag.id}</label>)}<label style={{...label,marginTop:10}}>키워드 획득</label>{(story.keywords||[]).map(k=><label key={k.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(eff.addKeywords||[]).includes(k.id)} onChange={e=>toggleEffect(eff,"addKeywords",k.id,e.target.checked)}/> {k.name||k.id}</label>)}{!(story.keywords||[]).length&&<div style={{fontSize:12,color:"#888"}}>설정 탭에서 키워드를 먼저 추가하세요.</div>}<label style={{...label,marginTop:10}}>키워드 삭제</label>{(story.keywords||[]).map(k=><label key={k.id} style={{fontSize:12,display:"block",marginBottom:4}}><input type="checkbox" checked={(eff.removeKeywords||[]).includes(k.id)} onChange={e=>toggleEffect(eff,"removeKeywords",k.id,e.target.checked)}/> {k.name||k.id}</label>)}
      </div>
    </div>}
  </div>
}

function Graph({story,selected,setSelected,onMove}){
  const nodes = story?.nodes || [];
  const maxX = Math.max(1200, ...nodes.map(n => (n.position?.x || 0) + 240));
  const maxY = Math.max(650, ...nodes.map(n => (n.position?.y || 0) + 150));
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const [drag, setDrag] = useState(null);

  function startDrag(e, nodeId){
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setSelected(nodeId);
    setDrag({
      id: nodeId,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function moveDrag(e){
    if(!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(10, e.clientX - rect.left + e.currentTarget.scrollLeft - drag.dx);
    const y = Math.max(10, e.clientY - rect.top + e.currentTarget.scrollTop - drag.dy);
    onMove(drag.id, x, y);
  }

  function endDrag(){
    setDrag(null);
  }

  return (
    <div
      className="graphWrap"
      style={{
        height: 650,
        overflow: "auto",
        border: "1px solid #ddd",
        borderRadius: 12,
        background: "#f7f7f7",
      }}
    >
      <div
        style={{
          position: "relative",
          width: maxX,
          height: maxY,
          minWidth: "100%",
        }}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <svg
          width={maxX}
          height={maxY}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
          }}
        >
          {nodes.flatMap(node =>
            (node.choices || [])
              .filter(choice => byId[choice.nextNodeId])
              .map(choice => {
                const from = node.position || {x: 0, y: 0};
                const to = byId[choice.nextNodeId].position || {x: 0, y: 0};
                return (
                  <g key={`${node.id}-${choice.id}`}>
                    <line
                      x1={from.x + 105}
                      y1={from.y + 52}
                      x2={to.x + 105}
                      y2={to.y + 52}
                      stroke="#bbb"
                      strokeWidth="2"
                    />
                    <text
                      x={(from.x + to.x) / 2 + 105}
                      y={(from.y + to.y) / 2 + 48}
                      fontSize="10"
                      fill="#777"
                    >
                      {(choice.text || "").slice(0, 12)}
                    </text>
                  </g>
                );
              })
          )}
        </svg>

        {nodes.map(node => {
          const position = node.position || {x: 50, y: 50};
          const isSelected = selected === node.id;
          const text = node.text || "";

          return (
            <div
              key={node.id}
              onPointerDown={e => startDrag(e, node.id)}
              onClick={e => {
                e.stopPropagation();
                setSelected(node.id);
              }}
              style={{
                position: "absolute",
                left: position.x,
                top: position.y,
                width: 210,
                minHeight: 105,
                boxSizing: "border-box",
                border: `2px solid ${isSelected ? "#333" : "#d5d5d5"}`,
                borderRadius: 10,
                background: "white",
                padding: 10,
                cursor: drag?.id === node.id ? "grabbing" : "grab",
                userSelect: "none",
                boxShadow: "0 2px 8px #00000010",
              }}
            >
              <div style={{fontSize: 11, color: "#777"}}>{node.id}</div>
              <div style={{fontSize: 13, fontWeight: 700, margin: "4px 0"}}>
                {text.slice(0, 42)}{text.length > 42 ? "…" : ""}
              </div>
              <div style={{fontSize: 11, color: "#888"}}>
                선택지 {node.choices?.length || 0}개
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NodeEditor({story,setStory,npcs,factions}){
  const textareaRef = useRef(null);
  const [selected,setSelected]=useState(story.nodes[0]?.id||""); const [simFaction,setSimFaction]=useState(factions[0]?.id||""); const [sim,setSim]=useState(null); const [mode,setMode]=useState("graph");
  const [livePlayer,setLivePlayer]=useState(null);
  const node=story.nodes.find(n=>n.id===selected); const faction=factions.find(f=>f.id===simFaction);
  const path=useMemo(()=>node&&faction?findPathToNode(story,faction.startNodeId,node.id,faction.id):null,[story,faction,node]);
  const computed=useMemo(()=>path!==null&&faction?computeStateAtNode(story,faction,npcs,path):null,[story,faction,npcs,path]);
  useEffect(()=>{if(computed)setSim(computed);},[selected,simFaction,computed]);
  useEffect(()=>{
    function refreshLive(){
      const saved=loadPlayerState();
      setLivePlayer(saved?.storyId===story.id?saved:null);
    }
    refreshLive();
    const timer=setInterval(refreshLive,500);
    window.addEventListener("storage",refreshLive);
    return ()=>{clearInterval(timer);window.removeEventListener("storage",refreshLive)};
  },[story.id]);
  function patchNode(p){setStory(s=>({...s,nodes:s.nodes.map(n=>n.id===selected?{...n,...p}:n)}))}
  function patchChoice(id,p){patchNode({choices:node.choices.map(c=>c.id===id?{...c,...p}:c)})}
  function addNode(){
    setStory(s=>{
      const used=new Set(s.nodes.map(n=>n.id));
      let i=1;
      while(used.has(`node_${String(i).padStart(3,"0")}`)) i++;
      const id=`node_${String(i).padStart(3,"0")}`;
      const nodeCount=s.nodes.length;
      const newNode={id,text:"새 노드",bgm:{youtubeUrl:""},choices:[],position:{x:100+(nodeCount%4)*280,y:80+Math.floor(nodeCount/4)*190}};
      setSelected(id);
      return {...s,nodes:[...s.nodes,newNode]};
    });
  }
  function addChoice(){patchNode({choices:[...node.choices,{id:`choice_${Date.now()}`,text:"새 선택지",conditions:{},effects:{},nextNodeId:""}]})}
  function patchNodeConditionalText(index, patch){
    const rows=[...(node.conditionalTexts||[])]; rows[index]={...(rows[index]||{}),...patch}; patchNode({conditionalTexts:rows});
  }
  function patchNodeConditionalRoute(index, patch){
    const rows=[...(node.conditionalRoutes||[])]; rows[index]={...(rows[index]||{}),...patch}; patchNode({conditionalRoutes:rows});
  }
  function toggleNodeCondition(type, index, key, id, on){
    const listKey = type === "text" ? "conditionalTexts" : type === "route" ? "conditionalRoutes" : "conditionalFragments";
    const rows=clone(node[listKey]||[]); const row={...(rows[index]||{}),conditions:{...(rows[index]?.conditions||{})}};
    const arr=[...(row.conditions[key]||[])]; row.conditions[key]=on?(arr.includes(id)?arr:[...arr,id]):arr.filter(x=>x!==id);
    rows[index]=row; patchNode({[listKey]:rows});
  }
  function addConditionalText(){
    const rows=[...(node.conditionalTexts||[])]; rows.push({id:`node_text_${Date.now()}`,priority:rows.length+1,conditions:{requiredFlags:[],excludedFlags:[],requiredKeywords:[],excludedKeywords:[]},text:"조건에 맞는 지문을 입력하세요."}); patchNode({conditionalTexts:rows});
  }
  function patchNodeConditionalFragment(index, patch){
    const rows=[...(node.conditionalFragments||[])]; rows[index]={...(rows[index]||{}),...patch}; patchNode({conditionalFragments:rows});
  }
  function addConditionalFragment(){
    const rows=[...(node.conditionalFragments||[])]; rows.push({id:`node_fragment_${Date.now()}`,priority:rows.length+1,mode:"before",anchor:"",text:"조건에 맞으면 추가할 문장",conditions:{requiredFlags:[],excludedFlags:[],requiredKeywords:[],excludedKeywords:[],requiredChoices:[],excludedChoices:[]}}); patchNode({conditionalFragments:rows});
  }
  function addConditionalRoute(){
    const rows=[...(node.conditionalRoutes||[])]; rows.push({id:`node_route_${Date.now()}`,priority:rows.length+1,conditions:{requiredFlags:[],excludedFlags:[],requiredKeywords:[],excludedKeywords:[]},nextNodeId:""}); patchNode({conditionalRoutes:rows});
  }
  function setNodeConditionMap(type,index,key,id,value){
    const listKey = type === "text" ? "conditionalTexts" : type === "route" ? "conditionalRoutes" : "conditionalFragments";
    const rows=clone(node[listKey]||[]); const row={...(rows[index]||{}),conditions:{...(rows[index]?.conditions||{})}};
    const map={...(row.conditions[key]||{})};
    if(value === "") delete map[id]; else map[id]=Number(value);
    row.conditions[key]=map; rows[index]=row; patchNode({[listKey]:rows});
  }
  function NodeConditionChecks({type,index,row}){
    const listKey = type === "text" ? "conditionalTexts" : type === "route" ? "conditionalRoutes" : "conditionalFragments";
    const allChoices = story.nodes.flatMap(n=>(n.choices||[]).map(c=>({id:c.id,label:`${n.id} · ${c.text||c.id}`})));
    return <div style={{marginTop:8}}>
      <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>필수 플래그</div>
      {(story.flags||[]).map(f=><label key={f.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:3}}><input type="checkbox" checked={(row.conditions?.requiredFlags||[]).includes(f.id)} onChange={e=>toggleNodeCondition(type,index,'requiredFlags',f.id,e.target.checked)}/> {f.name||f.id}</label>)}
      <div style={{fontSize:11,fontWeight:700,marginTop:7,marginBottom:4}}>제외 플래그</div>
      {(story.flags||[]).map(f=><label key={f.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:3}}><input type="checkbox" checked={(row.conditions?.excludedFlags||[]).includes(f.id)} onChange={e=>toggleNodeCondition(type,index,'excludedFlags',f.id,e.target.checked)}/> {f.name||f.id} 없음</label>)}
      <div style={{fontSize:11,fontWeight:700,marginTop:7,marginBottom:4}}>필수 키워드</div>
      {(story.keywords||[]).map(k=><label key={k.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:3}}><input type="checkbox" checked={(row.conditions?.requiredKeywords||[]).includes(k.id)} onChange={e=>toggleNodeCondition(type,index,'requiredKeywords',k.id,e.target.checked)}/> {k.name||k.id}</label>)}
      <div style={{fontSize:11,fontWeight:700,marginTop:7,marginBottom:4}}>제외 키워드</div>
      {(story.keywords||[]).map(k=><label key={k.id} style={{fontSize:11,display:'inline-block',marginRight:10,marginTop:3}}><input type="checkbox" checked={(row.conditions?.excludedKeywords||[]).includes(k.id)} onChange={e=>toggleNodeCondition(type,index,'excludedKeywords',k.id,e.target.checked)}/> {k.name||k.id} 없음</label>)}
      <div style={{fontSize:11,fontWeight:700,marginTop:7,marginBottom:4}}>필수 아이템 / 제외 아이템</div>
      {(story.items||[]).map(it=><span key={it.id} style={{fontSize:11,display:'inline-flex',gap:4,alignItems:'center',marginRight:10,marginTop:3}}><label><input type="checkbox" checked={(row.conditions?.requiredItems||[]).includes(it.id)} onChange={e=>toggleNodeCondition(type,index,'requiredItems',it.id,e.target.checked)}/> {it.name||it.id}</label><label><input type="checkbox" checked={(row.conditions?.excludedItems||[]).includes(it.id)} onChange={e=>toggleNodeCondition(type,index,'excludedItems',it.id,e.target.checked)}/> 없음</label></span>)}
      <div style={{fontSize:11,fontWeight:700,marginTop:7,marginBottom:4}}>스탯 범위</div>
      {(story.stats||[]).map(st=><div key={st.id} style={{display:'flex',gap:5,alignItems:'center',marginTop:3}}><span style={{width:75,fontSize:11}}>{st.name||st.id}</span><input type="number" placeholder="최소" value={row.conditions?.minStats?.[st.id]??''} onChange={e=>setNodeConditionMap(type,index,'minStats',st.id,e.target.value)} style={{width:65}}/><span style={{fontSize:10}}>~</span><input type="number" placeholder="최대" value={row.conditions?.maxStats?.[st.id]??''} onChange={e=>setNodeConditionMap(type,index,'maxStats',st.id,e.target.value)} style={{width:65}}/></div>)}
      <div style={{fontSize:11,fontWeight:700,marginTop:7,marginBottom:4}}>NPC 호감도 범위</div>
      {(story.npcs||[]).map(n=><div key={n.id} style={{display:'flex',gap:5,alignItems:'center',marginTop:3}}><span style={{width:75,fontSize:11}}>{n.name||n.id}</span><input type="number" placeholder="최소" value={row.conditions?.minAffection?.[n.id]??''} onChange={e=>setNodeConditionMap(type,index,'minAffection',n.id,e.target.value)} style={{width:65}}/><span style={{fontSize:10}}>~</span><input type="number" placeholder="최대" value={row.conditions?.maxAffection?.[n.id]??''} onChange={e=>setNodeConditionMap(type,index,'maxAffection',n.id,e.target.value)} style={{width:65}}/></div>)}
      <div style={{fontSize:11,fontWeight:700,marginTop:7,marginBottom:4}}>이전에 고른 선택지</div>
      {allChoices.map(c=><span key={c.id} style={{fontSize:11,display:'block',marginTop:3}}><label><input type="checkbox" checked={(row.conditions?.requiredChoices||[]).includes(c.id)} onChange={e=>toggleNodeCondition(type,index,'requiredChoices',c.id,e.target.checked)}/> 선택함 · {c.label}</label> <label style={{marginLeft:8}}><input type="checkbox" checked={(row.conditions?.excludedChoices||[]).includes(c.id)} onChange={e=>toggleNodeCondition(type,index,'excludedChoices',c.id,e.target.checked)}/> 선택 안 함</label></span>)}
      <div style={{fontSize:11,color:'#777',marginTop:6}}>모든 조건을 충족해야 합니다. 우선순위 숫자가 높을수록 먼저 적용됩니다.</div>
    </div>;
  }
  if(!node)return <div style={card}>노드가 없습니다. <button onClick={addNode}>첫 노드 만들기</button></div>;
  return <>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}><div style={{display:"flex",gap:6}}><button onClick={()=>setMode("graph")} style={{fontWeight:mode==="graph"?700:400}}>노드 그래프</button><button onClick={()=>setMode("list")} style={{fontWeight:mode==="list"?700:400}}>목록 편집</button></div><button onClick={addNode}>+ 새 노드</button></div>
    {mode==="graph"&&<details className="settingFold" open><summary><span className="settingFoldTitle">🗺 노드 그래프</span><span className="settingFoldMeta">클릭해서 접기/펼치기</span></summary><div className="settingFoldBody"><Graph story={story} selected={selected} setSelected={setSelected} onMove={(id,x,y)=>setStory(s=>({...s,nodes:s.nodes.map(n=>n.id===id?{...n,position:{x,y}}:n)}))}/></div></details>} 
    <div style={{display:"grid",gridTemplateColumns:"minmax(0,2fr) minmax(300px,1fr)",gap:18,marginTop:16}}>
      <section>
        <div style={card}><label style={label}>현재 노드</label><select style={input} value={selected} onChange={e=>setSelected(e.target.value)}>{story.nodes.map(n=><option key={n.id} value={n.id}>{n.id}</option>)}</select><label style={{...label,marginTop:12}}>본문</label>
          <div className="textEditorToolbar">
            <button type="button" onClick={() => {
              const result = wrapSelection(textareaRef.current);
              if (!result || result.value === textareaRef.current?.value) return;
              patchNode({text: result.value});
              requestAnimationFrame(() => {
                textareaRef.current?.focus();
                textareaRef.current?.setSelectionRange(result.start, result.end);
              });
            }}><b>B</b> 굵게</button>
            <span>본문에서 단어를 선택한 뒤 누르면 <code>**굵게**</code> 형식으로 저장됩니다.</span>
          </div>
          <textarea ref={textareaRef} rows={7} style={input} value={node.text || ""} onChange={e=>patchNode({text:e.target.value})}/>
          <div className="textPreview"><div className="textPreviewLabel">플레이 미리보기 (현재 시뮬레이션 상태)</div><div className="storyText editorPreview">{renderRichText(resolveNodeText(node, sim || {}))}</div></div>

          <details className="settingFold" style={{marginTop:14}}>
            <summary><span className="settingFoldTitle">📝 조건부 지문</span><span className="settingFoldMeta" style={{display:"inline-flex",gap:6,alignItems:"center"}}><button type="button" onClick={e=>{e.preventDefault();e.stopPropagation();addConditionalText()}}>+ 조건부 지문 추가</button></span></summary><div className="settingFoldBody">
            <div style={{fontSize:11,color:'#777',margin:'5px 0 8px'}}>노드는 하나만 만들고, 플레이어 상태에 따라 다른 지문을 보여줍니다. 조건이 여러 개 맞으면 우선순위가 높은 지문이 표시됩니다.</div>
            {(node.conditionalTexts||[]).map((row,index)=><div key={row.id||index} style={{border:'1px solid #ddd',borderRadius:9,padding:9,marginTop:8,background:'#fff'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 90px auto',gap:7,alignItems:'center'}}><input value={row.text||''} onChange={e=>patchNodeConditionalText(index,{text:e.target.value})} placeholder="조건이 맞을 때 보여줄 지문"/><input type="number" value={row.priority??0} onChange={e=>patchNodeConditionalText(index,{priority:Number(e.target.value)})} placeholder="우선순위"/><button type="button" onClick={()=>patchNode({conditionalTexts:(node.conditionalTexts||[]).filter((_,i)=>i!==index)})}>삭제</button></div>
              <NodeConditionChecks type="text" index={index} row={row}/>
              <div style={{fontSize:11,color:'#777',marginTop:7}}>조건 요약: {conditionSummary(row.conditions,{items:story.items,npcs:story.npcs,flags:story.flags,keywords:story.keywords,stats:story.stats,choices:story.nodes.flatMap(n=>(n.choices||[]).map(c=>({id:c.id,label:c.text||c.id})))}).join(' · ')||'조건 없음'}</div>
            </div>)}
            {!(node.conditionalTexts||[]).length&&<div style={{fontSize:11,color:'#999'}}>등록된 조건부 지문이 없습니다. 기본 본문이 표시됩니다.</div>}
            </div></details>

          <details className="settingFold" style={{marginTop:14}}>
            <summary><span className="settingFoldTitle">✂ 조건부 부분 지문</span><span className="settingFoldMeta" style={{display:"inline-flex",gap:6,alignItems:"center"}}><button type="button" onClick={e=>{e.preventDefault();e.stopPropagation();addConditionalFragment()}}>+ 부분 지문 추가</button></span></summary><div className="settingFoldBody">
            <div style={{fontSize:11,color:'#777',margin:'5px 0 8px'}}>본문 전체를 복제하지 않고, 조건이 맞을 때 문장 일부만 앞/뒤에 붙이거나 특정 문구를 교체·삭제합니다.</div>
            {(node.conditionalFragments||[]).map((row,index)=><div key={row.id||index} style={{border:'1px solid #ddd',borderRadius:9,padding:9,marginTop:8,background:'#fff'}}>
              <div style={{display:'grid',gridTemplateColumns:'100px 1fr 90px auto',gap:7,alignItems:'center'}}><select value={row.mode||'before'} onChange={e=>patchNodeConditionalFragment(index,{mode:e.target.value})}><option value="prepend">맨 앞에 추가</option><option value="append">맨 뒤에 추가</option><option value="before">특정 문구 앞</option><option value="after">특정 문구 뒤</option><option value="replace">특정 문구 교체</option><option value="remove">특정 문구 삭제</option></select><input value={row.anchor||''} onChange={e=>patchNodeConditionalFragment(index,{anchor:e.target.value})} placeholder="기준 문구 (앞/뒤/교체/삭제에 필요)"/><input type="number" value={row.priority??0} onChange={e=>patchNodeConditionalFragment(index,{priority:Number(e.target.value)})} placeholder="우선순위"/><button type="button" onClick={()=>patchNode({conditionalFragments:(node.conditionalFragments||[]).filter((_,i)=>i!==index)})}>삭제</button></div>
              {row.mode!=='remove'&&<textarea rows={2} style={{...input,marginTop:7}} value={row.text||''} onChange={e=>patchNodeConditionalFragment(index,{text:e.target.value})} placeholder="추가/교체할 문장"/>}
              <NodeConditionChecks type="fragment" index={index} row={row}/>
              <div style={{fontSize:11,color:'#777',marginTop:7}}>조건 요약: {conditionSummary(row.conditions,{items:story.items,npcs:story.npcs,stats:story.stats,flags:story.flags,keywords:story.keywords,choices:story.nodes.flatMap(n=>(n.choices||[]).map(c=>({id:c.id,label:c.text||c.id})))}).join(' · ')||'조건 없음'}</div>
            </div>)}
            {!(node.conditionalFragments||[]).length&&<div style={{fontSize:11,color:'#999'}}>등록된 부분 지문이 없습니다.</div>}
            </div></details>

          <details className="settingFold" style={{marginTop:14}}>
            <summary><span className="settingFoldTitle">↪ 조건부 노드 이동</span><span className="settingFoldMeta" style={{display:"inline-flex",gap:6,alignItems:"center"}}><button type="button" onClick={e=>{e.preventDefault();e.stopPropagation();addConditionalRoute()}}>+ 조건부 이동 추가</button></span></summary><div className="settingFoldBody">
            <div style={{fontSize:11,color:'#777',margin:'5px 0 8px'}}>이 노드에 들어왔을 때 조건을 만족하면 지정한 노드로 자동 이동합니다. 우선순위가 높은 규칙부터 검사하며, 여러 규칙을 연쇄적으로 적용할 수도 있습니다.</div>
            {(node.conditionalRoutes||[]).map((row,index)=><div key={row.id||index} style={{border:'1px solid #ddd',borderRadius:9,padding:9,marginTop:8,background:'#fff'}}>
              <div style={{display:'grid',gridTemplateColumns:'90px 1fr auto',gap:7,alignItems:'center'}}><input type="number" value={row.priority??0} onChange={e=>patchNodeConditionalRoute(index,{priority:Number(e.target.value)})} placeholder="우선순위"/><select value={row.nextNodeId||''} onChange={e=>patchNodeConditionalRoute(index,{nextNodeId:e.target.value})}><option value="">이동할 노드 선택</option>{story.nodes.filter(n=>n.id!==node.id).map(n=><option key={n.id} value={n.id}>{n.id}</option>)}</select><button type="button" onClick={()=>patchNode({conditionalRoutes:(node.conditionalRoutes||[]).filter((_,i)=>i!==index)})}>삭제</button></div>
              <NodeConditionChecks type="route" index={index} row={row}/>
              <div style={{fontSize:11,color:'#777',marginTop:7}}>조건 요약: {conditionSummary(row.conditions,{items:story.items,npcs:story.npcs,flags:story.flags,keywords:story.keywords,stats:story.stats,choices:story.nodes.flatMap(n=>(n.choices||[]).map(c=>({id:c.id,label:c.text||c.id})))}).join(' · ')||'조건 없음'} → {row.nextNodeId||'미지정'}</div>
            </div>)}
            {!(node.conditionalRoutes||[]).length&&<div style={{fontSize:11,color:'#999'}}>등록된 조건부 이동이 없습니다. 기존처럼 선택지의 다음 노드로 진행합니다.</div>}
            </div></details>

          <label style={{...label,marginTop:12}}>노드 BGM</label><input style={input} value={node.bgm?.youtubeUrl||""} onChange={e=>patchNode({bgm:{youtubeUrl:e.target.value}})}/></div>
        <div style={{marginTop:14}}>{node.choices.map(c=>{const passes=sim?checkCondition(c.conditions,sim):true;return <div key={c.id} style={{...card,marginBottom:10,borderColor:passes?"#cfdccf":"#ddd"}}><div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 180px auto",gap:8}}><input value={c.text} onChange={e=>patchChoice(c.id,{text:e.target.value})}/><select value={c.nextNodeId||""} onChange={e=>patchChoice(c.id,{nextNodeId:e.target.value})}><option value="">다음 노드</option>{story.nodes.map(n=><option key={n.id} value={n.id}>{n.id}</option>)}</select><button onClick={()=>patchNode({choices:node.choices.filter(x=>x.id!==c.id)})}>삭제</button></div><div style={{fontSize:12,color:"#777",marginTop:8}}>조건 요약: {conditionSummary(c.conditions,{items:story.items,npcs:story.npcs,stats:story.stats,flags:story.flags,keywords:story.keywords,choices:story.nodes.flatMap(n=>(n.choices||[]).map(x=>({id:x.id,label:x.text||x.id})))}).join(" · ")||"없음"}</div><ConditionEffectForm choice={c} story={story} onChange={p=>patchChoice(c.id,p)}/><div style={{fontSize:12,marginTop:8,color:passes?"#217a39":"#999"}}>{passes?"현재 상태에서 선택 가능":"현재 상태에서는 조건 불충족"}</div></div>})}</div><button onClick={addChoice}>+ 선택지 추가</button>
      </section>
      <aside><div style={card}><label style={label}>시뮬레이션 진영</label><select style={input} value={simFaction} onChange={e=>setSimFaction(e.target.value)}>{factions.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>{computed?<><div className="statePanelNote">현재 노드까지 연결된 경로를 기준으로 계산한 플레이어 상태입니다. 본문/조건/효과를 수정하면 즉시 갱신됩니다.</div><div className="statGrid">{(story.stats||[]).map(stat=><div key={stat.id}><small>{stat.name||stat.id}</small><strong>{computed.stats?.[stat.id]??0}</strong></div>)}</div><label style={{...label,marginTop:12}}>획득 플래그</label><div className="chipList">{(computed.flags||[]).map(id=><span key={id}>⚑ {idName(story.flags,id)}</span>)}{!computed.flags?.length&&<em>없음</em>}</div><label style={{...label,marginTop:12}}>획득 키워드</label><div className="chipList">{(computed.keywords||[]).map(id=><span key={id}>🔎 {idName(story.keywords,id)}</span>)}{!computed.keywords?.length&&<em>없음</em>}</div><label style={{...label,marginTop:12}}>보유 아이템</label><div className="chipList">{computed.inventory.map(id=><span key={id}>{idName(story.items,id)}</span>)}{!computed.inventory.length&&<em>없음</em>}</div><label style={{...label,marginTop:12}}>NPC 호감도</label><div style={{fontSize:12}}>{Object.entries(computed.affection).map(([id,v])=><div key={id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>{idName(story.npcs,id)}</span><b>{v}</b></div>)}</div></>:<p style={{fontSize:12,color:"#888"}}>이 진영의 시작점에서 현재 노드까지 연결된 경로가 없습니다.</p>}</div>
        <div style={{...card,marginTop:12}}><strong style={{fontSize:13}}>현재 플레이어 상태</strong>{livePlayer?<><div className="statePanelNote">같은 브라우저에서 실제로 플레이 중인 이 스토리의 저장 상태를 0.5초마다 확인합니다.</div><label style={{...label,marginTop:10}}>현재 노드</label><div style={{fontSize:12,marginBottom:8}}>{livePlayer.currentNodeId}</div><label style={label}>현재 플래그</label><div className="chipList">{(livePlayer.flags||[]).map(id=><span key={id}>⚑ {idName(story.flags,id)}</span>)}{!livePlayer.flags?.length&&<em>없음</em>}</div><label style={{...label,marginTop:10}}>현재 키워드</label><div className="chipList">{(livePlayer.keywords||[]).map(id=><span key={id}>🔎 {idName(story.keywords,id)}</span>)}{!livePlayer.keywords?.length&&<em>없음</em>}</div></>:<p style={{fontSize:12,color:"#888",lineHeight:1.6,marginBottom:0}}>현재 이 스토리의 플레이 저장 데이터가 없습니다. 플레이 화면에서 실제로 선택지를 진행하면 여기에 표시됩니다.</p>}</div>
        {node&&<div style={{...card,marginTop:12}}><strong style={{fontSize:13}}>이 노드의 NPC 참고</strong>{story.npcs.filter(n=>node.text.includes(n.name)).map(n=><NpcHint key={n.id} npc={n} story={story} sim={sim}/>) }{!story.npcs.some(n=>node.text.includes(n.name))&&<p style={{fontSize:12,color:"#888"}}>본문에 NPC 이름이 없으면 여기 표시되지 않습니다.</p>}</div>}
      </aside>
    </div>
  </>;
}
function NpcHint({npc,story,sim}){return <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #eee"}}><div style={{fontWeight:700,fontSize:13}}>{npc.name}</div>{(npc.reactions||[]).map(r=>{const ok=sim?checkCondition(r.conditions,sim):false;return <div key={r.id} style={{fontSize:12,marginTop:7,padding:8,borderRadius:8,background:ok?"#fff6df":"#f7f7f7"}}><b>{ok?"⚠ ":""}{r.name}</b><div>{r.reaction}</div><small>{conditionSummary(r.conditions,{items:story.items,npcs:story.npcs,stats:story.stats,flags:story.flags}).join(" · ")||"조건 없음"}</small></div>})}</div>}

function StatsFlagsTab({story,setStory}){
 const stats=story.stats||[]; const flags=story.flags||[];
 function patchStat(id,p){setStory(s=>({...s,stats:(s.stats||[]).map(x=>x.id===id?{...x,...p}:x)}))}
 function addStat(){let i=1;const used=new Set(stats.map(x=>x.id));while(used.has(`stat_${String(i).padStart(3,"0")}`))i++;const id=`stat_${String(i).padStart(3,"0")}`;setStory(s=>({...s,stats:[...(s.stats||[]),{id,name:"새 스탯",description:"",min:0,max:100,initialValue:0,isBase:false,unlockConditions:{requiredFlags:[],requiredKeywords:[],requiredFaction:[]}}]}))}
 function removeStat(id){if(!confirm("이 스탯을 삭제할까요? 기존 선택지의 조건/효과와 진영 시작값에서 이 스탯도 함께 정리하는 것을 권장합니다."))return;setStory(s=>{const next={...s,stats:(s.stats||[]).filter(x=>x.id!==id),factions:(s.factions||[]).map(f=>{const ss={...(f.startingStats||{})};delete ss[id];return {...f,startingStats:ss}}),nodes:(s.nodes||[]).map(n=>({...n,choices:(n.choices||[]).map(c=>{const cc={...c,conditions:{...c.conditions},effects:{...c.effects}};for(const k of ["minStats","maxStats"]){if(cc.conditions[k]){const m={...cc.conditions[k]};delete m[id];cc.conditions[k]=m}}if(cc.effects.stats){const m={...cc.effects.stats};delete m[id];cc.effects.stats=m}if(cc.effects.unlockStats)cc.effects.unlockStats=cc.effects.unlockStats.filter(x=>x!==id);if(cc.effects.lockStats)cc.effects.lockStats=cc.effects.lockStats.filter(x=>x!==id);return cc})}))};return next})}
 function patchFlag(id,p){setStory(s=>({...s,flags:(s.flags||[]).map(x=>x.id===id?{...x,...p}:x)}))}
 function addFlag(){let i=1;const used=new Set(flags.map(x=>x.id));while(used.has(`flag_${String(i).padStart(3,"0")}`))i++;const id=`flag_${String(i).padStart(3,"0")}`;setStory(s=>({...s,flags:[...(s.flags||[]),{id,name:"새 플래그",description:""}]}))}
 function addKeyword(){let i=1;const used=new Set((story.keywords||[]).map(x=>x.id));while(used.has(`keyword_${String(i).padStart(3,"0")}`))i++;const id=`keyword_${String(i).padStart(3,"0")}`;setStory(s=>({...s,keywords:[...(s.keywords||[]),{id,name:"새 키워드",description:""}]}))}
 function patchKeyword(id,p){setStory(s=>({...s,keywords:(s.keywords||[]).map(x=>x.id===id?{...x,...p}:x)}))}
 function removeKeyword(id){if(!confirm("이 키워드를 삭제할까요? 기존 선택지의 조건/효과에서도 함께 정리됩니다."))return;setStory(s=>({...s,keywords:(s.keywords||[]).filter(x=>x.id!==id),nodes:(s.nodes||[]).map(n=>({...n,choices:(n.choices||[]).map(c=>({...c,conditions:{...c.conditions,requiredKeywords:(c.conditions?.requiredKeywords||[]).filter(x=>x!==id),excludedKeywords:(c.conditions?.excludedKeywords||[]).filter(x=>x!==id)},effects:{...c.effects,addKeywords:(c.effects?.addKeywords||[]).filter(x=>x!==id),removeKeywords:(c.effects?.removeKeywords||[]).filter(x=>x!==id)}}))}))}))}
 function removeFlag(id){if(!confirm("이 플래그를 삭제할까요? 기존 선택지의 조건/효과에서도 이 플래그를 정리하는 것을 권장합니다."))return;setStory(s=>({...s,flags:(s.flags||[]).filter(x=>x.id!==id),nodes:(s.nodes||[]).map(n=>({...n,choices:(n.choices||[]).map(c=>({...c,conditions:{...c.conditions,requiredFlags:(c.conditions?.requiredFlags||[]).filter(x=>x!==id),excludedFlags:(c.conditions?.excludedFlags||[]).filter(x=>x!==id)},effects:{...c.effects,addFlags:(c.effects?.addFlags||[]).filter(x=>x!==id),removeFlags:(c.effects?.removeFlags||[]).filter(x=>x!==id)}}))}))}))}
 return <div>
  <section style={{...card,marginBottom:16}}><div style={{fontWeight:700,fontSize:14,marginBottom:6}}>스탯</div><p style={{fontSize:12,color:"#777",marginTop:0}}>스토리에서 사용할 숫자형 값을 자유롭게 만듭니다. 선택지에서 +/− 변화량과 조건으로 사용할 수 있습니다.</p>
   {stats.map(stat=><details className="settingFold" key={stat.id}><summary><span className="settingFoldTitle">{stat.name||stat.id}</span><span className="settingFoldMeta">{stat.isBase?"기본 스탯":"잠금형 스탯"} · {stat.min??0}~{stat.max??100}</span></summary><div className="settingFoldBody"><div className="twoGrid"><div><label style={label}>이름</label><input style={input} value={stat.name||""} onChange={e=>patchStat(stat.id,{name:e.target.value})}/></div><div><label style={label}>ID</label><input style={input} value={stat.id} disabled/></div></div><div className="threeGrid" style={{marginTop:10}}><input type="number" value={stat.min??0} onChange={e=>patchStat(stat.id,{min:Number(e.target.value)})} placeholder="최솟값"/><input type="number" value={stat.max??100} onChange={e=>patchStat(stat.id,{max:Number(e.target.value)})} placeholder="최댓값"/><input type="number" value={stat.initialValue??stat.min??0} onChange={e=>patchStat(stat.id,{initialValue:Number(e.target.value)})} placeholder="해금 시 초기값"/></div><label style={{...label,marginTop:10}}>설명</label><textarea rows={2} style={input} value={stat.description||""} onChange={e=>patchStat(stat.id,{description:e.target.value})}/>{!stat.isBase&&<><label style={{...label,marginTop:10}}>해금 조건</label><div className="checkGrid">{(story.flags||[]).map(flag=><label key={flag.id}><input type="checkbox" checked={(stat.unlockConditions?.requiredFlags||[]).includes(flag.id)} onChange={e=>{const a=stat.unlockConditions?.requiredFlags||[];patchStat(stat.id,{unlockConditions:{...(stat.unlockConditions||{}),requiredFlags:e.target.checked?[...a,flag.id]:a.filter(x=>x!==flag.id)}})}}/> {flag.name||flag.id}</label>)}</div><div className="checkGrid" style={{marginTop:8}}>{(story.keywords||[]).map(k=><label key={k.id}><input type="checkbox" checked={(stat.unlockConditions?.requiredKeywords||[]).includes(k.id)} onChange={e=>{const a=stat.unlockConditions?.requiredKeywords||[];patchStat(stat.id,{unlockConditions:{...(stat.unlockConditions||{}),requiredKeywords:e.target.checked?[...a,k.id]:a.filter(x=>x!==k.id)}})}}/> {k.name||k.id}</label>)}</div><div style={{fontSize:12,fontWeight:700,marginTop:10,marginBottom:6}}>필수 진영 (선택)</div><div className="checkGrid">{(story.factions||[]).map(f=><label key={f.id}><input type="checkbox" checked={(stat.unlockConditions?.requiredFaction||[]).includes(f.id)} onChange={e=>{const a=stat.unlockConditions?.requiredFaction||[];patchStat(stat.id,{unlockConditions:{...(stat.unlockConditions||{}),requiredFaction:e.target.checked?[...a,f.id]:a.filter(x=>x!==f.id)}})}}/> {f.name||f.id}</label>)}</div><div style={{fontSize:11,color:"#888",marginTop:6}}>조건을 모두 만족하면 자동으로 해금되고 위의 초기값으로 생성됩니다. 또는 선택지의 「스탯 해금」 효과로 직접 열 수 있습니다.</div></>}<button style={{marginTop:8}} onClick={()=>removeStat(stat.id)}>스탯 삭제</button></div></details>)}<button onClick={addStat}>+ 스탯 추가</button>
  </section>
  <section style={card}><div style={{fontWeight:700,fontSize:14,marginBottom:6}}>플래그</div><p style={{fontSize:12,color:"#777",marginTop:0}}>사건의 발생 여부를 기억하는 스위치입니다. 선택지 효과로 켜고, 다른 선택지의 조건으로 루트를 열 수 있습니다.</p>
   {flags.map(flag=><details className="settingFold" key={flag.id}><summary><span className="settingFoldTitle">{flag.name||flag.id}</span><span className="settingFoldMeta">ID: {flag.id}</span></summary><div className="settingFoldBody"><div className="twoGrid"><div><label style={label}>이름</label><input style={input} value={flag.name||""} onChange={e=>patchFlag(flag.id,{name:e.target.value})}/></div><div><label style={label}>ID</label><input style={input} value={flag.id} disabled/></div></div><label style={{...label,marginTop:10}}>설명</label><textarea rows={2} style={input} value={flag.description||""} onChange={e=>patchFlag(flag.id,{description:e.target.value})}/><button style={{marginTop:8}} onClick={()=>removeFlag(flag.id)}>플래그 삭제</button></div></details>)}<button onClick={addFlag}>+ 플래그 추가</button>
  </section>
  <section style={{...card,marginTop:16}}><div style={{fontWeight:700,fontSize:14,marginBottom:6}}>단어장 / 조사 노트</div><p style={{fontSize:12,color:"#777",marginTop:0}}>플레이 중 발견한 키워드가 기록됩니다. 선택지 효과로 획득시키고, 다른 선택지의 조건으로 사용할 수도 있습니다.</p>{(story.keywords||[]).map(k=><details className="settingFold" key={k.id}><summary><span className="settingFoldTitle">{k.name||k.id}</span><span className="settingFoldMeta">ID: {k.id}</span></summary><div className="settingFoldBody"><div className="twoGrid"><div><label style={label}>키워드 이름</label><input style={input} value={k.name||""} onChange={e=>patchKeyword(k.id,{name:e.target.value})}/></div><div><label style={label}>ID</label><input style={input} value={k.id} disabled/></div></div><label style={{...label,marginTop:10}}>조사 노트 내용</label><textarea rows={4} style={input} value={k.description||""} onChange={e=>patchKeyword(k.id,{description:e.target.value})} placeholder="플레이어가 이 키워드를 발견했을 때 조사 노트에 표시할 설명"/><button style={{marginTop:8}} onClick={()=>removeKeyword(k.id)}>키워드 삭제</button></div></details>)}<button onClick={addKeyword}>+ 키워드 추가</button></section>
  <section style={{...card,marginTop:16,background:"#fafafa"}}><strong style={{fontSize:13}}>사용 예시</strong><p style={{fontSize:12,lineHeight:1.7,marginBottom:0}}>① 선택지에서 <b>「비밀방 발견」</b> 플래그를 켭니다. ② 같은 선택지에서 <b>「고대의 힘 +10」</b>을 적용할 수 있습니다. ③ 이후 선택지 조건에서 <b>「비밀방 발견」</b>을 요구하면 숨겨진 루트가 열립니다. ④ 또는 <b>「고대의 힘 ≥ 20」</b> 조건으로 더 깊은 루트를 열 수 있습니다.</p></section>
 </div>
}

function FactionsTab({story,setStory}){
 function patch(id,p){setStory(s=>({...s,factions:s.factions.map(f=>f.id===id?{...f,...p}:f)}))}
 function add(){const id=`faction_${Date.now()}`;setStory(s=>({...s,factions:[...s.factions,{id,name:"새 진영",description:"",startNodeId:s.nodes[0]?.id||"",startingStats:Object.fromEntries((s.stats||[]).map(x=>[x.id,x.id==="health"?70:x.id==="mental"?60:x.id==="money"?500:(x.min??0)])),startingItems:[],startingAffection:{},npcIds:[],unlockConditions:{requiredFlags:[],requiredKeywords:[]}}]}))}
 return <div>
  {story.factions.map(f=><details className="settingFold" key={f.id}>
   <summary><span className="settingFoldTitle">{f.name||"이름 없는 진영"}</span><span className="settingFoldMeta">NPC {(f.npcIds||[]).length}명 · 시작 아이템 {(f.startingItems||[]).length}개</span></summary>
   <div className="settingFoldBody">
    <label style={label}>이름</label><input style={input} value={f.name} onChange={e=>patch(f.id,{name:e.target.value})}/>
    <label style={{...label,marginTop:10}}>설명</label><textarea rows={2} style={input} value={f.description||""} onChange={e=>patch(f.id,{description:e.target.value})}/>
    <label style={{...label,marginTop:10}}>시작 노드</label><select style={input} value={f.startNodeId} onChange={e=>patch(f.id,{startNodeId:e.target.value})}>{story.nodes.map(n=><option key={n.id} value={n.id}>{n.id}</option>)}</select>
    <label style={{...label,marginTop:10}}>진영 해금 조건</label><div style={{padding:10,border:"1px solid #eee",borderRadius:10,background:"#fafafa"}}><div style={{fontSize:12,color:"#777",marginBottom:8}}>처음에는 조건을 만족하는 진영만 보입니다. 플레이 중 조건을 만족하면 진영 선택 화면에서 다시 나타납니다.</div><div style={{fontSize:12,fontWeight:700,marginBottom:6}}>필수 플래그</div><div className="checkGrid">{(story.flags||[]).map(flag=><label key={flag.id}><input type="checkbox" checked={(f.unlockConditions?.requiredFlags||[]).includes(flag.id)} onChange={e=>{const a=f.unlockConditions?.requiredFlags||[];patch(f.id,{unlockConditions:{...(f.unlockConditions||{}),requiredFlags:e.target.checked?[...a,flag.id]:a.filter(x=>x!==flag.id)}})}}/> {flag.name||flag.id}</label>)}{!(story.flags||[]).length&&<span style={{fontSize:12,color:"#999"}}>먼저 스탯/플래그 탭에서 플래그를 추가하세요.</span>}</div><div style={{fontSize:12,fontWeight:700,margin:"12px 0 6px"}}>필수 키워드</div><div className="checkGrid">{(story.keywords||[]).map(k=><label key={k.id}><input type="checkbox" checked={(f.unlockConditions?.requiredKeywords||[]).includes(k.id)} onChange={e=>{const a=f.unlockConditions?.requiredKeywords||[];patch(f.id,{unlockConditions:{...(f.unlockConditions||{}),requiredKeywords:e.target.checked?[...a,k.id]:a.filter(x=>x!==k.id)}})}}/> {k.name||k.id}</label>)}</div></div>
    <label style={{...label,marginTop:10}}>전용 NPC</label><div className="checkGrid">{story.npcs.map(n=><label key={n.id}><input type="checkbox" checked={(f.npcIds||[]).includes(n.id)} onChange={e=>{const a=f.npcIds||[];patch(f.id,{npcIds:e.target.checked?[...a,n.id]:a.filter(x=>x!==n.id)})}}/> {n.name}</label>)}</div>
    <label style={{...label,marginTop:10}}>시작 스탯</label><div className="threeGrid">{(story.stats||[]).filter(stat=>stat.isBase).map(stat=><input key={stat.id} type="number" value={f.startingStats?.[stat.id]??stat.initialValue??stat.min??0} onChange={e=>patch(f.id,{startingStats:{...f.startingStats,[stat.id]:Number(e.target.value)}})} placeholder={stat.name||stat.id}/>)}</div>
    <label style={{...label,marginTop:10}}>시작 아이템</label><div className="checkGrid">{story.items.map(i=><label key={i.id}><input type="checkbox" checked={(f.startingItems||[]).includes(i.id)} onChange={e=>{const a=f.startingItems||[];patch(f.id,{startingItems:e.target.checked?[...a,i.id]:a.filter(x=>x!==i.id)})}}/> {i.name}</label>)}</div>
   </div>
  </details>)}
  <button onClick={add}>+ 진영 추가</button>
 </div>
}

function NpcsTab({story,setStory}){
 const patch=(id,p)=>setStory(s=>({...s,npcs:s.npcs.map(n=>n.id===id?{...n,...p}:n)}));
 function add(){const id=`npc_${Date.now()}`;setStory(s=>({...s,npcs:[...s.npcs,{id,name:"새 NPC",defaultAffection:0,description:"",tags:[],factions:[],appearanceConditions:{},reactions:[]}]}))}
 function addReaction(n){const r={id:`reaction_${Date.now()}`,name:"새 반응",conditions:{},reaction:"이 NPC는 이렇게 반응한다.",affection:0,notes:""};patch(n.id,{reactions:[...(n.reactions||[]),r]})}
 function patchR(n,rid,p){patch(n.id,{reactions:(n.reactions||[]).map(r=>r.id===rid?{...r,...p}:r)})}
 return <div>
  {story.npcs.map(n=><details className="settingFold" key={n.id}>
   <summary><span className="settingFoldTitle">{n.name||"이름 없는 NPC"}</span><span className="settingFoldMeta">기본 호감도 {n.defaultAffection??0} · 특수 반응 {(n.reactions||[]).length}개</span></summary>
   <div className="settingFoldBody">
    <div className="twoGrid"><div><label style={label}>이름</label><input style={input} value={n.name} onChange={e=>patch(n.id,{name:e.target.value})}/></div><div><label style={label}>기본 호감도</label><input type="number" style={input} value={n.defaultAffection??0} onChange={e=>patch(n.id,{defaultAffection:Number(e.target.value)})}/></div></div>
    <label style={{...label,marginTop:10}}>설명</label><textarea rows={2} style={input} value={n.description||""} onChange={e=>patch(n.id,{description:e.target.value})}/>
    <label style={{...label,marginTop:10}}>태그</label><input style={input} value={(n.tags||[]).join(", ")} onChange={e=>patch(n.id,{tags:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})}/>
    <div style={{marginTop:14,fontWeight:700,fontSize:13}}>특수 반응 규칙</div>
    {(n.reactions||[]).map(r=><details className="subSettingFold" key={r.id}><summary><span>{r.name||"이름 없는 반응"}</span><small>호감도 {r.affection??0}</small></summary><div className="subSettingBody"><div className="twoGrid"><input value={r.name} onChange={e=>patchR(n,r.id,{name:e.target.value})}/><input type="number" value={r.affection??0} onChange={e=>patchR(n,r.id,{affection:Number(e.target.value)})} placeholder="호감도 변화"/></div><label style={{...label,marginTop:7}}>조건 JSON</label><input style={input} value={JSON.stringify(r.conditions||{})} onChange={e=>patchR(n,r.id,{conditions:parseObject(e.target.value,r.conditions||{})})}/><label style={{...label,marginTop:7}}>반응</label><textarea rows={2} style={input} value={r.reaction||""} onChange={e=>patchR(n,r.id,{reaction:e.target.value})}/><label style={{...label,marginTop:7}}>작가 메모</label><input style={input} value={r.notes||""} onChange={e=>patchR(n,r.id,{notes:e.target.value})}/></div></details>)}
    <button style={{marginTop:8}} onClick={()=>addReaction(n)}>+ 특수 반응 추가</button>
   </div>
  </details>)}
  <button onClick={add}>+ NPC 추가</button>
 </div>
}

function ItemsTab({story,setStory}){
 function patch(id,p){setStory(s=>({...s,items:s.items.map(i=>i.id===id?{...i,...p}:i)}))}
 function add(){const id=`item_${Date.now()}`;setStory(s=>({...s,items:[...s.items,{id,name:"새 아이템",description:""}]}))}
 return <div>
  {story.items.map(i=><details className="settingFold" key={i.id}><summary><span className="settingFoldTitle">{i.name||"이름 없는 아이템"}</span><span className="settingFoldMeta">ID: {i.id}</span></summary><div className="settingFoldBody"><div className="twoGrid"><div><label style={label}>이름</label><input style={input} value={i.name} onChange={e=>patch(i.id,{name:e.target.value})}/></div><div><label style={label}>ID</label><input style={input} value={i.id} disabled/></div></div><label style={{...label,marginTop:10}}>설명</label><textarea rows={2} style={input} value={i.description||""} onChange={e=>patch(i.id,{description:e.target.value})}/></div></details>)}
  <button onClick={add}>+ 아이템 추가</button>
 </div>
}

function EditorInner(){
 const [stories,setStories]=useState([]); const [story,setStoryState]=useState(null); const [storyId,setStoryIdState]=useState(""); const [tab,setTab]=useState("nodes"); const [msg,setMsg]=useState(""); const fileRef=useRef(null);
 const storyIdRef=useRef("");
 function setStoryId(id){ storyIdRef.current=id; setStoryIdState(id); }
 async function loadManifest(preferredId){
   const localManifest=window.localStorage.getItem("seoul-choice-editor-stories");
   let localList=[];
   if(localManifest){try{localList=JSON.parse(localManifest)}catch{}}
   let serverList=[];
   try{const r=await fetch('/api/story');const b=await r.json();serverList=b.stories||[]}catch{}
   const merged=[...serverList];
   for(const item of localList){if(!merged.some(x=>x.id===item.id))merged.push(item);}
   const list=merged;
   setStories(list);
   const id=preferredId||storyIdRef.current||list[0]?.id;
   if(id) setStoryId(id);
   return list;
 }
 async function loadOne(id){
   if(!id)return;
   const key=`seoul-choice-story:${id}`; const local=window.localStorage.getItem(key);
   if(local){try{setStoryState(normalizeStory(JSON.parse(local)));return}catch{}}
   try{const r=await fetch(`/api/story?storyId=${encodeURIComponent(id)}`);if(r.ok){const s=normalizeStory(await r.json());setStoryState(s);window.localStorage.setItem(key,JSON.stringify(s));return;}}catch{}
   setMsg("스토리를 불러오지 못했습니다.");
 }
 useEffect(()=>{loadManifest().then(list=>{if(list[0]?.id)loadOne(list[0].id)})},[]);
 useEffect(()=>{if(storyId)loadOne(storyId)},[storyId]);
 useEffect(()=>{if(story){window.localStorage.setItem(`seoul-choice-story:${story.id}`,JSON.stringify(story));window.localStorage.setItem("seoul-choice-editor-stories",JSON.stringify(stories.map(s=>s.id===story.id?{id:story.id,name:story.name,description:story.description||'',accessCodes:story.accessCodes||[]}:s)))}},[story,stories]);
 if(!story)return <p style={{textAlign:"center",marginTop:100}}>스토리 불러오는 중...</p>;
 async function serverSave(){setMsg("플레이 반영 저장 중...");try{const r=await fetch('/api/story',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(story)});if(!r.ok)throw Error();setMsg("저장 완료 — 이 스토리는 접근 코드로 플레이할 수 있습니다.");await loadManifest(story.id)}catch{setMsg("서버 저장 실패 — 이 브라우저에서는 로컬 스토리로 플레이할 수 있습니다.")}}
 function localSave(){window.localStorage.setItem(`seoul-choice-story:${story.id}`,JSON.stringify(story));setMsg("이 브라우저에 스토리 저장 완료")}
 function downloadStory(){downloadJson(`${story.id}.json`,story);setMsg("현재 스토리 JSON을 내보냈습니다.")}
 function importJson(e){const file=e.target.files?.[0];if(!file)return;const r=new FileReader();r.onload=()=>{try{const raw=JSON.parse(r.result);const imported=normalizeStory(raw?.stories?.[0]||raw);if(!imported.id)throw Error();setStory(imported);setStoryId(imported.id);setStories(prev=>[...prev.filter(s=>s.id!==imported.id),{id:imported.id,name:imported.name||imported.id,description:imported.description||'',accessCodes:imported.accessCodes||[]}]);setMsg("스토리 JSON 불러오기 완료") }catch{setMsg("스토리 JSON 형식을 확인해주세요.")}};r.readAsText(file);e.target.value=""}
 function setStory(fn){setStoryState(prev=>typeof fn==='function'?fn(prev):{...prev,...fn})}
 function refreshStories(preferredId){loadManifest(preferredId).then(list=>{const id=preferredId||list[0]?.id;if(id)setStoryId(id)})}
 return <main className="editorMain"><StoryManager stories={stories} story={story} setStories={setStories} setStoryId={setStoryId} setStory={setStory} refreshStories={refreshStories} setMsg={setMsg}/><div className="editorToolbar"><div className="tabs">{[["nodes","노드"],["stats","스탯/플래그"],["factions","진영"],["npcs","NPC"],["items","아이템"]].map(([k,t])=><button key={k} onClick={()=>setTab(k)} className={tab===k?"active":""}>{t}</button>)}</div><div className="toolbarActions"><button onClick={localSave}>로컬 저장</button><button onClick={downloadStory}>JSON 내보내기</button><button onClick={()=>fileRef.current?.click()}>JSON 불러오기</button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importJson}/><button onClick={serverSave}>플레이 반영 저장</button></div></div>{msg&&<div className="saveMsg">{msg}</div>}{tab==="nodes"&&<NodeEditor story={story} setStory={setStory} npcs={story.npcs||[]} factions={story.factions||[]}/>} {tab==="stats"&&<StatsFlagsTab story={story} setStory={setStory}/>} {tab==="factions"&&<FactionsTab story={story} setStory={setStory}/>} {tab==="npcs"&&<NpcsTab story={story} setStory={setStory}/>} {tab==="items"&&<ItemsTab story={story} setStory={setStory}/>}</main>
}
export default function EditorPage(){const code=process.env.NEXT_PUBLIC_EDITOR_CODE||"";return code?<CodeGate code={code} storageKey="editor-code-ok"><EditorInner/></CodeGate>:<EditorInner/>}
