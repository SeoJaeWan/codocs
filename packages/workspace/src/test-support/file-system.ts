import type * as FileSystem from 'node:fs/promises';

/** 테스트가 지정한 경로·호출의 오류만 주입하고 나머지는 실제 OS에서 실행한다. */
export const ioFailures = new Map<
  string,
  { operations: readonly string[]; code: string }
>();

/** 권한이 없어 실제 파일 연결을 만들 수 없는 호스트에서도 연결 거부 계약을 재현한다. */
export const simulatedFileLinks = new Set<string>();

/** 링크·권한 규칙을 재현하지 않고 선택한 syscall의 실패 응답만 대체한다. */
export function withIoFailures(actual: typeof FileSystem): typeof FileSystem {
  const wrapped = { ...actual };
  for (const operation of [
    'access',
    'stat',
    'lstat',
    'realpath',
    'readlink',
    'readFile',
    'readdir',
  ] as const) {
    Reflect.set(
      wrapped,
      operation,
      /** 지정 오류 외의 호출은 실제 IO에 전달한다. */ async (
        ...args: unknown[]
      ) => {
        const selected = typeof args[0] === 'string' ? args[0] : undefined;
        if (selected && simulatedFileLinks.has(selected)) {
          if (operation === 'lstat')
            return {
              /** 파일 연결을 재현한다. */
              isSymbolicLink: () => true,
              /** 파일 연결은 디렉터리가 아니다. */
              isDirectory: () => false,
              /** 파일 연결은 일반 파일이 아니다. */
              isFile: () => false,
            };
          if (operation === 'realpath' || operation === 'readFile')
            throw new Error(
              `테스트가 파일 연결의 대상을 따라갔습니다: ${selected}`,
            );
        }
        const failure =
          selected === undefined ? undefined : ioFailures.get(selected);
        if (failure?.operations.includes(operation))
          throw Object.assign(new Error(failure.code), {
            code: failure.code,
            path: args[0],
          });
        return await (Reflect.apply(
          actual[operation],
          actual,
          args,
        ) as Promise<unknown>);
      },
    );
  }
  return wrapped;
}
