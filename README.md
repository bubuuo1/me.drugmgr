# me.drugmgr

근무력증 환자의 투약과 하루 상태를 본인과 가족이 여러 기기에서 함께 기록하는 모바일 우선 웹 앱입니다. Google 계정으로 로그인한 뒤 권한이 있는 사람의 복약 공간만 조회하거나 기록할 수 있습니다.

> 이 앱은 투약 일기입니다. 복용량을 결정하거나 처방 변경을 권고하지 않으며, 응급 대응 수단이 아닙니다.

## 구현 완료 기능

현재 작업 트리에는 Google 인증과 가족 공유 기능이 구현되어 있습니다. Google·Supabase 콘솔 설정만으로 운영 앱 화면이 바뀌지는 않으며, 아래 [운영 전환 체크리스트](#운영-전환-체크리스트)에 따라 새 코드를 Production에 배포해야 로그인 화면이 나타납니다.

- 접근: Google OAuth 로그인과 서버 측 세션 갱신, 비로그인 사용자의 로그인 화면 이동
- 격리: 한 사람의 기록을 하나의 복약 공간(`care space`)으로 분리하고 Supabase RLS로 접근 제한
- 공유: 소유자가 Gmail·네이버 등 이메일 주소로 보호자 또는 조회자 초대 메일을 보내고, 같은 이메일의 Google 계정으로 로그인한 사용자가 앱 안에서 수락·거절
- 데이터: 약·일정·투약 로그·하루 상태를 선택한 복약 공간 단위로 조회·저장
- 기록: 약 이름·실제 복용 시각·수량, 일정/추가 복용 구분, 수정, soft delete와 실행 취소
- 약 설정: 약·복용 일정 등록·수정·비활성화와 등록 약 삭제, 기존 복용 기록 보존
- 알림: 환경설정에서 로그인 사용자·기기·접근 가능 복약 공간별 Web Push 수신, 테스트와 해제
- 환경: 모바일 우선, 온라인 전용, 한국 날짜(`Asia/Seoul`) 기준
- 입력 UI: shadcn/ui의 모바일 크기 입력·버튼, React Hook Form 상태 관리, Zod 날짜·시간 검증
- 배포: [bubuuo1/me.drugmgr](https://github.com/bubuuo1/me.drugmgr)의 Vercel Git Integration 사용

새 사용자는 기록이 없는 개인 복약 공간을 받습니다. 다른 사람의 기록은 해당 공간에 초대받은 구성원만 볼 수 있습니다.
앱을 새로 열면 본인이 소유한 복약 공간을 기본 기록 대상으로 사용합니다. 가족 기록 전환, 가족 관리, 가족별 현재 기기 알림과 로그아웃은 모바일 하단의 `환경설정`에서 관리합니다. 알림을 눌러 들어온 명시적 복약 공간 링크는 기본 대상보다 우선합니다.

- `owner`(소유자): 약·일정·구성원·초대를 관리하고 기록을 조회·작성·수정
- `caregiver`(보호자): 기록을 조회하고 투약 로그·하루 상태를 작성·수정
- `viewer`(조회자): 기록 조회만 가능

등록 약을 삭제하면 약 목록과 앞으로의 일정·알림에서는 제외되지만, 이미 저장한 복용 기록은 삭제되지 않습니다. `복용기록`에서 기록 당시의 약 이름, 실제 복용 시각, 수량과 단위를 계속 확인할 수 있습니다.

인증 도입 전 데이터는 마이그레이션 시 `기존 데이터 (미지정)` 공간에 보존됩니다. 이 공간은 운영자가 실제 데이터 소유자를 확인해 연결하기 전까지 누구에게도 공개되지 않습니다.

알림은 각 사용자가 현재 기기에서 필요한 복약 공간마다 직접 켜야 합니다. 가족 구성원에게 자동 구독되지 않으며, 공간 접근 권한이 해제되면 그 공간의 새 알림도 발송되지 않습니다. 활성 일정의 알림은 해당 한국 날짜의 같은 일정 기록이 생길 때까지 5분마다 발송을 시도합니다. 알림은 기록을 확인하라는 안내일 뿐 미복용 여부를 판정하거나 정시 도착을 보장하지 않습니다. iPhone/iPad는 iOS/iPadOS 16.4 이상에서 Safari로 홈 화면에 추가한 앱을 사용해야 합니다.

## 명시적 제외

- 비밀번호 로그인, 접근 코드, 기기 승인
- localStorage, IndexedDB, 오프라인 캐시, 오프라인 큐, 동기화
- 백업·복원, CSV/PDF 내보내기
- 미복용·지연 복용 판정과 알림의 정시 도착 보장
- 통계·그래프·추이 분석
- AI 분석, 의료 판단, 복용량·처방 추천

## 로컬 실행

요구 사항은 Node.js 22와 npm입니다.

```bash
git clone https://github.com/bubuuo1/me.drugmgr.git
cd me.drugmgr
npm ci
```

`.env.example`을 `.env.local`로 복사하고 Supabase 프로젝트 값을 입력합니다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
APP_BASE_URL=https://me-drugmgr.vercel.app
GMAIL_SMTP_USER=YOUR-GMAIL-ADDRESS
GMAIL_SMTP_APP_PASSWORD=YOUR-GMAIL-APP-PASSWORD
GMAIL_SMTP_FROM_NAME=투약 관리
NEXT_PUBLIC_VAPID_PUBLIC_KEY=YOUR-PUBLIC-VAPID-KEY
VAPID_PRIVATE_KEY=YOUR-PRIVATE-VAPID-KEY
VAPID_SUBJECT=https://YOUR-DEPLOYMENT.example
PUSH_DISPATCH_SECRET=YOUR-RANDOM-DISPATCH-SECRET
```

기존 프로젝트가 legacy anon key를 사용하면 `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 호환 변수로 사용할 수 있습니다. publishable/anon 키는 브라우저 공개용이며, service role key는 클라이언트 환경변수에 넣지 않습니다.

Gmail 계정 비밀번호가 아니라 2단계 인증 후 발급한 앱 비밀번호를 사용합니다. Gmail SMTP 값, VAPID private key와 발송 비밀값은 서버 전용입니다. 운영 환경에서는 Vercel 환경변수에 저장하고, Supabase Vault에는 발송 URL과 같은 `PUSH_DISPATCH_SECRET`을 저장합니다. 알림 발송 스케줄은 Supabase Cron이 매분 Vercel API를 호출합니다.

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

## 운영 전환 체크리스트

Google·Supabase 설정과 애플리케이션 배포는 별개의 작업입니다. 특히 새 인증 코드를 커밋·푸시해 Vercel Production 배포를 완료하지 않으면 기존 운영 화면에는 Google 로그인 버튼이 나타나지 않습니다.

1. 운영 Supabase DB를 백업한 뒤 `supabase/migrations/20260829110749_add_multi_user_family_auth.sql`, `supabase/migrations/20260830023000_rate_limit_family_invite_email.sql`, `supabase/migrations/20260830030000_harden_family_invite_email_rate_limits.sql`, `supabase/migrations/20260830033000_release_push_endpoint_on_logout.sql`, `supabase/migrations/20260830040000_protect_family_invite_email_claim.sql`, `supabase/migrations/20260830050000_soft_delete_medications_preserve_logs.sql`을 순서대로 적용합니다.
2. 이 저장소의 인증·복약 공간 관련 변경을 함께 커밋하고 GitHub에 푸시합니다. Vercel의 Production 배포가 성공했는지 확인한 뒤, 로그아웃 상태에서 `/` 접속 시 `/login`으로 이동하는지 확인합니다.
3. Google Cloud에서 외부 사용자용 OAuth 동의 화면과 **웹 애플리케이션** OAuth 클라이언트를 구성합니다. 승인된 JavaScript 원본에는 운영 앱 주소를, 승인된 리디렉션 URI에는 `https://<project-ref>.supabase.co/auth/v1/callback`을 등록합니다.
4. Supabase Dashboard의 Authentication > Providers > Google에서 Google 공급자를 켜고 Client ID와 Client Secret을 저장합니다. Client Secret은 저장소나 Vercel 공개 환경변수에 넣지 않습니다.
5. Supabase Authentication의 Site URL을 운영 앱 주소로 설정하고 Redirect URLs에 `https://<app>/auth/callback`과 `http://localhost:3000/auth/callback`을 등록합니다. Preview 배포로 로그인한다면 사용할 Preview 주소도 명시적으로 허용합니다.
6. Vercel Production 환경에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(또는 legacy anon key), Push 환경변수와 초대 메일용 `APP_BASE_URL`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`, 선택 항목인 `GMAIL_SMTP_FROM_NAME`을 설정하고 다시 배포합니다.
7. 운영 주소에서 Google 로그인과 개인 공간 생성을 확인합니다. 인증 도입 전 기록이 있다면 Supabase Authentication에서 실제 소유자의 사용자 UUID를 확인한 뒤 아래 SQL의 `<auth-user-uuid>`를 바꾸어 한 번만 실행합니다.

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

8. 개인 공간 격리와 가족 초대 권한을 확인한 뒤, 환경설정에서 사용하는 기기마다 필요한 각 가족의 알림을 개별적으로 켭니다. 이전 익명 Push 구독은 사용자·공간 구독으로 자동 승격되지 않습니다.

초대 메일은 Gmail SMTP에서 Gmail·네이버 등 임의의 수신 주소로 보낼 수 있습니다. 다만 초대는 그 주소와 확인된 이메일이 같은 Google 계정으로 로그인한 사용자가 앱에서 명시적으로 수락해야만 권한으로 전환됩니다. 메일 발송 실패 시 저장된 대기 초대에서 다시 보낼 수 있습니다. 남용 방지를 위해 같은 초대는 1분에 한 번, 수신 주소별 하루 5회, 발신 사용자별 하루 50회, 앱 전체 하루 400회까지만 발송하며 하루 기준은 한국 날짜입니다.

### 배포 후 Gmail SMTP 설정

1. 초대 발송에 사용할 Gmail 또는 Google Workspace 계정에서 2단계 인증을 켭니다.
2. [Google 앱 비밀번호](https://myaccount.google.com/apppasswords)에서 이 앱용 16자리 앱 비밀번호를 만듭니다. 일반 Google 계정 비밀번호를 사용하지 않습니다.
3. Vercel 프로젝트의 Settings > Environment Variables에서 Production에 다음 값을 저장합니다.
   - `APP_BASE_URL=https://me-drugmgr.vercel.app`
   - `GMAIL_SMTP_USER`: 발송 Gmail 주소
   - `GMAIL_SMTP_APP_PASSWORD`: 16자리 앱 비밀번호
   - `GMAIL_SMTP_FROM_NAME=투약 관리`(선택)
4. 환경변수는 새 배포부터 적용되므로 Production을 다시 배포합니다.
5. 운영 앱에서 본인 외의 Gmail 주소와 네이버 주소로 각각 초대를 보내 수신함·스팸함, 동일 이메일 Google 로그인, 수락 후 가족 추가까지 확인합니다.

앱 비밀번호는 채팅, 저장소, 화면 캡처에 공유하지 않습니다. 관리형 Workspace 정책, 고급 보호 프로그램 또는 보안 키만 사용하는 2단계 인증에서는 앱 비밀번호 메뉴가 보이지 않을 수 있으므로 해당 계정 관리자 정책을 확인합니다.

## 품질 검사

```bash
npm run lint
npm run build
npm run test:e2e
```

Playwright는 `NEXT_PUBLIC_USE_MOCK_DB=true`인 휘발성 메모리 mock DB를 사용합니다. 테스트 데이터는 브라우저 메모리에만 존재하며 실제 Supabase, localStorage, IndexedDB, 쿠키에 기록하지 않습니다.

GitHub Actions는 Node.js 22에서 `npm ci`, lint, build, Playwright만 실행합니다. 배포는 Actions가 아니라 Vercel 프로젝트의 Git 연동이 담당합니다.

## 문서

- [프로젝트 개요](docs/01-overview.md)
- [기능 요구사항](docs/02-requirements.md)
- [UI 및 접근성](docs/03-ui.md)
- [투약 도메인](docs/04-medication.md)
- [상태 기록](docs/05-status.md)
- [데이터베이스](docs/06-database.md)
- [보안과 개인정보](docs/07-security.md)
- [모바일·온라인 정책](docs/08-pwa.md)
- [개발 순서와 CI](docs/09-development.md)
