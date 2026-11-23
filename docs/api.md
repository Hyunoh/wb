# workoutBoard API 계약

Google Apps Script 웹앱 하나가 POST(운동 업로드)와 GET(조회)을 제공한다.
URL은 배포 후 얻는 `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec` 이다.

## 공통 규칙

- 응답은 항상 JSON(`application/json`)이다. Apps Script는 HTTP 상태 코드를 바꿀 수 없으므로
  **항상 200**이고, 성공 여부는 본문의 `ok`로 판단한다. 실패는 `{"ok":false,"error":"<코드>"}`.
- 시간대는 **Asia/Seoul(+09:00)** 고정이다. 날짜 집계는 `start`의 서울 날짜 기준이다.
- 응답에 토큰/키/스택 트레이스는 절대 들어가지 않는다.
- **리다이렉트**: Apps Script는 요청을 받으면 `302`로 `script.googleusercontent.com`에 결과를 둔 주소를 알려 준다.
  실행(저장)은 리다이렉트 전에 끝난다. 결과 본문을 읽으려면 리다이렉트를 따라가되 **GET으로** 따라가야 한다
  (POST를 그대로 재전송하면 실패한다). curl은 `-X POST` 없이 `curl -sL --data ...`를 쓰면 올바르게 동작한다.
- **CORS(대시보드)**: 브라우저 `fetch()` GET은 "단순 요청"일 때만 교차 출처로 동작한다.
  **커스텀 헤더를 붙이지 말고**(`Authorization`, `Content-Type: application/json` 등 금지) 평범한 GET만 쓴다.
  `fetch(url)` 처럼 옵션 없이 호출하면 된다.
- iOS 단축어의 POST는 `Content-Type: application/json` 본문이어도 무방하다(브라우저가 아니므로 CORS 무관).

## 에러 코드

| error | 의미 | 발생 |
|---|---|---|
| `unauthorized` | 토큰/키가 없거나 틀림(사용자 토큰이 다른 사용자 것인 경우 포함) | POST, GET |
| `bad_request` | JSON 파싱 실패, 알 수 없는 `user`, `workouts`가 배열 아님, 날짜 누락/형식 오류, 기간 400일 초과 | POST, GET |
| `too_many` | `workouts`가 1000개 초과 | POST |
| `busy` | 락을 20초 안에 얻지 못함. 잠시 후 재시도 | POST |
| `server_error` | 서버 내부 오류(상세는 Apps Script 실행 로그에만 기록) | POST, GET |

## POST `<URL>`

### 요청 본문

