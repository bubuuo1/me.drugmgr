# 개발 순서, 테스트, 배포

## 1. 저장소와 배포

- npm package 이름: `me-drugmgr`
- GitHub: `bubuuo1/me.drugmgr`
- Node.js: 22
- 배포: Vercel 프로젝트의 Git Integration
- GitHub Actions: 품질 검사만 수행, 배포하지 않음

새 Vercel 계정에 `me-drugmgr` 프로젝트를 만들고 `bubuuo1/me.drugmgr`를 Git Integration으로 연결해 Preview/Production 배포 흐름을 사용한다.

Web Push 운영에는 다음 서버 설정이 필요하다.

- Vercel 공개 변수: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- Vercel 서버 전용 변수: `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET`
- Supabase Vault: `push_dispatch_url`, Vercel과 같은 `push_dispatch_secret`
- Supabase migration: `pg_cron`, `pg_net`, private push 테이블·RPC와 `medicine-push-dispatch` 매분 작업

service role key는 사용하지 않는다. VAPID private key와 발송 비밀값을 Git, `.env.example`의 실제 값, 브라우저 변수 또는 GitHub Actions secret에 복사하지 않는다.

## 2. P0 — 데이터 정확성과 운영 기반

### Phase 0.1 스키마 reset

- [ ] 기존 개발 데이터 보존 없이 스키마 재생성
- [ ] `quantity_options`
- [ ] `client_request_id` unique
- [ ] 약 이름·단위·일정 시각 스냅샷
- [ ] `is_extra`, `deleted_at`
- [ ] 상태 날짜 unique
- [ ] 수량 check, FK, 인덱스
- [ ] snapshot과 `updated_at` trigger
- [ ] anon RLS 정책과 허용/거부 테스트

### Phase 0.2 Supabase 단일 저장소

- [ ] localStorage·IndexedDB 코드 제거
- [ ] mock 외의 fallback DB 제거
- [ ] 운영 환경변수 검증
- [ ] publishable key와 legacy anon key 호환
- [ ] 브라우저 세션·로컬 영구 저장 비활성화
- [ ] 조회 로딩·빈 상태·오류 구분

### Phase 0.3 쓰기 신뢰성

- [ ] 모든 create/update/delete `await`
- [ ] 성공 응답 전 완료 UI 금지
- [ ] 저장 중 중복 제출 차단
- [ ] 재시도 시 같은 `client_request_id` 사용
- [ ] 실패 시 가짜 로컬 기록 없음
- [ ] 쓰기 성공 후 Supabase 재조회

### Phase 0.4 일정·시간·과거 무결성

- [ ] 일정 진입 기록에 정확한 `schedule_id` 연결
- [ ] 일정 없는 기록 분리
- [ ] KST 날짜 경계 유틸 통일
- [ ] `timestamptz` 저장과 KST 표시
- [ ] 약·일정 변경 후 과거 스냅샷 불변 검증
- [ ] soft delete 행을 기본 조회에서 제외

### Phase 0.5 핵심 화면 안정화

- [ ] 홈 활성 약 조회
- [ ] 투약 수량 선택과 직접 입력
- [ ] 오늘 상태 upsert
- [ ] 날짜별 투약 조회
- [ ] 설정·조회·저장 오류 UI
- [ ] 모바일 기본 접근성

## 3. P1 — 일상 사용 기능

### Phase 1.1 홈 정보

- [ ] 약별 마지막 복용
- [ ] 약별 오늘 누적
- [ ] 일정별 `기록 있음 / 아직 기록 없음`
- [ ] 미복용·지연 판정 문구 없음

### Phase 1.2 상세 투약

- [ ] 실제 복용 시각 입력·수정
- [ ] 메모
- [ ] 일정 복용과 추가 복용 구분
- [ ] 기록 수정
- [ ] soft delete
- [ ] 삭제 실행 취소

### Phase 1.3 상태와 타임라인

- [ ] 날짜별 상태 조회·수정·삭제
- [ ] 날짜별 투약+상태 타임라인
- [ ] 실제 시각 정렬
- [ ] 통계·추이·의료 해석 없음

### Phase 1.4 약과 스케줄 설정

- [ ] 약 추가·수정·활성화·비활성화
- [ ] 수량 선택지 설정
- [x] 약별 여러 복용·알림 시간 연속 추가·수정·켜기·끄기·삭제
- [ ] 사용 이력의 연쇄 삭제 방지
- [ ] 설정 변경 후 과거 스냅샷 검증

### Phase 1.5 접근성 완료

- [ ] 최소 48px 터치 영역
- [ ] 200% 글자 확대
- [ ] 키보드 전체 흐름
- [ ] 화면 낭독기 이름·상태·라이브 영역
- [ ] 포커스 관리
- [ ] 색상 외 상태 텍스트

### Phase 1.6 PWA Web Push — 완료

