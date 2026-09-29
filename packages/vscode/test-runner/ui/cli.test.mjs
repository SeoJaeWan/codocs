import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { parseArguments } from './cli.mjs';

const args = [
  '--version',
  '1.139.1',
  '--vsix',
  path.resolve('candidate.vsix'),
  '--output',
  path.resolve('evidence'),
];

test('accepts an exact shared version and candidate with isolated evidence output', /** 입력 계약의 성공·실패 관측을 검증한다. */ () => {
  assert.deepEqual(parseArguments(args, { CI: 'true' }, 'darwin'), {
    version: '1.139.1',
    vsix: args[3],
    output: args[5],
    timeout: 600_000,
  });
});

test('refuses moving versions, missing candidate, duplicate flags and unbounded timeout', /** 입력 계약의 성공·실패 관측을 검증한다. */ () => {
  for (const version of ['stable', 'insiders', '1.139', '1.139.1-insider'])
    assert.throws(
      /** 입력 계약의 성공·실패 관측을 검증한다. */ () =>
        parseArguments(
          ['--version', version, ...args.slice(2)],
          { CI: 'true' },
          'win32',
        ),
      /exact/u,
    );
  assert.throws(
    () => parseArguments(args.slice(0, 2), { CI: 'true' }, 'win32'),
    /vsix/u,
  );
  assert.throws(
    /** 입력 계약의 성공·실패 관측을 검증한다. */ () =>
      parseArguments(
        [...args, '--version', '1.139.1'],
        { CI: 'true' },
        'win32',
      ),
    /Invalid/u,
  );
  assert.throws(
    () =>
      parseArguments([...args, '--timeout-ms', '0'], { CI: 'true' }, 'win32'),
    /between/u,
  );
  assert.throws(
    () =>
      parseArguments([...args, '--extra', 'value'], { CI: 'true' }, 'win32'),
    /Invalid/u,
  );
});

test('local and unsupported OS calls fail before downloading or launching a GUI', /** 입력 계약의 성공·실패 관측을 검증한다. */ () => {
  assert.throws(() => parseArguments(args, {}, 'win32'), /only in CI/u);
  assert.throws(
    () => parseArguments(args, { CI: 'true' }, 'linux'),
    /Unsupported/u,
  );
});
