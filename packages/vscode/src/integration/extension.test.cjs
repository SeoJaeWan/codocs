const zone = '.codocs/zone %20 한글#.yaml';
const source = '.codocs/source %20 한글#.yaml';

const navigation = '.codocs/navigation-target.yaml';
const dirtyNavigation = '.codocs/dirty-nav-target.yaml';
const rejectedNavigation = '.codocs/rejected-nav-target.yaml';
const recoveredNavigation = '.codocs/recovered-nav-target.yaml';
const openLink = 'command:codocs.openSource';

/** 저장된 코드 파일에서 표기 문자열의 0부터 시작하는 UTF-16 선택 좌표를 구한다. */
async function markerSelection(c, relative, text) {
  const source = await c.fs.readFile(c.uri(relative).fsPath, 'utf8');
  const start = source.indexOf(text);
  c.assert.ok(start >= 0, `marker in ${relative}: ${text}`);
  const rows = source.slice(0, start).split('\n');
  const line = rows.length - 1;
  const character = rows.at(-1).length;
  return [line, character, line, character + text.length];
}

/** 1부터 시작하는 행 범위를 현재 원문의 0부터 시작하는 선택 좌표로 바꾼다. */
function rowSelection(text, startLine, endLine) {
  const rows = text.split(/\r\n|\r|\n/u);
  return [startLine - 1, 0, endLine - 1, rows[endLine - 1].length];
}

/** 클릭 뒤 실제 editor가 기대한 파일·선택을 표시할 때까지 기다린다. */
function selected(c, relative, selection, label) {
  return c.until(
    /** 현재 editor의 파일과 선택을 관측한다. */ () => {
      const state = c.editorState();
      return (
        state.uri === c.uri(relative).toString() &&
        JSON.stringify(state.selection) === JSON.stringify(selection) &&
        state
      );
    },
    label,
  );
}

/** 표시된 Hover에서 이름이 든 코드 이동 앵커만 모은다. 링크 위 Hover의 기본 안내 앵커는 제외된다. */
function codeAnchors(hover, name = '') {
  return hover.anchors.filter(
    (anchor) =>
      anchor.href?.startsWith(openLink) && anchor.label.includes(name),
  );
}

/** 이전 사례의 fixture 복원 뒤 문서 색인 재구성이 끝날 때까지 다른 문서의 링크 Hover로 기다린다. */
async function workspaceReady(c) {
  await c.open('.codocs/old-source.yaml');
  await c.driver.hover('[[Old]]', 'Old', 0, { providerLabel: 'Old' });
}

/** 이름 변경 반영이 색인 갱신과 겹쳐 거부될 때 workspace가 보여주는 안내다. */
const indexNotReadyNotice = '문서 색인을 구성하는 중입니다';

/**
 * 이름 변경을 시작하고 디스크에 반영될 때까지 기다린다.
 * fixture 복원 뒤 감시자의 색인 갱신이 아직 진행 중이면 반영이 index_not_ready로 거부되므로,
 * 그 안내가 보이고 아무것도 쓰이지 않았을 때만 안내를 지우고 다시 시도한다.
 */
async function renameWhenIndexed(c, start, written, label, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await c.vscode.commands.executeCommand('notifications.clearAll');
    await workspaceReady(c);
    await start();
    const outcome = await c.until(
      /** 반영 완료 또는 색인 준비 전 거부 중 먼저 관측된 결과를 돌려준다. */ async () => {
        if (await written()) return 'written';
        const { notifications } = await c.driver.workbenchState();
        return (
          notifications.some((text) => text.includes(indexNotReadyNotice)) &&
          'index-not-ready'
        );
      },
      label,
    );
    if (outcome === 'written') return;
  }
  c.assert.fail(
    `${label}: ${attempts}번 모두 색인 갱신 중이라 반영되지 않았습니다.`,
  );
}

/** 화면의 name 값을 실제 마우스로 눌러 커서를 두고 F2로 새 이름을 입력해 확정한다. */
async function startRename(c, name, newName) {
  await c.driver.clickText(name);
  // 실제 클릭이 반영된 편집기 커서가 name 행에 놓일 때까지 기다린다.
  await c.until(
    () => c.vscode.window.activeTextEditor?.selection.start.line === 2,
    'cursor placed on the name value',
  );
  await c.driver.key('F2', 'F2', 113);
  // 시작 위치 확인이 끝나 입력 창이 포커스를 받은 뒤에만 입력한다.
  await c.until(
    () => c.driver.isFocused('.rename-box'),
    'rename input focused',
  );
  await c.driver.insertText(newName);
  await c.driver.key('Enter', 'Enter', 13);
}

