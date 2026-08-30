# Supabase 데이터베이스

> 이 문서는 현재 물리 스키마와 DB 제약의 정본이다. 도메인 의미는 [04 투약 도메인](04-medication.md)과 [05 상태 기록](05-status.md), 권한 의도는 [02 기능 요구사항](02-requirements.md)을 따른다.

## 1. 기본 전제

- Supabase가 운영 데이터의 유일한 영구 저장소다.
- Supabase Auth의 Google 로그인으로 사용자를 식별한다.
- 한 사람의 건강 기록은 하나의 복약 공간으로 분리하고 구성원 RLS로 격리한다.
- 기존 데이터는 고정된 미지정 legacy 복약 공간에 보존하며 자동으로 사용자를 할당하지 않는다.
- 브라우저 영구 저장소와 별도 동기화 테이블은 만들지 않는다.

공개 스키마의 앱 테이블은 다음과 같다.

- `profiles`
- `care_spaces`
- `care_space_members`
- `care_space_invites`
- `medications`
- `medication_schedules`
- `medication_logs`
- `daily_status`

Web Push 운영 데이터는 Data API에 노출하지 않는 `private` 스키마의 다음 테이블에 저장한다.

- `push_subscriptions`
- `push_subscription_spaces`
- `push_deliveries`

## 2. 사용자와 가족 공유

### 2.1 `profiles`

`auth.users`와 1:1인 앱 표시용 프로필이다. `user_id`, `display_name`, `avatar_url`, 생성·수정 시각을 가진다. Google 메타데이터를 최초 생성에만 사용하며 권한 판정은 항상 `auth.uid()`와 DB 멤버십을 사용한다.

### 2.2 `care_spaces`

한 사람의 복약 기록 범위다. `id`, `name`, `created_by`, 생성·수정 시각을 가진다. 새 인증 사용자의 trigger는 빈 개인 공간을 만들고 그 사용자를 소유자로 추가한다.

인증 도입 전 데이터는 ID `00000000-0000-4000-8000-000000000100`, 이름 `기존 데이터 (미지정)`인 공간으로 이동한다. 이 공간은 소유자 없이 만들어지므로 운영자가 실제 사용자를 확인해 `care_space_members`에 명시적으로 연결하기 전에는 누구도 접근하지 못한다.

### 2.3 `care_space_members`

`care_space_id + user_id`가 PK다. 역할은 다음 세 값만 허용한다.

- `owner`: 전체 조회와 약·일정·기록 변경, 공간 이름·구성원·초대 관리
- `caregiver`: 전체 조회와 약·일정·투약 로그·하루 상태 변경
- `viewer`: 전체 조회만 가능

보호자의 변경 범위에는 약 생성·수정·비활성화·soft delete와 일정 생성·수정·삭제가 포함된다. 공간 이름·구성원·초대 변경은 소유자만 할 수 있다. `invited_by`, 생성·수정 시각을 함께 보존한다. 한 사용자는 여러 공간의 구성원이 될 수 있다.

### 2.4 `care_space_invites`

소유자가 만든 이메일 초대다. `care_space_id`, 소문자로 정규화한 `email`, `caregiver/viewer` 역할, 상태, `invited_by`, `accepted_by`, 만료·응답·생성·수정 시각을 저장한다. 상태는 `pending/accepted/declined/revoked/expired`만 허용하고 한 공간과 이메일에는 대기 초대 하나만 존재한다.

생성·수락·거절·취소는 제한 RPC를 사용한다. 수락·거절은 `auth.users.email`의 확인된 이메일이 초대 이메일과 일치해야 하며 클라이언트의 `user_metadata` 이메일을 권한 근거로 사용하지 않는다.

## 3. medications

