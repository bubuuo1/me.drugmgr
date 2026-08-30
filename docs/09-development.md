# 개발 순서, 테스트, 배포

> 이 문서는 구현·검증 현황과 배포 절차의 유일한 정본이다. `[x]`는 현재 작업 트리에 코드 또는 스키마가 있고 해당 수준의 검증 근거가 있다는 뜻이며, 운영 DB 적용이나 실제 Supabase 검증까지 자동으로 의미하지 않는다. 현황 기준일은 2026-08-30이다.

## 1. 저장소와 배포

- npm package 이름: `me-drugmgr`
- GitHub: `bubuuo1/me.drugmgr`
- Node.js: 24
- 배포: Vercel 프로젝트의 Git Integration
- GitHub Actions: 품질 검사만 수행, 배포하지 않음

새 Vercel 계정에 `me-drugmgr` 프로젝트를 만들고 `bubuuo1/me.drugmgr`를 Git Integration으로 연결해 Preview/Production 배포 흐름을 사용한다.

Google 로그인 운영 설정은 코드 저장소 밖에서 완료한다.

### 신규 빈 Supabase 프로젝트

1. 대상 프로젝트에 보존할 운영 데이터가 없는 새 빈 환경인지 확인한다.
2. Vercel의 최종 Push 발송 API URL과 `PUSH_DISPATCH_SECRET`을 정한 뒤, Supabase Vault에 `push_dispatch_url`과 같은 값의 `push_dispatch_secret`을 정확히 하나씩 먼저 등록한다. `supabase/schema.sql`은 두 Vault 항목이 없거나 중복이면 전체 트랜잭션을 실패시킨다.
3. `supabase/schema.sql`이 현재 전체 스키마를 만들지만 `drop` 문을 포함한다는 점을 다시 확인한 뒤 빈 프로젝트에만 적용한다. 기존 운영 DB나 보존할 데이터가 있는 환경에는 실행하지 않는다.
4. 스키마 적용 후 아래 공통 OAuth·환경변수 설정과 실제 RLS 허용·거부 검증을 완료한다.

### 기존 운영 DB 업그레이드

이 절차는 기존 운영 DB에 `20260829091546_remove_schedule_default_quantity.sql`까지 적용되어 있다는 전제다. 기준이 다르면 누락된 앞선 마이그레이션을 파일명 시각 순서로 먼저 검토하고, 전체 백업과 복구 연습 없이 적용하지 않는다.

1. 운영 DB를 백업한다.
2. `supabase/migrations/20260829110749_add_multi_user_family_auth.sql`, `supabase/migrations/20260830023000_rate_limit_family_invite_email.sql`, `supabase/migrations/20260830030000_harden_family_invite_email_rate_limits.sql`, `supabase/migrations/20260830033000_release_push_endpoint_on_logout.sql`, `supabase/migrations/20260830040000_protect_family_invite_email_claim.sql`, `supabase/migrations/20260830050000_soft_delete_medications_preserve_logs.sql`, `supabase/migrations/20260830050001_allow_caregiver_medication_management.sql`, `supabase/migrations/20260830050002_enforce_record_integrity.sql`을 순서대로 적용한다.
3. 기존 빈 상태 행이 없는지 확인하고, 발견되면 의료적 추정으로 값을 채우지 말고 데이터 소유자와 처리 방침을 확정한다. 빈 행이 없을 때 `supabase/migrations/20260830050003_validate_daily_status_content.sql`, `supabase/migrations/20260830050004_reject_whitespace_only_daily_status.sql`, `supabase/migrations/20260830050005_restrict_direct_record_mutations.sql`, `supabase/migrations/20260830050006_restrict_medication_log_classification.sql`을 순서대로 적용한다.
4. legacy 데이터 행 수와 약·일정·로그 스냅샷이 유지되는지 확인한다.

### 공통 OAuth·운영 연결

1. Google Cloud OAuth 동의 화면을 구성하고 웹 애플리케이션 OAuth Client ID/Secret을 만든다.
2. Google 승인된 redirect URI에 `https://<project-ref>.supabase.co/auth/v1/callback`을 등록한다.
3. Supabase Authentication > Providers > Google에 Client ID/Secret을 저장하고 공급자를 활성화한다.
4. Supabase Auth Site URL을 `https://<app>`으로 설정하고 Redirect URLs에 `https://<app>/auth/callback`, `http://localhost:3000/auth/callback`과 실제 사용할 Preview callback을 등록한다.
5. 인증 도입 전 기록이 있는 업그레이드 환경에서만 Google 로그인 후 실제 사용자 UUID를 확인하고 미지정 legacy 공간 `00000000-0000-4000-8000-000000000100`에 소유자 멤버십을 수동 지정한다. 첫 로그인 사용자에게 자동 지정하지 않는다.
6. 사용자 격리와 역할별 거부 테스트를 통과한 뒤 각 사용자가 필요한 복약 공간·기기에서 Push 알림을 다시 켠다.

