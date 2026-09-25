# Reference Selector v2: 리서치 품질 설계

## 목적

Reference Selector는 검색 페이지가 아니라 매일 원문을 읽고 판독하는 리서치 아카이브다.
독자는 한국 TVCF 감독이자 브랜드 전략가. 일반론이 아니라 현장에서 바로 써 볼 관찰만 남긴다.

## 두 층 구조

1. **기계 층 (GitHub Actions, `npm run recover:daily`)**: RSS/Google News/북마크에서 후보를 모으고 규칙 기반 게이트로 거른 뒤 `data/archives/*.json`에 보관한다. 판단은 하지 않는다.
2. **판독 층 (Gemini 무료 등급, 같은 워크플로 안)**:
   - `scripts/deep-insight-agent.mjs`: 항목마다 원문 본문을 읽고 `item.deep`을 쓴다. keep/sharpness(1~10)/새로움/작동 원리/근거 인용/가져갈 한 수/한계/분류/연출 축/신호. 최근 3일은 원문 본문 기준(항목당 1회 호출), 그 이전은 요약 기준 8개 묶음 백필.
   - `scripts/signal-agent.mjs`: 최근 14일 판독을 모아 출처 2곳·자료 3개 이상 근거가 붙는 가설만 `data/signals.json`에 쓴다.
   - `scripts/search-index-agent.mjs`: 아카이브 + 북마크 히스토리를 임베딩(256d int8)해 `data/search/`에 샤드로 저장. 변경분만 재임베딩.
   - `scripts/export-site-data.mjs`: `public/data/*.json`으로 내보내고 `data/curator-memory.json`의 소스 성적을 다시 계산한다.

## 표시 원칙

- `deep.keep`가 false인 항목은 삭제하지 않고 접는다. 접힌 이유를 한 줄로 보여 준다.
- 원문이 1년 넘게 지난 항목은 '아카이브 발굴' 배지로 구분한다(Korean Code의 오래된 소재는 의도된 자료).
- 분류는 `scripts/insight-taxonomy.mjs`의 10개 고정 카테고리와 12개 연출 축만 쓴다.
- 요약만으로 판독한 항목은 '요약 판독' 배지, evidence는 비운다.

## 큐레이터 메모리 (`data/curator-memory.json`)

- `taste_profile`: 독자의 관심 축(인스타 저장 8,624개 자기분석에서 시드). 판독 프롬프트에 들어간다.
- `source_quality`: 출처별 seen/kept/keepRate/avgSharpness. 8개 이상 보고 keep 20% 미만이면 `demoted` → 다음 수집부터 제외.
- `pipeline_health_log`: 에이전트별 실행 기록 90건.
- `editorial_decisions`, `open_questions`: 편집 결정과 다음에 볼 질문.

## 무료 등급 예산

- 텍스트 모델: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`(각 15 RPM / 500 RPD, 회전 사용). 하루 판독 예산은 워크플로 기본값 90(본문) + 120(백필 묶음).
- 임베딩: `gemini-embedding-001` 256차원. 100개 묶음 호출.
- `/api/brief`: 질의 임베딩 1회 + 선택적 보드 구성 1회.

## 검증

- `npm run verify` (문법 + `quality:check`)
- 배포 후 `public/data/meta.json`의 `generatedAt`과 `readProgress`가 갱신됐는지 확인.
- 큐레이터 탭의 파이프라인 로그에 `deep-insight`, `signal` 항목이 매일 추가되는지 확인.

## 개인정보 원칙

- 인스타그램 저장 목록 등 본인에게만 보이는 데이터는 공개 저장소에 넣지 않는다 (2026-09-26 결정, 한 차례 커밋 후 히스토리에서 제거).
