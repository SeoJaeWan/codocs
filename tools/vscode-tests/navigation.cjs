/** 기존 Playwright 기능 목표를 실제 VS Code API 검사로 대응시킨다. */
exports.scenarios = [
  {
    id: 'unsaved-code',
    title: '미저장 코드 식별자를 바꾸면 새 설명과 원본 디스크를 보존한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      await c.replace(d, 'readySignal();\ndirect();\n');
      const h = await c.hover(d, 'direct()', 'Direct body');
      c.assert.ok(!h.text.includes('Zone body'));
      c.assert.ok(d.isDirty);
      c.assert.match(
        await c.fs.readFile(c.path.join(c.root, 'source.java'), 'utf8'),
        /zoneAuxiliary/u,
      );
    },
  },
  {
    id: 'unsaved-reference',
    title: '미저장 참조를 바꾸면 경고를 제거하고 새 링크를 연다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('.codocs/old-source.yaml');
      await c.hover(d, '[[Old]]', 'Old');
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(d, 'deprecated_reference').length, 1),
      );
      await c.replace(
        d,
        'id: old-source\nname: Old Source\ndefinition: Body [[Zone]]\ndomains: [test]\n',
      );
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(d, 'deprecated_reference').length, 0),
      );
      const links = await c.links(d, 1);
      await c.execute(links[0].target);
      await c.atTop('.codocs/zone.yaml');
    },
  },
  {
    id: 'in-flight-link',
    title: '저장 직후 남은 링크는 최신 본문만 연다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'zoneAuxiliary', 'Zone body');
      const command = c.command(h, '원문 열기');
      const updated =
        'id: zone\nname: Zone\ndefinition: In flight change\ndomains: [test]\n';
      await c.write('.codocs/zone.yaml', updated);
      const observations = [];
      const listener = c.vscode.window.onDidChangeActiveTextEditor(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
          editor,
        ) => {
          if (editor && editor.document !== d)
            observations.push({
              uri: editor.document.uri.toString(),
              text: editor.document.getText(),
            });
        },
      );
      try {
        await c.execute(command);
        for (const item of observations)
          c.assert.deepEqual(item, {
            uri: c.uri('.codocs/zone.yaml').toString(),
            text: updated,
          });
      } finally {
        listener.dispose();
      }
    },
  },
  {
    id: 'hover-content',
    title: '코드 호버에 본문과 세 관계별 링크를 제공한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'zoneAuxiliary', 'Zone body');
      for (const text of [
        '현재 ID: zone',
        '도메인: test',
        '함께 매칭된 용어',
        '이 문서가 참조',
        '이 문서를 참조',
      ])
        c.assert.ok(h.text.includes(text), text);
      for (const label of ['Auxiliary', 'Direct', 'Referrer'])
        c.assert.equal(
          c.commands(h).filter((item) => item.label === label).length,
          1,
        );
      c.assert.ok(!h.text.includes('Auxiliary body'));
      c.assert.ok(!h.text.includes('Direct body'));
    },
  },
  ...[
    ['원문 열기', 'zone'],
    ['Auxiliary', 'auxiliary'],
    ['Direct', 'direct'],
    ['Referrer', 'referrer'],
  ].map(
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ ([
      label,
      target,
    ]) => ({
      id: `relation-${target}`,
      title: `${label} 반환 명령은 해당 원문의 상단을 연다`,
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(
        c,
      ) {
        const d = await c.open('source.java');
        const h = await c.hover(d, 'zoneAuxiliary', 'Zone body');
        await c.execute(c.command(h, label));
        await c.atTop(`.codocs/${target}.yaml`);
      },
    }),
  ),
  {
    id: 'duplicate-id',
    title: '중복 ID 호버는 모든 후보와 보조 링크를 제공한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'duplicateAuxiliary', 'duplicate-a.yaml');
      for (const text of ['duplicate-b.yaml', 'test'])
        c.assert.ok(h.text.includes(text));
      c.assert.equal(
        c.commands(h).filter((item) => item.label === 'Auxiliary').length,
        1,
      );
    },
  },
  {
    id: 'previous-id',
    title: '이전 ID 호버에 현재 ID와 이전 ID 안내를 제공한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'previous()', 'Current body');
      c.assert.ok(h.text.includes('현재 ID: current'));
      c.assert.ok(h.text.includes('이전 ID입니다'));
    },
  },
  {
    id: 'other-occurrence',
    title: '다른 출현의 이전 ID 안내를 유지한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'currentPrevious', 'Current body');
      c.assert.ok(h.text.includes('같은 식별자의 다른 위치'));
      c.assert.ok(h.text.includes('이전 ID입니다'));
    },
  },
  {
    id: 'broken-document',
    title: '필수 필드 누락 문서의 오류와 원문 링크를 제공한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'broken()', 'Broken');
      c.assert.ok(h.text.includes('오류'));
      c.assert.ok(h.text.includes('expected string, received undefined'));
      c.assert.equal(
        c.commands(h).filter((item) => item.label === '원문 열기').length,
        1,
      );
    },
  },
  {
    id: 'invalid-id',
    title: '잘못된 현재 ID의 이전 ID 호버에서 본문과 이동을 보존한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'legacyInvalid', 'Invalid body retained');
      c.assert.ok(h.text.includes('현재 ID를 확인할 수 없습니다'));
      c.assert.ok(
        h.text.includes('ID는 소문자·숫자를 하이픈으로 연결해야 합니다'),
      );
      await c.execute(c.command(h, '원문 열기'));
      await c.atTop('.codocs/invalid.yaml');
    },
  },
  {
    id: 'no-match',
    title: '준비 완료 뒤 매칭 없는 코드에 Codocs 호버가 없다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'utterlyUnmatched');
      c.assert.equal(c.commands(h).length, 0);
      c.assert.equal(h.text, '');
    },
  },
  ...[0, 1, 2].map(
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
      occurrence,
    ) => ({
      id: `yaml-occurrence-${occurrence}`,
      title: `본문·예시 ${occurrence + 1}번째 링크는 대상 상단을 연다`,
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(
        c,
      ) {
        const d = await c.open('.codocs/source.yaml');
        const links = await c.links(d, 3);
        c.assert.ok(
          links[occurrence].range.contains(
            c.position(d, '[[Zone]]', occurrence),
          ),
        );
        await c.execute(links[occurrence].target);
        await c.atTop('.codocs/zone.yaml');
      },
    }),
  ),
  {
    id: 'metadata',
    title: '메타데이터의 같은 표기에는 링크가 없다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('.codocs/source.yaml');
      const links = await c.links(d, 3);
      c.assert.ok(
        links.every(
          (link) => !link.range.contains(c.position(d, '[[Zone]]', 3)),
        ),
      );
      c.assert.equal(c.tabs('.codocs/zone.yaml').length, 0);
    },
  },
  {
    id: 'ambiguous-body',
    title: '복수 후보의 본문에는 직접 이동 링크가 없다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('.codocs/ambiguous.yaml');
      await c.hover(d, '[[Twin]]', 'twin-a.yaml');
      c.assert.deepEqual(await c.links(d, 0), []);
      c.assert.equal(c.tabs('.codocs/twin-a.yaml').length, 0);
      c.assert.equal(c.tabs('.codocs/twin-b.yaml').length, 0);
    },
  },
  ...['a', 'b'].map(
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (target) => ({
      id: `ambiguous-${target}`,
      title: `복수 후보 ${target} 명령은 선택한 원문만 연다`,
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(
        c,
      ) {
        const d = await c.open('.codocs/ambiguous.yaml');
        const h = await c.hover(d, '[[Twin]]', 'twin-a.yaml');
        c.assert.ok(h.text.includes('alpha'));
        c.assert.ok(h.text.includes('beta'));
        await c.execute(c.command(h, `twin-${target}.yaml`));
        await c.atTop(`.codocs/twin-${target}.yaml`);
        c.assert.equal(
          c.tabs(`.codocs/twin-${target === 'a' ? 'b' : 'a'}.yaml`).length,
          0,
        );
      },
    }),
  ),
  {
    id: 'invalid-name-link',
    title: '잘못된 현재 ID에도 확정한 이름 참조 링크로 이동한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('.codocs/invalid-source.yaml');
      const links = await c.links(d, 1);
      await c.execute(links[0].target);
      await c.atTop('.codocs/invalid.yaml');
    },
  },
  {
    id: 'unsaved-yaml',
    title: '미저장 본문의 새 위치 링크를 사용하고 디스크를 보존한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('.codocs/source.yaml');
      const edited =
        'id: source\nname: Source\ndefinition: |\n  shifted\n  [[Direct]]\ndomains: [test]\n';
      await c.replace(d, edited);
      const links = await c.links(d, 1);
      c.assert.equal(links[0].range.start.line, 4);
      await c.execute(links[0].target);
      await c.atTop('.codocs/direct.yaml');
      c.assert.equal(d.getText(), edited);
      c.assert.ok(d.isDirty);
      c.assert.match(
        await c.fs.readFile(d.uri.fsPath, 'utf8'),
        /\[\[Zone\]\]/u,
      );
    },
  },
  {
    id: 'fresh-hover',
    title: '대상 변경 뒤 새 조회에 새 설명과 링크를 제공한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      await c.hover(d, 'zoneAuxiliary', 'Zone body');
      await c.write(
        '.codocs/zone.yaml',
        'id: zone\nname: Zone\ndefinition: Updated zone body\ndomains: [test]\n',
      );
      const h = await c.hover(d, 'zoneAuxiliary', 'Updated zone body');
      c.assert.ok(!h.text.includes('Zone body'));
      await c.execute(c.command(h, '원문 열기'));
      await c.atTop('.codocs/zone.yaml');
    },
  },
  {
    id: 'stale-link',
    title: '갱신 완료 후 남은 링크가 최신 본문을 연다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'zoneAuxiliary', 'Zone body');
      const command = c.command(h, '원문 열기');
      const updated =
        'id: zone\nname: Zone\ndefinition: Changed after hover\ndomains: [test]\n';
      await c.write('.codocs/zone.yaml', updated);
      await c.hover(d, 'zoneAuxiliary', 'Changed after hover');
      await c.execute(command);
      await c.atTop('.codocs/zone.yaml');
      await c.eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () =>
          c.assert.equal(
            c.vscode.window.activeTextEditor.document.getText(),
            updated,
          ),
      );
    },
  },
  {
    id: 'moved-target',
    title: '이동한 대상의 새 링크가 새 경로를 연다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      await c.hover(d, 'zoneAuxiliary', 'Zone body');
      await c.fs.rename(
        c.path.join(c.root, '.codocs/zone.yaml'),
        c.path.join(c.root, '.codocs/moved.yaml'),
      );
      await c.eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
          const h = await c.hover(d, 'zoneAuxiliary', 'Zone body');
          await c.execute(c.command(h, '원문 열기'));
          c.assert.equal(
            c.vscode.window.activeTextEditor.document.uri.toString(),
            c.uri('.codocs/moved.yaml').toString(),
          );
        },
      );
      await c.atTop('.codocs/moved.yaml');
    },
  },
  {
    id: 'replaced-target',
    title: '삭제된 대상의 남은 링크는 같은 경로의 대체 문서를 열지 않는다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      const h = await c.hover(d, 'zoneAuxiliary', 'Zone body');
      await c.fs.unlink(c.path.join(c.root, '.codocs/zone.yaml'));
      await c.write(
        '.codocs/zone.yaml',
        'id: replacement\nname: Replacement\ndefinition: Wrong target\ndomains: [test]\n',
      );
      await c.execute(c.command(h, '원문 열기'));
      c.assert.equal(
        c.vscode.window.activeTextEditor.document.uri.toString(),
        d.uri.toString(),
      );
      c.assert.equal(c.tabs('.codocs/zone.yaml').length, 0);
    },
  },
  {
    id: 'deleted-fresh-hover',
    title: '삭제 확인 뒤 새 조회에서 설명과 원문 링크를 제거한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      await c.hover(d, 'zoneAuxiliary', 'Zone body');
      await c.fs.unlink(c.path.join(c.root, '.codocs/zone.yaml'));
      await c.eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
          const h = await c.hover(d, 'zoneAuxiliary', 'Auxiliary body', 0, 6);
          c.assert.ok(!h.text.includes('Zone body'));
          c.assert.ok(!c.commands(h).some((item) => item.label === 'Zone'));
        },
      );
    },
  },
  {
    id: 'dirty-target-tab',
    title: '기존 탭의 미저장 내용과 디스크를 보존하고 상단으로 이동한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const target = await c.open('.codocs/zone.yaml');
      const original = target.getText();
      const dirty = original + '# unsaved API edit\n';
      await c.replace(target, dirty);
      c.vscode.window.activeTextEditor.selection = new c.vscode.Selection(
        2,
        1,
        2,
        5,
      );
      const count = c.tabs('.codocs/zone.yaml').length;
      const d = await c.open('source.java');
      const h = await c.hover(d, 'zoneAuxiliary', 'Zone body');
      await c.execute(c.command(h, '원문 열기'));
      await c.atTop('.codocs/zone.yaml');
      c.assert.equal(target.getText(), dirty);
      c.assert.ok(target.isDirty);
      c.assert.equal(c.tabs('.codocs/zone.yaml').length, count);
      c.assert.equal(await c.fs.readFile(target.uri.fsPath, 'utf8'), original);
    },
  },
  {
    id: 'partial-scan',
    title: '부분 탐색 호버의 안내와 확인한 원문 링크를 유지한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('partial/probe.java');
      const h = await c.hover(d, 'zone()', '일부 문서');
      c.assert.ok(h.text.includes('Zone body'));
      await c.execute(c.command(h, '원문 열기'));
      await c.atTop('partial/.codocs/zone.yaml');
    },
  },
  {
    id: 'unconfirmed-reference',
    title:
      '부분 탐색의 미확정 참조에는 폐기 경고나 이동 링크를 제공하지 않는다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('partial/.codocs/unconfirmed-source.yaml');
      await c.eventually(
        /** 미확정 참조 진단과 폐기 경고 부재를 같은 관측에서 확인한다. */ () => {
          c.assert.equal(c.diagnostics(d, 'unconfirmed_reference').length, 1);
          c.assert.equal(c.diagnostics(d, 'deprecated_reference').length, 0);
        },
      );
      c.assert.deepEqual(await c.links(d, 0), []);
    },
  },
  {
    id: 'deprecated-link',
    title: '폐기 참조의 실제 경고 진단과 이동 링크를 함께 제공한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('.codocs/old-source.yaml');
      await c.hover(d, '[[Old]]', 'Old');
      await c.eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {
          const diagnostics = c.diagnostics(d, 'deprecated_reference');
          c.assert.equal(diagnostics.length, 1);
          c.assert.equal(
            diagnostics[0].severity,
            c.vscode.DiagnosticSeverity.Warning,
          );
          c.assert.ok(diagnostics[0].message.includes('폐기 상태'));
        },
      );
      const links = await c.links(d, 1);
      await c.execute(links[0].target);
      await c.atTop('.codocs/old.yaml');
    },
  },
  {
    id: 'clear-deprecated',
    title: '폐기 상태를 해제하면 게시된 경고를 제거한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('.codocs/old-source.yaml');
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(d, 'deprecated_reference').length, 1),
      );
      await c.write(
        '.codocs/old.yaml',
        'id: old\nname: Old\ndefinition: Active again\ndomains: [test]\n',
      );
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(d, 'deprecated_reference').length, 0),
      );
    },
  },
  {
    id: 'same-previous-id',
    title: '현재 ID와 같은 이전 ID는 YAML에만 경고한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const yaml = await c.open('.codocs/current.yaml');
      await c.eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () =>
          c.assert.ok(
            c.vscode.languages
              .getDiagnostics(yaml.uri)
              .some((item) =>
                item.message.includes('이전 ID가 현재 ID와 같습니다'),
              ),
          ),
      );
      const d = await c.open('source.java');
      await c.replace(d, 'readySignal();\ncurrent();\n');
      const h = await c.hover(d, 'current()', 'Current body');
      c.assert.ok(!h.text.includes('이전 ID입니다'));
    },
  },
  {
    id: 'missing-reference',
    title: '없는 이름 참조에는 진단만 있고 이동 링크가 없다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('.codocs/missing.yaml');
      await c.eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {
          const diagnostics = c.diagnostics(d, 'reference_not_found');
          c.assert.equal(diagnostics.length, 1);
          c.assert.ok(
            diagnostics[0].message.includes(
              '참조 이름에 해당하는 문서가 없습니다',
            ),
          );
        },
      );
      c.assert.deepEqual(await c.links(d, 0), []);
      c.assert.equal(
        c.vscode.window.activeTextEditor.document.uri.toString(),
        d.uri.toString(),
      );
    },
  },
  {
    id: 'nested-workspace',
    title: '중첩 코드의 원문은 가장 가까운 작업 공간에 연결한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('nested/nested.java');
      const h = await c.hover(d, 'zone()', 'Nested workspace body');
      c.assert.ok(!h.text.includes('Zone body'));
      await c.execute(c.command(h, '원문 열기'));
      await c.atTop('nested/.codocs/nested-zone.yaml');
    },
  },
  {
    id: 'native-definition',
    title: 'TypeScript 정의 provider를 Codocs 원문으로 바꾸지 않는다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('native.ts');
      await c.hover(d, 'nativeFunction', 'function nativeFunction', 1);
      await c.eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
          const definitions = await c.vscode.commands.executeCommand(
            'vscode.executeDefinitionProvider',
            d.uri,
            c.position(d, 'nativeFunction', 1),
          );
          c.assert.equal(definitions.length, 1);
          c.assert.equal(
            (definitions[0].targetUri ?? definitions[0].uri).toString(),
            d.uri.toString(),
          );
          c.assert.equal(
            (definitions[0].targetSelectionRange ?? definitions[0].range).start
              .line,
            0,
          );
        },
      );
      c.assert.ok(
        c.vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .every((tab) => !tab.input?.uri?.path.endsWith('.yaml')),
      );
    },
  },
  {
    id: 'restart-unsaved',
    title: '실제 서버 재시작 후 미저장 문서를 다시 동기화한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async run(c) {
      const d = await c.open('source.java');
      await c.replace(d, 'readySignal();\ndirect();\n');
      await c.hover(d, 'direct()', 'Direct body');
      await c.vscode.commands.executeCommand('codocs.restartLanguageServers');
      const h = await c.hover(d, 'direct()', 'Direct body');
      await c.execute(c.command(h, '원문 열기'));
      await c.atTop('.codocs/direct.yaml');
      c.assert.ok(d.isDirty);
      c.assert.match(
        await c.fs.readFile(d.uri.fsPath, 'utf8'),
        /zoneAuxiliary/u,
      );
    },
  },
];
