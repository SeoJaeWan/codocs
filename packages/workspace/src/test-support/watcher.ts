import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

/** 이벤트 순서와 종료 지연을 제어하는 테스트별 상태다. */
export const watcherBoundary = {
  connections: [] as {
    paths: string;
    options: {
      depth?: number;
      followSymlinks?: boolean;
      ignored?: (path: string) => boolean;
    };
    emitter: EventEmitter;
    close: ReturnType<typeof vi.fn>;
  }[],
  directory: undefined as
    | (EventEmitter & { notify: (event: string, name: string | null) => void })
    | undefined,
  closeGate: undefined as Promise<void> | undefined,
};
const boundary = watcherBoundary;

/** 실제 파일 변경 없이 디렉터리 알림을 전달한다. */
export function directoryMock(): {
  watch: (
    path: string,
    notify: (event: string, name: string | null) => void,
  ) => EventEmitter;
} {
  return {
    /** 감시 알림을 테스트에 노출한다. */
    watch: (
      _path: string,
      notify: (event: string, name: string | null) => void,
    ) => {
      const emitter = Object.assign(new EventEmitter(), {
        notify,
        /** 다음 이벤트 순환에서 종료를 알린다. */
        close: () => queueMicrotask(() => emitter.emit('close')),
      });
      boundary.directory = emitter;
      return emitter;
    },
  };
}

/** 실제 대기 없이 watcher 연결·종료 시점을 제어한다. */
export function chokidarMock(): {
  default: {
    watch: (
      paths: string,
      options: { ignored?: (path: string) => boolean },
    ) => EventEmitter;
  };
} {
  return {
    default: {
      /** 감시 알림을 테스트에 노출한다. */
      watch: (
        paths: string,
        options: { ignored?: (path: string) => boolean },
      ) => {
        const emitter = Object.assign(new EventEmitter(), {
          close: vi.fn(async () => {
            await boundary.closeGate;
          }),
        });
        boundary.connections.push({
          paths,
          options,
          emitter,
          close: emitter.close,
        });
        queueMicrotask(() => emitter.emit('ready'));
        return emitter;
      },
    },
  };
}
