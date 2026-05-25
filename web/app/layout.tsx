import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "B站抖音下载器",
  description: "B站与抖音视频下载和字幕提取工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
