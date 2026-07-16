import "./globals.css";

export const metadata = {
  title: "HORAI AI",
  description: "宝来社 社内DXデモ — 会社全体を動かすAIアシスタント",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
