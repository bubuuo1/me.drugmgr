"use client";

import Link from "next/link";
import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

type PageHeaderProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  trailing?: ReactNode;
};

export function PageHeader({
  title,
  backHref = "/",
  backLabel = "첫 화면",
  trailing,
}: PageHeaderProps) {
  return (
    <header className="flex min-h-14 items-center gap-3 pt-1">
      <Link
        href={backHref}
        className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-surface-strong px-4 text-base font-bold text-ink active:bg-hairline-soft"
        aria-label={`${backLabel}으로 이동`}
      >
        <span aria-hidden="true">‹</span>
        <span className="ml-1">{backLabel}</span>
      </Link>
      <h1 className="min-w-0 flex-1 text-2xl font-bold leading-snug text-ink">
        {title}
      </h1>
      {trailing}
    </header>
  );
}

type ErrorBannerProps = {
  message: string | null;
  onRetry?: () => void | Promise<void>;
  onDismiss?: () => void;
  retrying?: boolean;
};

export function ErrorBanner({
  message,
  onRetry,
  onDismiss,
  retrying = false,
}: ErrorBannerProps) {
  if (!message) return null;

  return (
    <section
      role="alert"
      className="rounded-2xl border border-error bg-canvas px-5 py-4"
      aria-label="오류"
    >
      <p className="text-lg font-bold text-error">처리하지 못했습니다.</p>
      <p className="mt-1 break-words text-base leading-relaxed text-body">
        {message}
      </p>
      {(onRetry || onDismiss) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={() => void onRetry()}
              disabled={retrying}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-error px-5 text-base font-bold text-on-primary disabled:cursor-wait disabled:opacity-60"
            >
              {retrying ? "다시 불러오는 중" : "다시 시도"}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-hairline bg-canvas px-5 text-base font-bold text-ink"
            >
              닫기
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function LoadingState({ label = "기록을 불러오는 중입니다." }: { label?: string }) {
  return (
    <div
      role="status"
      className="rounded-2xl bg-surface-soft px-5 py-6 text-center text-lg font-semibold text-body"
    >
      {label}
    </div>
  );
}

type NoticeProps = {
  tone?: "success" | "info" | "warning";
  children: ReactNode;
  action?: ReactNode;
};

export function Notice({ tone = "info", children, action }: NoticeProps) {
  const toneClass =
    tone === "success"
      ? "border-success text-success"
      : tone === "warning"
        ? "border-warning text-warning"
        : "border-hairline text-body";

  return (
    <div
      role="status"
      className={`rounded-2xl border bg-canvas px-5 py-4 ${toneClass}`}
    >
      <div className="text-lg font-bold leading-relaxed">{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

type ConfirmDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "취소",
  pending = false,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    cancelButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-2xl bg-canvas p-6"
      >
        <h2 id={titleId} className="text-xl font-bold leading-snug text-ink">
          {title}
        </h2>
        <div id={descriptionId} className="mt-3 text-lg leading-relaxed text-body">
          {description}
        </div>
        <div className="mt-6 flex flex-col gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex min-h-14 items-center justify-center rounded-xl border-2 border-ink bg-canvas px-6 text-lg font-bold text-ink"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={pending}
            className={`flex min-h-14 items-center justify-center rounded-xl px-6 text-lg font-bold text-on-primary disabled:cursor-wait disabled:opacity-60 ${
              destructive ? "bg-warning" : "bg-primary-active"
            }`}
          >
            {pending ? "처리 중" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-base font-semibold text-error">
      {children}
    </p>
  );
}
