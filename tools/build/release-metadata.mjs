import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 자체 설명·라이선스는 LF로 고정하고 로고 원본 바이트는 보존한다. */
export async function releaseMetadata(root, file, webLinks = false) {
  const bytes = await readFile(path.join(root, file));
  if (file === 'logo.png') return bytes;
  let text = bytes.toString('utf8').replace(/\r\n/gu, '\n');
  if (file.endsWith('.md')) {
    text = text.replace(/\]\((docs\/guide\/|examples\/)/gu, '](dist/$1');
    if (webLinks)
      text = text.replace(
        /\]\((?!https?:)([^)]+)\)/gu,
        (_, link) =>
          '](https://github.com/SeoJaeWan/codocs/blob/main/' +
          link.replace(/^dist\//u, '') +
          ')',
      );
  }
  return Buffer.from(text);
}
