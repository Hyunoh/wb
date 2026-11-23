# 운동보드 대시보드 (web/)

부부 운동 기록을 월 달력으로 보여 주는 정적 페이지. 빌드 없이 바닐라 ES 모듈로 동작하고,
이 `web/` 폴더만 GitHub Pages로 배포한다. 데이터는 Apps Script 웹앱(`docs/api.md`)에서 GET으로 받는다.

## 동작 방식
- `index.html` / `style.css` / `app.js`: UI. 디자인은 `mockup/`의 A안(사람별 막대 + 분)과 같다.
- `lib/dates.js`(서울 날짜, 월 격자), `lib/aggregate.js`(집계, 아이콘), `lib/format.js`(포맷, 이스케이프),
  `lib/api.js`(fetch 클라이언트), `lib/store.js`(localStorage 캐시).
- 처음 열면 공유 키를 입력받아 `localStorage`(`wb.key`)에 저장한다. 키는 서버 요청 쿼리와 localStorage 외에는 어디에도 쓰지 않는다.
- 시작하면 캐시(`wb.m.YYYY-MM`)로 먼저 그리고 뒤에서 새로 받는다. 달 이동 시 캐시가 5분 넘으면 다시 받고,
  앱이 다시 보일 때 마지막 갱신이 60초 넘었으면 갱신한다. 헤더의 "N분 전 업데이트"를 누르면 강제 갱신한다.
- 키가 틀리면(`unauthorized`) 저장된 키와 캐시를 지우고 키 입력 화면으로 돌아간다.
- 네트워크 실패 시 저장된 기록을 보여 주고 "오프라인 · 저장된 기록"(회색 점)으로 표시한다.

## 로컬 실행
```sh
python3 -m http.server -d web 8000
# http://localhost:8000/
```

## 목 모드 (디자인 확인용)
`http://localhost:8000/?mock=1` — 키 입력과 네트워크 없이 `mock-data.js`의 가짜 데이터로 그린다(오늘 = 2026-11-22).

## 설정 링크 (아내에게 보내기)
`https://<사용자>.github.io/<저장소>/#k=<읽기키>` 를 열면 키를 꺼내 주소창에서 즉시 지우고,
서버로 검증한 뒤 저장한다. 한 번 누르면 끝이다.
**주의: 이 링크에는 읽기 키가 그대로 들어 있다.** 메신저 대화방 등 신뢰할 수 있는 곳에만 보내고,
유출이 의심되면 Apps Script의 `READ_KEY`를 바꾼다(그러면 모든 기기가 키를 다시 입력한다).

## 배포
`main`에 push하면 `.github/workflows/pages.yml`이 `web/`을 GitHub Pages로 배포한다.
저장소 Settings > Pages > Source를 "GitHub Actions"로 설정해 둔다. 저장소에 키를 넣지 않는다.
`web/config.js`의 `API_URL`은 비밀이 아니다(키 없이는 아무것도 돌려주지 않는다).

## 테스트
```sh
node --test "web/test/*.test.js"
```
(Node 22+에서는 디렉터리 인자 대신 글롭을 쓴다. 인자 없이 `node --test`도 된다.)

## 이름/색 바꾸기
- 이름: `web/config.js`의 `USERS` (`id`는 서버의 `user` 값과 같아야 한다).
- 색: `web/style.css` 상단 `:root`의 `--me`, `--wife`(+ `-soft`) 라이트/다크 두 곳.
- 아이콘 매핑: `web/lib/aggregate.js`의 `ICONS`.
