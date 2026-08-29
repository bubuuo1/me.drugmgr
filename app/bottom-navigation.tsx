"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "첫 화면" },
  { href: "/records", label: "복용기록" },
  { href: "/settings", label: "환경설정" },
] as const;

function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/settings" && pathname === "/family") return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNavigation() {
  const pathname = usePathname();

  if (pathname === "/login" || pathname.startsWith("/auth/")) {
    return null;
  }

  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto grid w-full max-w-md grid-cols-3 border-x border-t border-hairline bg-canvas px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {items.map((item) => {
        const current = isCurrentPath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={
              current ? (pathname === item.href ? "page" : "location") : undefined
            }
            className={`flex min-h-14 min-w-0 items-center justify-center rounded-xl px-2 text-center text-sm font-bold ${
              current
                ? "bg-surface-soft text-primary-active"
                : "text-body active:bg-surface-soft"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