현재 약 설정이다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `care_space_id` | uuid | `care_spaces.id` FK, 격리 범위 |
| `name` | text | 필수, 빈 문자열 금지 |
| `unit` | text | 최대 20자, 횟수형 약은 빈 문자열 허용 |
| `quantity_options` | jsonb | 숫자 수량 선택지 배열, 최대 50개 |
| `active` | boolean | 기본 `true` |
| `deleted_at` | timestamptz nullable | 등록 약 soft delete 시각, 설정·일정·알림 조회에서 제외 |
| `created_by` | uuid nullable | 생성 사용자 감사 필드 |
| `updated_by` | uuid nullable | 마지막 변경 사용자 감사 필드 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

삭제되지 않은 약 이름은 같은 복약 공간 안에서 대소문자를 무시해 중복되지 않는다. `quantity_options`의 각 값은 0보다 크고 1000 이하여야 한다. 등록 약 삭제는 `deleted_at`을 설정하고 `active = false`로 바꾸며 연결 일정을 비활성화한다. 약 행과 기존 투약 로그는 물리 삭제하지 않는다.

## 4. medication_schedules

현재 복용 예정 설정이다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `care_space_id` | uuid | `care_spaces.id` FK, 격리 범위 |
| `medication_id` | uuid | `medications.id` FK |
| `time` | time(0) | 한국 현지 예정 시각 |
| `active` | boolean | 기본 `true` |
| `created_by` | uuid nullable | 생성 사용자 감사 필드 |
| `updated_by` | uuid nullable | 마지막 변경 사용자 감사 필드 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

한 공간의 한 약에 서로 다른 예정 시각을 여러 개 저장할 수 있고, 같은 약에 같은 예정 시각만 중복 생성하지 않는다. `medication_id + care_space_id` 복합 FK가 다른 공간의 약 연결을 막는다. 일정은 알림 시각만 관리하며 실제 수량은 투약 로그에 저장한다. 홈의 오늘 일정은 활성 약의 활성 일정으로 계산한다. 일정 자체를 수정하거나 삭제해도 기존 로그의 `schedule_time` 스냅샷은 변경하지 않는다.

## 5. medication_logs

실제 복용 기록이다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `care_space_id` | uuid | `care_spaces.id` FK, 격리 범위 |
| `client_request_id` | uuid | 필수, 같은 복약 공간 안에서 unique, 중복 저장 방지 |
| `medication_id` | uuid | `medications.id` FK |
| `schedule_id` | uuid nullable | `medication_schedules.id` FK |
| `medication_name` | text | 생성 당시 약 이름 스냅샷 |
| `medication_unit` | text | 생성 당시 단위 스냅샷 |
| `schedule_time` | time(0) nullable | 생성 당시 예정 시각 스냅샷 |
| `taken_at` | timestamptz | 실제 복용 순간 |
| `quantity` | numeric | DB check로 `0 < quantity <= 1000` 강제 |
| `note` | text nullable | 메모 |
| `is_extra` | boolean | 일정 없는 추가 복용 표시 |
| `deleted_at` | timestamptz nullable | P1 soft delete |
| `created_by` | uuid nullable | 생성 사용자 감사 필드 |
| `updated_by` | uuid nullable | 마지막 변경 사용자 감사 필드 |
| `created_at` | timestamptz | 최초 생성 시각 |
| `updated_at` | timestamptz | 마지막 수정 시각 |

insert trigger가 현재 약 이름·단위와 연결 일정 시각을 스냅샷 필드에 채운다. 클라이언트가 보낸 임의 스냅샷 값을 신뢰하지 않는다.

정합성 규칙:

- 같은 `(care_space_id, client_request_id)` 재사용은 새 행이 아니라 기존 성공 건으로 취급한다. 약, 일정, 실제 시각, 수량, 정규화한 메모, 추가 복용 분류가 기존 행과 모두 같을 때만 멱등 성공으로 반환하고 하나라도 다르면 충돌로 거부한다.
- 새 로그에서 `schedule_id`가 없으면 `is_extra = true`, 있으면 `is_extra = false`다. 연결 일정이 나중에 삭제되면 `schedule_id`는 `null`이 되더라도 `is_extra = false`와 `schedule_time`을 보존해 원래 일정 기록이었음을 유지한다.
- 일반 조회, 누적, 마지막 복용, 일정 상태는 `deleted_at is null`만 사용한다.
- 약·일정 설정 변경은 스냅샷 필드를 갱신하지 않는다.
- 메모는 최대 2000자다.

