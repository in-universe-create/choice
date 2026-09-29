"use client";
import { useEffect, useState } from "react";

// 특정 코드를 입력해야 통과하는 간단한 게이트.
// NEXT_PUBLIC_ 환경변수는 브라우저 번들에 그대로 노출되므로
// "URL만 알아도 상관없다" 수준의 가벼운 접근 제한용으로만 사용할 것.
export default function CodeGate({ code, storageKey, children }) {
  const [checked, setChecked] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.sessionStorage.getItem(storageKey);
    if (saved === code) setUnlocked(true);
    setChecked(true);
  }, [code, storageKey]);

  function handleSubmit(e) {
    e.preventDefault();
    if (input === code) {
      window.sessionStorage.setItem(storageKey, code);
      setUnlocked(true);
      setError("");
    } else {
      setError("코드가 올바르지 않습니다.");
    }
  }

  if (!checked) return null;
  if (unlocked) return children;

  return (
    <div style={{ maxWidth: 320, margin: "100px auto", textAlign: "center", padding: 16 }}>
      <p style={{ marginBottom: 16 }}>접근 코드를 입력하세요</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <button type="submit" style={{ width: "100%", padding: "8px 0" }}>확인</button>
      </form>
      {error && <p style={{ color: "#c33", fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
