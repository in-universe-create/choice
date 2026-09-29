"use client";

// 유튜브 링크에서 영상 ID를 뽑아 숨겨진 플레이어로 자동재생한다.
// key={nodeId}로 노드가 바뀔 때마다 iframe을 새로 마운트해서 곡이 바뀌도록 한다.
// 완전히 display:none 처리하면 일부 브라우저가 자동재생을 막기도 해서,
// 화면 밖으로 밀어내는 방식(1px, opacity 0)을 사용한다.
function getVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

export default function BgmPlayer({ url, nodeId }) {
  const videoId = getVideoId(url);
  if (!videoId) return null;

  return (
    <iframe
      key={nodeId}
      title="bgm-player"
      src={`https://www.youtube.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}`}
      allow="autoplay"
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", left: -9999 }}
    />
  );
}