```json
{
  "token": "<해당 user의 쓰기 토큰>",
  "user": "me",
  "workouts": [
    {
      "type": "실외 달리기",
      "start": "2026-11-22T07:05:00+09:00",
      "end": "2026-11-22T07:37:30+09:00",
      "duration_min": 32.5,
      "active_kcal": 310,
      "avg_hr": 142,
      "max_hr": 171
    }
  ]
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `token` | 필수 | `user`에 해당하는 쓰기 토큰(`WRITE_TOKEN_ME` / `WRITE_TOKEN_WIFE`). 상대방 토큰은 거부 |
| `user` | 필수 | `"me"` 또는 `"wife"` |
| `workouts` | 필수 | 배열, 최대 1000개. 빈 배열도 허용 |
| `type` | 필수 | 앞뒤 공백 제거 후, 앞쪽의 `=` `+` `-` `@`(수식 주입 방지)와 공백도 제거. 남은 값이 1~60자. 나머지는 원문 그대로 저장 |
| `start` | 필수 | ISO 8601, **오프셋 또는 `Z` 필수**. 밀리초 허용 |
| `end` | 조건부 | `end`와 `duration_min` 중 최소 하나 필요 |
| `duration_min` | 조건부 | 없으면 `end - start`로 계산. `end`가 없으면 `start + duration_min`으로 `end` 계산 |
| `active_kcal` | 선택 | 0..10000 아니면 빈칸 |
| `avg_hr`, `max_hr` | 선택 | 25..250 아니면 빈칸 |

**숫자는 관대하게 파싱한다.** 문자열도 되며, 숫자/`.`/`-` 외 문자는 모두 버린다:
`"32.5"`, `"1,204"`(=1204), `"142 count/min"`, `"310 kcal"`, `" 171 "`. 남은 문자열 전체가 숫자여야 하며(`"142-150"`은 null), 해석 불가/빈 값은 빈칸(null).
**쉼표는 천 단위 구분으로만** 허용한다(`^-?\d{1,3}(,\d{3})+(\.\d+)?$`). `"310,4"`, `"1.204,5"`처럼 소수점 쉼표로 읽힐 수 있는 값은 모호하므로 null이다.
칼로리와 심박은 정수로 반올림, `duration_min`은 소수 1자리.

**정규화**: `start`/`end`는 `yyyy-MM-dd'T'HH:mm:ss+09:00`(서울)로 바뀐다. 예: `2026-11-21T15:30:00Z` → `2026-11-22T00:30:00+09:00`
(날짜가 바뀔 수 있음). 초 미만은 버린다.
`id = user + "_" + 정규화된 start`. 같은 id가 이미 있으면 덮어쓴다(멱등). 같은 요청을 여러 번 보내도 한 행만 남는다.
멱등 키는 `user + start(초 단위)`이므로 시작 시각이 다르면 별도 기록이다.

**갱신 시 측정값 보존**: 기존 행이 있을 때 `active_kcal`/`avg_hr`/`max_hr`의 새 값이 비었거나 해석 불가·범위 밖이면 **기존 값을 유지**한다(워치 데이터가 늦게 와서 먼저 빈 값을 보낸 뒤 채워지는 경우, 또는 반대로 나중 전송이 비어도 지워지지 않게). 새 값이 유효하면 덮어쓴다. `type`/`start`/`end`/`duration_min`은 항상 덮어쓴다.

**수신 시각**: `received_at`은 **마지막 수신** 시각(갱신될 때마다 바뀜), `first_received_at`은 **최초 수신** 시각(삽입 시에만 설정, 이후 불변). 전송 지연은 `end`와 `first_received_at`을 비교한다. 이 열이 생기기 전의 행은 `first_received_at`이 비어 있다(알 수 없음).

**행 검증**: `end >= start`, `duration_min`은 반올림 전 원값이 `0 < d <= 1440`이어야 하고, 소수 1자리 반올림 후에도 `> 0`이어야 한다(1440 허용, 1440.01 거부, 0.05는 0.1로 허용, 0.04는 거부). 위반한 행은 거부되지만 나머지 행은 정상 처리된다.

### 성공 응답

```json
{ "ok": true, "inserted": 1, "updated": 0, "rejected": [] }
```

거부된 행이 있는 경우(`index`는 `workouts` 배열의 0부터 시작하는 위치):

```json
{ "ok": true, "inserted": 1, "updated": 0,
  "rejected": [ { "index": 2, "reason": "invalid_start" } ] }
```

| reason | 의미 |
|---|---|
| `not_object` | 항목이 객체가 아님 |
| `missing_type` | `type` 없음/공백 |
| `type_too_long` | `type` 60자 초과 |
| `missing_start` | `start` 없음 |
| `invalid_start` | `start`가 ISO 8601(오프셋 포함)이 아니거나 존재하지 않는 날짜 |
| `invalid_end` | `end`가 있으나 ISO 형식이 아님 |
| `missing_end_and_duration` | `end`, `duration_min` 모두 없음 |
| `end_before_start` | `end < start` |
| `invalid_duration` | 길이가 0 이하이거나 24시간 초과 |

### 예시

```bash
curl -sL -H 'Content-Type: application/json' \
  --data '{"token":"TOKEN","user":"me","workouts":[{"type":"실외 달리기","start":"2026-11-22T07:05:00+09:00","end":"2026-11-22T07:37:30+09:00","active_kcal":"310 kcal","avg_hr":"142","max_hr":"171"}]}' \
  "https://script.google.com/macros/s/XXXX/exec"