## 6. daily_status

한국 날짜별 하루 상태다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `care_space_id` | uuid | `care_spaces.id` FK, 격리 범위 |
| `date` | date | 필수, 공간 안에서 unique |
| `fatigue` | text nullable | 피로 |
| `strength` | text nullable | 근력 |
| `breathing` | text nullable | 호흡 |
| `eye_symptom` | text nullable | 눈 증상 |
| `note` | text nullable | 메모 |
| `created_by` | uuid nullable | 생성 사용자 감사 필드 |
| `updated_by` | uuid nullable | 마지막 변경 사용자 감사 필드 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

동일 `care_space_id + date` 저장은 권한을 확인하는 `upsert_daily_status` RPC로 upsert한다. `date`는 행의 식별자이므로 authenticated 직접 update 대상이 아니며, 다른 날짜를 저장하려면 그 날짜의 별도 upsert를 사용한다. 상태 삭제는 해당 날짜 행만 삭제하며 투약 로그에는 영향을 주지 않는다.

피로·근력은 `좋음/보통/나쁨`, 호흡은 `편안함/평소와 다름`, 눈 증상은 `없음/있음` 또는 `null`만 허용한다. 메모는 최대 2000자다.

상태 선택 하나 이상 또는 모든 종류의 공백으로만 이루어지지 않은 메모가 있어야 하며 DB의 `daily_status_has_content` check와 앱 입력 검증에서 함께 강제한다. 운영 증분 마이그레이션은 기존 데이터를 자동 변경하지 않기 위해 제약을 먼저 `NOT VALID`로 추가한 뒤 빈 기존 행이 없음을 확인하고 별도 마이그레이션으로 검증·강화한다. 빈 행이 발견되면 의료적 추정으로 값을 채우지 않고 데이터 소유자와 처리 방침을 먼저 확정한다.

## 7. Web Push 운영 데이터 — P1

### 7.1 `private.push_subscriptions`

브라우저가 발급한 기기별 Web Push 구독을 저장한다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid nullable | 구독 소유 인증 사용자, 비활성 legacy 행만 null 허용 |
| `endpoint` | text | push service HTTPS endpoint, unique |
| `p256dh` | text | 브라우저 공개 암호화 키 |
| `auth` | text | 구독 인증용 값 |
| `expiration_time` | timestamptz nullable | 브라우저가 제공한 만료 시각 |
| `disabled_at` | timestamptz nullable | 해제·만료된 구독 표시 |
| `last_seen_at` | timestamptz | 마지막 등록 확인 시각 |
| `last_success_at` | timestamptz nullable | 마지막 push service 접수 시각 |
| `last_failure_at` | timestamptz nullable | 마지막 전송 실패 시각 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 마지막 수정 시각 |

같은 사용자가 같은 endpoint를 다시 등록하면 키와 만료 시각을 갱신하고 활성화한다. 다른 사용자가 소유 중인 endpoint를 임의로 가져갈 수 없다. 인증 도입 전의 소유자 없는 구독은 마이그레이션 시 비활성화하고, 사용자가 직접 다시 켤 때만 되살린다. 사용자가 모든 공간의 알림을 끄거나 push service가 `404/410`으로 구독 만료를 알리면 `disabled_at`을 기록한다. 이 행은 앱의 승인 기기 목록을 뜻하지 않는다.

### 7.2 `private.push_subscription_spaces`

하나의 브라우저 Push 구독이 알림을 받을 복약 공간을 명시한다. `subscription_id + care_space_id`가 PK이며 `user_id`를 함께 저장한다. 복합 FK는 구독 소유자와 활성 공간 구성원이 같은 사용자임을 보장한다. 구성원 행을 삭제하면 해당 공간 대상 연결도 함께 삭제되어 새 알림이 중단된다.

