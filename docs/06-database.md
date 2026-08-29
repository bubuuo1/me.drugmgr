# Supabase 데이터베이스

## 1. 기본 전제

- Supabase가 운영 데이터의 유일한 영구 저장소다.
- 모든 가족 기기가 하나의 공유 데이터셋을 사용한다.
- 인증과 사용자별 소유권 컬럼은 사용하지 않는다.
- P0 스키마는 기존 개발 데이터를 보존하지 않고 reset하여 적용한다.
- 브라우저 영구 저장소와 별도 동기화 테이블은 만들지 않는다.

공개 앱 데이터 테이블은 다음 네 개다.

- `medications`
- `medication_schedules`
- `medication_logs`
- `daily_status`

Web Push 운영 데이터는 Data API에 노출하지 않는 `private` 스키마의 다음 테이블에 저장한다.

- `push_subscriptions`
- `push_deliveries`

## 2. medications

현재 약 설정이다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | 필수, 빈 문자열 금지 |
| `unit` | text | 최대 20자, 횟수형 약은 빈 문자열 허용 |
| `quantity_options` | jsonb | 숫자 수량 선택지 배열, 최대 50개 |
| `active` | boolean | 기본 `true` |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

약 이름은 대소문자를 무시해 중복되지 않는다. `quantity_options`의 각 값은 0보다 크고 1000 이하여야 한다. 사용 이력이 있는 약은 물리 삭제하지 않고 비활성화한다.

## 3. medication_schedules

현재 복용 예정 설정이다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `medication_id` | uuid | `medications.id` FK |
| `time` | time(0) | 한국 현지 예정 시각 |
| `active` | boolean | 기본 `true` |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

한 약에 서로 다른 예정 시각을 여러 개 저장할 수 있고, 같은 약에 같은 예정 시각만 중복 생성하지 않는다. 일정은 알림 시각만 관리하며 실제 수량은 투약 로그에 저장한다. 홈의 오늘 일정은 활성 약의 활성 일정으로 계산한다. 일정 자체를 수정하거나 삭제해도 기존 로그의 `schedule_time` 스냅샷은 변경하지 않는다.

## 4. medication_logs

실제 복용 기록이다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `client_request_id` | uuid | 필수, unique, 중복 저장 방지 |
| `medication_id` | uuid | `medications.id` FK |
| `schedule_id` | uuid nullable | `medication_schedules.id` FK |
| `medication_name` | text | 생성 당시 약 이름 스냅샷 |
| `medication_unit` | text | 생성 당시 단위 스냅샷 |
| `schedule_time` | time(0) nullable | 생성 당시 예정 시각 스냅샷 |
| `taken_at` | timestamptz | 실제 복용 순간 |
| `quantity` | numeric | 0보다 큼 |
| `note` | text nullable | 메모 |
| `is_extra` | boolean | 일정 없는 추가 복용 표시 |
| `deleted_at` | timestamptz nullable | P1 soft delete |
| `created_at` | timestamptz | 최초 생성 시각 |
| `updated_at` | timestamptz | 마지막 수정 시각 |

insert trigger가 현재 약 이름·단위와 연결 일정 시각을 스냅샷 필드에 채운다. 클라이언트가 보낸 임의 스냅샷 값을 신뢰하지 않는다.

정합성 규칙:

- `client_request_id` 재사용은 새 행이 아니라 기존 성공 건으로 취급한다.
- 새 로그에서 `schedule_id`가 없으면 `is_extra = true`, 있으면 `is_extra = false`다. 연결 일정이 나중에 삭제되면 `schedule_id`는 `null`이 되더라도 `is_extra = false`와 `schedule_time`을 보존해 원래 일정 기록이었음을 유지한다.
- 일반 조회, 누적, 마지막 복용, 일정 상태는 `deleted_at is null`만 사용한다.
- 약·일정 설정 변경은 스냅샷 필드를 갱신하지 않는다.
- 메모는 최대 2000자다.

## 5. daily_status

