import { test as base, expect, _electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  cp,
  glob,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertBackground,
  backgroundState,
  ensureBackground,
} from './background.mjs';
import { captureEvidence, errorRecord } from './evidence.mjs';

const execute = promisify(execFile);
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const observer = path.join(import.meta.dirname, 'observer');

/** 실행별 기본 문서와 편집할 코드의 고정 데이터를 제공한다. */
export function fixtureFiles() {
  return {
    '.codocs/ready.yaml':
      'id: ready-signal\nname: Ready Signal\ndefinition: UI ready sentinel\ndomains: [test]\n',
    '.codocs/zone.yaml':
      'id: zone\nname: Zone\ndefinition: Zone body [[Direct]]\ndomains: [test]\n',
    '.codocs/direct.yaml':
      'id: direct\nname: Direct\ndefinition: Direct body\ndomains: [test]\n',
    '.codocs/referrer.yaml':
      'id: referrer\nname: Referrer\ndefinition: Backlink [[Zone]]\ndomains: [test]\n',
    '.codocs/auxiliary.yaml':
      'id: auxiliary\nname: Auxiliary\ndefinition: Auxiliary body\ndomains: [test]\n',
    '.codocs/source.yaml':
      'id: source\nname: Source\ndefinition: Body [[Zone]] and [[Zone]]\nexamples:\n  - Example [[Zone]]\ndomains: [test]\ncustom: Metadata [[Zone]]\n',
    '.codocs/ambiguous.yaml':
      'id: ambiguous-source\nname: Ambiguous Source\ndefinition: Body [[Twin]]\ndomains: [test]\n',
    '.codocs/twin-a.yaml':
      'id: twin-a\nname: Twin\ndefinition: Twin A body\ndomains: [alpha]\n',
    '.codocs/twin-b.yaml':
      'id: twin-b\nname: Twin\ndefinition: Twin B body\ndomains: [beta]\n',
    '.codocs/current.yaml':
      'id: current\nname: Current\ndefinition: Current body\ndomains: [test]\ndeprecatedAliases:\n  - id: current\n  - id: previous\n',
    '.codocs/duplicate-a.yaml':
      'id: duplicate\nname: Duplicate\ndefinition: First duplicate body\ndomains: [test]\n',
    '.codocs/duplicate-b.yaml':
      'id: duplicate\nname: Duplicate\ndefinition: Second duplicate body\ndomains: [test]\n',
    '.codocs/old.yaml':
      'id: old\nname: Old\ndefinition: Old body\nstatus: deprecated\ndomains: [test]\n',
    '.codocs/old-source.yaml':
      'id: old-source\nname: Old Source\ndefinition: Body [[Old]]\ndomains: [test]\n',
    '.codocs/missing.yaml':
      'id: missing-source\nname: Missing Source\ndefinition: Body [[Absent]]\ndomains: [test]\n',
    '.codocs/invalid.yaml':
      'id: Invalid_ID\nname: Invalid\ndefinition: Invalid body retained\ndomains: [test]\ndeprecatedAliases:\n  - id: legacy-invalid\n',
    '.codocs/invalid-source.yaml':
      'id: invalid-source\nname: Invalid Source\ndefinition: Body [[Invalid]]\ndomains: [test]\n',
    '.codocs/broken.yaml': 'id: broken\nname: Broken\ndomains: [test]\n',
    'source.java':
      'class Probe {\n  readySignal();\n  zoneAuxiliary();\n  currentPrevious();\n  previous();\n  duplicateAuxiliary();\n  broken();\n  legacyInvalid();\n  utterlyUnmatched();\n}\n',
    'native.ts': 'function nativeFunction() { return 1; }\nnativeFunction();\n',
  };
}

/** 경로 밖으로 fixture 파일이 새지 않게 검증한다. */
export function fixturePath(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep))
    throw new Error(`fixture 밖의 경로: ${relative}`);
  return target;
}

/** 실제 편집기의 DOM 입력과 읽기 전용 관측을 연결한다. */
export class EditorUi {
  /** 격리된 UI 실행의 준비와 결과를 확인한다. */ constructor(
    page,
    root,
    stateFile,
    logs,
  ) {
    this.page = page;
    this.root = root;
    this.stateFile = stateFile;
    this.logs = logs;
    this.modifier = modifier;
  }

  /** 임시 작업 공간의 파일 URI를 반환한다. */
  uri(relative) {
    return pathToFileURL(fixturePath(this.root, relative)).toString();
  }