실제 데이터 소유자를 확인한 뒤 legacy 공간 연결에만 다음 SQL을 한 번 사용한다.

```sql
insert into public.care_space_members (
  care_space_id,
  user_id,
  role
) values (
  '00000000-0000-4000-8000-000000000100',
  '<auth-user-uuid>',
  'owner'
)
on conflict (care_space_id, user_id)
do update set role = 'owner', invited_by = null;
```

가족 초대 안내 메일은 Vercel 서버에서 Gmail SMTP로 발송한다. 운영 환경에는 `APP_BASE_URL`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`와 선택 항목인 `GMAIL_SMTP_FROM_NAME`을 서버 전용 환경변수로 설정한다. Gmail 계정에는 2단계 인증과 앱 비밀번호가 필요하며 실제 비밀번호나 앱 비밀번호를 Git, `NEXT_PUBLIC_*`, 문서의 예시 값에 기록하지 않는다. DB RPC가 같은 초대의 발송을 1분에 한 번, 수신 주소별 하루 5회, 발신 사용자별 하루 50회, 앱 전체 하루 400회로 제한하며 하루는 한국 날짜를 기준으로 한다.

현재 인증 구현은 브라우저의 실제 origin에 `/auth/callback`을 결합하므로 `NEXT_PUBLIC_SITE_URL` 환경변수를 사용하지 않는다. Google Client Secret을 `.env.local`, Vercel의 `NEXT_PUBLIC_*` 또는 Git에 넣지 않는다.

Web Push 운영에는 다음 서버 설정이 필요하다.

- Vercel 공개 변수: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- Vercel 서버 전용 변수: `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET`
- Supabase Vault: `push_dispatch_url`, Vercel과 같은 `push_dispatch_secret`
- Supabase migration: `pg_cron`, `pg_net`, private push 테이블·RPC와 `medicine-push-dispatch` 매분 작업

service role key는 사용하지 않는다. VAPID private key와 발송 비밀값을 Git, `.env.example`의 실제 값, 브라우저 변수 또는 GitHub Actions secret에 복사하지 않는다.

### Gmail SMTP

1. 초대 발송에 사용할 Gmail 또는 Google Workspace 계정에서 2단계 인증을 켠다.
2. [Google 앱 비밀번호](https://myaccount.google.com/apppasswords)에서 이 앱용 앱 비밀번호를 만들고 일반 계정 비밀번호를 사용하지 않는다.
3. Vercel Production에 `APP_BASE_URL`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`와 선택 항목인 `GMAIL_SMTP_FROM_NAME`을 서버 전용으로 저장한다.
4. Production을 다시 배포한 뒤 Gmail과 다른 도메인의 주소로 각각 초대해 수신, 동일 이메일 Google 로그인, 앱 안 수락과 가족 추가까지 확인한다.
5. 앱 비밀번호를 채팅, 저장소, 로그와 화면 캡처에 공유하지 않는다. 관리형 Workspace 정책 등으로 앱 비밀번호를 사용할 수 없으면 계정 관리자 정책을 확인한다.

## 2. P0 — 데이터 정확성과 운영 기반

### Phase 0.0 Google 인증·복약 공간·가족 공유

- [x] Supabase SSR 브라우저·서버 클라이언트와 세션 갱신 proxy
- [x] Google 로그인, OAuth callback, 로그아웃과 mock 테스트 우회
- [x] 새 사용자의 빈 개인 복약 공간 자동 생성
- [x] 소유자·보호자의 약·일정·기록 쓰기, 소유자 전용 공간·구성원·초대 관리와 조회자 읽기 전용을 구분하는 `auth.uid()` 기반 RLS
- [x] 확인된 이메일 기반 초대 생성·수락·거절·취소
- [x] Gmail SMTP 초대 안내 이메일 발송·재발송과 실패 상태 구분
- [x] 현재 복약 공간 선택과 공간 전환 시 데이터 격리
- [x] 사용자·기기·복약 공간별 Push 대상 연결
- [x] 기존 데이터를 미지정 legacy 공간에 보존
- [x] 소유자의 복약 공간 이름 수정 UI와 repository 연결

