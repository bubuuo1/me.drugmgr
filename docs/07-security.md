# 보안과 개인정보

> 이 문서는 인증, RLS, 비밀값과 개인정보 보호 규칙의 정본이다. 역할별 제품 권한은 [02 기능 요구사항](02-requirements.md), 실제 DB 객체는 [06 데이터베이스](06-database.md)를 따른다.

## 1. 확정된 접근 모델

모든 사용자는 Supabase Auth를 통한 Google OAuth로 로그인한다. URL과 publishable key는 공개 값이며 데이터 접근 권한이 아니다. 서버에서 교환한 인증 세션의 `auth.uid()`와 DB 멤버십이 권한의 근거다.

한 사람의 건강 데이터는 하나의 복약 공간으로 분리한다. 사용자는 자신이 구성원인 공간만 볼 수 있으며 역할은 다음과 같다.

- `owner`: 전체 조회, 약·일정·기록 작성·수정, 공간 이름·구성원·초대 관리
- `caregiver`: 소유자와 다른 구성원 정보를 포함한 전체 조회, 약·일정·투약 로그·하루 상태 작성·수정
- `viewer`: 조회 전용

소유자와 보호자는 약을 비활성화하거나 soft delete하고 일정을 삭제할 수 있다. 복약 공간 이름·구성원·초대 변경은 소유자만 할 수 있다.

새 사용자는 다른 사람의 처방이나 기록이 들어 있지 않은 개인 공간을 받는다. 인증 도입 전 데이터는 소유자 없는 미지정 legacy 공간으로 보존하므로 운영자가 실제 소유자를 검증하기 전에는 누구도 접근하지 못한다.

## 2. Supabase 공개 키

클라이언트에는 다음만 사용할 수 있다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- 호환이 필요한 경우 `NEXT_PUBLIC_SUPABASE_ANON_KEY`

publishable/anon key는 브라우저에 공개되는 키다. `service_role`, `sb_secret_...` 등 비밀 키는 코드, `.env.example`, GitHub Actions, Vercel의 `NEXT_PUBLIC_*` 변수에 넣지 않는다.

운영 모드에서 URL 또는 공개 키가 없거나 비밀 키 형식이 들어오면 앱은 Supabase 클라이언트를 만들지 않고 설정 오류를 표시한다. Google OAuth Client Secret은 Supabase Dashboard의 공급자 설정에만 저장하며 앱 환경변수나 Git에 넣지 않는다.

