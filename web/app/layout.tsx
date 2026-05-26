import type { Metadata } from "next";
import Script from "next/script";

import { ThemeInit } from "../components/theme-init";
import "./globals.css";

export const metadata: Metadata = {
  title: "B站抖音下载器",
  description: "B站与抖音视频下载和字幕提取工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script id="theme-script" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('theme')||(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.className=t}catch(e){document.documentElement.className='light'}`}
        </Script>
      </head>
      <body>
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