- [x] manifest의 앱 id·scope와 홈 화면 아이콘
- [x] 캐시 없는 push 전용 서비스 워커
- [x] 설정 화면의 기기별 알림 켜기·테스트·끄기
- [x] iOS/iPadOS 16.4 이상 홈 화면 설치 안내
- [x] private 구독·발송 테이블과 제한 RPC
- [x] Vault 비밀값을 사용하는 Supabase 매분 Cron
- [x] Vercel 발송 API의 Bearer 비밀값 검증
- [x] 활성 일정 대상 생성과 이미 기록한 일정 건너뛰기
- [x] 일정 기록 전까지 한국 날짜 안에서 5분 간격 반복 알림
- [x] 기기·일정·5분 회차 중복 방지
- [x] 같은 일정의 기존 표시를 닫고 새 알림으로 재표시하며 진동 요청
- [x] 일정 기록·끄기·삭제 시 현재 기기의 같은 일정 알림 닫기
- [x] 발송 직전 일정·약·구독·기록 재검증과 취소 회차 `skipped` 처리
- [x] 일정·한국 날짜별 push topic과 일정 알림 TTL 0
- [x] 중단·일시 실패 시 5분 이내 최대 3회 재시도와 시도 번호 검증
- [x] 만료 구독 비활성화와 전송 결과 기록
- [x] 알림 클릭 시 해당 투약 기록 화면 열기
- [x] 알림 지연 가능성과 미복용 판정 아님을 안내

## 4. 테스트 전략

### 단위·통합 테스트 대상

- KST 날짜 변환과 자정 경계
- 수량 검증
- 일정 연결과 추가 복용 분류
- 마지막 복용·오늘 누적 계산 시 soft delete 제외
- Supabase 오류 매핑
- 같은 `client_request_id`의 멱등성

### Playwright

Playwright는 `NEXT_PUBLIC_USE_MOCK_DB=true`를 사용한다. mock은 테스트 프로세스의 메모리에만 존재하며 다음을 사용하지 않는다.

- 실제 Supabase
- localStorage
- IndexedDB
- 쿠키
- 파일 기반 영구 저장

핵심 E2E:

- 홈의 주요 동작
- 투약 기록 성공과 중복 제출 방지
- 저장 실패 시 완료 처리 금지
- 상태 저장
- 날짜 이동과 기록 조회
- P1 수정·soft delete·실행 취소
- 약·일정 설정 후 과거 로그 불변
- manifest의 PWA id·scope와 push 전용 서비스 워커 제공
- 서비스 워커에 `push`, `notificationclick`이 있고 앱/API `fetch` 캐시가 없음
- 서비스 워커가 같은 논리 일정 알림을 찾아 닫고 `silent: false`인 새 알림과 진동 패턴을 요청함
- 설정 화면의 알림 상태와 기기별 제어
- 한 약에 두 복용·알림 시간을 추가 버튼 재클릭 없이 연속 저장하고 각각 수정·삭제
- 비밀값이 없거나 잘못된 Vercel 발송 API 요청 거부

## 5. GitHub Actions CI

`.github/workflows/ci.yml`은 push, pull request, 수동 실행에서 다음 순서로 품질을 검사한다.

1. Node.js 22 설정
2. `npm ci`
3. `npm run lint`
4. `npm run build`
5. Playwright Chromium 설치
6. `NEXT_PUBLIC_USE_MOCK_DB=true npm run test:e2e`

CI에는 Supabase 운영 URL/key, VAPID private key, 발송 비밀값과 Vercel 배포 토큰이 필요하지 않다. Playwright 실행기는 브라우저 경로 검증에만 쓰는 테스트용 공개 VAPID key와 발송 비밀값을 프로세스 환경에 제공하며 실제 Push 구독이나 운영 발송을 만들지 않는다. Actions에서 `vercel deploy`를 실행하지 않는다.

## 6. 로컬 완료 검사

```bash
npm run lint
npm run build
npm run test:e2e
```

Playwright 최초 실행 환경에서는 Chromium 설치가 필요하다.

```bash
npx playwright install chromium
```

## 7. 완료 정의

변경은 다음을 모두 만족해야 완료다.

- lint 오류 0
- production build 성공
- Playwright 핵심 흐름 성공
- 운영 모드가 Supabase 외 저장소를 사용하지 않음
- 실패한 쓰기를 성공으로 표시하지 않음
- 반복 제출로 중복 로그가 생기지 않음
- 한국 날짜 경계와 과거 스냅샷 테스트 통과
- push 서비스 워커가 앱/API 요청을 오프라인 캐시하지 않음
- 발송 API, Supabase 발송 RPC와 Cron 비밀값이 브라우저나 Git 저장소에 노출되지 않음
- 이미 기록했거나 비활성·삭제된 일정과 중복 발송이 DB 규칙 및 발송 직전 재검증으로 제외됨
- 기록 전 5분 회차와 한국 날짜 자정 종료가 DB 규칙으로 계산됨
- P0/P1 제외 기능을 새 의존성이나 UI로 추가하지 않음

## 8. 명시적 제외

- 인증, 접근 코드, 기기 승인
- localStorage, IndexedDB, 오프라인 캐시·큐·동기화
- 백업·복원, CSV/PDF
- 미복용·지연 복용 판정과 알림의 정시·필수 도착 보장
- 통계·그래프·추이
- 역할·초대·공유 관리
- AI 분석과 의료 판단

위 항목은 개발 backlog가 아니라 현재 제품 범위에서 제외된 결정이다.