Web Push에서 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`는 브라우저에 공개해도 되는 키다. 다음 값은 서버 전용이며 코드나 `NEXT_PUBLIC_*` 변수에 넣지 않는다.

- `VAPID_PRIVATE_KEY`: Vercel 환경변수
- `PUSH_DISPATCH_SECRET`: Vercel 환경변수와 Supabase Vault에 동일하게 저장
- push 발송 URL: Supabase Vault

이 기능은 service role key를 사용하지 않는다. Supabase Cron의 요청과 Vercel 발송 API, 발송용 RPC는 `PUSH_DISPATCH_SECRET`으로 연결한다.

로그아웃할 때는 현재 기기의 모든 가족별 Push 대상 행을 삭제하고 구독 endpoint의 사용자 소유권을 해제한다. 브라우저 구독 해제가 실패해도 다음 로그인 사용자가 같은 endpoint를 안전하게 다시 등록할 수 있다.

가족 초대 메일의 `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`와 선택 항목인 `GMAIL_SMTP_FROM_NAME`도 Vercel 서버 전용 환경변수다. 앱 비밀번호는 코드, Git, 로그, `NEXT_PUBLIC_*`에 넣지 않는다. 메일 링크는 가족 권한 토큰이 아니며, 로그인 세션의 확인된 이메일과 대기 초대가 일치한 사용자가 앱에서 직접 수락해야만 DB 멤버십을 만든다. 발송 quota RPC는 서버 전용 `PUSH_DISPATCH_SECRET`을 검증하고 익명·이메일 미확인 사용자를 거부한다. 발송 권한은 DB가 소유자와 대기 초대를 다시 확인하고, 같은 초대는 1분에 한 번, 수신 주소별 하루 5회, 발신 사용자별 하루 50회, 앱 전체 하루 400회까지만 원자적으로 허용한다. 하루 기준은 한국 날짜다.

## 3. RLS와 역할 권한

모든 공개 앱 테이블은 RLS를 활성화하고 `anon`에는 앱 데이터 권한을 주지 않는다. `authenticated`에도 필요한 테이블·컬럼 권한과 정책만 명시적으로 부여한다.

- 프로필: 본인 또는 같은 복약 공간을 공유하는 구성원만 조회, 본인만 수정
- 복약 공간·구성원: 구성원만 조회, 소유자만 관리
- 약·일정: 구성원은 조회, 소유자와 보호자는 생성·수정·비활성화·삭제
- 투약 로그·하루 상태: 구성원은 조회, 소유자와 보호자만 생성·수정·삭제
- 초대: 소유자용 목록과 제한 RPC로 관리

정책에서 현재 사용자는 `auth.uid()`로 확인한다. 재귀적인 멤버십 정책을 피하기 위한 `private` security-definer helper는 고정된 빈 `search_path`를 사용하고 실행 권한을 `authenticated`에만 제한한다. 공간 안의 FK는 `care_space_id`를 포함한 복합 키를 사용해 다른 공간의 약·일정을 서로 연결하지 못하게 한다.

정책 테스트는 최소 두 명의 관계없는 사용자와 한 공유 공간을 만들고 다음을 모두 검증한다.

- 자기 공간과 초대받은 공간의 허용 동작 성공
- 관계없는 공간의 목록·행·구성원·초대 조회 실패
- 보호자의 약·일정 관리 성공과 공간 이름·구성원·초대 관리 실패
- 조회자의 모든 쓰기 실패
- `care_space_id`와 약·일정 ID를 섞은 쓰기 실패

Web Push 구독과 발송 이력은 Data API에 노출하지 않는 `private` 스키마에 두고 RLS를 활성화한다. `anon`과 `authenticated`에는 private 테이블 권한을 주지 않는다. 서버의 제한 RPC는 `auth.uid()`, endpoint 소유권, 선택 공간의 현재 멤버십과 Vault 발송 비밀값을 검사한다. 발송 직전에도 멤버십을 재확인해 권한이 회수된 사용자에게 새 알림을 보내지 않는다.

## 4. DB가 보장할 규칙

클라이언트 입력만 신뢰하지 않는다.

- 중복 방지용 `(care_space_id, client_request_id)` unique
- 수량 양수 check
- 복약 공간+상태 날짜 unique
- 약·일정 FK
- 로그 스냅샷을 DB trigger로 생성
- `updated_at`을 DB trigger로 갱신
- 과거 로그를 연쇄 삭제하지 않는 FK 정책
- 도메인 관계가 같은 `care_space_id`에 속하도록 하는 복합 FK
- 감사 필드의 `created_by`, `updated_by`를 `auth.uid()`로 설정

로그의 약 이름·단위·일정 시각 스냅샷은 클라이언트가 임의로 정하는 값이 아니라 insert 시 DB가 현재 설정에서 복사한다.

## 5. 브라우저 데이터

- 앱 데이터는 React 메모리와 화면 상태에만 일시적으로 존재할 수 있다.
- localStorage, IndexedDB, Cache Storage, 쿠키에 건강 기록을 저장하지 않는다.
- 인증 유지에는 Supabase SSR이 관리하는 보안 쿠키를 사용한다. 이 쿠키에는 건강 기록을 넣지 않는다.
- 서비스 워커로 화면이나 API 응답을 오프라인 캐시하지 않는다.
- 네트워크 요청 실패 내용을 큐에 보관하지 않는다.
- 페이지 새로고침 후 데이터는 Supabase에서 다시 조회한다.

Web Push를 켠 경우에는 브라우저가 서비스 워커, 알림 권한과 Push 구독을 관리한다. 서비스 워커에는 `fetch` 캐시 핸들러가 없으며 앱 화면, API 응답, 투약·상태 데이터를 저장하지 않는다. Push 구독은 로그인 사용자와 사용자가 직접 선택한 복약 공간에 연결하지만 승인 기기 증명은 아니다.

Playwright mock DB도 테스트 프로세스의 메모리에만 존재하고 실제 Supabase나 브라우저 영구 저장소를 사용하지 않는다.

## 6. 개인정보 최소화

저장 대상은 로그인 식별자와 최소 프로필, 공유 초대, 약 설정, 복용 기록, 상태 선택, 사용자가 작성한 메모로 제한한다.

- Google에서 받은 표시 이름·아바타와 확인된 이메일 외에 주민등록번호, 주소, 전화번호를 요구하지 않는다.
- 확인된 이메일은 초대 대상 일치 확인에만 사용하고 역할 판정에는 DB 멤버십을 사용한다.
- 메모에 불필요한 식별정보를 쓰지 않도록 안내한다.
- 오류·분석 로그에 약 메모나 상태 내용을 보내지 않는다.
- push payload에는 상태 기록이나 사용자가 작성한 메모를 넣지 않는다.
- 알림 제목의 예정 시각과 약 이름은 기기 알림 화면에 보일 수 있으므로 화면 잠금 알림 노출 범위는 해당 기기 설정을 따른다.
- 브라우저 콘솔에 Supabase 응답 전체나 환경변수를 출력하지 않는다.
- 화면 공유·공용 기기 사용 시 건강 기록이 노출될 수 있음을 운영자가 이해해야 한다.

## 7. OAuth와 운영

- Google OAuth의 승인된 redirect URI에는 Supabase callback인 `https://<project-ref>.supabase.co/auth/v1/callback`만 정확히 등록한다.
- 앱의 `https://<app>/auth/callback`과 로컬 `http://localhost:3000/auth/callback`은 Supabase Auth Redirect URLs에 등록한다.
- OAuth callback의 `next` 값은 내부 경로만 허용하고 외부 URL로 redirect하지 않는다.
- 로그아웃과 구성원 회수는 별개다. 공유를 중단하려면 소유자가 해당 멤버십을 제거해야 한다.
- 공용 기기에서는 사용 후 로그아웃하며 OS 잠금 화면의 알림 노출 설정을 확인한다.
- 기존 데이터의 legacy 공간 소유자는 계정 이메일과 실제 데이터 주체를 확인한 운영자만 수동 지정한다.

## 8. 제외 보안 기능

- 비밀번호·SMS 로그인과 자체 계정 복구
- 접근 코드와 승인 기기 목록
- 로컬 암호화 건강 데이터 저장소
- 애플리케이션 내 백업·복원

Google 및 Supabase 계정의 보안, OAuth 동의 화면 운영, 데이터베이스 백업과 구성원 권한 회수는 운영자가 계속 관리해야 한다.