### 7.3 `private.push_deliveries`

일정 알림의 중복 생성 방지와 전송 결과를 저장한다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `subscription_id` | uuid | `private.push_subscriptions.id` FK |
| `care_space_id` | uuid | 발송 대상 복약 공간 |
| `schedule_id` | uuid | `medication_schedules.id` FK |
| `scheduled_for` | timestamptz | 최초 예정 시각부터 계산한 5분 알림 회차 순간 |
| `status` | text | `pending / accepted / failed / skipped` |
| `attempt_count` | smallint | 전송 시도 횟수 |
| `response_status` | integer nullable | push service 응답 상태 |
| `error_code` | text nullable | 제한된 운영 오류 코드 |
| `attempted_at` | timestamptz nullable | 전송 시도 시각 |
| `accepted_at` | timestamptz nullable | push service 접수 시각 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 마지막 수정 시각 |

`subscription_id + schedule_id + scheduled_for`는 unique다. 일정과 delivery의 `care_space_id`도 복합 FK로 일치해야 한다. 최초 예정 시각과 이후 5분 간격의 각 회차가 별도 `scheduled_for`를 사용하므로 같은 회차는 중복 생성되지 않는다. 같은 한국 날짜와 공간에 같은 일정의 삭제되지 않은 투약 로그가 있거나 일정·약·구독·공간 멤버십이 비활성이면 새 회차를 만들지 않으며, 직전에 만들어진 `pending/failed` 회차는 `skipped`로 바꾸고 발송하지 않는다. `accepted`는 push service가 요청을 접수했다는 의미이며 기기에 정시에 표시되었음을 보장하지 않는다.

기록이 없는 동안 생성되는 5분 간격 알림 회차와 네트워크 실패 재시도는 서로 다른 개념이다. 각 새 회차는 1회차 시도 번호와 함께 점유한다. 요청 중단이나 일시 실패가 발생하면 해당 회차부터 5분 이내에 최대 3회까지 같은 delivery 행을 다시 점유하며, 시도 번호가 맞는 결과만 완료 처리한다. 같은 일정과 한국 날짜에는 같은 논리 식별자와 Web Push topic을 사용한다. 기기에서는 기존 표시를 닫은 뒤 새 알림을 표시하고, 일정 알림은 TTL 0으로 push service에 보관하지 않는다.

### 7.4 RPC, Cron과 Vault

- 서버의 구독 등록·해제·테스트 처리는 제한된 공개 RPC `register_push_subscription`, `unregister_push_subscription`, `get_push_subscription_for_test`를 사용한다. 각 RPC는 인증 사용자의 `auth.uid()`, 선택한 `care_space_id` 멤버십, endpoint의 소유권과 발송 비밀값을 모두 검사한다.
- `claim_due_push_notifications`는 활성 약의 활성 일정에 대해 예정 시각부터 5분 간격의 최신 회차를 한국 시각으로 계산하고, 최근 3분 범위의 회차를 중복 없이 발송 대상으로 만든다. 같은 한국 날짜의 일정 기록이 생기거나 날짜가 끝나면 새 회차를 만들지 않는다.
- `private.push_delivery_is_sendable`은 구독·대상 공간 멤버십·약·일정 활성 상태, 일정 시각과 회차 정렬, 한국 날짜와 같은 공간의 일정 기록 부재를 한 곳에서 검사한다.
- `prepare_push_delivery_for_send`는 claim 이후 외부 Web Push 직전에 delivery를 잠그고 최신 상태를 다시 확인하며, 취소된 건은 `skipped` 처리하고 발송 payload를 반환하지 않는다.
- `complete_push_delivery`는 Vercel 발송 결과를 기록하며 만료된 구독을 비활성화할 수 있다.
- 알림 관련 모든 RPC는 Supabase Vault에 정확히 하나만 존재하는 `push_dispatch_secret`과 일치하는 값이 없으면 실행을 거부한다.
- Supabase Cron 작업 `medicine-push-dispatch`가 매분 `pg_net`으로 Vault의 발송 URL을 호출한다.
- Vercel 발송 API는 같은 비밀값을 Bearer 헤더로 확인한 뒤 Web Push를 전송한다.