```

## GET `<URL>?key=&from=&to=`

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `key` | 필수 | 읽기 키(`READ_KEY`) |
| `from`, `to` | 필수 | `YYYY-MM-DD`, 양끝 포함. `start`의 서울 날짜 기준. `from <= to`, 포함 일수 최대 400 |
| `action` | 선택 | `ping`이면 `from`/`to` 없이 신선도만 반환 |

### 성공 응답

```json
{
  "ok": true,
  "workouts": [
    {
      "id": "me_2026-11-22T07:05:00+09:00",
      "user": "me",
      "type": "실외 달리기",
      "start": "2026-11-22T07:05:00+09:00",
      "end": "2026-11-22T07:37:30+09:00",
      "duration_min": 32.5,
      "active_kcal": 310,
      "avg_hr": 142,
      "max_hr": 171
    }
  ],
  "updated_at": "2026-11-22T07:40:12+09:00",
  "server_time": "2026-11-22T09:00:00+09:00"
}
```

- `workouts`는 `start` 오름차순. 두 사용자의 운동이 섞여 있으므로 `user`로 구분한다.
- `duration_min`, `active_kcal`, `avg_hr`, `max_hr`는 숫자 또는 `null`(빈 문자열 아님).
- `updated_at`: 조회 기간과 무관하게 시트 전체의 `received_at` 최댓값. 데이터가 없으면 `null`.
- `server_time`: 서버 현재 시각(서울).

### ping

`GET <URL>?key=<READ_KEY>&action=ping` → `{"ok":true,"updated_at":"2026-11-22T07:40:12+09:00"}`
(데이터 없으면 `null`). 대시보드가 캐시 갱신 여부를 가볍게 확인할 때 쓴다.

### 실패 응답 예

```json
{ "ok": false, "error": "unauthorized" }
```

키가 틀리면 `workouts`는 절대 포함되지 않는다.

### 대시보드 fetch 예

```js
const res = await fetch(`${URL}?key=${encodeURIComponent(key)}&from=2026-11-01&to=2026-11-30`);
const data = await res.json();
if (!data.ok && data.error === 'unauthorized') { /* 키 재입력 */ }
```

## 시트 스키마 (`workouts` 탭)

`id, user, type, start, end, duration_min, active_kcal, avg_hr, max_hr, received_at, first_received_at` (이 순서, 11열).
10열이던 기존 시트는 다음 쓰기 때 `first_received_at` 헤더가 자동으로 추가된다. GET 응답에는 이 열이 포함되지 않는다.
문자열 컬럼(id~end, received_at, first_received_at)은 텍스트 서식이고, 시작 시각 오름차순으로 유지된다.
시트를 손으로 편집하는 것은 가능하나 헤더 순서를 바꾸면 안 된다.

## iOS 단축어에서 보낼 때

단축어는 본문을 **JSON 텍스트**로 만들어 `URL의 콘텐츠 가져오기`(POST, 요청 본문 파일)로 보낸다.
누락된 숫자 때문에 JSON이 깨지지 않도록 **모든 값을 문자열**로 보내고, 값이 없으면 빈 문자열 `""`을 쓴다.
`duration_min`은 보내지 않는다(서버가 `end - start`로 계산). 날짜는 `날짜 형식 지정`의 ISO 8601(시간 포함) 결과를 그대로 쓴다.

```json
{
  "token": "<쓰기 토큰>",
  "user": "me",
  "workouts": [
    {"type":"실외 달리기","start":"2026-11-22T07:05:00+09:00","end":"2026-11-22T07:37:30+09:00","active_kcal":"310.4","avg_hr":"142.3","max_hr":"171"},
    {"type":"요가","start":"2026-11-21T20:00:00+09:00","end":"2026-11-21T20:45:00+09:00","active_kcal":"","avg_hr":"","max_hr":""}
  ]
}
```

소수("142.3")는 서버가 정수로 반올림하고, 빈 문자열은 빈칸(null)으로 저장된다. 이 형태는 `backend/test/shortcut.test.js`가 검증한다.
자세한 제작 방법은 [shortcuts.md](shortcuts.md).
