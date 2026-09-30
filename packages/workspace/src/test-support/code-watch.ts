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
/** 실제 감시·시계 없이 등록 횟수, 등록 실패와 재시도 예약을 제어한다. */
export function createFakeCodeWatch(): {
  connections: FakeCodeWatchConnection[];
  schedules: FakeCodeWatchSchedule[];
  behavior: { failRegistrations: number };
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
  const behavior = { failRegistrations: 0 };
  return {
    connections,
    schedules,
    behavior,
    /** 등록 중 오류를 주입할 수 있는 연결을 만든다. */
    createWatcher: (_projectRoot, changed, failed, excluded) => {
      const connection = { changed, failed, excluded, closed: false };
      connections.push(connection);
      return {
        /** 지정한 횟수만큼 등록 중 오류를 보낸 뒤 ready로 끝낸다. */
        start: () => {
          if (behavior.failRegistrations > 0) {
            behavior.failRegistrations--;
            failed(new Error('EPERM: 감시 등록 실패'));
          }
          return Promise.resolve();
        },
        /** 종료를 기록한다. */
        close: () => {
          connection.closed = true;
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