한국 날짜별 하루 상태다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `date` | date | 필수, unique |
| `fatigue` | text nullable | 피로 |
| `strength` | text nullable | 근력 |
| `breathing` | text nullable | 호흡 |
| `eye_symptom` | text nullable | 눈 증상 |
| `note` | text nullable | 메모 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

동일 `date` 저장은 upsert한다. 상태 삭제는 해당 날짜 행만 삭제하며 투약 로그에는 영향을 주지 않는다.

피로·근력은 `좋음/보통/나쁨`, 호흡은 `편안함/평소와 다름`, 눈 증상은 `없음/있음` 또는 `null`만 허용한다. 메모는 최대 2000자다.

## 6. Web Push 운영 데이터 — P1 완료

### 6.1 `private.push_subscriptions`

브라우저가 발급한 기기별 Web Push 구독을 저장한다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
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

같은 endpoint를 다시 등록하면 키와 만료 시각을 갱신하고 활성화한다. 사용자가 알림을 끄거나 push service가 `404/410`으로 구독 만료를 알리면 `disabled_at`을 기록한다. 이 행은 사용자 계정이나 승인 기기를 뜻하지 않는다.

### 6.2 `private.push_deliveries`

일정 알림의 중복 생성 방지와 전송 결과를 저장한다.

| 필드 | 형식 | 규칙 |
|---|---|---|
| `id` | uuid | PK |
| `subscription_id` | uuid | `private.push_subscriptions.id` FK |
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

`subscription_id + schedule_id + scheduled_for`는 unique다. 최초 예정 시각과 이후 5분 간격의 각 회차가 별도 `scheduled_for`를 사용하므로 같은 회차는 중복 생성되지 않는다. 같은 한국 날짜에 같은 일정의 삭제되지 않은 투약 로그가 있거나 일정·약·구독이 비활성이면 새 회차를 만들지 않으며, 직전에 만들어진 `pending/failed` 회차는 `skipped`로 바꾸고 발송하지 않는다. `accepted`는 push service가 요청을 접수했다는 의미이며 기기에 정시에 표시되었음을 보장하지 않는다.

기록이 없는 동안 생성되는 5분 간격 알림 회차와 네트워크 실패 재시도는 서로 다른 개념이다. 각 새 회차는 1회차 시도 번호와 함께 점유한다. 요청 중단이나 일시 실패가 발생하면 해당 회차부터 5분 이내에 최대 3회까지 같은 delivery 행을 다시 점유하며, 시도 번호가 맞는 결과만 완료 처리한다. 같은 일정과 한국 날짜에는 같은 논리 식별자와 Web Push topic을 사용한다. 기기에서는 기존 표시를 닫은 뒤 새 알림을 표시하고, 일정 알림은 TTL 0으로 push service에 보관하지 않는다.

### 6.3 RPC, Cron과 Vault

- 서버의 구독 등록·해제·테스트 처리는 제한된 공개 RPC `register_push_subscription`, `unregister_push_subscription`, `get_push_subscription_for_test`를 사용한다.
- `claim_due_push_notifications`는 활성 약의 활성 일정에 대해 예정 시각부터 5분 간격의 최신 회차를 한국 시각으로 계산하고, 최근 3분 범위의 회차를 중복 없이 발송 대상으로 만든다. 같은 한국 날짜의 일정 기록이 생기거나 날짜가 끝나면 새 회차를 만들지 않는다.
- `private.push_delivery_is_sendable`은 구독·약·일정 활성 상태, 일정 시각과 회차 정렬, 한국 날짜와 같은 일정 기록 부재를 한 곳에서 검사한다.
- `prepare_push_delivery_for_send`는 claim 이후 외부 Web Push 직전에 delivery를 잠그고 최신 상태를 다시 확인하며, 취소된 건은 `skipped` 처리하고 발송 payload를 반환하지 않는다.
- `complete_push_delivery`는 Vercel 발송 결과를 기록하며 만료된 구독을 비활성화할 수 있다.
- 알림 관련 모든 RPC는 Supabase Vault에 정확히 하나만 존재하는 `push_dispatch_secret`과 일치하는 값이 없으면 실행을 거부한다.
- Supabase Cron 작업 `medicine-push-dispatch`가 매분 `pg_net`으로 Vault의 발송 URL을 호출한다.
- Vercel 발송 API는 같은 비밀값을 Bearer 헤더로 확인한 뒤 Web Push를 전송한다.

