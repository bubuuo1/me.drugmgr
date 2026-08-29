"use client";

import type { PropsWithChildren } from "react";
import { useDb } from "@/lib/store";

export function CareSpaceBoundary({ children }: PropsWithChildren) {
  const { selectedCareSpace } = useDb();

  return (
    <div key={selectedCareSpace?.id ?? "no-care-space"} className="contents">
      {children}
    </div>
  );
}
