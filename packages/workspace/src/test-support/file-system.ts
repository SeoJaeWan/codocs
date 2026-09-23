import type * as FileSystem from 'node:fs/promises';

/** 테스트가 지정한 경로·호출의 오류만 주입하고 나머지는 실제 OS에서 실행한다. */
export const ioFailures = new Map<
  string,
  { operations: readonly string[]; code: string }
>();

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
        const failure =
          typeof args[0] === 'string' ? ioFailures.get(args[0]) : undefined;
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
