import path from 'node:path';
import type * as FileSystem from 'node:fs/promises';

/** 실제 임시 파일 위에서 링크·권한 syscall만 재현한다. 제품 경로 판정은 대체하지 않는다. */
export function createFileSystemBoundary(
  actual: typeof FileSystem,
): typeof FileSystem {
  const links = new Map<string, string>();
  const modes = new Map<string, number>();

  /** 원래 링크 문자열을 따라가되 순환은 OS의 ELOOP로 반환한다. */
  function follow(input: string, leaf = true, depth = 0): string {
    if (depth > 40)
      throw Object.assign(new Error('ELOOP: ' + input), { code: 'ELOOP' });
    const absolute = path.resolve(input);
    const parts = absolute
      .slice(path.parse(absolute).root.length)
      .split(path.sep);
    let current = path.parse(absolute).root;
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]!);
      const target = links.get(current);
      if (target !== undefined && (leaf || index < parts.length - 1)) {
        return follow(
          path.join(
            path.resolve(path.dirname(current), target),
            ...parts.slice(index + 1),
          ),
          leaf,
          depth + 1,
        );
      }
    }
    return absolute;
  }

  /** metadata 확인과 읽기·탐색 거부를 구분하며 호스트 권한을 바꾸지 않는다. */
  function checked(input: string, mask = 0, leaf = true): string {
    const resolved = follow(input, leaf);
    for (const [restricted, mode] of modes) {
      const relative = path.relative(restricted, resolved);
      const child =
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith('..' + path.sep) &&
        !path.isAbsolute(relative);
      if (
        (child && (mode & 0o100) === 0) ||
        (relative === '' && (mode & mask) !== mask)
      ) {
        throw Object.assign(new Error('EACCES: ' + input), {
          code: 'EACCES',
          path: input,
        });
      }
    }
    return resolved;
  }

  return {
    ...actual,
    /** 링크 표식은 열거에만 쓰며 대상 syscall에는 원래 링크를 제공한다. */
    async symlink(target, input) {
      const name = follow(String(input), false);
      await actual.writeFile(name, '', { flag: 'wx' });
      links.set(name, String(target));
    },
    /** 링크 자체의 원래 상대·절대 표기를 유지한다. */
    async readlink(input, options) {
      const name = checked(String(input), 0, false);
      const target = links.get(name) ?? (await actual.readlink(name));
      return options === 'buffer' ||
        (typeof options === 'object' && options?.encoding === 'buffer')
        ? Buffer.from(target)
        : target;
    },
    /** lstat은 마지막 링크를 따라가지 않는다. */
    async lstat(input, options) {
      const name = checked(String(input), 0, false);
      const result = await actual.lstat(name, options);
      if (!links.has(name)) return result;
      return Object.assign(result, {
        /** 표식은 링크 자체다. */
        isSymbolicLink: () => true,
        /** 링크를 일반 파일로 오인하지 않는다. */
        isFile: () => false,
        /** 링크를 일반 폴더로 오인하지 않는다. */
        isDirectory: () => false,
      });
    },
    /** stat은 링크의 실제 대상을 확인한다. */
    async stat(input, options) {
      return actual.stat(checked(String(input)), options);
    },
    /** realpath는 링크 해석과 대상 존재를 확인한다. */
    async realpath(input, options) {
      const result = await actual.realpath(checked(String(input)));
      return options === 'buffer' ||
        (typeof options === 'object' && options?.encoding === 'buffer')
        ? Buffer.from(result)
        : result;
    },
    /** 실제 호스트의 접근 확인 전에 모의 권한을 검사한다. */
    async access(input, mode = 0) {
      const mask =
        (mode & 4 ? 0o400 : 0) |
        (mode & 2 ? 0o200 : 0) |
        (mode & 1 ? 0o100 : 0);
      return actual.access(checked(String(input), mask), mode);
    },
    /** 원문 바이트를 변환하지 않고 대상 읽기에 전달한다. */
    async readFile(input, options) {
      return actual.readFile(
        typeof input === 'string' ? checked(input, 0o400) : input,
        options,
      );
    },
    /** 폴더 읽기 권한과 실제 대상의 열거를 연결한다. */
    async readdir(input, options) {
      return await actual.readdir(
        checked(String(input), 0o400),
        options as Parameters<typeof actual.readdir>[1],
      );
    },
    /** 연결 경유 쓰기도 실제 대상에 반영한다. */
    async writeFile(input, data, options) {
      return actual.writeFile(
        typeof input === 'string' ? checked(input, 0o200) : input,
        data,
        options,
      );
    },
    /** POSIX 모드 입력은 호스트 chmod 대신 오류 fixture를 설정한다. */
    chmod(input, mode) {
      modes.set(follow(String(input)), Number(mode));
      return Promise.resolve();
    },
    /** 삭제는 링크 자체를 제거하고 해당 fixture의 경계 상태를 정리한다. */
    async rm(input, options) {
      const name = follow(String(input), false);
      await actual.rm(name, options);
      for (const key of [...links.keys()])
        if (key === name || key.startsWith(name + path.sep)) links.delete(key);
      for (const key of [...modes.keys()])
        if (key === name || key.startsWith(name + path.sep)) modes.delete(key);
    },
    /** 폴더 이동 뒤에도 그 안의 상대 링크 표기를 보존한다. */
    async rename(from, to) {
      const source = follow(String(from), false);
      const destination = follow(String(to), false);
      await actual.rename(source, destination);
      for (const [key, target] of [...links]) {
        if (key === source || key.startsWith(source + path.sep)) {
          links.delete(key);
          links.set(destination + key.slice(source.length), target);
        }
      }
    },
  } as typeof FileSystem;
}
