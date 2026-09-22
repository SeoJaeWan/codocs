const { denyRead } = require('../test-runtime/read-denial.cjs');
const { ownedServers, killOwnedServer } = require('./processes.cjs');

/** 운영 파일의 실제 읽기 실패를 전용 숨김 자식으로 만들고 명시적으로 해제한다. */
async function lockFile(c, relative) {
  return denyRead(
    c.path.join(c.root, relative),
    c.path.join(c.config.temporary, 'diagnostic-denied-' + Date.now()),
  );
}

/** 실제 게시 진단과 사용자 상태 안내를 등록된 명령으로 관측한다. */
exports.scenarios = [
  {
    id: 'unexpected-server-exit',
    title:
      '전용 서버가 예기치 않게 종료되어도 미저장 최신 문서를 자동 재동기화한다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      const d = await c.open('.codocs/source.yaml');
      await c.replace(
        d,
        '# 😀 최신\n' + d.getText().replace('id: source', 'id: direct'),
      );
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(d, 'duplicate_id').length, 1),
      );
      const before = ownedServers(c);
      c.assert.equal(before.length, 3, '현재 시험의 세 workspace 서버만 종료');
      for (const pid of before) killOwnedServer(c, pid);
      await c.eventually(
        /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ () => {
          const after = ownedServers(c);
          c.assert.equal(after.length, 3);
          c.assert.ok(after.every((pid) => !before.includes(pid)));
        },
      );
      await c.eventually(
        /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ () => {
          const diagnostics = c.diagnostics(d, 'duplicate_id');
          c.assert.equal(diagnostics.length, 1);
          c.assert.equal(diagnostics[0].range.start.line, 1);
          c.assert.equal(d.getText(diagnostics[0].range), 'direct');
        },
      );
      const hover = await c.hover(d, '[[Zone]]', 'Zone', 0, 3);
      await c.execute(c.command(hover, 'Zone'));
      await c.atTop('.codocs/zone.yaml');
      c.assert.ok(d.isDirty);
    },
  },
  {
    id: 'diagnostics-closed-catalog',
    title: '닫힌 지식 파일도 저장 중복과 정확한 위치를 게시한다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      const uri = c.uri('.codocs/duplicate-a.yaml');
      c.assert.equal(
        c.vscode.workspace.textDocuments.some(
          (document) => document.uri.toString() === uri.toString(),
        ),
        false,
      );
      await c.eventually(
        /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ () => {
          const values = c.diagnostics({ uri }, 'duplicate_id');
          c.assert.equal(values.length, 1);
          c.assert.deepEqual(
            [
              values[0].range.start.line,
              values[0].range.start.character,
              values[0].range.end.character,
            ],
            [0, 4, 13],
          );
        },
      );
    },
  },
  {
    id: 'diagnostics-live-create',
    title: '미저장 ID 편집을 즉시 진단하고 다른 저장 문서에 전파하지 않는다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      const d = await c.open('.codocs/source.yaml');
      await c.replace(d, d.getText().replace('id: source', 'id: zone'));
      await c.eventually(
        /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ () => {
          c.assert.equal(c.diagnostics(d, 'duplicate_id').length, 1);
          c.assert.equal(
            c.diagnostics({ uri: c.uri('.codocs/zone.yaml') }, 'duplicate_id')
              .length,
            0,
          );
        },
      );
      c.assert.ok(d.isDirty);
    },
  },
  {
    id: 'diagnostics-live-resolve',
    title: '저장 중복을 미저장 원문에서 해소하면 현재 밑줄을 제거한다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      const d = await c.open('.codocs/duplicate-a.yaml');
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(d, 'duplicate_id').length, 1),
      );
      await c.replace(
        d,
        '# 😀 앞줄\n' + d.getText().replace('id: duplicate', 'id: distinct'),
      );
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(d, 'duplicate_id').length, 0),
      );
      c.assert.ok(d.isDirty);
    },
  },
  {
    id: 'diagnostics-save',
    title: 'ID 중복을 저장하면 다른 닫힌 문서의 진단도 갱신한다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      const d = await c.open('.codocs/source.yaml');
      await c.replace(d, d.getText().replace('id: source', 'id: zone'));
      c.assert.equal(await d.save(), true);
      await c.eventually(
        /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ () =>
          c.assert.equal(
            c.diagnostics({ uri: c.uri('.codocs/zone.yaml') }, 'duplicate_id')
              .length,
            1,
          ),
      );
    },
  },
  {
    id: 'diagnostics-delete',
    title: '닫힌 문서 삭제를 확인하면 이전 진단을 제거한다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      const uri = c.uri('.codocs/duplicate-b.yaml');
      c.assert.equal(
        c.vscode.workspace.textDocuments.some(
          (document) => document.uri.toString() === uri.toString(),
        ),
        false,
      );
      await c.eventually(() =>
        c.assert.ok(c.vscode.languages.getDiagnostics(uri).length > 0),
      );
      await c.fs.rm(uri.fsPath);
      await c.eventually(() =>
        c.assert.equal(c.vscode.languages.getDiagnostics(uri).length, 0),
      );
    },
  },
  {
    id: 'diagnostics-recheck-recovery',
    title:
      '실제 읽기 실패와 편집 후 과거 결과를 안내하며 복구해도 다른 workspace 실패를 유지한다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      const d = await c.open('.codocs/duplicate-a.yaml');
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(d, 'duplicate_id').length, 1),
      );
      const unlock = await lockFile(c, '.codocs/duplicate-a.yaml');
      const rootUri = c.vscode.workspace
        .getWorkspaceFolder(d.uri)
        .uri.toString();
      const readyText = await c.fs.readFile(
        c.uri('.codocs/ready.yaml').fsPath,
        'utf8',
      );
      try {
        await c.write('.codocs/ready.yaml', readyText + '# 재검사\n');
        await c.eventually(
          /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async () => {
            const states = await c.vscode.commands.executeCommand(
              'codocs.showDiagnosticStatus',
            );
            const root = states.find((item) => item.workspaceUri === rootUri);
            c.assert.ok(root.statusText.includes('재검사 실패'));
            c.assert.ok(root.text.includes('현재 상태를 확인하지 못했습니다.'));
            c.assert.ok(root.text.includes('duplicate-a.yaml'));
            c.assert.ok(root.text.includes('과거 관측 결과'));
          },
        );
        await c.replace(
          d,
          '# 위치 변경\n' + d.getText().replace('id: duplicate', 'id: unique'),
        );
        await c.eventually(() =>
          c.assert.equal(c.diagnostics(d, 'duplicate_id').length, 0),
        );
        c.assert.ok(d.isDirty);
      } finally {
        await unlock();
      }
      await c.write('.codocs/ready.yaml', readyText + '# 복구\n');
      await c.eventually(
        /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async () => {
          const states = await c.vscode.commands.executeCommand(
            'codocs.showDiagnosticStatus',
          );
          c.assert.equal(
            states.find((item) => item.workspaceUri === rootUri).statusText,
            '',
          );
          const partial = states.find((item) =>
            item.workspaceUri.endsWith('/partial'),
          );
          c.assert.ok(partial.statusText.includes('재검사 실패'));
          c.assert.ok(partial.text.includes('unreadable.yaml'));
        },
      );
    },
  },
  {
    id: 'rapid-edit-restart-diagnostics',
    title: '빠른 연속 편집 직후 재시작해도 최신 미저장 원문 진단을 동기화한다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      const d = await c.open('.codocs/source.yaml');
      const original = d.getText();
      await c.replace(d, original.replace('id: source', 'id: zone'));
      await c.replace(
        d,
        '# 😀\n' + original.replace('id: source', 'id: direct'),
      );
      await c.vscode.commands.executeCommand('codocs.restartLanguageServers');
      await c.eventually(
        /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ () => {
          const diagnostics = c.diagnostics(d, 'duplicate_id');
          c.assert.equal(diagnostics.length, 1);
          c.assert.equal(diagnostics[0].range.start.line, 1);
          c.assert.equal(d.getText(diagnostics[0].range), 'direct');
        },
      );
      c.assert.ok(d.isDirty);
    },
  },
];