### Phase 0.1 스키마 마이그레이션

- [x] 기존 약·일정·로그·상태를 legacy 공간에 보존
- [x] `profiles`, `care_spaces`, `care_space_members`, `care_space_invites`
- [x] 도메인 테이블의 `care_space_id`, `created_by`, `updated_by`
- [x] `quantity_options`
- [x] `(care_space_id, client_request_id)` unique
- [x] 약 이름·단위·일정 시각 스냅샷
- [x] `is_extra`, `deleted_at`
- [x] 공간+상태 날짜 unique
- [x] 투약 수량 `0 < quantity <= 1000` check, FK, 인덱스
- [x] snapshot과 `updated_at` trigger
- [x] anon 앱 데이터 권한 제거와 보호자의 약·일정 관리를 포함한 authenticated 역할별 RLS 정책
- [x] 약 soft delete를 연결 일정 비활성화 RPC로만 허용하고 상태 날짜 직접 변경 차단
- [ ] 서로 관계없는 사용자·공유 공간의 허용/거부 통합 테스트
- [x] 값과 메모가 모두 비어 있거나 메모가 모든 종류의 공백으로만 이루어진 상태 행을 DB check로 금지하고 기존 행 검증 완료

### Phase 0.2 Supabase 단일 저장소

- [x] localStorage·IndexedDB 코드 제거
- [x] mock 외의 fallback DB 제거
- [x] Supabase URL·공개 키 형식과 secret/service-role 키 거부 검증 로직
- [x] 설정 오류를 로그인 화면에서 일반 로그인·네트워크 오류와 구분해 표시
- [x] publishable key와 legacy anon key 호환
- [x] 인증 세션 쿠키 사용, 건강 기록의 브라우저 영구 저장 비활성화
- [x] 조회 로딩·정상 빈 상태·일반 오류 구분
- [x] 인증·권한·네트워크·DB 오류의 안전하고 일관된 사용자 메시지 매핑

### Phase 0.3 쓰기 신뢰성

- [x] 모든 create/update/delete `await`
- [x] 성공 응답 전 완료 UI 금지
- [x] 저장 중 중복 제출 차단
- [x] 재시도 시 같은 `client_request_id` 사용
- [x] 실패 시 가짜 로컬 기록 없음
- [x] 쓰기 성공 후 DB 반환 행 반영과 여러 행 변경 작업의 관련 데이터 갱신
- [x] 같은 `client_request_id`를 다른 payload에 재사용할 때 기존 행과 비교하고 다른 내용이면 충돌로 거부

### Phase 0.4 일정·시간·과거 무결성

- [x] 일정 진입 기록에 정확한 `schedule_id` 연결
- [x] 일정 없는 기록과 삭제된 일정의 과거 분류 구분
- [x] KST 날짜 경계 유틸 통일
- [x] `timestamptz` 저장과 KST 표시
- [x] 약·일정 설정 변경 후 스냅샷을 자동 갱신하지 않는 DB trigger
- [ ] 실제 Supabase에서 약·일정 변경·삭제 후 과거 스냅샷 불변 검증
- [x] 화면 합계·일정 상태에서 soft delete 행 제외
- [x] 일반 조회에서 soft delete 투약 로그를 가져오지 않기
- [ ] 날짜·홈 조회를 서버 날짜 범위 쿼리로 제한하기
- [x] 삭제된 일정 로그를 편집할 때 사용자가 새 분류를 고르기 전 `is_extra = false`와 예정 스냅샷 유지
- [x] 일반 기록 편집에서 `medication_id`를 바꾸지 못하도록 DB update column grant와 repository 입력 제한
- [x] `schedule_id`·`is_extra` 직접 update 권한을 제거하고 검증 RPC에서만 명시적 재분류 허용

### Phase 0.5 핵심 화면 안정화

- [x] 홈 활성 약 조회
- [x] 투약 수량 선택과 직접 입력
- [x] 오늘 상태 upsert와 빈 입력 저장 차단
- [x] 날짜별 투약 조회·표시
- [x] 기본 조회·저장 오류 UI
- [x] 모바일 기본 접근성
- [x] 홈의 `오늘 예정` 다음에 권한별 `약·일정 관리` 또는 보기 진입점 제공
- [x] 의료·응급 대응 비제공 공통 안내를 로그인 화면에 제공

