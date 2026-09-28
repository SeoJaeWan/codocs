import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  lstat,
  stat,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { withCacheLock } from './cache-lock.mjs';

export const vscodeVersion = '1.100.0';

/** 공식 다운로드 실행 파일에서 OS별 CLI와 설치 루트를 결정한다. */
export function vscodeApplicationPaths(
  executable,
  platform = process.platform,
  applicationRoot,
) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') {
    const root = applicationRoot ?? paths.dirname(executable);
    return {
      executable,
      cli: executable,
      cliPrefix: [paths.join(root, 'resources/app/out/cli.js')],
      cliAsNode: true,
      runtimeRoot: paths.dirname(executable),
      packageJson: paths.join(root, 'resources/app/package.json'),
    };
  }
  if (platform === 'darwin') {
    const contents = paths.resolve(paths.dirname(executable), '..');
    return {
      executable,
      cli: paths.join(contents, 'Resources/app/bin/code'),
      cliPrefix: [],
      cliAsNode: false,
      runtimeRoot: paths.dirname(contents),
      packageJson: paths.join(contents, 'Resources/app/package.json'),
    };
  }
  if (platform === 'linux')
    return {
      executable,
      cli: executable,
      cliPrefix: [
        paths.join(paths.dirname(executable), 'resources/app/out/cli.js'),
      ],
      cliAsNode: true,
      runtimeRoot: paths.dirname(executable),
      packageJson: paths.join(
        paths.dirname(executable),
        'resources/app/package.json',
      ),
    };
  throw new Error(`지원하지 않는 VS Code 운영체제: ${platform}`);
}

/** 기능·성능 실행기에 같은 무결성 검증 VS Code 설치를 제공한다. */
export async function prepareVSCodeApplication(options) {
  const executable = await prepareVSCode(options);
  const platform = options.platform ?? process.platform;
  return resolveVSCodeApplicationPaths(executable, platform);
}

/** Windows 공식 압축본의 구형/중첩 app 레이아웃을 파일로 확인한다. */
export async function resolveVSCodeApplicationPaths(
  executable,
  platform = process.platform,
) {
  if (platform === 'win32') {
    const applicationRoot = await resolveWindowsApplicationRoot(executable);
    return vscodeApplicationPaths(executable, platform, applicationRoot);
  }
  return vscodeApplicationPaths(executable, platform);
}

/** Windows 압축본의 app 위치를 호스트의 실제 파일 경로로 탐색한다. */
export async function resolveWindowsApplicationRoot(executable) {
  const root = path.dirname(executable);
  const candidates = [root];
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) candidates.push(path.join(root, entry.name));
  const found = [];
  for (const candidate of candidates) {
    try {
      if (
        (
          await stat(path.join(candidate, 'resources/app/out/cli.js'))
        ).isFile() &&
        (
          await stat(path.join(candidate, 'resources/app/package.json'))
        ).isFile()
      )
        found.push(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (found.length !== 1)
    throw new Error(
      `VS Code Windows CLI 경로가 정확히 하나여야 합니다: ${found.length} (${root})`,
    );
  return found[0];
}

/** 다운로드 완료 후 실행 파일·라이브러리 전체의 내용을 해시한다. 프로필은 캐시에 만들지 않는다. */
async function fingerprint(directory) {
  const hash = createHash('sha256');
  /** 정렬한 상대 경로와 실제 파일 내용을 해시에 넣는다. */
  async function visit(relative) {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const entry = path.join(relative, name);
      const stat = await lstat(path.join(directory, entry));
      if (stat.isDirectory()) await visit(entry);
      else if (stat.isFile()) {
        hash.update(entry.replaceAll('\\', '/'));
        for await (const chunk of createReadStream(path.join(directory, entry)))
          hash.update(chunk);
      }
    }
  }
  await visit('');
  return hash.digest('hex');
}

/** 버전·OS·아키텍처별 캐시를 잠그고 공식 다운로드와 재사용 무결성을 확인한다. */
export async function prepareVSCode({
  cacheRoot,
  version = vscodeVersion,
  platform = process.platform,
  arch = process.arch,
}) {
  if (!/^\d+\.\d+\.\d+$/u.test(version))
    throw new Error('VS Code 버전은 정확한 x.y.z여야 합니다');
  if (
    !['win32', 'darwin', 'linux'].includes(platform) ||
    !['x64', 'arm64'].includes(arch)
  )
    throw new Error('지원하지 않는 VS Code 플랫폼/아키텍처');
  const key = `${platform}-${arch}-${version}`;
  await mkdir(cacheRoot, { recursive: true });
  const lock = path.join(cacheRoot, `${key}.lock`);
  const cachePath = path.join(cacheRoot, key);
  const receiptPath = path.join(cacheRoot, `${key}.json`);
  return withCacheLock(
    lock,
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
      let receipt;
      try {
        receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (receipt) {
        if (receipt.digest !== (await fingerprint(cachePath)))
          throw new Error(`VS Code 캐시 무결성 불일치: ${cachePath}`);
        return path.join(cachePath, receipt.executable);
      }
      // 중단된 다운로드만 이 버전의 전용 경로에서 제거한다.
      await rm(cachePath, { recursive: true, force: true });
      const downloadPlatform =
        platform === 'win32'
          ? `win32-${arch}-archive`
          : platform === 'darwin'
            ? arch === 'arm64'
              ? 'darwin-arm64'
              : 'darwin'
            : `linux-${arch}`;
      const executable = await downloadAndUnzipVSCode({
        version,
        platform: downloadPlatform,
        cachePath,
        timeout: 120000,
      });
      await writeFile(
        receiptPath,
        JSON.stringify({
          version,
          platform,
          arch,
          executable: path.relative(cachePath, executable),
          digest: await fingerprint(cachePath),
        }),
      );
      return executable;
    },
  );
}
