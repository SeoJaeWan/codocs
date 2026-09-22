import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  lstat,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { withCacheLock } from './cache-lock.mjs';

export const vscodeVersion = '1.100.0';

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
