| 검토 항목 | 판정 | 근거 |
|---|---|---|
| 인증 세대 검사 | 부분해결 | 이전 세대 응답의 데이터 쓰기는 차단합니다. 다만 이전 요청이 끝나면서 재인증 후 시작한 요청을 진행 목록에서 지울 수 있습니다. [web/lib/loader.js:27](web/lib/loader.js:27), [web/lib/loader.js:38](web/lib/loader.js:38) |
| `unauthorized` 시 시트 닫기 및 DOM 초기화 | 해결됨 | 시트와 배경이 닫히고 상세·달력·요약의 운동 기록이 비워지는 것을 확인했습니다. [web/app.js:191](web/app.js:191) |
| 자정의 범위별 요청 병합·만료 판정 및 월 전환 | 부분해결 | 범위가 늘어나면 새 요청을 보내고 월도 전환합니다. 응답이 역순으로 도착하면 캐시 범위가 줄어들며, 월 전환 중 열린 상세 시트가 빈 기록을 표시할 수 있습니다. [web/lib/loader.js:16](web/lib/loader.js:16), [web/lib/store.js:85](web/lib/store.js:85), [web/app.js:219](web/app.js:219) |
| `localStorage` 예외 처리·메모리 대체·알림 | 부분해결 | 키 쓰기 실패 시 메모리로 계속 동작하고 알림이 표시됩니다. `window.localStorage` 접근 자체에서 `SecurityError`가 발생하면 앱이 시작 전에 중단됩니다. 저장소 객체를 가져오는 코드도 `try/catch`로 감싸야 합니다. [web/app.js:19](web/app.js:19), [web/app.js:244](web/app.js:244), [web/lib/store.js:10](web/lib/store.js:10) |
| 월별 로딩·오류 상태 | 부분해결 | 다른 달의 응답은 현재 달의 오류를 지우지 않습니다. 같은 달의 자정 전 요청은 자정 후 요청의 상태를 덮을 수 있습니다. [web/lib/loader.js:29](web/lib/loader.js:29), [web/lib/loader.js:49](web/lib/loader.js:49) |
| 평균·최고 심박 독립 표시 | 해결됨 | 평균만 있는 경우, 최고만 있는 경우, 둘 다 있는 경우와 둘 다 없는 경우를 확인했습니다. [web/lib/format.js:34](web/lib/format.js:34), [web/test/loader.test.js:104](web/test/loader.test.js:104) |
| 손잡이·헤더에서 시트 끌어 닫기 | 해결됨 | 본문을 스크롤해도 손잡이·헤더에서 닫기 제스처를 시작하며, 날짜를 바꾸면 본문 스크롤이 초기화됩니다. [web/app.js:151](web/app.js:151), [web/app.js:303](web/app.js:303) |
| 셀 최소 높이 56px 및 숫자 11px | 해결됨 | CSS에서 셀 최소 높이 56px, 날짜 12px, 운동 분 11px 이상을 확인했습니다. [web/style.css:114](web/style.css:114), [web/style.css:134](web/style.css:134), [web/style.css:148](web/style.css:148) |
| 회귀 테스트 | 부분해결 | Node 테스트 32개가 모두 통과했습니다. 기존 테스트는 자정 전 응답을 먼저 완료하며, 인증 실패 테스트는 앱의 `loader.reset()`을 호출하지 않습니다. 배포 URL의 Apps Script 리디렉션·CORS와 실제 iPhone Safari 탭·홈 화면 앱의 복귀·레이아웃·터치는 검증하지 못했습니다. [web/test/loader.test.js:20](web/test/loader.test.js:20), [web/test/loader.test.js:50](web/test/loader.test.js:50), [web/app.js:193](web/app.js:193) |

### 신규 발견

1. **Major — 자정 전 요청이 더 넓은 캐시와 최신 요청 상태를 덮습니다.** 23일까지 조회한 응답이 먼저 성공하고 22일까지 조회한 응답이 늦게 성공하면, 캐시 종료일이 22일로 돌아가 23일 운동이 화면에서 사라집니다. 늦은 응답이 실패하면 최신 조회가 성공했어도 오프라인으로 표시되며, 반대 순서의 성공·실패 조합에서는 최신 오류가 지워집니다. 월별로 현재 필요한 범위와 해당 요청을 추적하고, 그 요청만 캐시와 로딩·오류 상태에 반영하세요. [web/lib/loader.js:14](web/lib/loader.js:14), [web/lib/loader.js:29](web/lib/loader.js:29)
2. **Minor — 이전 인증 세대의 요청이 새 요청의 중복 제거를 해제합니다.** 10월 요청이 `unauthorized`로 끝난 뒤 새 키로 11월을 다시 조회하면, 이전 키로 시작한 11월 요청의 완료 처리가 같은 범위의 새 요청을 진행 목록에서 지웁니다. 이어서 새로고침하면 새 키로 같은 요청이 한 번 더 전송됩니다. 완료된 Promise가 진행 목록에 등록된 Promise와 일치할 때만 삭제하세요. [web/lib/loader.js:19](web/lib/loader.js:19), [web/lib/loader.js:37](web/lib/loader.js:37)
3. **Minor — 월 전환 뒤 열린 상세 시트가 기존 기록을 빈 기록으로 표시합니다.** 11월 15일 상세를 열어 둔 채 서울 시각으로 12월 1일이 되면, 시트 제목은 11월 15일로 남지만 본문은 12월 달력의 조회 결과를 사용해 ‘운동 기록이 없어요’를 표시합니다. 자동 월 전환 시 선택 날짜가 새 격자 범위를 벗어나면 시트를 닫거나, 상세 시트가 선택 날짜의 캐시를 계속 사용하게 하세요. [web/app.js:111](web/app.js:111), [web/app.js:134](web/app.js:134), [web/app.js:219](web/app.js:219)

**M3 보류**