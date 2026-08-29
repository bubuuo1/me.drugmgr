# Supabase 데이터베이스

## 1. 기본 전제

- Supabase가 운영 데이터의 유일한 영구 저장소다.
- 모든 가족 기기가 하나의 공유 데이터셋을 사용한다.
- 인증과 사용자별 소유권 컬럼은 사용하지 않는다.
- P0 스키마는 기존 개발 데이터를 보존하지 않고 reset하여 적용한다.
- 브라우저 영구 저장소와 별도 동기화 테이블은 만들지 않는다.

기본 테이블은 다음 네 개다.

- `medications`
- `medication_schedules`
- `medication_logs`
- `daily_status`

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
| `default_quantity` | numeric | 0보다 큼 |
| `active` | boolean | 기본 `true` |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

같은 약에 같은 예정 시각을 중복 생성하지 않는다. 홈의 오늘 일정은 활성 약의 활성 일정으로 계산한다. 일정 자체를 수정해도 기존 로그의 `schedule_time` 스냅샷은 변경하지 않는다.

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

## 6. 시간대 규칙

- `created_at`, `updated_at`, `taken_at`, `deleted_at`은 절대 순간인 `timestamptz`다.
- 화면에는 `Asia/Seoul`로 변환해 표시한다.
- 투약 로그의 날짜별 조회는 `taken_at`을 한국 시간으로 변환한 달력 날짜를 사용한다.
- `daily_status.date`와 일정 `time`은 이미 한국 현지 날짜·시각 의미다.
- 클라이언트의 브라우저 시간대가 달라도 날짜 경계는 한국 기준으로 유지한다.

## 7. 인덱스와 제약

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

FK 삭제 정책은 과거 로그를 연쇄 삭제하지 않아야 한다. 사용 이력이 있는 약과 일정은 애플리케이션에서 비활성화하고 물리 삭제하지 않는다.

## 8. 갱신 규칙

- `updated_at`은 DB trigger로 갱신한다.
- 투약 로그 스냅샷은 insert 시 DB trigger로 채우고 이후 자동 갱신하지 않는다.
- soft delete는 `deleted_at`만 설정한다.
- 실행 취소는 같은 행의 `deleted_at`을 `null`로 복원한다.

## 9. P0와 P1

P0에서 스키마, 제약, 스냅샷 trigger, 중복 방지를 먼저 완성한다. `deleted_at`, 메모, 일정 연결 등 P1 필드도 P0 스키마에 포함해 다시 reset하지 않고 P1 UI를 개발할 수 있게 한다.

P1에서는 이 구조 위에 약·일정 설정, 실제 시각·메모 편집, soft delete·실행 취소, 날짜별 타임라인을 추가한다.

## 10. 제외 데이터

다음 테이블이나 필드는 만들지 않는다.

- 사용자, 가족 구성원, 역할, 초대
- 접근 코드와 승인 기기
- 알림과 리마인더
- 오프라인 작업, 동기화 큐, 충돌 로그
- 백업·복원·내보내기 작업
- 통계·분석 결과
- AI 또는 의료 판단 결과
