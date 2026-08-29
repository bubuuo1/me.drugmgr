# me.drugmgr

근무력증 환자의 투약과 하루 상태를 가족이 여러 기기에서 함께 기록하는 모바일 우선 웹 앱입니다. 모든 가족 구성원은 같은 Vercel URL에 직접 접속하며, 같은 Supabase 데이터를 봅니다.

> 이 앱은 투약 일기입니다. 복용량을 결정하거나 처방 변경을 권고하지 않으며, 응급 대응 수단이 아닙니다.

## 확정된 운영 방식

- 접근: 가족이 공유한 URL로 직접 접속
- 인증: 로그인, 접근 코드, 기기 승인 없음
- 저장소: Supabase가 유일한 영구 저장소
- 네트워크: 온라인 전용
- 알림: 사용자가 허용한 기기마다 브라우저 Web Push 구독 사용
- 배포: Vercel 프로젝트의 Git Integration 사용
- GitHub: [bubuuo1/me.drugmgr](https://github.com/bubuuo1/me.drugmgr)

URL을 아는 사람은 같은 데이터에 접근할 수 있습니다. URL은 인증 수단이 아니며, 이 제약을 받아들인 소규모 가족용 앱으로만 운영합니다.

## 범위

### P0 — 데이터 정확성과 운영 기반

- Supabase 단일 저장 및 온라인 실패 상태
- 모든 쓰기 작업 `await`, 성공 확인 후 UI 반영, 오류 표시
- 중복 저장 방지
- 예정 일정과 실제 기록의 정확한 연결
- 설정 변경 후에도 과거 기록의 약명·단위·예정 정보 보존
- 한국 날짜(`Asia/Seoul`) 기준 조회와 저장 규칙
- 새 스키마 정리 및 실제 Supabase를 건드리지 않는 Playwright 테스트

기존 Supabase 데이터는 마이그레이션하거나 보존하지 않습니다.

### P1 — 가족이 매일 쓰는 완성 기능

- 홈의 마지막 복용, 오늘 누적, 일정 상태
- 실제 복용 시각·메모 입력, 일정 복용과 추가 복용 구분
- 투약 기록 수정, soft delete, 실행 취소
- 날짜별 상태 수정·삭제
- 약 및 복용 스케줄 설정
- 날짜별 투약+상태 타임라인
- 활성 일정의 기기별 Web Push 알림과 테스트·해제(완료)
- 모바일·키보드·화면 낭독기 접근성

알림은 설정 화면에서 각 기기 사용자가 직접 켜고 테스트하거나 끕니다. 활성 일정의 예정 시각에만 발송을 시도하고, 그날 같은 일정의 투약 기록이 이미 있으면 건너뜁니다. iPhone/iPad는 iOS/iPadOS 16.4 이상에서 Safari로 홈 화면에 추가한 앱을 사용해야 합니다. 알림은 기록을 확인하라는 안내이며 미복용 여부를 판정하지 않고, 네트워크와 기기 설정에 따라 늦거나 도착하지 않을 수 있습니다.

### 명시적 제외

- 로그인, 접근 코드, 기기 승인
- localStorage, IndexedDB, 오프라인 캐시, 오프라인 큐, 동기화
- 백업·복원, CSV/PDF 내보내기
- 미복용·지연 복용 판정과 알림의 정시 도착 보장
- 통계·그래프·추이 분석
- 역할별 권한, 보호자 초대·공유 관리
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
NEXT_PUBLIC_VAPID_PUBLIC_KEY=YOUR-PUBLIC-VAPID-KEY
VAPID_PRIVATE_KEY=YOUR-PRIVATE-VAPID-KEY
VAPID_SUBJECT=https://YOUR-DEPLOYMENT.example
PUSH_DISPATCH_SECRET=YOUR-RANDOM-DISPATCH-SECRET
```

기존 프로젝트가 legacy anon key를 사용하면 `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 호환 변수로 사용할 수 있습니다. publishable/anon 키는 브라우저 공개용이며, service role key는 클라이언트 환경변수에 넣지 않습니다.

VAPID private key와 발송 비밀값은 서버 전용입니다. 운영 환경에서는 Vercel 환경변수에 저장하고, Supabase Vault에는 발송 URL과 같은 `PUSH_DISPATCH_SECRET`을 저장합니다. 알림 발송 스케줄은 Supabase Cron이 매분 Vercel API를 호출합니다.

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

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
