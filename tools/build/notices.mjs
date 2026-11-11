import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 패키지에 라이선스 원문이 없을 때 쓰는 upstream 원문 폴더다. 파일 이름은 `이름@버전.txt`이며 원문 바이트를 그대로 둔다.
 * 버전까지 맞아야 쓰므로 의존성 버전이 바뀌면 원문을 다시 확인하게 된다.
 */
export const thirdPartyLicenseDirectory = fileURLToPath(
  new URL('./third-party-licenses/', import.meta.url),
);

/**
 * 실제 번들 입력의 외부 패키지에서 라이선스 원문과 고지를 수집한다.
 * 패키지 폴더의 LICENSE·COPYING·NOTICE를 먼저 쓰고, 없으면 fallbackDirectory의 `이름@버전.txt`를 쓴다. 둘 다 없으면 실패한다.
 * @param metafile esbuild metafile이다.
 * @param root 번들 입력 경로의 기준 폴더다.
 * @param fallbackDirectory 패키지에 원문이 없을 때 찾을 upstream 원문 폴더다.
 */
export async function bundledNotices(
  metafile,
  root,
  fallbackDirectory = thirdPartyLicenseDirectory,
) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.includes('node_modules')) continue;
    let directory = path.dirname(path.resolve(root, input));
    while (directory !== path.dirname(directory)) {
      try {
        const manifest = JSON.parse(
          await readFile(path.join(directory, 'package.json'), 'utf8'),
        );
        if (manifest.name) {
          packages.set(manifest.name + '@' + manifest.version, {
            directory,
            manifest,
          });
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      directory = path.dirname(directory);
    }
  }
  const notices = [];
  for (const [name, { directory, manifest }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const files = (await readdir(directory))
      .filter((file) => /^(licen[cs]e|copying|notice)([.-]|$)/iu.test(file))
      .sort()
      .map((file) => path.join(directory, file));
    if (!files.length) {
      const fallback = path.join(fallbackDirectory, name + '.txt');
      try {
        await readFile(fallback);
        files.push(fallback);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        throw new Error('번들 의존성 라이선스 원문 누락: ' + name);
      }
    }
    notices.push(name + ' (' + manifest.license + ')');
    for (const file of files) notices.push(await readFile(file, 'utf8'));
  }
  return notices.join('\n\n---\n\n') + '\n';
}
