// Node 22+ 에서는 `node --test <디렉터리>` 가 디렉터리를 모듈로 해석한다.
// 이 파일이 진입점 역할을 하여 `node --test backend/test/` 가 동작하게 한다.
require('./code.test.js');