  /** 관측 확장이 게시한 최신 상태만 읽는다. */
  async state() {
    try {
      return JSON.parse(await readFile(this.stateFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /** 서버의 완료 관측 통지를 로그에서 읽으며 요청을 실행하지 않는다. */
  async snapshotCount() {
    let count = 0;
    for await (const file of glob('**/*.log', { cwd: this.logs })) {
      const content = await readFile(path.join(this.logs, file), 'utf8');
      count += (
        content.match(/Received notification 'codocs\/snapshotChanged'/gu) ?? []
      ).length;
    }
    return count;
  }

  /** 파일 검색 UI로 파일을 열고 정확한 URI의 활성화를 기다린다. */
  async open(relative) {
    await this.page.keyboard.press('Escape');
    await this.page.keyboard.press(`${modifier}+p`);
    const widget = this.page.locator('.quick-input-widget:visible');
    await widget
      .locator('input:not([type="checkbox"])')
      .fill(fixturePath(this.root, relative));
    await widget
      .locator('.monaco-list-row')
      .filter({ hasText: path.basename(relative) })
      .first()
      .click();
    await expect
      .poll(async () => (await this.state())?.active?.uri)
      .toBe(this.uri(relative));
    await this.page.locator('.view-lines:visible').first().waitFor();
  }

  /** 화면의 텍스트 노드만 사용해 지정한 출현의 문자 중심 좌표를 찾는다. */
  async point(text, occurrence = 0, character = 1) {
    return this.page.locator('.view-lines .view-line:visible').evaluateAll(
      /** 격리된 UI 실행의 준비와 결과를 확인한다. */ (lines, request) => {
        let remaining = request.occurrence;
        for (const line of lines) {
          const content = line.textContent.replaceAll('\u00a0', ' ');
          let start = content.indexOf(request.text);
          while (start >= 0) {
            if (remaining-- === 0) {
              let offset =
                start + Math.min(request.character, request.text.length - 1);
              const walker = document.createTreeWalker(
                line,
                NodeFilter.SHOW_TEXT,
              );
              let node;
              while ((node = walker.nextNode())) {
                if (offset < node.textContent.length) {
                  const range = document.createRange();
                  range.setStart(node, offset);
                  range.setEnd(node, offset + 1);
                  const box = range.getBoundingClientRect();
                  return {
                    x: box.x + box.width / 2,
                    y: box.y + box.height / 2,
                  };
                }
                offset -= node.textContent.length;
              }
            }
            start = content.indexOf(request.text, start + request.text.length);
          }
        }
        throw new Error(`화면에서 찾지 못한 텍스트: ${request.text}`);
      },
      { text, occurrence, character },
    );
  }

  /** 실제 마우스를 출현 위로 이동하고 요청한 화면 내용이 준비되기를 기다린다. */
  async hover(text, expected, occurrence = 0, character = 1) {
    const hover = this.page.locator('.monaco-hover:visible').first();
    await expect(
      /** 격리된 UI 실행의 준비와 결과를 확인한다. */ async () => {
        await this.page.mouse.move(5, 5);
        const point = await this.point(text, occurrence, character);
        await this.page.mouse.move(point.x, point.y);
        await expect(hover).toContainText(expected, { timeout: 1000 });
      },
    ).toPass({ timeout: 15000, intervals: [100, 200, 400] });
    return hover;
  }

  /** 링크 위에 수정 키를 누른 채 실제 마우스로 클릭한다. */
  async follow(text, occurrence = 0) {
    const point = await this.point(
      text,
      occurrence,
      Math.floor(text.length / 2),
    );
    await this.page.keyboard.down(modifier);
    try {
      await this.page.mouse.click(point.x, point.y);
    } finally {
      await this.page.keyboard.up(modifier);
    }
  }

  /** 편집기에 입력하고 변경된 미저장 버전의 관측을 기다린다. */
  async replace(text) {
    const previous = await this.state();
    await this.page.keyboard.press('Escape');
    await this.page.locator('.view-lines:visible').first().click();
    await this.page.keyboard.press(`${modifier}+a`);
    await this.page.keyboard.insertText(text);
    await expect
      .poll(async () => (await this.state())?.active?.text)
      .toBe(text);
    await expect
      .poll(async () => (await this.state())?.active?.version)
      .toBeGreaterThan(previous.active.version);
  }

  /** 비동기 클릭 처리 동안 잘못된 탭이나 팝업이 생기지 않는지 계속 검사한다. */
  async observeNavigation(relative) {
    const until = Date.now() + 2500;
    const violations = [];
    await expect
      .poll(
        /** 격리된 UI 실행의 준비와 결과를 확인한다. */ async () => {
          const uri = (await this.state())?.active?.uri;
          if (uri !== this.uri(relative)) violations.push({ uri });
          if (await this.page.locator('.quick-input-widget:visible').count())
            violations.push('picker');
          if (
            await this.page
              .locator('.notifications-toasts .notification-toast')
              .count()
          )
            violations.push('notification');
          return Date.now() >= until;
        },
        { timeout: 5000, intervals: [100] },
      )
      .toBe(true);
    return violations;
  }
}

export const test = base.extend({
  runtime: [null, { option: true, scope: 'worker' }],
  vsix: [null, { option: true, scope: 'worker' }],
  files: [{}, { option: true }],
  partial: [false, { option: true }],
  nested: [false, { option: true }],
  installation: [
    /** 격리된 UI 실행의 준비와 결과를 확인한다. */ async (
      { runtime, vsix },
      use,
    ) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-ui-install-'));
      try {
        await execute(
          runtime.executable,
          [
            runtime.cli,
            '--install-extension',
            vsix,
            '--force',
            '--user-data-dir',
            path.join(root, 'u'),
            '--extensions-dir',
            path.join(root, 'e'),
          ],
          {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            timeout: 60000,
          },
        );
        await use(path.join(root, 'e'));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
  /** 격리된 UI 실행의 준비와 결과를 확인한다. */ ui: async (
    { runtime, installation, files, partial, nested },
    use,
    testInfo,
  ) => {
    const temporary = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'codocs-ui-')),
    );
    const root = path.join(temporary, 'w');
    let app;
    let page;
    let tracing = false;
    let phase = 'environment';
    let fixtureError;
    let finalBackground;
    let processLog = '';
    const backgroundRecords = [];
    const errors = [];
    const output = testInfo.outputPath('evidence');
    await mkdir(output, { recursive: true });
    try {
      await mkdir(root);
      const contents = { ...fixtureFiles(), ...files };
      for (const [relative, source] of Object.entries(contents)) {
        const target = fixturePath(root, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, source);
      }
      if (partial) {
        try {
          await symlink(
            path.join(root, '.codocs/not-present.yaml'),
            path.join(root, '.codocs/unreadable.yaml'),
          );
        } catch (error) {
          if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code))
            testInfo.skip(true, `symlink capability 없음: ${error.code}`);
          throw error;
        }
      }
      const settings = {
        'files.autoSave': 'off',
        'security.workspace.trust.enabled': false,
        'update.mode': 'none',
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
        'extensions.ignoreRecommendations': true,
        'telemetry.telemetryLevel': 'off',
        'workbench.startupEditor': 'none',
        'workbench.editor.enablePreview': false,
        'window.restoreWindows': 'none',
        'editor.minimap.enabled': false,
        'editor.hover.delay': 150,
        'editor.hover.sticky': true,
        'editor.multiCursorModifier': 'alt',
        'editor.renderWhitespace': 'none',
        'editor.wordWrap': 'off',
        'editor.autoClosingBrackets': 'never',
        'editor.autoClosingQuotes': 'never',
        'editor.formatOnType': false,
        'editor.formatOnPaste': false,
        'editor.autoIndent': 'none',
        '[yaml]': { 'editor.autoIndent': 'none' },
        'chat.disableAIFeatures': true,
        'codocs-0.trace.server': 'verbose',
      };
      await mkdir(path.join(temporary, 'u/User'), { recursive: true });
      await writeFile(
        path.join(temporary, 'u/User/settings.json'),
        JSON.stringify(settings),
      );
      await cp(installation, path.join(temporary, 'e'), { recursive: true });
      const folders = [
        { path: root },
        ...(nested ? [{ path: path.join(root, 'nested') }] : []),
      ];
      const workspace = path.join(temporary, 'ui.code-workspace');
      await writeFile(workspace, JSON.stringify({ folders }));
      const env = {
        ...process.env,
        CODOCS_UI_STATE: path.join(temporary, 'state.json'),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.VSCODE_IPC_HOOK_CLI;
      app = await _electron.launch({
        executablePath: runtime.executable,
        env,
        chromiumSandbox: true,
        timeout: 30000,
        args: [
          '--user-data-dir',
          path.join(temporary, 'u'),
          '--extensions-dir',
          path.join(temporary, 'e'),
          '--extensionDevelopmentPath',
          observer,
          '--new-window',
          '--skip-welcome',
          '--skip-release-notes',
          '--disable-workspace-trust',
          '--disable-updates',
          '--disable-telemetry',
          '--disable-experiments',
          '--locale=en',
          workspace,
          path.join(root, 'source.java'),
        ],
      });
      /** 기동 후 프로세스 출력을 제한된 크기로 보존한다. */
      const recordOutput = (chunk) => {
        processLog = (processLog + chunk.toString()).slice(-65536);
      };
      app.process().stdout?.on('data', recordOutput);
      app.process().stderr?.on('data', recordOutput);
      backgroundRecords.push({ checkpoint: 'before-first-window' });
      await ensureBackground(app, backgroundRecords);
      page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      await app.context().tracing.start({ screenshots: true, snapshots: true });
      tracing = true;
      backgroundRecords.push({ checkpoint: 'after-first-window' });
      await ensureBackground(app, backgroundRecords);
      const ui = new EditorUi(
        page,
        root,
        env.CODOCS_UI_STATE,
        path.join(temporary, 'u/logs'),
      );
      await expect
        .poll(async () => (await ui.state())?.codocsActive)
        .toBe(true);
      await ui.hover('readySignal', 'UI ready sentinel');
      await page.mouse.move(5, 5);
      await page.keyboard.press('Escape');
      phase = 'test';
      await use(ui);
      if (testInfo.status === testInfo.expectedStatus) phase = 'teardown';
      finalBackground = await backgroundState(app, backgroundRecords);
      assertBackground(finalBackground);
      await writeFile(
        path.join(output, 'state.json'),
        JSON.stringify(await ui.state(), null, 2),
      );
    } catch (error) {
      fixtureError = error;
      errors.push(errorRecord(error, phase));
      throw error;
    } finally {
      testInfo.annotations.push({
        type: 'execution-phase',
        description: phase,
      });
      /** 정리 작업 하나의 실패가 나머지 증거 수집과 앱 종료를 막지 않게 한다. */
      const attempt = async (stage, action) => {
        try {
          await action();
        } catch (error) {
          errors.push(errorRecord(error, stage));
        }
      };
      if (app && !finalBackground) {
        await attempt('background-state', async () => {
          finalBackground = await backgroundState(app, backgroundRecords);
        });
      }
      const failed =
        Boolean(fixtureError) ||
        errors.length > 0 ||
        testInfo.status !== testInfo.expectedStatus;
      await captureEvidence({
        page: page ?? app?.windows()[0],
        tracing: tracing ? app.context().tracing : null,
        failed,
        output,
        errors,
        /** 수집된 증거를 현재 테스트에 연결한다. */
        attach: (name, attachment) => testInfo.attach(name, attachment),
      });
      if (app)
        await attempt(
          'close',
          /** 이 테스트의 격리 앱만 종료한다. */ () => app.close(),
        );
      await attempt(
        'logs',
        /** 격리된 테스트의 증거와 정리 결과를 보존한다. */ async () => {
          await cp(path.join(temporary, 'u/logs'), path.join(output, 'logs'), {
            recursive: true,
          }).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        },
      );
      await attempt('cleanup', () =>
        rm(temporary, { recursive: true, force: true, maxRetries: 3 }),
      );
      await attempt(
        'background-evidence',
        /** 격리된 테스트의 증거와 정리 결과를 보존한다. */ () =>
          writeFile(
            path.join(output, 'background.json'),
            JSON.stringify(
              { records: backgroundRecords, final: finalBackground },
              null,
              2,
            ),
          ),
      );
      await attempt('process-log', () =>
        writeFile(path.join(output, 'process.log'), processLog),
      );
      await attempt(
        'environment',
        /** 격리된 테스트의 증거와 정리 결과를 보존한다. */ async () => {
          await writeFile(
            path.join(output, 'environment.json'),
            JSON.stringify(
              {
                ...runtime,
                platform: process.platform,
                arch: process.arch,
                phase,
                background: true,
              },
              null,
              2,
            ),
          );
          await testInfo.attach('UI evidence', {
            path: path.join(output, 'environment.json'),
            contentType: 'application/json',
          });
        },
      );
      await attempt(
        'errors',
        /** 격리된 테스트의 증거와 정리 결과를 보존한다. */ () =>
          writeFile(
            path.join(output, 'errors.json'),
            JSON.stringify([...testInfo.errors, ...errors], null, 2),
          ),
      );
      if (
        !fixtureError &&
        testInfo.status === testInfo.expectedStatus &&
        errors.length
      ) {
        throw new Error(`UI 증거 수집/정리 실패: ${JSON.stringify(errors)}`);
      }
    }
  },
});
export { expect };
