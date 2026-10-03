const code = 'source %20 한글#.java';
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

module.exports.scenarios = [
  {
    id: 'hover-content-and-relations',
    /** 실제 코드 Hover의 본문·관계 앵커를 관측하고 각각 클릭한다.
     * */
    async run(c) {
      for (const [label, target] of [
        ['원문 열기', zone],
        ['Auxiliary', '.codocs/auxiliary.yaml'],
        ['Direct', '.codocs/direct.yaml'],
        ['Referrer', '.codocs/referrer.yaml'],
      ]) {
        await c.open(code);
        const hover = await c.driver.hover('zone', 'Zone body');
        for (const text of [
          '현재 ID: zone',
          '도메인: test',
          '함께 매칭된 용어',
          '이 문서가 참조',
          '이 문서를 참조',
        ])
          c.assert.ok(hover.body.includes(text), text);
        c.assert.ok(!hover.body.includes('Auxiliary body'));
        await c.driver.clickAnchor(label);
        await c.atTop(target);
      }
    },
  },
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
        for (const text of ['twin-b.yaml', 'alpha', 'beta'])
          c.assert.ok(hover.body.includes(text), text);
        await c.driver.clickAnchor(`twin-${candidate}.yaml`);
        await c.atTop(`.codocs/twin-${candidate}.yaml`);
      }
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
      await c.open(code);
      await c.driver.hover('zone', 'Zone body');
      await c.driver.clickAnchor('원문 열기');
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
      await c.until(
        () =>
          c.diagnostics('.codocs/old-source.yaml', 'deprecated_reference')
            .length === 1,
        'deprecated warning',
      );
      await c.driver.hover('[[Old]]', 'Old', 0, {
        providerLabel: 'Old',
        nativeLabel: '원문 열기: Old (.codocs/old.yaml)',
      });
      await c.replace(
        document,
        document.getText().replace('[[Old]]', '[[Direct]]'),
      );
      await c.until(
        () =>
          c.diagnostics('.codocs/old-source.yaml', 'deprecated_reference')
            .length === 0,
        'changed-reference warning cleared',
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
    /** 저장·외부 변경 뒤 새 포인터 조회에 최신 본문과 연결만 표시한다. */
    async run(c) {
      const document = await c.open(zone);
      await c.replace(
        document,
        document
          .getText()
          .replace('Zone body [[Direct]]', 'Saved body [[Auxiliary]]'),
      );
      c.assert.equal(await document.save(), true);
      await c.open(code);
      const saved = await c.driver.hover('zone', 'Saved body');
      c.assert.ok(saved.anchors.some((anchor) => anchor.label === 'Auxiliary'));
      c.assert.ok(!saved.anchors.some((anchor) => anchor.label === 'Direct'));
      await c.driver.dismiss();
      c.assert.equal(await c.vscode.window.tabGroups.close(c.tabs(zone)), true);
      await c.until(() => c.tabs(zone).length === 0, 'saved target tab closed');
      await c.fs.writeFile(
        document.uri.fsPath,
        'id: zone\nname: Zone\ndefinition: External body [[Direct]]\ndomains: [test]\ndeprecatedAliases: []\n',
      );
      await c.driver.hover('zone', 'External body');
      await c.driver.clickAnchor('원문 열기');
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
    /** 표시된 같은 앵커를 클릭해 재확인한 최신 대상 내용만 연다. */
    async run(c) {
      await c.open(code);
      const hover = await c.driver.hover('zone', 'Zone body');
      const href = hover.anchors.find(
        (anchor) => anchor.label === '원문 열기',
      ).href;
      await c.fs.writeFile(
        c.uri(zone).fsPath,
        'id: zone\nname: Zone\ndefinition: Changed after display [[Old]]\ndomains: [test]\ndeprecatedAliases: []\n',
      );
      // 새 저장 원문의 실제 진단 게시로 완료 snapshot을 관측한다.
      // 기존 Hover와 href는 유지하며 제품 조회·명시 refresh는 호출하지 않는다.
      await c.until(
        () => c.diagnostics(zone, 'deprecated_reference').length === 1,
        'changed target completed snapshot',
      );
      await c.driver.clickAnchor('원문 열기', href);
      const editor = await c.atTop(zone);
      c.assert.ok(editor.document.getText().includes('Changed after display'));
    },
  },
  {
    id: 'stale-target-rejected-output',
    /** 대상 교체 뒤 실제 클릭 실패 기록과 작업 상태 보존을 관측한다. */
    async run(c) {
      await c.open(code);
      const hover = await c.driver.hover('zone', 'Zone body');
      const href = hover.anchors.find(
        (anchor) => anchor.label === '원문 열기',
      ).href;
      const beforeEditor = c.editorState();
      const beforeUi = await c.driver.workbenchState();
      const beforeOutput = await c.output();
      await c.fs.writeFile(
        c.uri(zone).fsPath,
        'id: replacement\nname: Replacement\ndefinition: Different document\ndomains: [test]\ndeprecatedAliases: []\n',
      );
      await c.driver.clickAnchor('원문 열기', href);
      await c.until(
        /** 입력 계약의 성공·실패 관측을 검증한다. */ async () => {
          const output = await c.output();
          return (
            output.startsWith(beforeOutput) &&
            output
              .slice(beforeOutput.length)
              .includes('Codocs 원문 이동 실패: [confirmation_rejected]') &&
            output
          );
        },
        'Codocs Output rejection',
      );
      c.assert.deepEqual(c.editorState(), beforeEditor);
      c.assert.deepEqual(await c.driver.workbenchState(), beforeUi);
      c.assert.equal(c.tabs(zone).length, 0);
      c.assert.deepEqual(c.editorState(), beforeEditor);
      c.assert.deepEqual(await c.driver.workbenchState(), beforeUi);
    },
  },
  {
    id: 'nested-workspace-owner',
    /** 같은 ID라도 가장 가까운 workspace의 표시 내용·링크만 사용한다.
     * */
    async run(c) {
      await c.open('nested/source.java');
      const hover = await c.driver.hover('zone', 'Nested workspace body');
      c.assert.ok(!hover.body.includes('Zone body'));
      await c.driver.clickAnchor('원문 열기');
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
        'id: recovered-nav-target\nname: Recovered Nav Target\ndefinition: Recovered body\ndomains: [test]\ndeprecatedAliases: []\n',
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
        await markerSelection(c, code, '@codocs [[Reverse Single]]#L3'),
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
      const marker = '@codocs [[Reverse Recreate]]#L3';
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
          await markerSelection(c, code, '@codocs [[Reverse Multiple]]#L3'),
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
        await markerSelection(c, code, '@codocs [[Reverse Overlap]]#L3'),
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
];
