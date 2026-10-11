import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeRepositoryKinds } from '../code-reference/domain-values.js';
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

  it('.gitignore가 제외한 폴더라도 Git이 추적하는 .codocs는 찾는다', async () => {
    await execute('git', ['init', project]);
    await file('.gitignore', 'vendor/\n');
    await file('vendor/lib/.codocs/a.yaml');
    await execute('git', [
      '-C',
      project,
      'add',
      '-f',
      'vendor/lib/.codocs/a.yaml',
    ]);
    const result = await discoverCodocsLocations(project);

    expect(result.owners).toEqual(['vendor/lib']);
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

    expect(result.policy.repositoryKind).not.toBe(codeRepositoryKinds.unknown);
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

  it('Git 상태를 확인하지 못한 규칙이면 하위 .codocs를 unknown으로 판정한다', async () => {
    const known = await discoverCodocsLocations(project);
    const locations: CodocsLocations = {
      ...known,
      policy: { ...known.policy, repositoryKind: codeRepositoryKinds.unknown },
    };

    expect(classifyCodocsLocation(locations, 'packages/core')).toBe(
      codocsLocationStates.unknown,
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
