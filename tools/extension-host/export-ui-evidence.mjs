import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [sessionPath, destination] = process.argv.slice(2);
if (!sessionPath || !destination)
  throw new Error('session path and evidence directory required');
await mkdir(destination, { recursive: true });
const rows = (await readFile(sessionPath, 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const evidence = [];
let isolated = false;
for (const row of rows) {
  const item = row.payload?.item;
  if (
    row.payload?.type !== 'item_completed' ||
    item?.server !== 'cua_repl' ||
    item.tool !== 'js'
  )
    continue;
  // 전체 앱 목록은 제외하고 이 검증에서 선택한 isolated Code의 관찰만 내보낸다.
  if (
    !item.arguments?.code?.includes('code.') &&
    !item.arguments?.code?.includes('getApp(') &&
    !item.arguments?.code?.includes('installedCode.')
  )
    continue;
  const contents = [];
  if (item.arguments.code.includes('getApp('))
    isolated = (item.result?.content ?? []).some(
      (content) =>
        content.type === 'text' &&
        content.text.includes('[Extension Development Host]'),
    );
  if (!isolated) continue;
  for (const [index, content] of (item.result?.content ?? []).entries()) {
    if (content.type === 'text') contents.push(content);
    if (content.type === 'image' && content.data) {
      const bytes = Buffer.from(content.data, 'base64');
      const file = `${item.id}-${index}.png`;
      await writeFile(path.join(destination, file), bytes);
      contents.push({
        type: 'image',
        file,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  evidence.push({
    timestamp: row.timestamp,
    callId: item.id,
    arguments: item.arguments,
    contents,
  });
}
await writeFile(
  path.join(destination, 'observations.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(`exported ${evidence.length} isolated UI observations`);