## 3. P1 — 일상 사용 기능

### Phase 1.1 홈 정보

- [x] 약별 전체 마지막 복용 시각과 수량 표시
- [x] 약별 오늘 누적
- [x] 일정별 상태를 쓰기 권한과 관계없이 `기록 있음 / 아직 기록 없음` 텍스트로 식별
- [x] 미복용·지연 판정 문구 없음

### Phase 1.2 상세 투약

- [x] 실제 복용 시각 입력·수정
- [x] 메모
- [x] 일정 복용과 추가 복용 구분
- [x] 수량·시각·메모와 일정 분류의 명시적 기록 수정
- [x] soft delete
- [x] 삭제 실행 취소

### Phase 1.3 상태와 타임라인

- [x] 날짜별 상태 조회·수정·삭제
- [x] 날짜별 투약+상태 타임라인
- [x] 실제 시각 정렬
- [x] 통계·추이·의료 해석 없음

### Phase 1.4 약과 스케줄 설정

- [x] 약 추가·수정·활성화·비활성화·soft delete
- [x] 수량 선택지 설정
- [x] 약별 여러 복용·알림 시간 연속 추가·수정·켜기·끄기·삭제
- [x] 사용 이력의 연쇄 삭제 방지
- [x] 약 삭제 후 등록 목록·일정·알림 제외 및 mock E2E의 과거 약 이름·실제 복용 시각·수량 보존
- [x] 조회자 설정 안내에서 약·일정 변경 주체를 `소유자와 보호자`로 정확히 표시

### Phase 1.5 접근성 완료

- [ ] 최소 48px 터치 영역
- [ ] 200% 글자 확대
- [ ] 키보드 전체 흐름
- [ ] 화면 낭독기 이름·상태·라이브 영역
- [ ] 포커스 관리
- [ ] 색상 외 상태 텍스트
- [x] 공용 날짜·시간 선택기의 모바일 하단 시트·넓은 화면 대화상자와 1분 단위 입력
- [x] 320px·375px 화면과 날짜·시간 선택기 핵심 흐름 E2E

### Phase 1.6 PWA Web Push — 완료

- [x] manifest의 앱 id·scope와 홈 화면 아이콘
- [x] 캐시 없는 push 전용 서비스 워커
- [x] 환경설정의 사용자·기기·접근 가능 공간별 알림 켜기·테스트·끄기
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
- [x] 발송 생성·직전의 공간 멤버십 재검증과 권한 회수 시 대상 삭제
- [x] 알림 클릭 시 해당 투약 기록 화면 열기
- [x] 약 이름·예정 시각 알림 문구, 단색 캡슐 badge와 클릭한 일정 알림 정리
- [x] 알림 지연 가능성과 미복용 판정 아님을 안내

### 2026-08-30 정합성 감사에서 해소한 불일치

| 확인된 불일치 | 적용한 기준과 해소 내용 |
|---|---|
| 중복 사용자 요청의 우선순위가 불명확함 | 같은 주제는 마지막 사용자 요청을 정본으로 삼는 규칙을 `docs/README.md`에 고정했다. |
| 누락·무효·비활성 일정 링크가 조용히 추가 복용으로 바뀜 | `schedule=<id>`가 유효하지 않고 `extra=1`도 없으면 저장 폼을 제공하지 않는다. 사용자가 추가 복용 또는 첫 화면 재선택을 명시해야 한다. |
| 최초 공간 조회 실패가 정상 빈 화면과 함께 보이고 재시도할 수 없음 | 홈·복용기록·환경설정·가족 공유에서 선택 공간이 없는 조회 오류는 오류 화면만 표시하고 하단 메뉴를 숨긴다. 재시도는 공간 목록부터 다시 조회한다. |
| 약 `deleted_at` 직접 update가 연결 일정 비활성화 RPC를 우회함 | 직접 update 권한을 제거하고 호출 사용자·역할을 검사하는 원자적 soft-delete RPC만 허용한다. |
| 상태 `date` 직접 update로 기록 날짜를 이동할 수 있음 | `date` update 권한을 제거하고 날짜별 제한 upsert RPC를 사용한다. |
| 로그 `schedule_id`·`is_extra` 직접 update로 삭제 일정 전용 분류를 위조할 수 있음 | 두 분류 필드의 직접 update 권한을 제거하고, 호출 사용자·역할·로그·일정·약 관계를 검사하는 원자적 재분류 RPC만 허용한다. |
| mock 일반 편집이 `schedule_id: undefined`를 일정 삭제로 해석해 E2E를 거짓 통과시킴 | store는 정의되지 않은 patch 필드를 제거하고, mock도 실제 분류 값이 함께 제공된 경우에만 재분류한다. 일반 편집 뒤 일정 연결 ID가 유지되는지 E2E로 확인한다. |
| 탭·줄바꿈만 있는 상태 메모가 DB check를 통과함 | POSIX whitespace를 기준으로 비공백 문자가 하나 이상 있어야 하도록 검증 제약을 강화했다. |
| Push 서버 액션이 Supabase 원문 오류를 반환할 수 있음 | 사용자 입력·인증·권한·설정·연결 오류를 제한된 문구로 매핑하고 원문은 반환하지 않는다. |
| CSS 토큰 유일 정의 규칙과 manifest/viewport 리터럴이 충돌함 | CSS 변수를 읽지 못하는 플랫폼 메타데이터만 명시적 예외로 두고 manifest·viewport 값을 E2E로 고정한다. |