private 테이블에는 RLS를 활성화하고 `anon`과 `authenticated`에 테이블 권한을 주지 않는다. private 스키마는 Data API에 노출하지 않으며 브라우저와 서버는 필요한 RPC만 사용한다. 사용자 구독 RPC는 인증된 Supabase 클라이언트로 호출하고 발송 비밀값은 테이블이나 브라우저 코드에 저장하지 않고 Supabase Vault와 Vercel 서버 환경변수에만 둔다.

## 8. 시간대 규칙

- `created_at`, `updated_at`, `taken_at`, `deleted_at`은 절대 순간인 `timestamptz`다.
- 화면에는 `Asia/Seoul`로 변환해 표시한다.
- 투약 로그의 날짜별 조회는 `taken_at`을 한국 시간으로 변환한 달력 날짜를 사용한다.
- `daily_status.date`와 일정 `time`은 이미 한국 현지 날짜·시각 의미다.
- 클라이언트의 브라우저 시간대가 달라도 날짜 경계는 한국 기준으로 유지한다.
- 알림 `scheduled_for`는 해당 한국 날짜의 일정 `time`을 최초 회차로 삼아 5분 간격으로 계산한 순간을 저장한다.

## 9. 인덱스와 제약

필수:

- `care_space_members(user_id, care_space_id)`
- `care_space_invites(care_space_id, email)` 대기 상태 부분 unique
- `medication_logs(care_space_id, client_request_id)` unique
- `daily_status(care_space_id, date)` unique
- `medication_logs(taken_at)`
- `medication_logs(medication_id, taken_at)`
- 삭제되지 않은 기록 조회를 위한 `deleted_at` 고려 인덱스
- `medication_schedules(medication_id, active, time)`
- `medications(care_space_id, lower(name)) where deleted_at is null` 부분 unique
- `medication_schedules(care_space_id, medication_id, time)` unique
- 수량 양수 check 제약
- `private.push_subscriptions(endpoint)` unique
- 활성 구독의 `user_id, last_seen_at` 인덱스
- `private.push_subscription_spaces(care_space_id, user_id, subscription_id)`
- 활성 push 구독의 `last_seen_at` 인덱스
- `private.push_deliveries(subscription_id, schedule_id, scheduled_for)` unique
- 대기 발송의 `scheduled_for` 인덱스
- 기록된 일정 확인을 위한 `medication_logs(schedule_id, taken_at)` 부분 인덱스

FK 삭제 정책은 과거 로그를 연쇄 삭제하지 않아야 한다. 일정 삭제는 기존 로그의 `schedule_id`를 `null`로 바꾸더라도 예정 스냅샷을 보존한다. 약 삭제는 행을 물리 삭제하지 않고 soft delete하여 로그의 약 이름·단위·실제 복용 시각·수량을 계속 조회할 수 있게 한다.

## 10. 갱신 규칙

- `updated_at`은 DB trigger로 갱신한다.
- 투약 로그의 약 이름·단위·예정 시각 스냅샷은 insert 시 DB trigger가 현재 설정에서 채운다.
- 약·일정 설정을 나중에 변경해도 기존 로그 스냅샷은 자동 갱신하지 않는다. 사용자가 로그의 일정 연결 또는 추가 복용 분류를 명시적으로 정정한 경우에만 trigger가 `schedule_time`과 `is_extra`를 새 분류에 맞춘다.
- 투약 로그의 update column grant와 repository 수정 입력은 `medication_id`를 포함하지 않는다. 일반 기록 편집은 약을 바꾸지 못하며 약 이름·단위 스냅샷도 그대로 유지한다.
- 투약 로그 soft delete는 `deleted_at`을 설정하고 실행 취소 시 같은 행의 `deleted_at`을 `null`로 복원한다.
- 등록 약의 `deleted_at`은 authenticated 직접 update 권한에 포함하지 않는다. `soft_delete_medication` RPC가 호출 사용자와 역할을 확인한 뒤 같은 트랜잭션에서 `deleted_at`, `active = false`와 연결 일정 비활성화를 처리한다. 약 삭제는 실행 취소 기능을 제공하지 않는다.
- 하루 상태 삭제는 해당 날짜 행을 물리 삭제하며 투약 로그에는 영향을 주지 않는다.
- push 구독과 발송의 `updated_at`도 DB trigger로 갱신한다.
- 인증된 도메인 쓰기의 `created_by`, `updated_by`는 trigger가 `auth.uid()`로 채운다.

