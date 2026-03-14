# OrigamiCraft Fold Simulator (MVP)

웹 기반 종이접기 시뮬레이션 기본 모듈입니다.

## 포함 기능

- 접힘선 그리기: 종이 위를 드래그해서 접힘선을 생성
- 접기 동작: 우클릭 지점 기준 가장 가까운 1겹을 씨드로 잡고 드래그해 각도 조절
- 접힘 시각 정책: 접힘선은 힌지처럼 보이도록 내부 공유 경계선(절단처럼 보이는 선)은 억제
- 3D 렌더링: Three.js 기반 실시간 렌더링
- 터치/마우스 공통 입력: Pointer Events 사용

## 현재 모듈 구조

- `app.js`: 진입 파일(부트스트랩)
- `src/main.js`: UI 이벤트/모드 전환/메시지 라우팅 오케스트레이션
- `src/core/messages.js`: 모듈 간 메시지 타입 계약
- `src/core/messageBus.js`: 최소 pub/sub 메시지 버스
- `src/modules/sceneSetup.js`: 렌더러/카메라/라이트/바닥 씬 초기화
- `src/modules/cameraOrbitController.js`: 우클릭 카메라 오빗(메시지 구독 객체)
- `src/modules/paperSimulator.js`: 레이어 기반 종이 시뮬레이션 + 접힘 확정 이벤트 발행
- `src/modules/paperPoseController.js`: 종이 자세 제어(세우기/뒤집기/리셋)
- `src/modules/foldHistoryManager.js`: 접힘/포즈 이력 누적 스냅샷 저장
- `src/modules/airplaneEvaluator.js`: 자유 접기 기반 종이비행기 완성도 평가
- `src/modules/geometry.js`: 폴리곤 분할/거리/기하 계산 유틸
- `src/lib/three.js`: Three.js CDN import 단일 진입점

모듈은 직접 서로 호출하지 않고, `MessageBus`와 `MSG` 계약을 통해 최소 메시지로 동작합니다.

## 실행 방법

정적 파일 서버로 실행하세요.

```bash
cd d:/project/OrigamiCraft
python -m http.server 5173
```

브라우저에서 `http://localhost:5173` 접속

## 조작법

1. 종이 위 `좌클릭 드래그`로 접힘선 생성
2. 접힘선에서 떨어진 면을 `우클릭 드래그`로 접기
   - 선택은 클릭 지점의 면(접힘선 기준 side)을 먼저 고정한 뒤, 그 면에 겹친 레이어 중 가장 가까운 1겹을 씨드로 고릅니다.
   - 씨드와 경계를 공유하며 같은 접힘 측에 있는 연결 레이어는 함께 접혀, 절단처럼 분리된 움직임을 줄입니다.
   - 연결되지 않은 뒤쪽 레이어는 다시 해당 면을 우클릭해 순차적으로 접을 수 있습니다.
3. 카메라는 `MMB(휠 클릭) + 드래그`로 회전, `휠`로 줌
4. 종이 자세 제어:
   - `1`: 세우기
   - `2`: 뒤집기
   - `0`: 작업면 기준 초기화

## 종이비행기 평가 기준(자유 접기 B)

- 평가는 접힘이 확정되어 레이어가 커밋될 때 실행됩니다.
- 현재 휴리스틱 점수 요소:
  - 좌우 대칭도
  - 중심축 정렬도(마지막 접힘선 기준)
  - 실루엣 길쭉함(가로/세로 바운딩 비율)
  - 레이어 깊이(겹 수)
  - 포즈 안정도(과도한 기울기 페널티)
- 기본 완성 임계치:
  - 점수 `0.72` 이상
  - 레이어 수 `3` 이상

## 튜닝 포인트

- `src/modules/paperSimulator.js`
  - `foldLimits.snapStartAngle`, `snapTargetAngle`
  - `layerGap`
- `src/modules/paperPoseController.js`
  - `smoothFactor`, `snapEpsilon`
- `src/modules/airplaneEvaluator.js`
  - 점수 가중치(대칭/정렬/실루엣/레이어/포즈)
  - 완성 임계치(`0.72`)

## 다음 단계 제안

- 템플릿 단계형(A) 모드 추가: `matchStep(state, templateStep)` 기반 튜토리얼
- Undo/Redo(이력 복원) 및 스텝 리플레이
- 평가 로그 기반 임계치 자동 보정
- 비행/던지기 미니게임 연결(완성 점수 연동)