### 확인된 잔여 제약

다음 항목은 이번 배포 뒤에도 남으며, 완료 또는 무위험으로 표현하지 않는다.

- 실제 사용자 계정 두 개 이상을 사용한 RLS 허용·거부와 실제 Supabase trigger·스냅샷 회귀 통합 테스트가 없다.
- 공간 초기 조회가 전체 삭제되지 않은 로그와 상태를 가져온 뒤 화면에서 날짜를 거른다. 홈·날짜별 서버 범위 조회가 남아 있다.
- 48px 터치 영역, 200% 글자 확대, 전체 키보드·화면 낭독기·포커스 흐름과 색상 외 상태 표현은 부분 E2E만 있고 종합 접근성 검증이 남아 있다.
- MCP로 적용한 운영 migration version과 저장소 파일명의 version이 다르다. migration history를 명시적으로 정렬하기 전에는 운영 DB에 `supabase db push`를 사용하지 않고, 검토한 SQL을 순서대로 적용한다.
- Supabase Security Advisor의 `SECURITY DEFINER` RPC, public `pg_net`, leaked-password protection 경고가 남아 있다. 현재 RPC는 `auth.uid()`·역할 또는 Vault 발송 비밀값을 검사하지만 비밀 유출과 설정 회귀 위험까지 사라진 것은 아니다.
- Vercel의 `GMAIL_SMTP_APP_PASSWORD`는 서버 전용이지만 운영 감사 시 Sensitive 유형이 아니었다. 값 노출 없이 Sensitive로 재등록하고 필요하면 앱 비밀번호를 회전해야 한다.
- Production에는 `NEXT_PUBLIC_USE_MOCK_DB=true`를 설정하지 않는다. 배포 전 환경변수 이름을 확인하고 mock은 Playwright 프로세스에서만 켠다.
- Supabase Performance Advisor의 미인덱스 FK·미사용 인덱스 정보 항목은 실제 쿼리 부하와 사용 통계를 확인한 뒤 조정한다.

### 아직 확정하지 않은 개선 후보

다음은 목적과 현재 제약 사이의 긴장 관계이지만 승인된 요구사항이나 backlog는 아니다. 구현 전에 제품 결정을 먼저 기록한다.

- 기록이 생길 때까지 5분마다 반복하는 알림은 알림 피로를 만들거나 알림을 멈추기 위한 부정확한 기록을 유도할 수 있다. 복용 사실과 분리된 `오늘 이 일정 알림 그만 받기`가 필요한지 검토한다.
- 서로 다른 가족 기기가 같은 실제 복용을 각자 저장하면 서로 다른 `client_request_id`로 두 행이 생길 수 있다. 현재의 최근 유사 기록 확인을 유지하면서 작성자 표시나 낙관적 충돌 감지가 필요한지 검토한다.
- 실시간 구독이 없으므로 계속 열린 화면의 데이터 신선도 계약, 수동 새로고침과 주기적 재검증 범위를 정할 필요가 있다.
- 소유권 이전, 소유자 계정 상실, 자진 탈퇴, 공간·계정 삭제와 운영 백업 보존 기간은 별도 데이터 생명주기 결정이 필요하다.

## 4. 테스트 전략

### 단위·통합 테스트 대상

