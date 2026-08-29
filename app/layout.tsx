import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "./sw-register";
import { OfflineBanner } from "./offline-banner";
import { DbProvider } from "@/lib/store";
import { BottomNavigation } from "./bottom-navigation";
import { CareSpaceBoundary } from "./care-space-boundary";
import { RecordSubjectBar } from "./record-subject-bar";

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
  viewportFit: "cover",
  themeColor: "#ff385c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-dvh overflow-x-hidden font-sans antialiased">
        <div className="pt-[env(safe-area-inset-top)]">
          <OfflineBanner />
        </div>
        <DbProvider>
          <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-canvas px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 min-[400px]:px-5 min-[400px]:pt-6">
            <RecordSubjectBar />
            <CareSpaceBoundary>{children}</CareSpaceBoundary>
          </div>
          <BottomNavigation />
        </DbProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
