import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "./sw-register";
import { OfflineBanner } from "./offline-banner";
import { DbProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "투약 관리",
  description: "약 복용과 건강 상태를 빠르게 기록하는 개인용 투약 관리 앱",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ff385c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen font-sans antialiased">
        <OfflineBanner />
        <DbProvider>
          <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-canvas px-5 pb-8 pt-6">
            {children}
          </div>
        </DbProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
