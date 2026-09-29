import "./globals.css";

export const metadata = {
  title: "텍스트 선택지 게임",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
