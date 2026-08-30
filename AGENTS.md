<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project: 투약 관리 앱 (Medicine App)

## 필수 읽기

- 문서별 정본과 읽기 순서는 `docs/README.md`를 따른다.
- 모든 화면 디자인의 기준은 `docs/03-ui.md` (Airbnb 디자인 시스템 기반).
- 요구사항/데이터 모델/개발 순서는 `docs/01-overview.md` ~ `docs/09-development.md` 참고.

## 커밋 전 검증

- `npm run lint` (eslint, 오류 0)
- `npm run build` (type check + build 통과)
- `npm run test:e2e` (Playwright 핵심 흐름 통과)

## 구조

- `lib/types.ts` — Supabase 스키마(`docs/06-database.md`)와 동일한 필드의 타입. 테이블당 하나의 타입.
- `lib/store.ts` — UI 데이터 접근의 단일 진입점인 `useDb()` 컨텍스트. 운영에서는 `SupabaseDbRepository`, `NEXT_PUBLIC_USE_MOCK_DB=true`인 테스트에서만 휘발성 `MockDbRepository`를 사용한다.
  - `db.medications` / `db.medication_schedules` / `db.medication_logs` / `db.daily_status` 사용.
  - 건강 데이터를 localStorage, IndexedDB, Cache Storage 또는 파일에 영구 저장하지 않는다.
- `lib/supabase-db.ts` / `lib/mock-db.ts` — 같은 `DbRepository` 인터페이스의 운영·테스트 구현.
- `lib/date.ts` — 날짜 유틸(한국 시간 기준).
- `app/` — 라우트.
  - `/` 조회한 활성 약·오늘 일정·오늘 상태 진입
  - `/log?med=<id>&schedule=<id>` 또는 `extra=1` 투약 기록
  - `/status?date=<YYYY-MM-DD>` 상태 기록
  - `/records` 날짜별 투약·상태 기록 확인
  - `/settings` 약·일정, 알림, 복약 공간·계정 설정
  - `/family` 구성원과 초대 관리
  - `/login`, `/auth/*` 인증 흐름

## 디자인 토큰

- `app/globals.css`의 `:root` 변수 + `@theme inline`이 앱 화면의 유일한 색상/폰트 정의처.
- 컴포넌트 하드코딩 색상 금지 (tailwind utility `bg-primary`, `text-ink` 등 토큰 사용). CSS 변수를 읽지 못하는 Web App Manifest·Next viewport 메타데이터만 플랫폼 예외로 같은 토큰 값을 리터럴로 사용하고 E2E로 일치를 확인한다.

## 원칙

- 화면은 모바일 우선(세로), 최대 폭 28rem(max-w-md) 내에서 표현.
- 색상만으로 상태를 구분하지 않는다(항상 텍스트와 함께).
- 설정(medications/schedules)과 과거 기록(logs)은 분리하고, 과거 기록은 자동 변경하지 않는다.
- 의료적 판단 금지: 복용량 자동 변경·처방 변경 권고·누락 약 임의 복용 안내 금지.
