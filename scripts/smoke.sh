#!/usr/bin/env bash
# 배포된 Apps Script 웹앱 스모크 테스트 (python3 필요, jq 불필요).
# 사용: URL=https://script.google.com/macros/s/XXXX/exec WRITE_TOKEN=... READ_KEY=... ./scripts/smoke.sh
# 테스트 운동은 2000-01-01 날짜라 실제 월 화면에 나타나지 않는다.
# 시트에 남는 행 id: me_2000-01-01T00:00:00+09:00 (원하면 시트에서 직접 삭제)
set -euo pipefail

: "${URL:?URL 환경변수가 필요합니다}"
: "${WRITE_TOKEN:?WRITE_TOKEN 환경변수가 필요합니다 (me 의 쓰기 토큰)}"
: "${READ_KEY:?READ_KEY 환경변수가 필요합니다}"

TEST_ID='me_2000-01-01T00:00:00+09:00'

# JSON 에서 파이썬 식을 평가한다. d 가 파싱된 응답.
py() { python3 -c 'import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }
check() { # 설명 응답 식(참이어야 함)
  if [ "$(printf '%s' "$2" | py "$3" 2>/dev/null || echo False)" = "True" ]; then
    echo "OK: $1"
  else
    echo "FAIL: $1"; echo "   응답: $2"; exit 1
  fi
}

# 주의: -X POST 를 쓰지 않는다. Apps Script 는 302 를 주고, curl 이 --data 와 -L 조합에서
# 리다이렉트를 GET 으로 바꿔 따라가야 결과 본문을 받을 수 있다.
BODY=$(WRITE_TOKEN="$WRITE_TOKEN" python3 -c '
import json,os
print(json.dumps({"token":os.environ["WRITE_TOKEN"],"user":"me","workouts":[{
 "type":"스모크테스트","start":"2000-01-01T00:00:00+09:00","end":"2000-01-01T00:30:00+09:00",
 "duration_min":"30","active_kcal":"100 kcal","avg_hr":"120 count/min","max_hr":"150"}]}))')
post() { curl -sL -H 'Content-Type: application/json' --data "$BODY" "$URL"; }

echo "1) POST 테스트 운동 전송"
RES=$(post)
check "POST ok, rejected 없음, inserted+updated == 1" "$RES" \
  "d['ok'] is True and d['rejected']==[] and d['inserted']+d['updated']==1"

echo "2) 같은 페이로드 재전송 (멱등)"
RES=$(post)
check "두 번째 POST 는 updated == 1" "$RES" "d['ok'] is True and d['updated']==1 and d['inserted']==0"

echo "3) GET 조회"
RES=$(curl -sL -G --data-urlencode "key=$READ_KEY" --data-urlencode "from=2000-01-01" \
  --data-urlencode "to=2000-01-01" "$URL")
check "테스트 id 가 정확히 한 번 나타남" "$RES" \
  "d['ok'] is True and [w['id'] for w in d['workouts']].count('$TEST_ID')==1"

echo "4) 잘못된 키"
RES=$(curl -sL -G --data-urlencode "key=wrong" --data-urlencode "from=2000-01-01" \
  --data-urlencode "to=2000-01-01" "$URL")
check "unauthorized 이고 workouts 없음" "$RES" "d.get('error')=='unauthorized' and 'workouts' not in d"

echo "스모크 테스트 통과"
