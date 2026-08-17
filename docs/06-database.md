# Supabase 데이터베이스

## 1. 기본 구조

초기 버전은 다음 테이블을 사용한다.

- medications
- medication_schedules
- medication_logs
- daily_status

## 2. medications

약 기본 정보.

필드:

- id
- name
- unit
- active
- created_at
- updated_at

예:

name = "메스티논"
unit = "정"
active = true

## 3. medication_schedules

복용 예정 정보.

필드:

- id
- medication_id
- time
- default_quantity
- active
- created_at
- updated_at

medication_id는 medications.id를 참조한다.

## 4. medication_logs

실제 복용 기록.

필드:

- id
- medication_id
- schedule_id nullable
- taken_at
- quantity
- note nullable
- created_at
- updated_at

## 5. daily_status

하루 상태.

필드:

- id
- date
- fatigue
- strength
- breathing
- eye_symptom
- note
- created_at
- updated_at

## 6. 인덱스

medication_logs:

- taken_at
- medication_id

daily_status:

- date

기록 조회가 많은 날짜 기준으로 인덱스를 구성한다.

## 7. 시간대

한국에서 사용하는 앱이므로 기본 시간대는:

Asia/Seoul

로 한다.

서버 시간과 표시 시간을 혼동하지 않도록 한다.

## 8. 데이터 원칙

설정 데이터와 과거 기록을 분리한다.

약 설정 변경:

현재 설정에만 영향을 준다.

과거 medication_logs:

변경하지 않는다.