## 11. 인증·공유 마이그레이션

`supabase/schema.sql`은 현재 전체 스키마를 재구성하기 위해 `drop` 문을 포함한다. 새 빈 Supabase 프로젝트나 폐기 가능한 로컬 환경에서만 사용하고 기존 운영 DB에는 실행하지 않는다. 기존 운영 데이터에는 백업 후 `supabase/migrations/`의 증분 마이그레이션만 적용한다. 구체적인 신규 구축·운영 업그레이드 순서는 `09-development.md`가 정본이다.

`20260829110749_add_multi_user_family_auth.sql`은 기존 앱 테이블을 삭제하지 않고 공간·감사 컬럼을 추가한다. 기존 약·일정·로그·상태는 미지정 legacy 공간으로 backfill하고 기존 익명 Push 구독은 안전하게 비활성화한다. 새 사용자와 기존 Auth 사용자는 빈 개인 공간을 받는다.

`20260830050000_soft_delete_medications_preserve_logs.sql`은 약에 `deleted_at`을 추가하고 약 삭제와 연결 일정 비활성화를 하나의 DB 작업으로 처리한다. 기존 투약 로그 행과 약 이름·단위·시각·수량 스냅샷은 변경하지 않는다.

`20260830050001_allow_caregiver_medication_management.sql`은 약·일정 쓰기 RLS와 약 soft delete RPC를 소유자·보호자에게 허용하되, 복약 공간 이름·구성원·초대 관리 정책은 소유자 전용으로 유지한다.

`20260830050002_enforce_record_integrity.sql`은 빈 상태 기록을 막고, 투약 로그의 약 변경 권한을 제거하며, 삭제된 일정 기록의 예정 스냅샷을 일반 편집에서 보존한다. 기존 빈 상태 행은 자동 삭제하거나 보정하지 않는다.

`20260830050003_validate_daily_status_content.sql`은 기존 빈 상태 행이 없음을 확인한 환경에서 `daily_status_has_content`를 완전 검증 상태로 전환한다. 데이터를 변경하거나 삭제하지 않으며 빈 행이 남아 있으면 실패한다.

`20260830050004_reject_whitespace_only_daily_status.sql`은 일반 공백뿐 아니라 탭·줄바꿈 등으로만 이루어진 메모도 빈 내용으로 취급하도록 같은 제약을 강화한다.

`20260830050005_restrict_direct_record_mutations.sql`은 약의 `deleted_at`과 상태의 `date` 직접 update 권한을 제거한다. 약 삭제와 상태 upsert는 호출 사용자·역할을 검사하는 제한 RPC를 사용해 약 삭제의 연결 일정 비활성화와 상태 날짜 불변성을 보장한다.

마이그레이션 적용 전 운영 DB를 백업한다. 적용 뒤에는 실제 기존 데이터 소유자를 확인해 미지정 공간에 소유자 멤버십을 수동으로 추가해야 한다. 자동으로 첫 로그인 사용자에게 할당하면 잘못된 사람에게 건강 기록이 노출될 수 있으므로 금지한다.

## 12. 제외 데이터

다음 테이블이나 필드는 만들지 않는다.

- 접근 코드와 승인 기기
- 오프라인 작업, 동기화 큐, 충돌 로그
- 백업·복원·내보내기 작업
- 통계·분석 결과
- AI 또는 의료 판단 결과
