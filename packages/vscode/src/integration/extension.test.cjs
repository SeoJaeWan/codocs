const code = 'source %20 한글#.java';
const zone = '.codocs/zone %20 한글#.yaml';
const source = '.codocs/source %20 한글#.yaml';

module.exports.scenarios = [
  {
    id: 'hover-content-and-relations',
    /** 실제 코드 Hover의 본문·관계 앵커를 관측하고 각각 클릭한다. */
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
    /** 특수 출처·대상 경로의 YAML 링크를 OS 수정 키 클릭으로 연다. */
    async run(c) {
      await c.open(source);
      const hover = await c.driver.hover('[[Zone]]', 'Zone');
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
    /** 복수 후보를 모두 표시하고 선택한 앵커의 파일만 연다. */
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
    /** 기존 미저장 대상의 내용·탭을 보존하며 상단으로 이동한다. */
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
      await c.driver.hover('[[Old]]', 'Old');
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
      await c.driver.hover('[[Direct]]', 'Direct');
      await c.driver.yamlLink('[[Direct]]');
      await c.atTop('.codocs/direct.yaml');
      c.assert.ok(document.isDirty);
      c.assert.match(
        await c.fs.readFile(document.uri.fsPath, 'utf8'),
        /\[\[Old\]\]/u,
      );
      c.assert.equal(await document.save(), true);
      await c.open('.codocs/old-source.yaml');
      await c.driver.hover('[[Direct]]', 'Direct');
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
      await c.vscode.window.tabGroups.close(c.tabs(zone));
      await c.fs.writeFile(
        document.uri.fsPath,
        'id: zone\nname: Zone\ndefinition: External body [[Direct]]\ndomains: [test]\n',
      );
      await c.driver.hover('zone', 'External body');
      await c.driver.clickAnchor('원문 열기');
      const editor = await c.atTop(zone);
      c.assert.ok(editor.document.getText().includes('External body'));
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
        'id: zone\nname: Zone\ndefinition: Changed after display [[Old]]\ndomains: [test]\n',
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
        'id: replacement\nname: Replacement\ndefinition: Different document\ndomains: [test]\n',
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
    /** 같은 ID라도 가장 가까운 workspace의 표시 내용·링크만 사용한다. */
    async run(c) {
      await c.open('nested/source.java');
      const hover = await c.driver.hover('zone', 'Nested workspace body');
      c.assert.ok(!hover.body.includes('Zone body'));
      await c.driver.clickAnchor('원문 열기');
      await c.atTop('nested/.codocs/zone.yaml');
      c.assert.equal(c.tabs(zone).length, 0);
    },
  },
];
