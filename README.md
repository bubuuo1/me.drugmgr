# me.drugmgr

근무력증 환자의 투약과 하루 상태를 본인과 가족이 여러 기기에서 함께 기록하는 모바일 우선 웹 앱입니다. Google 계정으로 로그인한 뒤 권한이 있는 사람의 복약 공간만 조회하거나 기록할 수 있습니다.

> 이 앱은 투약 일기입니다. 복용량을 결정하거나 처방 변경을 권고하지 않으며, 응급 대응 수단이 아닙니다.

## 현재 구현된 주요 기능

현재 작업 트리에는 Google 인증과 가족 공유 기능이 구현되어 있습니다. 정확한 구현·검증 현황은 [개발 순서와 현황](docs/09-development.md)의 체크박스를 정본으로 사용합니다. Google·Supabase 콘솔 설정만으로 운영 앱 화면이 바뀌지는 않으며, 아래 [운영 전환 체크리스트](#운영-전환-체크리스트)에 따라 새 코드를 Production에 배포해야 로그인 화면이 나타납니다.

- 접근: Google OAuth 로그인과 서버 측 세션 갱신, 비로그인 사용자의 로그인 화면 이동
- 격리: 한 사람의 기록을 하나의 복약 공간(`care space`)으로 분리하고 Supabase RLS로 접근 제한
- 가족 관리: 소유자가 Gmail·네이버 등 이메일 주소로 관리 요청을 보내고, 같은 이메일의 Google 계정으로 로그인한 상대가 자신의 복약 공간을 선택해 명시적으로 동의하면 요청자가 그 공간의 보호자가 됨
- 데이터: 약·일정·투약 로그·하루 상태를 선택한 복약 공간 단위로 조회·저장
- 기록: 약 이름·실제 복용 시각·수량, 일정/추가 복용 구분, 수정, soft delete와 실행 취소
- 약 설정: 약·복용 일정 등록·수정·비활성화와 등록 약 삭제, 기존 복용 기록 보존
- 알림: 환경설정에서 로그인 사용자·기기·접근 가능 복약 공간별 Web Push 수신, 테스트와 해제
- 환경: 모바일 우선, 온라인 전용, 한국 날짜(`Asia/Seoul`) 기준
- 입력 UI: 앱 토큰을 사용하는 공용 날짜·시간 대화상자, 모바일 하단 시트와 넓은 화면 중앙 대화상자, 저장 전 화면·저장소 검증
- 배포: [bubuuo1/me.drugmgr](https://github.com/bubuuo1/me.drugmgr)의 Vercel Git Integration 사용

새 사용자는 기록이 없는 개인 복약 공간을 받습니다. 다른 사람의 기록은 그 공간의 소유자가 관리 요청을 수락해 구성원 권한을 준 사람만 볼 수 있습니다. 관리 요청을 받은 사람은 자신이 소유한 공간을 직접 선택하며, 요청을 수락해도 요청받은 사람이 요청자의 공간에 자동으로 추가되지는 않습니다.
앱을 새로 열면 본인이 소유한 복약 공간을 기본 기록 대상으로 사용합니다. 가족 기록 전환, 가족 관리, 가족별 현재 기기 알림과 로그아웃은 모바일 하단의 `환경설정`에서 관리합니다. 알림을 눌러 들어온 명시적 복약 공간 링크는 기본 대상보다 우선합니다.

- `owner`(소유자): 약·일정·기록과 복약 공간 이름·구성원·초대를 관리
- `caregiver`(보호자): 약·일정·투약 로그·하루 상태를 조회·작성·수정·삭제하되 복약 공간 이름·구성원·초대는 관리하지 않음
- `viewer`(조회자): 복약 공간의 데이터 조회만 가능

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

요구 사항은 Node.js 24와 npm입니다.

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

신규 빈 DB 구축, 기존 운영 DB 증분 마이그레이션, Google OAuth, legacy 소유자 연결, Gmail SMTP와 Push 설정의 정확한 순서는 [개발·배포 정본](docs/09-development.md#1-저장소와-배포)을 따릅니다.

- `supabase/schema.sql`은 `drop` 문을 포함하므로 기존 운영 DB에 실행하지 않습니다.
- 기존 운영 DB는 전체 백업 후 현재 적용 기준을 확인하고 증분 마이그레이션만 순서대로 적용합니다.
- 콘솔 설정과 코드 배포는 별개이므로 GitHub push와 Vercel Production 배포 성공까지 확인합니다.
- 실제 사용자 두 명 이상으로 공간 격리, 관리 요청 이메일 일치, 수신자 소유 공간의 명시적 선택·동의, 요청자의 보호자 권한과 조회자 쓰기 거부를 검증합니다.
- legacy 기록은 실제 데이터 소유자를 확인한 뒤에만 수동 연결하고 첫 로그인 사용자에게 자동 할당하지 않습니다.
- 이전 익명 Push 구독은 자동 승격하지 않으며 각 사용자가 필요한 공간·기기에서 직접 다시 켭니다.

## 품질 검사

```bash
npm run lint
npm run build
npm run test:e2e
```

Playwright는 `NEXT_PUBLIC_USE_MOCK_DB=true`인 휘발성 메모리 mock DB를 사용합니다. 테스트 데이터는 브라우저 메모리에만 존재하며 실제 Supabase, localStorage, IndexedDB, 쿠키에 기록하지 않습니다.

GitHub Actions는 Node.js 24에서 `npm ci`, lint, build, Playwright만 실행합니다. 배포는 Actions가 아니라 Vercel 프로젝트의 Git 연동이 담당합니다.

## 문서

- [문서 안내와 정본 범위](docs/README.md)
- [프로젝트 개요](docs/01-overview.md)
- [기능 요구사항](docs/02-requirements.md)
- [UI 및 접근성](docs/03-ui.md)
- [투약 도메인](docs/04-medication.md)
- [상태 기록](docs/05-status.md)
- [데이터베이스](docs/06-database.md)
- [보안과 개인정보](docs/07-security.md)
- [모바일·온라인 정책](docs/08-pwa.md)
- [개발 순서와 CI](docs/09-development.md)
