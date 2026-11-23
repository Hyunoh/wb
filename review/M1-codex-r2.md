| 항목 | 상태 | 근거 |
|---|---|---|
| 시트 연결 (`SPREADSHEET_ID`, `openById`, 활성 시트 폴백) | 해결됨 | `backend/Code.gs:29,55,265,346`, `backend/test/code.test.js:343` |
| 락 해제 전 `flush()` | 해결됨 | `backend/Code.gs:250,256,316–322`, `backend/test/code.test.js:358` |
| `type` 수식 시작 문자 제거 | 해결됨 | `backend/Code.gs:175–179`, `backend/test/code.test.js:364`, `docs/api.md:57` |
| 중복 행 정리 | 부분해결 | 중복은 제거되지만 ID가 비어 있는 수동 입력 행도 삭제될 수 있음. `backend/Code.gs:270–278,315–322`, `backend/test/code.test.js:376` |
| 설정 로그에서 키 값 제거 | 해결됨 | `backend/Code.gs:41–49`, `backend/test/code.test.js:329`, `backend/README.md:23` |
| 숫자 전체 파싱과 반올림 후 운동 시간 검사 | 부분해결 | 요청한 검사는 동작하지만 API 문서의 1,440분 경계 설명이 코드와 다름. `backend/Code.gs:104–111,192–204`, `backend/test/code.test.js:389`, `docs/api.md:72` |
| 스모크 테스트 JSON 검증 및 GET 인코딩 | 해결됨 | `scripts/smoke.sh:14–21,26–51` |
| README 직접 호출 예제 | 해결됨 | `backend/README.md:41–57` |
| CORS 배포 체크리스트 | 부분해결 | 정상·오류 응답 확인이 추가됐지만 로그아웃 조건이 빠졌고 실제 대시보드 확인은 M3로 미뤄짐. `backend/README.md:59–63`, `docs/api.md:15–18` |

### 신규 발견

- **major** · [backend/Code.gs:278](backend/Code.gs:278), [backend/Code.gs:320](backend/Code.gs:320) — **중복 정리가 수동 입력 중인 행을 지울 수 있습니다.** 마지막 행의 `type`만 입력하고 `id`를 채우기 전에 기존 운동을 재전송하면, 해당 행이 병합에서 빠지고 `clearContent()`로 지워집니다. 로컬 목에서 재현했습니다. 중복으로 확인된 행만 정리하고, ID가 없지만 값이 있는 행은 보존하도록 수정하세요.
- **minor** · [docs/api.md:72](docs/api.md:72), [backend/Code.gs:195](backend/Code.gs:195), [backend/Code.gs:202](backend/Code.gs:202) — **운동 시간 상한의 검사 순서가 API 계약과 다릅니다.** `duration_min: 1440.01`은 소수 첫째 자리로 반올림하면 `1440.0`이지만 서버는 반올림 전에 `invalid_duration`으로 거부합니다. 문서에 원래 값의 1,440분 상한과 반올림 후 양수 검사를 각각 명시하고 경계값 테스트를 추가하세요.

로컬 테스트 32개, `bash -n`, 모의 스모크 테스트의 정상·거부 경로를 확인했습니다. 실제 `/exec`, Google Sheets, Safari는 검증하지 않았습니다. 파일 변경은 없습니다.

**M1 보류**