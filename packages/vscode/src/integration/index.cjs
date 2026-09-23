const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { context } = require('./test-support/context.cjs');
const { scenarios } = require('./extension.test.cjs');

/** 공식 Extension Host의 실행 진입점에서 독립 기능 사례와 관측을 기록한다. */
exports.run =
  /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async function run() {
    const config = JSON.parse(
      await fs.readFile(process.env.CODOCS_VSCODE_CONFIG, 'utf8'),
    );
    const c = context(config);
    const { fixtureFiles } = await import('./test-support/fixtures.mjs');
    const results = [];
    const environment = {
      vscode: vscode.version,
      node: process.versions.node,
      electron: process.versions.electron,
      platform: process.platform,
      apiObservation: true,
      renderedUi: false,
    };
    const extension = vscode.extensions.getExtension('codocs.codocs');
    c.assert.ok(extension, '설치한 VSIX 확장 등록');
    c.assert.equal(
      await fs.realpath(extension.extensionPath),
      await fs.realpath(config.extension),
      '제품은 개발 소스가 아닌 이번에 설치한 VSIX에서 로드되어야 한다',
    );
    environment.packageKind = 'installed-vsix';
    environment.extensionPath = extension.extensionPath;
    await extension.activate();
    c.assert.ok(extension.isActive);
    for (const scenario of scenarios) {
      const started = Date.now();
      try {
        // 이전 사례의 미저장 버퍼를 실제 편집기 명령으로 폐기한 후 새 fixture를 준비한다.
        for (const document of vscode.workspace.textDocuments)
          if (document.isDirty && document.uri.scheme === 'file') {
            await vscode.window.showTextDocument(document);
            await vscode.commands.executeCommand(
              'workbench.action.revertAndCloseActiveEditor',
            );
          }
        await vscode.commands.executeCommand(
          'workbench.action.closeAllEditors',
        );
        for (const extra of ['.codocs/moved.yaml', '.codocs/closed-a.yaml'])
          await fs.rm(path.join(c.root, extra), { force: true });
        for (const [relative, content] of Object.entries(fixtureFiles())) {
          if (relative === 'partial/.codocs/unreadable.yaml') continue;
          const target = path.join(c.root, relative);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, content);
        }
        await vscode.commands.executeCommand('codocs.restartLanguageServers');
        const ready = await c.open('source.java');
        await c.hover(ready, 'readySignal', 'UI ready sentinel');
        await scenario.run(c);
        results.push({
          id: scenario.id,
          title: scenario.title,
          passed: true,
          milliseconds: Date.now() - started,
        });
      } catch (error) {
        results.push({
          id: scenario.id,
          title: scenario.title,
          passed: false,
          milliseconds: Date.now() - started,
          error: error.stack ?? String(error),
        });
      }
      await fs.writeFile(
        path.join(config.output, 'functional.json'),
        JSON.stringify({ environment, results }, null, 2),
      );
    }
    const failures = results.filter((result) => !result.passed);
    if (failures.length)
      throw new Error(
        `${failures.length}/${results.length} VS Code 기능 실패: ${failures.map((item) => item.id).join(', ')}`,
      );
  };