/** 화면의 텍스트를 실제 마우스로 눌러 커서를 두고 F2로 새 이름을 입력해 확정한다. 커서가 놓인 행을 먼저 확인한다. */
async function startRenameAt(c, text, line, newName) {
  await c.driver.clickText(text);
  await c.until(
    () => c.vscode.window.activeTextEditor?.selection.start.line === line,
    `cursor placed on ${text}`,
  );
  await c.driver.key('F2', 'F2', 113);
  await c.until(
    () => c.driver.isFocused('.rename-box'),
    'rename input focused',
  );
  await c.driver.insertText(newName);
  await c.driver.key('Enter', 'Enter', 13);
}

/** 출처 YAML의 [[Zone]] 링크가 표시되고 서버 준비가 끝날 때까지 Hover로 기다린다. */
async function readyZoneLink(c) {
  await c.open(source);
  return c.driver.hover('[[Zone]]', 'Zone', 0, {
    providerLabel: 'Zone',
    nativeLabel: '원문 열기: Zone (.codocs/zone %20 한글#.yaml)',
  });
}

module.exports.scenarios = [
  {
    id: 'yaml-single-special-path',
    /** 특수 출처·대상 경로의 YAML 링크를 OS 수정 키 클릭으로 연다.
     * */
    async run(c) {
      await c.open(source);
      const hover = await c.driver.hover('[[Zone]]', 'Zone', 0, {
        providerLabel: 'Zone',
        nativeLabel: '원문 열기: Zone (.codocs/zone %20 한글#.yaml)',
      });
      c.assert.ok(hover.anchors.some((anchor) => anchor.label === 'Zone'));
      c.assert.ok(
        hover.anchors.some(
          (anchor) =>
            anchor.href?.startsWith('command:codocs.openSource') &&
            anchor.title?.includes('codocs.openSource'),
        ),
      );
      await c.driver.yamlLink('[[Zone]]');
      await c.atTop(zone);
    },
  },
  {
    id: 'yaml-multiple-candidates',
    /** 복수 후보를 모두 표시하고 선택한 앵커의 파일만 연다.
     * */
    async run(c) {
      for (const candidate of ['a', 'b']) {
        await c.open('.codocs/ambiguous.yaml');
        const hover = await c.driver.hover('[[Twin]]', 'twin-a.yaml');
        // 같은 이름의 두 문서는 도메인 없이 경로로만 구분된다.
        c.assert.ok(hover.body.includes('twin-b.yaml'));
        for (const text of ['도메인', 'alpha', 'beta'])
          c.assert.ok(!hover.body.includes(text), text);
        await c.driver.clickAnchor(`twin-${candidate}.yaml`);
        await c.atTop(`.codocs/twin-${candidate}.yaml`);
      }
    },
  },
  {
    id: 'section-reference-diagnostics',
    /** 첫 섹션이 아닌 섹션의 참조도 링크가 되고, 문서는 있으나 섹션이 없는 표기는 섹션 없음 진단이 된다. */
    async run(c) {
      const file = '.codocs/section-refs.yaml';
      await c.open(file);
      await c.until(
        () => c.diagnostics(file, 'section_reference_not_found').length === 1,
        'missing section reference diagnostic',
      );
      c.assert.equal(c.diagnostics(file, 'reference_not_found').length, 0);
      await c.driver.hover('[[Direct]]', 'Direct', 0, {
        providerLabel: 'Direct',
      });
      await c.driver.yamlLink('[[Direct]]');
      await c.atTop('.codocs/direct.yaml');
    },
  },
  {
    id: 'section-link-opens-key',
    /** [[문서:섹션]] 링크 클릭이 대상 파일의 섹션 키를 선택해 연다. */
    async run(c) {
      const file = '.codocs/section-link-source.yaml';
      const target = '.codocs/section-link-target.yaml';
      await c.open(file);
      const hover = await c.driver.hover(
        '[[Section Link Target:Link Policy]]',
        'Section Link Target:Link Policy',
      );
      c.assert.ok(
        hover.body.includes('.codocs/section-link-target.yaml'),
        'tooltip names the target path',
      );
      await c.driver.yamlLink('[[Section Link Target:Link Policy]]');
      // 대상 파일의 'Link Policy:' 키(넷째 행)가 선택된다.
      await selected(c, target, [3, 0, 3, 'Link Policy'.length], 'key opened');
    },
  },
  {
    id: 'dirty-target-tab',
    /** 기존 미저장 대상의 내용·탭을 보존하며 상단으로 이동한다.
     * */
    async run(c) {
      const document = await c.open(zone);
      const disk = await c.fs.readFile(document.uri.fsPath, 'utf8');
      const edited = disk + '# unsaved target\n';
      await c.replace(document, edited);
      c.vscode.window.activeTextEditor.selection = new c.vscode.Selection(
        2,
        1,
        2,
        5,
      );
      const before = c.tabs(zone)[0];
      await readyZoneLink(c);
      await c.driver.yamlLink('[[Zone]]');
      await c.atTop(zone);
      c.assert.equal(c.tabs(zone).length, 1);
      c.assert.equal(c.tabs(zone)[0], before);
      c.assert.equal(document.getText(), edited);
      c.assert.ok(document.isDirty);
      c.assert.equal(await c.fs.readFile(document.uri.fsPath, 'utf8'), disk);
    },
  },
  {
    id: 'changed-reference-and-save',
    /** 참조 편집과 저장 뒤 새 Hover·링크·진단을 관측한다. */
    async run(c) {
      const document = await c.open('.codocs/old-source.yaml');
      await c.driver.hover('[[Old]]', 'Old', 0, {
        providerLabel: 'Old',
        nativeLabel: '원문 열기: Old (.codocs/old.yaml)',
      });
      await c.replace(
        document,
        document.getText().replace('[[Old]]', '[[Direct]]'),
      );
      await c.driver.hover('[[Direct]]', 'Direct', 0, {
        providerLabel: 'Direct',
        nativeLabel: '원문 열기: Direct (.codocs/direct.yaml)',
      });
      await c.driver.yamlLink('[[Direct]]');
      await c.atTop('.codocs/direct.yaml');
      c.assert.ok(document.isDirty);
      c.assert.match(
        await c.fs.readFile(document.uri.fsPath, 'utf8'),
        /\[\[Old\]\]/u,
      );
      c.assert.equal(await document.save(), true);
      await c.open('.codocs/old-source.yaml');
      await c.driver.hover('[[Direct]]', 'Direct', 0, {
        providerLabel: 'Direct',
        nativeLabel: '원문 열기: Direct (.codocs/direct.yaml)',
      });
    },
  },
  {
    id: 'saved-and-external-refresh',
    /** 저장·외부 변경 뒤 YAML 참조 링크가 최신 대상 내용을 연다. */
    async run(c) {
      const document = await c.open(zone);
      await c.replace(
        document,
        document
          .getText()
          .replace('Zone body [[Direct]]', 'Saved body [[Auxiliary]]'),
      );
      c.assert.equal(await document.save(), true);
      await readyZoneLink(c);
      await c.driver.yamlLink('[[Zone]]');
      const saved = await c.atTop(zone);
      await c.until(
        () => saved.document.getText().includes('Saved body [[Auxiliary]]'),
        'opened saved text settled',
      );
      c.assert.ok(!saved.document.getText().includes('Zone body'));
      c.assert.equal(await c.vscode.window.tabGroups.close(c.tabs(zone)), true);
      await c.until(() => c.tabs(zone).length === 0, 'saved target tab closed');
      await c.fs.writeFile(
        document.uri.fsPath,
        '_codocs:\n  id: zone\n  name: Zone\nbody: External body [[Unknown Target]]\n',
      );
      // 외부 변경의 실제 진단 게시로 완료 snapshot을 관측한다.
      await c.until(
        () => c.diagnostics(zone, 'reference_not_found').length === 1,
        'external target completed snapshot',
      );
      await readyZoneLink(c);
      await c.driver.yamlLink('[[Zone]]');
      const editor = await c.atTop(zone);
      await c.until(
        () => editor.document.getText().includes('External body'),
        'opened external text settled',
      );
      c.assert.ok(editor.document.getText().includes('External body'));
      await c.atTop(zone);
    },
  },
  {
    id: 'stale-target-latest-content',
    /** 화면에 남은 같은 YAML 링크를 클릭해 재확인한 최신 대상 내용만 연다. */
    async run(c) {
      await readyZoneLink(c);
      await c.fs.writeFile(
        c.uri(zone).fsPath,
        '_codocs:\n  id: zone\n  name: Zone\nbody: Changed after display [[Unknown Target]]\n',
      );
      // 새 저장 원문의 실제 진단 게시로 완료 snapshot을 관측한다.
      // 출처 편집기의 기존 링크는 유지하며 제품 조회·명시 refresh는 호출하지 않는다.
      await c.until(
        () => c.diagnostics(zone, 'reference_not_found').length === 1,
        'changed target completed snapshot',
      );
      await c.driver.yamlLink('[[Zone]]');
      const editor = await c.atTop(zone);
      c.assert.ok(editor.document.getText().includes('Changed after display'));
    },
  },
  {
    id: 'nested-workspace-owner',
    /** 같은 이름이라도 가장 가까운 workspace의 문서로 YAML 링크가 이동한다.
     * */
    async run(c) {
      await c.open('nested/.codocs/source.yaml');
      const hover = await c.driver.hover('[[Zone]]', 'Zone', 0, {
        providerLabel: 'Zone',
      });
      c.assert.ok(!hover.body.includes('zone %20 한글#.yaml'));
      await c.driver.yamlLink('[[Zone]]');
      await c.atTop('nested/.codocs/zone.yaml');
      c.assert.equal(c.tabs(zone).length, 0);
    },
  },
  {
    id: 'explicit-link-open',
    /** 코드의 명시 링크 셋을 OS 수정 키 클릭으로 열어 상단·행·범위 선택을 관측한다.
     * */
    async run(c) {
      const text = await c.fs.readFile(c.uri(navigation).fsPath, 'utf8');
      await c.open('navigation/explicit-whole.java');
      await c.driver.yamlLink('@codocs [[Navigation Target]]');
      await c.atTop(navigation);
      await c.open('navigation/explicit-row.java');
      await c.driver.yamlLink('@codocs [[Navigation Target]]#L11');
      await selected(
        c,
        navigation,
        rowSelection(text, 11, 11),
        'row 11 selected',
      );
      await c.open('navigation/explicit-range.java');
      await c.driver.yamlLink('@codocs [[Navigation Target]]#L11-L12');
      await selected(
        c,
        navigation,
        rowSelection(text, 11, 12),
        'rows 11-12 selected',
      );
      c.assert.equal(c.tabs(navigation).length, 1);
    },
  },
  {
    id: 'explicit-link-dirty-target',
    /** 미저장 행이 삽입된 대상에서 저장 행 번호가 아닌 현재 원문의 11·12행을 선택한다.
     * */
    async run(c) {
      const document = await c.open(dirtyNavigation);
      const disk = await c.fs.readFile(document.uri.fsPath, 'utf8');
      const rows = disk.split('\n');
      rows.splice(4, 0, '  Inserted unsaved row');
      const edited = rows.join('\n');
      await c.replace(document, edited);
      c.vscode.window.activeTextEditor.selection = new c.vscode.Selection(
        1,
        0,
        1,
        3,
      );
      const before = c.tabs(dirtyNavigation)[0];
      await c.open('navigation/dirty-range.java');
      await c.driver.yamlLink('@codocs [[Dirty Nav Target]]#L11-L12');
      await selected(
        c,
        dirtyNavigation,
        rowSelection(edited, 11, 12),
        'actual buffer rows 11-12 selected',
      );
      c.assert.equal(c.tabs(dirtyNavigation).length, 1);
      c.assert.equal(c.tabs(dirtyNavigation)[0], before);
      c.assert.equal(document.getText(), edited);
      c.assert.ok(document.isDirty);
      c.assert.equal(await c.fs.readFile(document.uri.fsPath, 'utf8'), disk);
    },
  },
  {
    id: 'explicit-link-invalid',
    /** 대상 없는 표기의 진단·이유 Hover를 확인하고 수정 키 클릭이 이동을 만들지 않음을 관측한다. */
    async run(c) {
      const invalid = 'navigation/invalid.java';
      const marker = '@codocs [[Absent]]';
      await c.open(invalid);
      await c.until(
        () =>
          c.diagnostics(invalid, 'codocs.codeReference.missing').length === 1,
        'missing explicit reference diagnostic',
      );
      const hover = await c.driver.hover(
        marker,
        '선택한 프로젝트에 대상 문서가 없습니다.',
      );
      for (const text of ['현재 ID', '도메인:', '함께 매칭된 용어'])
        c.assert.ok(!hover.body.includes(text), text);
      c.assert.equal(codeAnchors(hover).length, 0);
      const [line] = await markerSelection(c, invalid, marker);
      const before = c.editorState();
      const beforeUi = await c.driver.workbenchState();
      await c.driver.modifierClick(marker);
      // 클릭이 편집기에 도달한 것은 표기 행의 빈 커서 이동으로 관측한다.
      const after = await c.until(
        /** 클릭한 표기 행의 빈 커서를 관측한다. */ () => {
          const state = c.editorState();
          return (
            state.selection?.[0] === line &&
            state.selection[0] === state.selection[2] &&
            state.selection[1] === state.selection[3] &&
            state
          );
        },
        'modifier click reached the invalid marker',
      );
      c.assert.equal(after.uri, before.uri);
      c.assert.deepEqual(after.tabs, before.tabs);
      c.assert.deepEqual(await c.driver.workbenchState(), beforeUi);
      c.assert.equal(
        c.diagnostics(invalid, 'codocs.codeReference.missing').length,
        1,
      );
    },
  },
  {
    id: 'explicit-link-recover',
    /** 대상을 만들고 저장하면 진단이 사라지고 새로 연 편집기의 링크가 대상을 연다. */
    async run(c) {
      const recover = 'navigation/recover.java';
      const marker = '@codocs [[Recovered Nav Target]]';
      await c.open(recover);
      await c.until(
        () =>
          c.diagnostics(recover, 'codocs.codeReference.missing').length === 1,
        'missing explicit reference diagnostic',
      );
      await c.create(
        recoveredNavigation,
        '_codocs:\n  id: recovered-nav-target\n  name: Recovered Nav Target\nbody: Recovered body\n',
      );
      await c.until(
        () =>
          c.diagnostics(recover, 'codocs.codeReference.missing').length === 0,
        'recovered explicit reference diagnostic cleared',
      );
      // 링크는 편집기를 열 때 조회하므로 저장 뒤 새로 열어 새 링크를 얻는다.
      await c.closeAll();
      await c.open(recover);
      await c.driver.yamlLink(marker);
      await c.atTop(recoveredNavigation);
      // 다음 사례가 지연된 삭제 이벤트를 만나지 않도록 삭제 반영까지 관측한다.
      await c.closeAll();
      await c.open(recover);
      await c.remove(recoveredNavigation);
      await c.until(
        () =>
          c.diagnostics(recover, 'codocs.codeReference.missing').length === 1,
        'deleted target diagnostic restored',
      );
    },
  },
  {
    id: 'explicit-link-rejected',
    /** 미저장 대상에서 끝 행을 지운 뒤 클릭하면 Output에 실패만 남고 편집기·탭이 유지된다.
     * */
    async run(c) {
      const document = await c.open(rejectedNavigation);
      const disk = await c.fs.readFile(document.uri.fsPath, 'utf8');
      const shortened = disk.split('\n').slice(0, 11).join('\n');
      await c.replace(document, shortened);
      const targetTab = c.tabs(rejectedNavigation)[0];
      await c.open('navigation/rejected-range.java');
      const beforeEditor = c.editorState();
      const beforeUi = await c.driver.workbenchState();
      const beforeOutput = await c.output();
      await c.driver.yamlLink('@codocs [[Rejected Nav Target]]#L11-L12');
      await c.until(
        /** 입력 계약의 성공·실패 관측을 검증한다. */ async () => {
          const output = await c.output();
          return (
            output.startsWith(beforeOutput) &&
            output
              .slice(beforeOutput.length)
              .includes('Codocs 원문 이동 실패: [destination_unavailable]') &&
            output
          );
        },
        'Codocs Output destination rejection',
      );
      const after = c.editorState();
      c.assert.equal(after.uri, beforeEditor.uri);
      c.assert.deepEqual(after.tabs, beforeEditor.tabs);
      // 링크 클릭이 커서를 옮길 수는 있으나 범위 선택으로 바꾸지는 않는다.
      c.assert.ok(
        after.selection[0] === after.selection[2] &&
          after.selection[1] === after.selection[3],
      );
      c.assert.deepEqual(await c.driver.workbenchState(), beforeUi);
      c.assert.equal(c.tabs(rejectedNavigation).length, 1);
      c.assert.equal(c.tabs(rejectedNavigation)[0], targetTab);
      c.assert.equal(document.getText(), shortened);
      c.assert.ok(document.isDirty);
      c.assert.equal(await c.fs.readFile(document.uri.fsPath, 'utf8'), disk);
    },
  },
  {
    id: 'reverse-single-direct',
    /** 코드 하나가 연결한 YAML 행을 수정 키로 클릭하면 코드의 @codocs 표기가 선택된다.
     * */
    async run(c) {
      const yaml = '.codocs/reverse-single.yaml';
      const code = 'navigation/reverse-single.java';
      await c.open(yaml);
      // Hover의 완료 표시로 코드 수집이 끝난 뒤의 단일 연결을 확인한다.
      const hover = await c.driver.hover(
        'Reverse single row',
        '연결된 코드 · 1곳',
      );
      c.assert.equal(codeAnchors(hover, 'reverse-single.java').length, 1);
      await c.driver.yamlLink('Reverse single row');
      await selected(
        c,
        code,
        await markerSelection(c, code, '@codocs [[Reverse Single]]#L4'),
        'reverse single marker selected',
      );
    },
  },
  {
    id: 'reverse-folder-recreate',
    /** 범위 안 폴더를 지웠다 다시 만들어도 연결된 코드 수집이 완료로 돌아오고 이후 편집이 반영된다.
     * */
    async run(c) {
      const yaml = '.codocs/reverse-recreate.yaml';
      const folder = 'navigation/recreate';
      const code = folder + '/reverse-recreate.java';
      const marker = '@codocs [[Reverse Recreate]]#L4';
      const text = `class ReverseRecreate {\n  // ${marker}\n}\n`;
      await c.open(yaml);
      await c.driver.hover('Reverse recreate row', '연결된 코드 · 1곳');
      // 폴더를 재귀 삭제하고 곧바로 같은 내용으로 다시 만든다.
      await c.fs.rm(c.uri(folder).fsPath, { recursive: true, force: true });
      await c.create(code, text);
      // 감시가 끊겼다 복구된 뒤에도 완료 표시(N곳)로 돌아온다.
      await c.driver.hover('Reverse recreate row', '연결된 코드 · 1곳');
      // 다시 만든 파일의 편집이 이후 Hover에 반영된다.
      await c.create(code, text.replace('}\n', `  // ${marker}\n}\n`));
      await c.driver.hover('Reverse recreate row', '연결된 코드 · 2곳');
    },
  },
  {
    id: 'reverse-multiple-hover',
    /** 구현·테스트 두 연결을 Hover의 위치별 앵커로 각각 클릭해 해당 표기를 선택한다.
     * */
    async run(c) {
      const yaml = '.codocs/reverse-multiple.yaml';
      for (const [label, code] of [
        ['reverse-multiple-impl.java', 'navigation/reverse-multiple-impl.java'],
        ['reverse-multiple-test.java', 'navigation/reverse-multiple-test.java'],
      ]) {
        await c.open(yaml);
        const hover = await c.driver.hover(
          'Reverse multiple row',
          '연결된 코드 · 2곳',
        );
        c.assert.equal(codeAnchors(hover, 'reverse-multiple-').length, 2);
        for (const name of ['reverse-multiple-impl', 'reverse-multiple-test'])
          c.assert.equal(codeAnchors(hover, name).length, 1);
        await c.driver.clickAnchor(label);
        await selected(
          c,
          code,
          await markerSelection(c, code, '@codocs [[Reverse Multiple]]#L4'),
          `reverse marker selected: ${label}`,
        );
      }
    },
  },
  {
    id: 'reverse-overlap-yaml-link',
    /** 이름 링크와 겹친 행은 YAML 링크가 문서를 열고 코드 연결은 Hover 앵커로만 연다.
     * */
    async run(c) {
      const yaml = '.codocs/reverse-overlap.yaml';
      const code = 'navigation/reverse-overlap.java';
      await c.open(yaml);
      const hover = await c.driver.hover('[[Direct]]', '연결된 코드 · 1곳', 0, {
        providerLabel: 'Direct',
      });
      c.assert.equal(codeAnchors(hover, 'reverse-overlap.java').length, 1);
      await c.driver.yamlLink('[[Direct]]');
      await c.atTop('.codocs/direct.yaml');
      await c.open(yaml);
      await c.driver.hover('[[Direct]]', '연결된 코드 · 1곳', 0, {
        providerLabel: 'Direct',
      });
      await c.driver.clickAnchor('reverse-overlap.java');
      await selected(
        c,
        code,
        await markerSelection(c, code, '@codocs [[Reverse Overlap]]#L4'),
        'overlap code marker selected',
      );
    },
  },
  {
    id: 'whole-single-gesture',
    /** 문서 전체 코드 하나는 상단 Inlay label을 수정 키로 클릭해 표기를 선택한다.
     * */
    async run(c) {
      const code = 'navigation/whole-single.java';
      await c.open('.codocs/whole-single.yaml');
      await c.driver.inlayLink('문서 전체에 연결된 코드 · 1곳');
      await selected(
        c,
        code,
        await markerSelection(c, code, '@codocs [[Whole Single]]'),
        'whole single marker selected',
      );
    },
  },
  {
    id: 'whole-multiple-hover',
    /** 문서 전체 코드 둘은 Inlay label Hover의 앵커로 고른 표기를 선택한다.
     * */
    async run(c) {
      const code = 'navigation/whole-multiple-test.java';
      await c.open('.codocs/whole-multiple.yaml');
      const hover = await c.driver.hover(
        '문서 전체에 연결된 코드 · 2곳',
        '연결된 코드 · 2곳',
      );
      c.assert.equal(codeAnchors(hover, 'whole-multiple-').length, 2);
      await c.driver.clickAnchor('whole-multiple-test.java');
      await selected(
        c,
        code,
        await markerSelection(c, code, '@codocs [[Whole Multiple]]'),
        'whole multiple marker selected',
      );
    },
  },
  {
    id: 'rename-ambiguous-reference-picker',
    /** name 값에서 F2로 새 이름을 입력하고 선택 목록에서 모호한 참조의 대상을 골라 디스크에 반영한다. */
    async run(c) {
      const target = '.codocs/rename-twin-a.yaml';
      const reference = '.codocs/rename-twin-ref.yaml';
      const other = '.codocs/rename-twin-b.yaml';
      /** 디스크에 저장된 현재 원문을 읽는다. */
      const read = (relative) => c.fs.readFile(c.uri(relative).fsPath, 'utf8');
      const otherBefore = await read(other);
      await renameWhenIndexed(
        c,
        /** 대상 name에서 F2로 새 이름을 넣고 모호한 참조의 대상 파일을 고른다. */ async () => {
          await c.open(target);
          await startRename(c, 'Rename Twin', 'Rename Twin Renamed');
          // 같은 이름의 후보는 도메인 없이 경로로 구분되고 도메인 선택 단계가 없다.
          const picked = await c.driver.chooseQuickInput('rename-twin-a.yaml');
          c.assert.ok(!picked.text.includes('alpha'));
        },
        async () =>
          (await read(reference)).includes('[[Rename Twin Renamed]]') &&
          (await read(target)).includes('name: Rename Twin Renamed'),
        'rename written to disk',
      );
      c.assert.equal(await read(other), otherBefore);
      await c.until(
        async () =>
          (await c.driver.workbenchState()).notifications.some((text) =>
            text.includes('바꿨습니다'),
          ),
        'rename result notification',
      );
    },
  },
  {
    id: 'rename-updates-parent',
    /** 부모 문서의 name 값에서 F2로 이름을 바꾸면 자식의 _codocs.parent 항목이 디스크에 함께 바뀐다. */
    async run(c) {
      const target = '.codocs/rename-parent-target.yaml';
      const child = '.codocs/rename-parent-child.yaml';
      /** 디스크에 저장된 현재 원문을 읽는다. */
      const read = (relative) => c.fs.readFile(c.uri(relative).fsPath, 'utf8');
      await renameWhenIndexed(
        c,
        /** 부모 문서 name에서 F2로 새 이름을 넣는다. */ async () => {
          await c.open(target);
          await startRename(c, 'Rename Parent Target', 'Rename Parent Renamed');
        },
        async () =>
          (await read(child)).includes('- Rename Parent Renamed') &&
          (await read(target)).includes('name: Rename Parent Renamed'),
        'parent rename written to disk',
      );
      c.assert.ok(!(await read(child)).includes('Rename Parent Target'));
    },
  },
  {
    id: 'rename-dirty-file-abort',
    /** 영향받는 파일에 미저장 수정이 있으면 F2 이름 입력 뒤 중단 안내가 보이고 어느 파일도 바뀌지 않는다. */
    async run(c) {
      const target = '.codocs/rename-target.yaml';
      const reference = '.codocs/rename-ref.yaml';
      /** 디스크에 저장된 현재 원문을 읽는다. */
      const read = (relative) => c.fs.readFile(c.uri(relative).fsPath, 'utf8');
      const targetBefore = await read(target);
      const referenceBefore = await read(reference);
      const dirty = await c.open(reference);
      await c.replace(dirty, referenceBefore + '# unsaved\n');
      await c.open(target);
      await startRename(c, 'Rename Target', 'Rename Target Renamed');
      await c.until(
        () => c.driver.hasText('저장하지 않은 수정이 있는 파일'),
        'dirty file abort message',
      );
      c.assert.equal(await read(target), targetBefore);
      c.assert.equal(await read(reference), referenceBefore);
      c.assert.ok(dirty.isDirty);
    },
  },
  {
    id: 'section-rename-updates-key-and-references',
    /** 참조의 섹션 부분에서 F2로 섹션 이름을 바꾸면 대상 키와 참조가 디스크에서 함께 바뀌고 문서 name은 그대로다. */
    async run(c) {
      const target = '.codocs/section-rename-target.yaml';
      const reference = '.codocs/section-rename-ref.yaml';
      /** 디스크에 저장된 현재 원문을 읽는다. */
      const read = (relative) => c.fs.readFile(c.uri(relative).fsPath, 'utf8');
      await renameWhenIndexed(
        c,
        /** 참조의 섹션 부분에서 F2로 새 섹션 이름을 넣는다. */ async () => {
          await c.open(reference);
          await startRenameAt(c, 'Refund Policy', 3, 'Refund Rules');
        },
        /** 참조와 대상 키가 디스크에 반영되었는지 확인한다. */ async () =>
          (await read(reference)).includes(
            '[[Section Rename Target:Refund Rules]]',
          ) &&
          (await read(target)).includes('Refund Rules: Refund policy body'),
        'section rename written to disk',
      );
      const after = await read(target);
      c.assert.ok(!after.includes('Refund Policy:'));
      c.assert.ok(after.includes('name: Section Rename Target'));
      await c.until(
        async () =>
          (await c.driver.workbenchState()).notifications.some((text) =>
            text.includes('섹션 이름을'),
          ),
        'section rename result notification',
      );
    },
  },
  {
    id: 'section-rename-dirty-file-abort',
    /** 섹션 키에서 시작한 F2가 참조 파일의 미저장 수정 때문에 중단되고 어느 파일도 바뀌지 않는다. */
    async run(c) {
      const target = '.codocs/section-abort-target.yaml';
      const reference = '.codocs/section-abort-ref.yaml';
      /** 디스크에 저장된 현재 원문을 읽는다. */
      const read = (relative) => c.fs.readFile(c.uri(relative).fsPath, 'utf8');
      const targetBefore = await read(target);
      const referenceBefore = await read(reference);
      const dirty = await c.open(reference);
      await c.replace(dirty, referenceBefore + '# unsaved\n');
      await c.open(target);
      await startRenameAt(c, 'Abort Policy', 3, 'Abort Rules');
      await c.until(
        () => c.driver.hasText('섹션 이름을 바꾸지 않았습니다'),
        'section dirty file abort message',
      );
      c.assert.equal(await read(target), targetBefore);
      c.assert.equal(await read(reference), referenceBefore);
      c.assert.ok(dirty.isDirty);
    },
  },
];
