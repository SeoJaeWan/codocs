import { execFileSync } from 'node:child_process';
import lintStaged from 'lint-staged';

/** 설정 파일을 바꾸지 않고 Git이 원본 줄바꿈과 긴 경로를 보존하게 한다. */
export async function formatIndex(options, logger = console) {
  const before = indexEntries(options.cwd);
  let passed;
  const count = Number(process.env.GIT_CONFIG_COUNT ?? 0);
  const values = {
    GIT_CONFIG_COUNT: String(count + 2),
    [`GIT_CONFIG_KEY_${count}`]: 'core.longpaths',
    [`GIT_CONFIG_VALUE_${count}`]: 'true',
    [`GIT_CONFIG_KEY_${count + 1}`]: 'core.autocrlf',
    [`GIT_CONFIG_VALUE_${count + 1}`]: 'false',
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  try {
    passed = await lintStaged(options, logger);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  if (passed) normalizeFormattedBlobs(options.cwd, before);
  return passed;
}

/** 인덱스 항목을 원문 경로와 모드·객체 ID로 읽는다. */
function indexEntries(cwd) {
  const raw = execFileSync(
    'git',
    ['-c', 'core.longpaths=true', 'ls-files', '--stage', '-z'],
    { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  /** NUL로 분리된 인덱스의 탭 경계와 메타데이터를 해석한다. */
  function parseEntry(line) {
    const tab = line.indexOf('\t');
    const [mode, oid, stage] = line.slice(0, tab).split(' ');
    return [line.slice(tab + 1), { mode, oid, stage }];
  }
  return new Map(raw.split('\0').filter(Boolean).map(parseEntry));
}

/** 작업 파일을 재스테이징하지 않고 자동 수정한 blob에 원래 Git clean 규칙을 적용한다. */
function normalizeFormattedBlobs(cwd, before) {
  for (const [filename, entry] of indexEntries(cwd)) {
    if (
      entry.stage !== '0' ||
      !['100644', '100755'].includes(entry.mode) ||
      before.get(filename)?.oid === entry.oid
    )
      continue;
    const options = { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 };
    const bytes = execFileSync('git', ['cat-file', 'blob', entry.oid], options);
    const canonical = execFileSync(
      'git',
      [
        '-c',
        'core.longpaths=true',
        'hash-object',
        '-w',
        '--path',
        filename,
        '--stdin',
      ],
      { ...options, input: bytes, encoding: 'utf8' },
    ).trim();
    if (canonical !== entry.oid)
      execFileSync(
        'git',
        [
          '-c',
          'core.longpaths=true',
          'update-index',
          '--cacheinfo',
          entry.mode,
          canonical,
          filename,
        ],
        options,
      );
  }
}
