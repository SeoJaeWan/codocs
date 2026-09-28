import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
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
        await readFile(path.join(root, relative, file)),
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
