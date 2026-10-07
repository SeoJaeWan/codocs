# COD-67 — Codocs 커스텀 ESLint 규칙 정비 및 오픈소스 대체 검토

## 배경

현재 Codocs는 ESLint에 아래 커스텀 규칙을 사용하고 있다.

- `codocs/korean-jsdoc`
- `codocs/package-boundaries`
- `codocs/no-raw-domain-value`

하지만 범용적인 코드 컨벤션이나 아키텍처 규칙까지 프로젝트 내부 커스텀 ESLint로 직접 유지할 필요가 있는지 재검토가 필요하다.

현재 이미 아래 범용 규칙은 외부 플러그인으로 처리하고 있다.

- 파일/폴더명: `eslint-plugin-check-file`
- JSDoc 존재 여부: `eslint-plugin-jsdoc`
- TypeScript 기본 규칙: `typescript-eslint`

따라서 커스텀 ESLint는 가능한 한 Codocs 고유 의미론만 담당하도록 정리한다.

## 목표

커스텀 ESLint 규칙을 아래 기준으로 재구성한다.

> 기존 ESLint 생태계로 표현 가능한 일반 규칙은 외부 플러그인/ESLint 기본 규칙을 사용하고,
> Codocs 고유 의미론 또는 invariant만 자체 커스텀 규칙으로 유지한다.

## 대상 규칙

### 1. korean-jsdoc

현재 역할:

- 선언 함수/메서드/변수 할당 함수 등에 JSDoc이 있는지 확인
- JSDoc에 한글이 포함되어 있는지 확인
- 일부 짧은 인라인 콜백 제외

검토 방향:

- JSDoc 존재 여부는 기존 `jsdoc/require-jsdoc` 유지
- 한글 포함 여부는 `eslint-plugin-jsdoc`의 description 정규식 검사(예: `match-description`)로 대체
- 인라인 콜백 범위도 `require-jsdoc`의 `contexts` 설정으로 일원화

예상 결론:

- `codocs/korean-jsdoc` 제거
- 기존 `eslint-plugin-jsdoc` 설정으로 통합

### 2. package-boundaries

현재 역할:

- Codocs package 간 허용 의존 방향 검사
- 다른 package 내부 subpath import 금지
- 상대 경로를 통한 cross-package 접근 금지
- TypeScript module resolution을 이용한 실제 대상 package 판별
- core package에서 Node/VS Code/MCP SDK 등 host dependency 금지

검토 방향:

- package 간 dependency policy는 `eslint-plugin-boundaries`로 대체 가능한지 검증
- 특정 host dependency 금지도 `eslint-plugin-boundaries`의 dependencies 규칙(`checkAllOrigins`)으로 처리한다. ESLint core `no-restricted-imports`는 정적 import만 검사하므로 동적 import와 `require()`를 막지 못한다.
- 현재 테스트 케이스를 기준으로 기존 동작이 동일하게 재현되는지 확인

주의:

현재 커스텀 구현은 `ts.resolveModuleName()`까지 사용하므로 아래 케이스를 반드시 비교한다.

- relative cross-package import
- package subpath import
- TS path/alias 해석
- dynamic import
- TSImportType
- `require()`
- export from

예상 결론:

- 가능하면 `codocs/package-boundaries` 제거
- 완전 대체가 어렵다면 범용 영역은 plugin으로 이동하고, Codocs에 꼭 필요한 최소 로직만 custom rule로 유지

### 3. no-raw-domain-value

현재 역할:

`@domainValues`로 정의된 Codocs 도메인 상수와 연결된 위치에서 raw string을 직접 사용하는 것을 금지한다.

TypeScript type checker를 이용해 아래 문맥을 추적한다.

- contextual type
- type alias
- indexed access
- property type
- 함수 parameter
- return type
- comparison
- case
- satisfies

가능한 경우 raw string을 원본 도메인 상수 참조로 자동 수정하고 import까지 추가한다.

예:

```ts
scan('ready');
```

→

```ts
scan(ScanStatus.ready);
```

판단:

- Codocs 고유 의미론에 직접 의존하는 규칙
- 범용 ESLint 플러그인으로 대체하기 어려움
- 커스텀 유지

## 목표 구조

현재:

```text
ESLint
├─ typescript-eslint
├─ eslint-plugin-check-file
├─ eslint-plugin-jsdoc
└─ codocs
   ├─ korean-jsdoc
   ├─ package-boundaries
   └─ no-raw-domain-value
```

목표:

```text
ESLint
├─ typescript-eslint
├─ eslint-plugin-check-file
│  └─ 파일/폴더 naming
├─ eslint-plugin-jsdoc
│  ├─ require-jsdoc
│  └─ 한국어 description 검사
├─ eslint-plugin-boundaries
│  ├─ package architecture
│  └─ dependencies (checkAllOrigins): core의 host dependency 제한
│     (no-restricted-imports는 정적 import만 검사하므로 사용하지 않는다)
└─ codocs custom
   └─ no-raw-domain-value
```

## 완료 조건

- [ ] `korean-jsdoc`을 `eslint-plugin-jsdoc`으로 대체 가능한지 검증한다.
- [ ] 동일 동작이 가능하면 `codocs/korean-jsdoc`을 제거한다.
- [ ] 현재 `package-boundaries` 테스트 케이스를 기준으로 `eslint-plugin-boundaries` 대체 가능성을 검증한다.
- [ ] host dependency 제한을 `eslint-plugin-boundaries` dependencies 규칙(`checkAllOrigins`)으로 처리할 수 있는지 확인한다. (`no-restricted-imports`는 정적 import만 검사한다.)
- [ ] 기존 package boundary 회귀 테스트의 의미를 유지한다.
- [ ] `no-raw-domain-value`는 Codocs 고유 커스텀 규칙으로 유지한다.
- [ ] `tools/development-checks`에서 범용 규칙 구현을 제거하거나 최소화한다.
- [ ] `.codocs/development/code-convention.yaml`의 자동 검사 설명을 실제 ESLint 구성과 일치하도록 수정한다.
- [ ] lint / typecheck / test가 모두 통과한다.

## 원칙

새로운 커스텀 ESLint 규칙은 아래 조건을 만족하는 경우에만 추가한다.

1. 기존 ESLint core 또는 검증된 오픈소스 플러그인으로 표현하기 어렵다.
2. 단순 스타일/컨벤션이 아니라 Codocs 고유 의미론 또는 invariant를 검사한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-67
