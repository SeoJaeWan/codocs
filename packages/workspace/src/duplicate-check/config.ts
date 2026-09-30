/** 중복 검사 실행의 기본 설정이다. 시간 제한과 조각 시간은 세션 옵션으로 바꿀 수 있다. */
export const workspaceDuplicateCheckDefaults = {
  /** 검사 한 번의 시간 제한(ms)이다. 넘으면 확인한 범위를 partial로 반환한다. */
  timeLimitMs: 3000,
  /** 이벤트 루프에 양보하지 않고 계산하는 조각의 목표 시간(ms)이다. */
  sliceMs: 15,
  /** 한 페이지가 담는 후보 수다. */
  pageSize: 20,
} as const;

/** 세션 옵션으로 주입하는 중복 검사 실행 설정이다. 생략한 값은 기본값을 쓴다. */
export interface WorkspaceDuplicateCheckOptions {
  /** 시간 제한(ms)이다. 0은 첫 비교 전에 partial로 끝낸다. */
  timeLimitMs?: number;
  /** 조각 시간(ms)이다. */
  sliceMs?: number;
  /** 시간 측정 함수(ms)다. 테스트가 결정적인 시계를 주입한다. */
  now?: () => number;
  /** 문서 한 건을 새로 준비할 때마다 호출한다. 재사용한 문서는 호출하지 않는다. */
  onPrepare?: (path: string) => void;
  /** 비교 조각 하나를 끝내고 양보하기 전에 호출한다. Promise를 반환하면 검사가 기다린다. */
  onSlice?: (progress: {
    completedUnits: number;
    totalUnits: number;
  }) => void | Promise<void>;
}

/** 단조 증가하는 기본 시계(ms)다. */
function defaultClock(): number {
  return performance.now();
}

/** 옵션을 검증해 실행 설정으로 확정한다. 유효하지 않은 값은 기본값으로 대체한다. */
export function resolveDuplicateCheckOptions(
  options: WorkspaceDuplicateCheckOptions = {},
): Required<Pick<WorkspaceDuplicateCheckOptions, 'timeLimitMs' | 'sliceMs'>> &
  WorkspaceDuplicateCheckOptions & { now: () => number } {
  /** 유효한 시간(ms)이면 그대로, 아니면 기본값을 쓴다. */
  const valid = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value >= 0
      ? value
      : fallback;
  return {
    ...options,
    timeLimitMs: valid(
      options.timeLimitMs,
      workspaceDuplicateCheckDefaults.timeLimitMs,
    ),
    sliceMs: valid(options.sliceMs, workspaceDuplicateCheckDefaults.sliceMs),
    now: options.now ?? defaultClock,
  };
}
