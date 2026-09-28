import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** 실제 번들 입력의 외부 패키지에서 라이선스 원문과 고지를 수집한다. */
export async function bundledNotices(metafile, root) {
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
      .sort();
    if (!files.length)
      throw new Error('번들 의존성 라이선스 원문 누락: ' + name);
    notices.push(name + ' (' + manifest.license + ')');
    for (const file of files)
      notices.push(await readFile(path.join(directory, file), 'utf8'));
  }
  return notices.join('\n\n---\n\n') + '\n';
}
