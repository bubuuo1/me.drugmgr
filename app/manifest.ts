import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "투약 관리",
    short_name: "투약관리",
    description: "약 복용과 건강 상태를 빠르게 기록하는 개인용 투약 관리 앱",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ff385c",
    lang: "ko",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/notification-badge.png",
        sizes: "96x96",
        type: "image/png",
        purpose: "monochrome",
      },
    ],
  };
}
