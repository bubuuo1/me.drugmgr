import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "./sw-register";
import { OfflineBanner } from "./offline-banner";
import { DbProvider } from "@/lib/store";
import { CareSpaceBar } from "./care-space-bar";
import { CareSpaceBoundary } from "./care-space-boundary";

export const metadata: Metadata = {
  title: "투약 관리",
  description: "본인과 초대한 가족이 복약 기록과 알림을 안전하게 공유하는 앱",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "투약관리",
  },
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
            <CareSpaceBar />
            <CareSpaceBoundary>{children}</CareSpaceBoundary>
          </div>
        </DbProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
