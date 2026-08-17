<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project: 투약 관리 앱 (Medicine App)

## 필수 읽기
- 모든 화면 디자인의 기준은 `docs/03-ui.md` (Airbnb 디자인 시스템 기반).
- 요구사항/데이터 모델/개발 순서는 `docs/01-overview.md` ~ `docs/09-development.md` 참고.

## 커밋 전 검증
- `npm run lint` (eslint, 오류 0)
- `npm run build` (type check + build 통과)

## 구조
- `lib/types.ts` — Supabase 스키마(`docs/06-database.md`)와 동일한 필드의 타입. 테이블당 하나의 타입.
- `lib/store.ts` — 현재는 localStorage 기반 저수준 저장소. `useDb()` 훅이 단일 진입점.
  - `db.medications` / `db.medication_logs` / `db.daily_status`  사용.
  - Supabase 연동 시 이 파일만 교체(UI는 `useDb()` 인터페이스 유지).
- `lib/date.ts` — 날짜 유틸(한국 시간 기준).
- `app/` — 라우트.
  - `/` 첫 화면 (메스티논/소론도 기록 + 오늘 상태 + 기록 확인)
  - `/log?med=<id>` 투약 기록
  - `/status` 오늘 상태
  - `/records` 기록 확인

## 디자인 토큰
- `app/globals.css`의 `:root` 변수 + `@theme inline`이 유일한 색상/폰트 정의처.
- 하드코딩 색상 금지 (tailwind utility `bg-primary`, `text-ink` 등 토큰 사용).

## 원칙
- 화면은 모바일 우선(세로), 최대 폭 28rem(max-w-md) 내에서 표현.
- 색상만으로 상태를 구분하지 않는다(항상 텍스트와 함께).
- 설정(medications/schedules)과 과거 기록(logs)은 분리하고, 과거 기록은 자동 변경하지 않는다.
- 의료적 판단 금지: 복용량 자동 변경·처방 변경 권고·누락 약 임의 복용 안내 금지.
