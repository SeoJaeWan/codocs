/** 코드 감시 연결 하나가 받은 콜백과 종료 여부다. */
export interface FakeCodeWatchConnection {
  changed: (paths: readonly string[]) => void;
  failed: (error: unknown) => void;
  excluded: (input: string, stats?: { isDirectory(): boolean }) => boolean;
  closed: boolean;
}
/** 예약된 재시도 하나와 취소 여부다. */
export interface FakeCodeWatchSchedule {
  delay: number;
  run: () => void;
  cancelled: boolean;
}
/** 색인이 호출한 전체 정책 계산과 전체 탐색의 횟수이며 테스트만 읽는다. */
export const codeAccessCounts = { policy: 0, discovery: 0 };
/** 횟수를 0으로 되돌린다. */
export function resetCodeAccessCounts(): void {
  codeAccessCounts.policy = 0;
  codeAccessCounts.discovery = 0;
}
/** 제품 계약에 계수 지점을 더하지 않고 module mock으로 전체 정책 계산과 전체 탐색 호출만 센다. */
export function countCodeAccess<
  T extends {
    computeCodeFilePolicy: (...args: never[]) => unknown;
    discoverCodeFiles: (...args: never[]) => unknown;
  },
>(actual: T): T {
  return {
    ...actual,
    /** 전체 정책 계산 호출을 센다. */
    computeCodeFilePolicy: (
      ...args: Parameters<T['computeCodeFilePolicy']>
    ) => {
      codeAccessCounts.policy++;
      return actual.computeCodeFilePolicy(...args);
    },
    /** 전체 탐색 호출을 센다. */
    discoverCodeFiles: (...args: Parameters<T['discoverCodeFiles']>) => {
      codeAccessCounts.discovery++;
      return actual.discoverCodeFiles(...args);
    },
  };
}
/** 실제 감시·시계 없이 등록 횟수, 등록 실패와 재시도 예약을 제어한다. */
export function createFakeCodeWatch(): {
  connections: FakeCodeWatchConnection[];
  schedules: FakeCodeWatchSchedule[];
  /** 연결별 start·ready·close를 발생 순서대로 기록한다(예: start:1, ready:1, close:0). */
  events: string[];
  /** holdStart를 켜면 이후 연결의 ready가 release 전까지 보류된다. */
  behavior: { failRegistrations: number; holdStart: boolean };
  /** 보류된 연결의 ready를 허용한다. */
  release: (index: number) => void;
  createWatcher: (
    projectRoot: string,
    changed: FakeCodeWatchConnection['changed'],
    failed: FakeCodeWatchConnection['failed'],
    excluded: FakeCodeWatchConnection['excluded'],
  ) => { start(): Promise<void>; close(): Promise<void> };
  schedule: (callback: () => void, delay: number) => () => void;
} {
  const connections: FakeCodeWatchConnection[] = [];
  const schedules: FakeCodeWatchSchedule[] = [];
  const events: string[] = [];
  const holds = new Map<number, () => void>();
  const behavior = { failRegistrations: 0, holdStart: false };
  return {
    connections,
    schedules,
    events,
    behavior,
    /** 보류된 ready를 해제한다. */
    release: (index) => holds.get(index)?.(),
    /** 등록 중 오류를 주입할 수 있는 연결을 만든다. */
    createWatcher: (_projectRoot, changed, failed, excluded) => {
      const connection = { changed, failed, excluded, closed: false };
      const index = connections.push(connection) - 1;
      const hold = behavior.holdStart;
      return {
        /** 지정한 횟수만큼 등록 중 오류를 보낸 뒤 ready로 끝낸다. */
        start: async () => {
          events.push(`start:${index}`);
          if (hold)
            await new Promise<void>(
              /** 해제 함수를 보관한다. */ (resolve) =>
                holds.set(index, resolve),
            );
          if (behavior.failRegistrations > 0) {
            behavior.failRegistrations--;
            failed(new Error('EPERM: 감시 등록 실패'));
          }
          events.push(`ready:${index}`);
        },
        /** 종료를 기록한다. */
        close: () => {
          connection.closed = true;
          events.push(`close:${index}`);
          return Promise.resolve();
        },
      };
    },
    /** 시간이 흐르지 않고 테스트가 실행 시점을 정한다. */
    schedule: (run, delay) => {
      const item = { delay, run, cancelled: false };
      schedules.push(item);
      return /** 예약을 취소로 기록한다. */ () => {
        item.cancelled = true;
      };
    },
  };
}
