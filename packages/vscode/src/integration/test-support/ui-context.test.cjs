const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const contextSource = fsSync.readFileSync(
  path.join(__dirname, 'ui-context.cjs'),
  'utf8',
);

/** 격리된 workspace에서 UI context를 만들고 임시 경로를 반환한다. */
async function setup() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codocs-ui-'));
  const tabs = [{ tabs: [{}] }];
  const vscode = {
    Uri: {
      /** 테스트 fixture 경로를 VS Code 파일 URI처럼 제공한다. */
      file(fsPath) {
        return {
          scheme: 'file',
          fsPath,
          /** 경로를 VS Code URI 문자열로 표현한다. */
          toString: () => `file://${fsPath}`,
        };
      },
    },
    workspace: {
      textDocuments: [],
      /** 테스트에서 요청한 원문을 반환한다. */
      openTextDocument: /** 요청 원문을 테스트 문서로 연다. */ async (uri) => {
        return {
          uri,
          /** 비어 있는 테스트 문서 내용을 반환한다. */
          getText() {
            return '';
          },
        };
      },
      /** 테스트 편집을 성공한 것으로 기록한다. */
      applyEdit: async () => true,
    },
    window: {
      tabGroups: { all: tabs },
      /** 문서를 활성 편집기로 보여준다. */
      showTextDocument: async (document) => ({ document }),
      activeTextEditor: undefined,
    },
    commands: {
      /** 편집기 닫기 명령의 관측 상태를 갱신한다. */
      async executeCommand(command) {
        if (command === 'workbench.action.closeAllEditors')
          for (const group of tabs) group.tabs = [];
      },
    },
    languages: {
      /** 테스트 workspace에는 서버 진단을 게시하지 않는다. */
      getDiagnostics: () => [],
    },
    Range: class Range {},
  };
  const faults = { restoration: undefined };
  const exports = {};
  const context = {
    exports,
    /** fixture 모듈을 테스트에서 직접 불러온다. */
    fixtureModule: async () => {
      const fixture = await import('./ui-fixture.mjs');
      return {
        ...fixture,
        /** fixture 복원 오류 주입을 허용한다. */
        async createFixture(root) {
          if (faults.restoration) throw faults.restoration;
          return fixture.createFixture(root);
        },
      };
    },
    /** vscode 요청에는 테스트 double을 반환한다. */
    require(identifier) {
      if (identifier === 'vscode') return vscode;
      return require(identifier);
    },
  };
  vm.runInNewContext(
    contextSource.replaceAll("import('./ui-fixture.mjs')", 'fixtureModule()'),
    context,
    {
      filename: path.join(__dirname, 'ui-context.cjs'),
    },
  );
  /** 테스트 조건을 즉시 관측하고 실패하면 이름을 남긴다. */
  const until = async (predicate, message) => {
    const value = await predicate();
    assert.ok(value, message);
    return value;
  };
  /** 남아 있는 Hover를 정리한다. */
  async function dismiss() {}
  const contextValue = exports.uiContext(
    { workspace, profile: path.join(workspace, 'profile') },
    { dismiss },
    until,
  );
  return { workspace, tabs, vscode, context: contextValue, faults };
}

test('fixture를 만들고 삭제하며 열린 편집기를 닫는 helper를 제공한다', /** 공개 helper와 부수 효과를 확인한다. */ async (t) => {
  const setupResult = await setup();
  t.after(() => fs.rm(setupResult.workspace, { recursive: true, force: true }));
  const { context, workspace, tabs } = setupResult;

  for (const method of ['create', 'remove', 'closeAll'])
    assert.equal(typeof context[method], 'function', method);
  await context.create('navigation/temporary.txt', 'temporary fixture');
  assert.equal(
    await fs.readFile(path.join(workspace, 'navigation/temporary.txt'), 'utf8'),
    'temporary fixture',
  );
  await context.remove('navigation/temporary.txt');
  await assert.rejects(
    fs.access(path.join(workspace, 'navigation/temporary.txt')),
    { code: 'ENOENT' },
  );
  await context.closeAll();
  assert.deepEqual(
    tabs.map((group) => group.tabs.length),
    [0],
  );
});

test('삭제된 미저장 fixture를 복원하고 사례가 만든 파일을 정리한다', /** 삭제 fixture 복구와 생성 파일 정리를 확인한다. */ async (t) => {
  const setupResult = await setup();
  t.after(() => fs.rm(setupResult.workspace, { recursive: true, force: true }));
  const { context, workspace, vscode } = setupResult;
  const { createFixture } = await import('./ui-fixture.mjs');
  await createFixture(workspace);
  const relative = '.codocs/navigation-target.yaml';
  const file = path.join(workspace, relative);
  const baseline = await fs.readFile(file, 'utf8');
  const document = {
    uri: vscode.Uri.file(file),
    isDirty: true,
    value: `${baseline}unsaved edit\n`,
    /** 편집 중인 문서 내용을 반환한다. */
    getText() {
      return this.value;
    },
  };
  vscode.workspace.textDocuments.push(document);
  /** 되돌리기와 닫기 뒤 실제 fixture 상태를 반영한다. */
  async function executeCommand(command) {
    if (command === 'workbench.action.revertAndCloseActiveEditor') {
      document.value = await fs.readFile(file, 'utf8');
      document.isDirty = false;
    }
    if (command === 'workbench.action.closeAllEditors')
      setupResult.tabs[0].tabs = [];
  }
  vscode.commands.executeCommand = executeCommand;
  await fs.rm(file);
  await context.create('navigation/temporary.txt', 'case file');

  await context.reset();

  assert.equal(await fs.readFile(file, 'utf8'), baseline);
  assert.equal(document.getText(), baseline);
  assert.equal(document.isDirty, false);
  await assert.rejects(
    fs.access(path.join(workspace, 'navigation/temporary.txt')),
    { code: 'ENOENT' },
  );
});

test('workspace 밖의 미저장 문서는 되돌리지 않고 외부 파일을 보존한다', /** 외부 원문은 변경하지 않는지 확인한다. */ async (t) => {
  const setupResult = await setup();
  const outside = path.join(os.tmpdir(), `codocs-outside-${process.pid}.txt`);
  t.after(async () => {
    await fs.rm(setupResult.workspace, { recursive: true, force: true });
    await fs.rm(outside, { force: true });
  });
  await fs.writeFile(outside, 'preserve');
  setupResult.vscode.workspace.textDocuments.push({
    uri: setupResult.vscode.Uri.file(outside),
    isDirty: true,
  });

  await assert.rejects(
    setupResult.context.reset(),
    /only owned fixture may be changed/u,
  );

  assert.equal(await fs.readFile(outside, 'utf8'), 'preserve');
});

test('fixture 복원에 실패하면 오류를 사례 실패로 전달한다', /** 복원 오류가 사례 실패로 전달되는지 확인한다. */ async (t) => {
  const setupResult = await setup();
  t.after(() => fs.rm(setupResult.workspace, { recursive: true, force: true }));
  const failure = new Error('fixture restoration failed');
  setupResult.faults.restoration = failure;

  await assert.rejects(
    setupResult.context.reset(),
    (error) => error === failure,
  );
});