- OAuth callback code 교환 실패와 안전한 내부 redirect
- 인증 없는 보호 경로의 로그인 redirect
- 새 사용자의 빈 개인 복약 공간 생성
- 관계없는 두 사용자의 RLS 격리
- 소유자·보호자의 약·일정·기록 쓰기, 보호자의 공간 이름·구성원·초대 관리 거부와 조회자의 모든 쓰기 거부
- 확인된 이메일이 일치하는 초대만 수락·거절
- 공간 전환 시 이전 공간 데이터가 남지 않음
- 사용자·기기·공간 Push opt-in과 멤버십 회수 후 발송 제외
- KST 날짜 변환과 자정 경계
- 수량 검증
- 일정 연결과 추가 복용 분류
- 삭제된 일정 로그의 과거 분류 보존과 명시적 재분류
- 마지막 복용·오늘 누적 계산 시 soft delete 제외
- Supabase 오류 매핑
- 같은 `client_request_id`의 멱등성
- 같은 `client_request_id`와 다른 payload의 충돌 처리
- 비어 있는 상태 행과 1000 초과 수량의 DB 거부

실제 Supabase 또는 로컬 Supabase를 사용하는 별도 통합 테스트는 아직 없다. RLS, trigger, composite FK·unique와 migration 보존을 완료로 판정하려면 메모리 mock과 별개인 SQL/통합 테스트 경로를 추가해야 한다.

### Playwright

Playwright는 `NEXT_PUBLIC_USE_MOCK_DB=true`를 사용하고 외부 Google/Supabase 인증을 우회한다. mock은 테스트 프로세스의 메모리에만 존재하며 다음을 사용하지 않는다.

- 실제 Supabase
- localStorage
- IndexedDB
- 운영 인증 쿠키
- 파일 기반 영구 저장

따라서 Playwright 성공만으로 실제 Supabase RLS·trigger·migration이 검증되었다고 판단하지 않는다.

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
- 96x96 단색 캡슐 알림 badge와 알림 클릭 후 같은 일정 표시 정리
- 설정 화면의 알림 상태와 기기별 제어
- 복약 공간 선택과 역할 표시
- 가족 초대 생성·수락·거절·취소
- 가족 초대 안내 이메일 발송 성공·실패와 재발송
- 보호자의 약·일정 설정 UI 제공, 보호자의 공간 이름·구성원·초대 관리 차단과 조회자의 모든 쓰기 UI 차단
- 한 약에 두 복용·알림 시간을 추가 버튼 재클릭 없이 연속 저장하고 각각 수정·삭제
- 비밀값이 없거나 잘못된 Vercel 발송 API 요청 거부

## 5. GitHub Actions CI

`.github/workflows/ci.yml`은 push, pull request, 수동 실행에서 다음 순서로 품질을 검사한다.

1. Node.js 24 설정
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
- 보호 경로가 Google 로그인 세션을 요구함
- 관계없는 복약 공간은 RLS와 복합 FK로 격리됨
- 소유자·보호자의 약·일정 쓰기와 소유자 전용 공간·구성원·초대 관리, 확인된 이메일 초대 수락이 DB에서 강제됨
- 실패한 쓰기를 성공으로 표시하지 않음
- 반복 제출로 중복 로그가 생기지 않음
- 한국 날짜 경계와 과거 스냅샷 테스트 통과
- push 서비스 워커가 앱/API 요청을 오프라인 캐시하지 않음
- 발송 API, Supabase 발송 RPC와 Cron 비밀값이 브라우저나 Git 저장소에 노출되지 않음
- 이미 기록했거나 비활성·삭제된 일정과 중복 발송이 DB 규칙 및 발송 직전 재검증으로 제외됨
- 기록 전 5분 회차와 한국 날짜 자정 종료가 DB 규칙으로 계산됨
- 초대 메일 자격 증명이 브라우저나 Git 저장소에 노출되지 않고, 메일 링크만으로 가족 권한이 생기지 않음

## 8. 명시적 제외

- 비밀번호·SMS 로그인, 접근 코드, 기기 승인 목록
- localStorage, IndexedDB, 오프라인 캐시·큐·동기화
- 백업·복원, CSV/PDF
- 미복용·지연 복용 판정과 알림의 정시·필수 도착 보장
- 통계·그래프·추이
- AI 분석과 의료 판단

위 항목은 개발 backlog가 아니라 현재 제품 범위에서 제외된 결정이다.
