# Codex Project Harness: ref

이 프로젝트는 reference-selector Node/Vercel 앱이다. Codex는 하네스 엔지니어링 방식으로 작업하되, 이 파일의 프로젝트별 검증 명령을 우선한다.

## 작업 루프

1. 요청을 질문, 조사, 구현, 리뷰, 배포 중 무엇인지 분류한다.
2. 관련 파일만 읽는다. `node_modules`, `.vercel`, `.env.local`은 필요한 경우를 제외하고 열지 않는다.
3. 변경 전 `package.json`과 관련 스크립트를 확인한다.
4. 좁게 수정하고, 데이터 파일과 공개 정적 파일 변경의 파급을 확인한다.
5. 완료 전 변경 범위에 맞게 검증한다.

## 검증 명령

- 설치: `npm install`
- 개발 서버: `npm run dev`
- 북마크 갱신: `npm run update:bookmarks`
- 업데이트 백필: `npm run backfill:updates`
- 정적 아카이브 내보내기: `npm run export:archive`
- 전체 검증: `npm run verify`

`npm run verify`는 북마크 추출 체크와 주요 `public`, `api`, `scripts` 파일의 Node 문법 검사를 포함한다.

## 프로젝트 규칙

- `.env.local`의 값은 읽거나 출력하지 않는다.
- Vercel Blob, 배포, 백필처럼 외부 상태가 바뀌는 작업은 사용자 요청 또는 명확한 승인 없이 실행하지 않는다.
- 검색/업데이트 API 변경 시 `api/*.mjs`, `scripts/*-core.mjs`, `public/app.js`의 계약을 함께 확인한다.
- 정적 출력물 `public/static-updates.js`를 바꾸면 생성 스크립트와 검증 결과를 같이 확인한다.
- 반복되는 데이터 품질 문제는 수동 메모가 아니라 검증 스크립트 또는 데이터 검사로 승격한다.

## 효율 규칙

- 루트 하네스나 긴 조사 메모는 필요한 경우에만 읽는다.
- 브라우저 검증은 UI 또는 API 응답 확인이 필요한 변경에만 수행한다.
- 배포 전에는 로컬 검증 명령을 먼저 통과시킨다.
- 새 데이터 소스나 업데이트 흐름을 이해해야 할 때는 `api`, `scripts`, `public`의 연결 구조를 먼저 지도화한다.
- 반복되는 검색/큐레이션/백필 절차는 스크립트 또는 체크리스트로 승격한다.
- 외부 영상/자료를 ref에 넣을 때는 제목, 설명, 자막/본문, 출처 URL을 함께 남긴다.
- 레퍼런스 탐색 UI, 대시보드, 큐레이션 화면을 설계하거나 크게 고칠 때는 `$designer-codex-workflow`로 디자인 컨텍스트와 반응형 QA를 먼저 잡는다.
- `public` UI나 레퍼런스 사이트 화면을 크게 바꾸는 작업은 `$image-first-frontend`를 사용해 시각 레퍼런스, 에셋, 반응형 검증을 분리한다.
