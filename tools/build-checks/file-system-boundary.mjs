import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

// 소스 없는 tarball 소비자에서 syscall 링크 경계만 재현한다. 제품 경로·로딩·파싱은 실제 배포 코드를 사용한다.
const actual = { ...fs.promises };
const links = new Map();

/** 링크의 상대·절대 문자열과 마지막 링크를 따라갈지 여부를 구분한다. */
function follow(input, leaf = true, depth = 0) {
  if (depth > 40)
    throw Object.assign(new Error('ELOOP: ' + input), { code: 'ELOOP' });
  const absolute = path.resolve(String(input));
  const root = path.parse(absolute).root;
  const parts = absolute.slice(root.length).split(path.sep);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
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

Object.assign(fs.promises, {
  /** 실제 목록에 나타나는 표식만 만들고 symlink 생성 권한을 요구하지 않는다. */
  async symlink(target, input) {
    const name = follow(input, false);
    await actual.writeFile(name, '', { flag: 'wx' });
    links.set(name, String(target));
  },
  /** 원문 링크 문자열을 제품의 경로 판정에 전달한다. */
  async readlink(input, options) {
    const name = follow(input, false);
    const value = links.get(name) ?? (await actual.readlink(name));
    return options === 'buffer' || options?.encoding === 'buffer'
      ? Buffer.from(value)
      : value;
  },
  /** lstat은 마지막 링크의 대상이 아닌 링크 자체를 반환한다. */
  async lstat(input, options) {
    const name = follow(input, false);
    const value = await actual.lstat(name, options);
    if (!links.has(name)) return value;
    return Object.assign(value, {
      /** 등록한 표식을 링크로 관측한다. */
      isSymbolicLink: () => true,
      /** 링크를 일반 파일로 분류하지 않는다. */
      isFile: () => false,
      /** 링크를 일반 폴더로 분류하지 않는다. */
      isDirectory: () => false,
    });
  },
  /** 링크 대상의 실제 종류와 존재를 확인한다. */
  stat(input, options) {
    return actual.stat(follow(input), options);
  },
  /** 끊어진 링크는 실제 대상의 ENOENT를 그대로 반환한다. */
  realpath(input, options) {
    return actual.realpath(follow(input), options);
  },
  /** 실제 대상의 읽기·쓰기 접근 가능 여부를 전달한다. */
  access(input, mode) {
    return actual.access(follow(input), mode);
  },
  /** 원문을 가공하지 않고 실제 파일 바이트를 읽는다. */
  readFile(input, options) {
    return actual.readFile(
      typeof input === 'string' ? follow(input) : input,
      options,
    );
  },
  /** 링크 대상 디렉터리의 실제 항목을 열거한다. */
  readdir(input, options) {
    return actual.readdir(follow(input), options);
  },
});
syncBuiltinESMExports();
