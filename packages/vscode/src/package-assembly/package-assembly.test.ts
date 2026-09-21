/* eslint-disable codocs/korean-jsdoc -- package metadata 검증 콜백이다. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledServerPath } from './index.js';

const packageRoot = path.resolve(import.meta.dirname, '../..');

describe('VS Code 확장 패키지 조립', () => {
  it('Extension Host를 활성화하면 main·수동 재시작 명령을 manifest에 선언한다', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    );

    expect(manifest).toMatchObject({
      main: './dist/index.cjs',
      engines: { vscode: '^1.95.0' },
      extensionKind: ['workspace'],
      activationEvents: [
        'onStartupFinished',
        'onCommand:codocs.restartLanguageServers',
      ],
      contributes: {
        commands: [{ command: 'codocs.restartLanguageServers' }],
      },
    });
  });

  it('설치된 extension root 아래의 bundled server 진입점을 사용한다', () => {
    expect(bundledServerPath('/extension')).toBe(
      path.join('/extension', 'dist/server/index.cjs'),
    );
  });
});
