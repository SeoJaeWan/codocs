import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const corpusSettings = Object.freeze({
  seed: 20260924,
  normalCount: 800,
  longCount: 100,
  referencesCount: 50,
  errorsCount: 30,
  duplicateCount: 20,
  normalBodyLength: 160,
  longBodyLength: 4096,
  referenceCount: 10,
  errorKind: 'malformed-yaml-missing-colon',
});

/** 실제 UTF-8 입력을 식별한다. */
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
/** 고정 seed에서 플랫폼과 무관한 요청 순서를 생성한다. */
function randomGenerator(seed) {
  let value = seed >>> 0;
  /** 다음 난수를 반환한다. */
  function nextRandom() {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x100000000;
  }
  return nextRandom;
}

/** 정의문의 실제 문자 수를 고정한다. */
function body(id, length) {
  const phrase = `Expected body for ${id}. `;
  return phrase.repeat(Math.ceil(length / phrase.length)).slice(0, length);
}

/** 독립 기대값과 순서를 파일을 쓰기 전에 고정한다. */
export function createCorpus(
  settings = corpusSettings,
  projectId = 'project-a',
) {
  if (!/^[a-z][a-z0-9-]*$/u.test(projectId))
    throw new Error('프로젝트 ID 형식이 잘못되었습니다');
  if (settings.duplicateCount !== 20)
    throw new Error('중복 ID 문서 20개가 필요합니다');
  const random = randomGenerator(settings.seed);
  const documents = [];
  const files = {};
  /** 문서와 독립 기대값을 한 번만 등록한다. */
  const add = (category, index, id, definition, content, expected) => {
    const relative = `.codocs/performance/${category}-${String(index).padStart(4, '0')}.yaml`;
    files[relative] = content;
    documents.push({
      category,
      id,
      relative,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
      expected: { ...expected, definition },
    });
  };
  /** 정상 형식 문서를 유형별로 생성한다. */
  const valid = (category, count, length, makeDefinition) => {
    for (let index = 1; index <= count; index++) {
      const id = `${category}${String(index).padStart(4, '0')}`;
      const definition =
        makeDefinition?.(id, index) ?? body(`${projectId}-${id}`, length);
      const content = `id: ${id}\nname: ${id}\ndefinition: ${JSON.stringify(definition)}\ndomains: [performance]\n`;
      add(category, index, id, definition, content, {
        kind: 'hover',
        id,
        projectId,
      });
    }
  };
  valid('normal', settings.normalCount, settings.normalBodyLength);
  valid('long', settings.longCount, settings.longBodyLength);
  valid(
    'references',
    settings.referencesCount,
    settings.normalBodyLength,
    /** 다수의 독립 참조를 갖는 정의를 생성한다. */
    (id) => {
      const references = Array.from(
        { length: settings.referenceCount },
        (_, i) =>
          `[[normal${String(i + 1 + (((Number(id.slice(-4)) - 1) * settings.referenceCount) % settings.normalCount)).padStart(4, '0')}]]`,
      );
      return `${body(`${projectId}-${id}`, settings.normalBodyLength)} ${references.join(' ')}`;
    },
  );
  for (let index = 1; index <= settings.errorsCount; index++) {
    const id = `error${String(index).padStart(4, '0')}`;
    const content = `id: ${id}\nname: ${id}\ndefinition ${projectId}-${id}\ndomains: [performance]\n`;
    add('errors', index, id, null, content, {
      kind: 'parse-error',
      errorKind: settings.errorKind,
      projectId,
    });
  }
  for (let index = 1; index <= settings.duplicateCount; index++) {
    const id = `duplicate${String(Math.ceil(index / 2)).padStart(2, '0')}`;
    const definition = body(
      `${projectId}-${id}-${index}`,
      settings.normalBodyLength,
    );
    const content = `id: ${id}\nname: ${id}\ndefinition: ${JSON.stringify(definition)}\ndomains: [performance]\n`;
    add('duplicate', index, id, definition, content, {
      kind: 'duplicate-id',
      id,
      projectId,
      pair: Math.ceil(index / 2),
    });
  }
  const requests = documents.map(
    /** 요청 대상과 기대값을 파일과 별도로 보관한다. */
    (document, index) => ({
      documentIndex: index,
      id: document.id,
      category: document.category,
      expected: document.expected,
    }),
  );
  for (let index = requests.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [requests[index], requests[other]] = [requests[other], requests[index]];
  }
  const code = requests.map((request) => `${request.id}();`).join('\n') + '\n';
  files['probe.java'] = code;
  const fileHashes = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, sha256(content)]),
  );
  const manifest = {
    schema: 'codocs-ide-corpus/v1',
    projectId,
    settings,
    documents,
    requests,
    fileHashes,
    totalFiles: documents.length + 1,
    totalBytes: Object.values(files).reduce(
      (sum, content) => sum + Buffer.byteLength(content),
      0,
    ),
  };
  return { files, manifest, sha256: sha256(JSON.stringify(manifest)) };
}

/** 생성된 내용의 덮어쓰기를 금지해 실행별 입력을 보존한다. */
export async function writeCorpus(workspace, corpus) {
  for (const [relative, content] of Object.entries(corpus.files)) {
    const target = path.join(workspace, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
  }
  await writeFile(
    path.join(workspace, 'corpus-manifest.json'),
    JSON.stringify(
      {
        ...corpus.manifest,
        sha256: corpus.sha256,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
}