private 테이블에는 RLS를 활성화하고 `anon`과 `authenticated`에 테이블 권한을 주지 않는다. private 스키마는 Data API에 노출하지 않으며 브라우저와 서버는 필요한 RPC만 사용한다. 발송 비밀값은 테이블이나 애플리케이션 코드에 저장하지 않고 Supabase Vault와 Vercel 서버 환경변수에만 둔다.

## 7. 시간대 규칙

- `created_at`, `updated_at`, `taken_at`, `deleted_at`은 절대 순간인 `timestamptz`다.
- 화면에는 `Asia/Seoul`로 변환해 표시한다.
- 투약 로그의 날짜별 조회는 `taken_at`을 한국 시간으로 변환한 달력 날짜를 사용한다.
- `daily_status.date`와 일정 `time`은 이미 한국 현지 날짜·시각 의미다.
- 클라이언트의 브라우저 시간대가 달라도 날짜 경계는 한국 기준으로 유지한다.
- 알림 `scheduled_for`는 해당 한국 날짜의 일정 `time`을 최초 회차로 삼아 5분 간격으로 계산한 순간을 저장한다.

## 8. 인덱스와 제약

필수:

- `medication_logs(client_request_id)` unique
- `daily_status(date)` unique
- `medication_logs(taken_at)`
- `medication_logs(medication_id, taken_at)`
- 삭제되지 않은 기록 조회를 위한 `deleted_at` 고려 인덱스
- `medication_schedules(medication_id, active, time)`
- `medications(lower(name))` unique
- `medication_schedules(medication_id, time)` unique
- 수량 양수 check 제약
- `private.push_subscriptions(endpoint)` unique
- 활성 push 구독의 `last_seen_at` 인덱스
- `private.push_deliveries(subscription_id, schedule_id, scheduled_for)` unique
- 대기 발송의 `scheduled_for` 인덱스
- 기록된 일정 확인을 위한 `medication_logs(schedule_id, taken_at)` 부분 인덱스

FK 삭제 정책은 과거 로그를 연쇄 삭제하지 않아야 한다. 사용 이력이 있는 약과 일정은 애플리케이션에서 비활성화하고 물리 삭제하지 않는다.

## 9. 갱신 규칙

- `updated_at`은 DB trigger로 갱신한다.
- 투약 로그 스냅샷은 insert 시 DB trigger로 채우고 이후 자동 갱신하지 않는다.
- soft delete는 `deleted_at`만 설정한다.
- 실행 취소는 같은 행의 `deleted_at`을 `null`로 복원한다.
- push 구독과 발송의 `updated_at`도 DB trigger로 갱신한다.

## 10. P0와 P1

P0에서 스키마, 제약, 스냅샷 trigger, 중복 방지를 먼저 완성한다. `deleted_at`, 메모, 일정 연결 등 P1 필드도 P0 스키마에 포함해 다시 reset하지 않고 P1 UI를 개발할 수 있게 한다.

P1에서는 이 구조 위에 약·일정 설정, 실제 시각·메모 편집, soft delete·실행 취소, 날짜별 타임라인을 추가한다. Web Push 운영 테이블, 제한된 RPC, Vault, 매분 Cron과 Vercel 발송 API 연동도 P1에 완료한다.

## 11. 제외 데이터

다음 테이블이나 필드는 만들지 않는다.

- 사용자, 가족 구성원, 역할, 초대
- 접근 코드와 승인 기기
- 오프라인 작업, 동기화 큐, 충돌 로그
- 백업·복원·내보내기 작업
- 통계·분석 결과
- AI 또는 의료 판단 결과
