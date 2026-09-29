import assert from 'node:assert/strict';
import { readFile, readdir, access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 배포 디렉터리 전체를 정렬한 상대 파일 목록으로 읽는다. */
async function assetFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      files.push(
        ...(await assetFiles(path.join(directory, entry.name))).map(
          (file) => entry.name + '/' + file,
        ),
      );
    else files.push(entry.name);
  }
  return files.sort();
}

/** 프로젝트 소유 Markdown·YAML만 UTF-8 LF로 고정하고 나머지 바이트는 보존한다. */
export function releaseAssetBytes(file, bytes) {
  if (!/\.(md|ya?ml)$/iu.test(file)) return bytes;
  return Buffer.from(
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(bytes)
      .replaceAll('\r\n', '\n'),
  );
}

/** 최종 제품에 들어가는 전체 가이드·예제를 동일한 텍스트 바이트로 복사한다. */
export async function copyReleaseAssets(root, deployed) {
  for (const relative of ['docs/guide', 'examples/.codocs']) {
    for (const file of await assetFiles(path.join(root, relative))) {
      const target = path.join(deployed, relative, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(
        target,
        releaseAssetBytes(
          file,
          await readFile(path.join(root, relative, file)),
        ),
      );
    }
  }
}

/** 최종 제품의 전체 가이드·예제 목록과 바이트 및 상대 링크를 확인한다. */
export async function assertReleaseAssets(root, deployed) {
  for (const relative of ['docs/guide', 'examples/.codocs']) {
    const originals = await assetFiles(path.join(root, relative));
    assert.deepEqual(
      await assetFiles(path.join(deployed, relative)),
      originals,
    );
    for (const file of originals) {
      const target = path.join(deployed, relative, file);
      const content = await readFile(target);
      assert.deepEqual(
        content,
        releaseAssetBytes(
          file,
          await readFile(path.join(root, relative, file)),
        ),
      );
      if (file.endsWith('.md'))
        for (const match of content
          .toString('utf8')
          .matchAll(/\]\(([^)]+)\)/gu)) {
          const link = match[1].split('#')[0];
          if (link && !/^[a-z]+:/iu.test(link))
            await access(
              path.resolve(path.dirname(target), decodeURIComponent(link)),
            );
        }
    }
  }
}
