import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ioFailures } from '../test-support/file-system.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';
import {
  classifyCodocsLocation,
  discoverCodocsLocations,
  type CodocsLocations,
} from './codocs-locations.js';
import { codocsLocationStates } from './domain-values.js';

const execute = promisify(execFile);
let project: string;

/** 프로젝트 상대 경로에 파일을 만든다. 상위 폴더도 만든다. */
async function file(relative: string, text = ''): Promise<void> {
  const target = path.join(project, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), 'codocs-locations-'));
});
afterEach(async () => {
  ioFailures.clear();
  vi.unstubAllEnvs();
  await rmWithRetry(project, { recursive: true, force: true });
});

describe('discoverCodocsLocations: 하위 .codocs 찾기', () => {
  it('Git 저장소에서 .gitignore가 제외하지 않은 하위 .codocs의 소유 폴더를 찾는다', async () => {
    await execute('git', ['init', project]);
    await file('packages/core/.codocs/a.yaml');
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual(['packages/core']);
    expect(result.failures).toEqual([]);
  });

  it('루트 .codocs와 .codocs 안의 .codocs 구간은 하위 .codocs로 찾지 않는다', async () => {
    await file('.codocs/a/.codocs/b.yaml');
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual([]);
  });

  it('.gitignore가 제외한 폴더의 .codocs는 찾지 않는다', async () => {
    await execute('git', ['init', project]);
    await file('.gitignore', '.workbench/\n');
    await file('.workbench/x/.codocs/a.yaml');
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual([]);
  });

  it('.gitignore가 제외한 폴더의 .codocs는 Git이 강제로 추적해도 찾지 않는다', async () => {
    await execute('git', ['init', project]);
    await file('.gitignore', 'build/\n');
    await file('build/.codocs/a.yaml');
    await file('packages/core/.codocs/a.yaml');
    await execute('git', ['-C', project, 'add', '-f', 'build/.codocs/a.yaml']);
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual(['packages/core']);
    expect(result.failures).toEqual([]);
  });

  it('git 실행 파일을 찾을 수 없어도 하위 .codocs를 찾고 실패를 알리지 않는다', async () => {
    await file('.gitignore', 'build/\n');
    await file('build/.codocs/a.yaml');
    await file('packages/core/.codocs/a.yaml');
    vi.stubEnv('PATH', '');
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual(['packages/core']);
    expect(result.failures).toEqual([]);
    expect(classifyCodocsLocation(result, 'packages/core')).toBe(
      codocsLocationStates.recognized,
    );
    expect(classifyCodocsLocation(result, 'build')).toBe(
      codocsLocationStates.excluded,
    );
  });

  it('git 없이도 폴더별 .gitignore 계층으로 제외한다', async () => {
    await file('packages/.gitignore', 'generated/\n');
    await file('packages/generated/.codocs/a.yaml');
    await file('packages/core/.codocs/a.yaml');
    vi.stubEnv('PATH', '');
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual(['packages/core']);
  });

  it('루트 .codocsignore가 제외한 폴더의 .codocs는 Git 추적과 무관하게 찾지 않는다', async () => {
    await execute('git', ['init', project]);
    await file('.codocsignore', 'examples/\n');
    await file('examples/.codocs/a.yaml');
    await execute('git', ['-C', project, 'add', 'examples/.codocs/a.yaml']);
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual([]);
  });

  it('Git 저장소가 아닌 프로젝트도 .gitignore 규칙으로 찾는다', async () => {
    await file('.gitignore', 'build/\n');
    await file('build/.codocs/a.yaml');
    await file('docs/.codocs/a.yaml');
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual(['docs']);
  });
});

describe('classifyCodocsLocation: .codocs 위치 판정', () => {
  it('루트 .codocs는 .gitignore가 제외해도 인정한다', async () => {
    await execute('git', ['init', project]);
    await file('.gitignore', '.codocs/\n');
    const locations = await discoverCodocsLocations(project);

    expect(classifyCodocsLocation(locations, '')).toBe(
      codocsLocationStates.recognized,
    );
  });

  it.each([
    [
      '아직 없는 폴더의 .codocs',
      'packages/new',
      codocsLocationStates.recognized,
    ],
    [
      '.gitignore가 제외한 폴더의 .codocs',
      '.workbench/x',
      codocsLocationStates.excluded,
    ],
    [
      '.codocsignore가 제외한 폴더의 .codocs',
      'examples',
      codocsLocationStates.excluded,
    ],
  ])('%s는 %s로 판정한다', async (_label, owner, expected) => {
    await execute('git', ['init', project]);
    await file('.gitignore', '.workbench/\n');
    await file('.codocsignore', 'examples/\n');
    const locations = await discoverCodocsLocations(project);

    expect(classifyCodocsLocation(locations, owner)).toBe(expected);
  });

  it('루트 .codocsignore를 읽지 못하면 하위 .codocs는 unknown이고 루트는 recognized다', async () => {
    await file('.codocsignore', 'examples/\n');
    ioFailures.set(path.join(project, '.codocsignore'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const locations = await discoverCodocsLocations(project);

    expect(locations.failures).toHaveLength(1);
    expect(classifyCodocsLocation(locations, 'packages/core')).toBe(
      codocsLocationStates.unknown,
    );
    expect(classifyCodocsLocation(locations, '')).toBe(
      codocsLocationStates.recognized,
    );
  });

  it('폴더 .gitignore를 읽지 못한 범위의 하위 .codocs를 unknown으로 판정한다', async () => {
    const known = await discoverCodocsLocations(project);
    const locations: CodocsLocations = {
      ...known,
      policy: {
        ...known.policy,
        unknownIgnoreDirectories: new Set(['packages']),
      },
    };

    expect(classifyCodocsLocation(locations, 'packages/core')).toBe(
      codocsLocationStates.unknown,
    );
  });

  it('위치 규칙이 없으면 하위 .codocs를 unknown으로 판정한다', () => {
    expect(classifyCodocsLocation(undefined, 'packages/core')).toBe(
      codocsLocationStates.unknown,
    );
  });
});
