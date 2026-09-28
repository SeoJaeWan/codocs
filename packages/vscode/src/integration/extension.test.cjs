/** 기존 Playwright 기능 목표를 실제 VS Code API 검사로 대응시킨다. */
const navigation = [
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

const { denyRead } = require('../../../../tools/test/runtime/read-denial.cjs');
const {
  ownedServers,
  killOwnedServer,
} = require('./test-support/processes.cjs');

/** 운영 파일의 실제 읽기 실패를 전용 숨김 자식으로 만들고 명시적으로 해제한다. */
async function lockFile(c, relative) {
  return denyRead(
    c.path.join(c.root, relative),
    c.path.join(c.config.temporary, 'diagnostic-denied-' + Date.now()),
  );
}

/** 실제 게시 진단과 사용자 상태 안내를 등록된 명령으로 관측한다. */
const diagnostics = [
  {
    id: 'duplicate-name-open',
    title: '저장 이름 중복 문서를 열어도 이름 진단을 유지한다',
    /** 닫힌 파일의 진단과 열린 버퍼의 진단을 비교한다. */
    async run(c) {
      const uri = c.uri('.codocs/duplicate-a.yaml');
      await c.eventually(() =>
        c.assert.equal(c.diagnostics({ uri }, 'duplicate_name').length, 1),
      );
      const document = await c.open('.codocs/duplicate-a.yaml');
      await c.eventually(
        /** 최신 진단 상태를 확인한다. */ () => {
          const values = c.diagnostics(document, 'duplicate_name');
          c.assert.equal(values.length, 1);
          c.assert.equal(document.getText(values[0].range), 'Duplicate');
        },
      );
    },
  },
  ...[
    ['name', 'name: Duplicate', 'name: Distinct'],
    ['domain', 'domains: [test]', 'domains: [other]'],
  ].map(
    /** 이름·도메인 편집 사례를 독립적으로 만든다. */ ([
      field,
      original,
      replacement,
    ]) => ({
      id: 'duplicate-name-edit-' + field,
      title: field + ' 편집으로 이름 충돌을 해소하면 현재 진단만 제거한다',
      /** 미저장 편집은 저장된 상대 문서의 진단에 전파하지 않는다. */
      async run(c) {
        const document = await c.open('.codocs/duplicate-a.yaml');
        await c.eventually(() =>
          c.assert.equal(c.diagnostics(document, 'duplicate_name').length, 1),
        );
        await c.replace(
          document,
          document.getText().replace(original, replacement),
        );
        await c.eventually(
          /** 최신 진단 상태를 확인한다. */ () => {
            c.assert.equal(c.diagnostics(document, 'duplicate_name').length, 0);
            c.assert.equal(
              c.diagnostics(
                { uri: c.uri('.codocs/duplicate-b.yaml') },
                'duplicate_name',
              ).length,
              1,
            );
          },
        );
        c.assert.ok(document.isDirty);
      },
    }),
  ),
  {
    id: 'duplicate-name-save',
    title: '이름 충돌 해소를 저장하면 상대 문서의 진단도 제거한다',
    /** 실제 저장과 색인 갱신을 기다린다. */
    async run(c) {
      const document = await c.open('.codocs/duplicate-a.yaml');
      await c.eventually(() =>
        c.assert.equal(c.diagnostics(document, 'duplicate_name').length, 1),
      );
      await c.replace(
        document,
        document.getText().replace('name: Duplicate', 'name: Distinct'),
      );
      c.assert.equal(await document.save(), true);
      await c.eventually(
        /** 최신 진단 상태를 확인한다. */ () => {
          c.assert.equal(c.diagnostics(document, 'duplicate_name').length, 0);
          c.assert.equal(
            c.diagnostics(
              { uri: c.uri('.codocs/duplicate-b.yaml') },
              'duplicate_name',
            ).length,
            0,
          );
        },
      );
    },
  },

  ...[1, 4].map(
    /** 단발 종료와 재시작 예산 소진의 복구 경로를 각각 검사한다. */ (
      crashes,
    ) => ({
      id: crashes === 1 ? 'unexpected-server-exit' : 'restart-budget-recovery',
      title:
        crashes === 1
          ? '전용 서버가 예기치 않게 종료되어도 미저장 최신 문서를 자동 재동기화한다'
          : '반복 장애로 자동 재시작을 중단한 뒤 수동 복구하고 미저장 내용을 보존한다',
      /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
        c,
      ) {
        const d = await c.open('.codocs/source.yaml');
        const disk = await c.fs.readFile(d.uri.fsPath, 'utf8');
        await c.replace(
          d,
          '# 😀 최신\n' + d.getText().replace('id: source', 'id: direct'),
        );
        const text = d.getText();
        const version = d.version;
        await c.eventually(() =>
          c.assert.equal(c.diagnostics(d, 'duplicate_id').length, 1),
        );
        for (let crash = 0; crash < crashes; crash++) {
          // 각 workspace의 실제 응답을 기다려 시작 중인 서버를 종료하지 않는다.
          await c.hover(d, '[[Zone]]', 'Zone', 0, 3);
          await c.hover(
            await c.open('nested/nested.java'),
            'zone()',
            'Nested workspace body',
          );
          await c.hover(
            await c.open('partial/probe.java'),
            'zone()',
            'Zone body',
          );
          const before = ownedServers(c);
          c.assert.equal(
            before.length,
            3,
            '현재 시험의 세 workspace 서버만 종료',
          );
          for (const pid of before) killOwnedServer(c, pid);
          if (crash < 3) {
            await c.eventually(
              /** 종료한 서버가 새 프로세스로 교체됐는지 확인한다. */ () => {
                const after = ownedServers(c);
                c.assert.equal(after.length, 3);
                c.assert.ok(after.every((pid) => !before.includes(pid)));
              },
            );
          } else {
            await c.eventually(() => c.assert.equal(ownedServers(c).length, 0));
            // 잠깐의 재시작 공백과 예산 소진에 따른 지속적인 중단을 구분한다.
            const until = Date.now() + 1500;
            while (Date.now() < until) {
              c.assert.equal(ownedServers(c).length, 0);
              await new Promise(
                /** 중단 상태를 반복 관측하는 간격을 둔다. */ (resolve) =>
                  setTimeout(resolve, 100),
              );
            }
            await c.vscode.commands.executeCommand(
              'codocs.restartLanguageServers',
            );
            await c.eventually(() => c.assert.equal(ownedServers(c).length, 3));
            await c.hover(
              await c.open('nested/nested.java'),
              'zone()',
              'Nested workspace body',
            );
            await c.hover(
              await c.open('partial/probe.java'),
              'zone()',
              'Zone body',
            );
          }
        }
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
        c.assert.equal(d.version, version);
        c.assert.equal(d.getText(), text);
        c.assert.equal(await c.fs.readFile(d.uri.fsPath, 'utf8'), disk);
      },
    }),
  ),
  {
    id: 'diagnostics-closed-catalog',
    title: '닫힌 지식 파일도 저장 중복과 정확한 위치를 게시한다',
    /** 실제 입력과 최신 Host 관측을 연결하여 기능 결과를 확인한다. */ async run(
      c,
    ) {
      await c.write(
        '.codocs/closed-a.yaml',
        'id: duplicate\nname: Closed A\ndefinition: 내용\ndomains: [test]\n',
      );
      const uri = c.uri('.codocs/closed-a.yaml');
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

const multiprocess = [
  ...[
    ['mcp-write', 'MCP 저장을 다른 MCP와 IDE가 새 본문과 참조로 관찰한다'],
    ['external-edit', '외부 편집을 두 MCP와 IDE가 새 본문과 참조로 관찰한다'],
    ['move', '외부 이동을 두 MCP와 IDE가 새 경로와 참조로 관찰한다'],
    [
      'recreate',
      '삭제를 확인한 뒤 재생성하면 두 MCP와 IDE가 새 본문을 관찰한다',
    ],
  ].map(
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ ([
      mode,
      title,
    ]) => ({
      id: 'multiprocess-' + mode,
      title,
      /** 같은 프로젝트의 독립 색인을 준비한 뒤 한 가지 변경만 관찰한다. */
      async run(c) {
        const a = await c.mcp();
        const b = await c.mcp();
        const d = await c.open('source.java');
        for (const client of [a, b]) {
          const ready = await client.call('codocs_get', { ids: ['zone'] });
          c.assert.equal(
            ready.results[0].document.definition,
            'Zone body [[Direct]]',
          );
        }
        await c.hover(d, 'zoneAuxiliary', 'Zone body');
        const before = await c.fileEvidence('.codocs/zone.yaml');
        const definition =
          mode === 'move'
            ? 'Zone body [[Direct]]'
            : mode + ' new body [[Auxiliary]]';
        let relative = '.codocs/zone.yaml';
        if (mode === 'mcp-write') {
          const saved = await a.call('codocs_write', {
            mode: 'update',
            id: 'zone',
            revision: before.revision,
            set: { definition },
          });
          c.assert.equal(saved.saved, true);
          c.assert.equal(saved.success, true);
          c.assert.equal(
            saved.revision,
            (await c.fileEvidence(relative)).revision,
          );
        } else if (mode === 'move') {
          relative = '.codocs/mcp-moved.yaml';
          await c.fs.rename(
            c.path.join(c.root, '.codocs/zone.yaml'),
            c.path.join(c.root, relative),
          );
        } else {
          if (mode === 'recreate') {
            await c.fs.unlink(c.path.join(c.root, relative));
            for (const client of [a, b])
              await c.eventually(
                /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
                  const missing = await client.call('codocs_get', {
                    ids: ['zone'],
                  });
                  c.assert.equal(missing.results[0].found, false);
                },
              );
            await c.eventually(
              /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
                const h = await c.hover(d, 'zoneAuxiliary');
                c.assert.ok(!h.text.includes('Zone body'));
                const source = await c.open('.codocs/referrer.yaml');
                c.assert.equal(
                  c.diagnostics(source, 'reference_not_found').length,
                  1,
                );
              },
            );
          }
          await c.write(
            relative,
            'id: zone\nname: Zone\ndefinition: ' +
              definition +
              '\ndomains: [test]\n',
          );
        }
        const current = await c.fileEvidence(relative);
        for (const client of [a, b])
          await c.eventually(
            /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
              const result = (
                await client.call('codocs_get', { ids: ['zone', 'referrer'] })
              ).results;
              c.assert.equal(result[0].document.definition, definition);
              c.assert.equal(result[0].revision, current.revision);
              c.assert.equal(
                result[0].source.path.replaceAll('\\', '/'),
                relative,
              );
              c.assert.deepEqual(result[0].references, [
                mode === 'move' ? 'direct' : 'auxiliary',
              ]);
              c.assert.ok(result[0].referencedBy.includes('referrer'));
              c.assert.deepEqual(result[1].references, ['zone']);
            },
          );
        const h = await c.hover(d, 'zoneAuxiliary', definition.split(' [[')[0]);
        c.assert.ok(
          c
            .commands(h)
            .some(
              (item) =>
                item.label === (mode === 'move' ? 'Direct' : 'Auxiliary'),
            ),
        );
        c.assert.ok(h.text.includes('이 문서가 참조'));
        if (mode !== 'move')
          c.assert.ok(
            !c
              .commands(h)
              .some(
                /** 변경 전 참조 링크가 남지 않았는지 확인한다. */ (item) =>
                  item.label === 'Direct',
              ),
          );
        await c.execute(c.command(h, '원문 열기'));
        await c.atTop(relative);
        const source = await c.open('.codocs/source.yaml');
        await c.eventually(
          /** 재생성 이후 참조 진단의 해소를 기다린다. */ () =>
            c.assert.equal(
              c.diagnostics(source, 'reference_not_found').length,
              0,
            ),
        );
        c.observations.push({
          kind: 'ide',
          workspace: c.root,
          hover: h.text,
          source: relative,
          referencesRestored: true,
        });
      },
    }),
  ),
  {
    id: 'multiprocess-project-isolation',
    title:
      '같은 ID를 가진 root만 변경하면 nested MCP와 IDE의 본문·참조·진단·파일을 보존한다',
    /** 실제 multi-root의 두 프로젝트에 별도 MCP를 연결하여 격리를 검사한다. */
    async run(c) {
      const a = await c.mcp();
      const b = await c.mcp(c.path.join(c.root, 'nested'));
      const rootDocument = await c.open('source.java');
      const nestedDocument = await c.open('nested/nested.java');
      await c.hover(rootDocument, 'zoneAuxiliary', 'Zone body');
      await c.hover(nestedDocument, 'zone()', 'Nested workspace body');
      const original = (await a.call('codocs_get', { ids: ['zone'] }))
        .results[0];
      c.assert.equal(original.document.definition, 'Zone body [[Direct]]');
      const nested = (await b.call('codocs_get', { ids: ['zone'] })).results[0];
      c.assert.equal(nested.document.definition, 'Nested workspace body');
      const nestedBytes = await c.fileEvidence(
        'nested/.codocs/nested-zone.yaml',
      );
      const nestedSource = await c.open('nested/.codocs/nested-zone.yaml');
      const baselineDiagnostics = c.vscode.languages.getDiagnostics(
        nestedSource.uri,
      );
      const saved = await a.call('codocs_write', {
        mode: 'update',
        id: 'zone',
        revision: original.revision,
        set: { definition: 'Root isolated change [[Auxiliary]]' },
      });
      c.assert.equal(saved.saved, true);
      await c.hover(rootDocument, 'zoneAuxiliary', 'Root isolated change');
      c.assert.equal(
        (await a.call('codocs_get', { ids: ['zone'] })).results[0].revision,
        (await c.fileEvidence('.codocs/zone.yaml')).revision,
      );
      c.assert.deepEqual(
        (await b.call('codocs_get', { ids: ['zone'] })).results[0],
        nested,
      );
      c.assert.deepEqual(
        await c.fileEvidence('nested/.codocs/nested-zone.yaml'),
        nestedBytes,
      );
      const h = await c.hover(
        nestedDocument,
        'zone()',
        'Nested workspace body',
      );
      c.assert.ok(!h.text.includes('Root isolated change'));
      c.assert.deepEqual(
        c.vscode.languages.getDiagnostics(nestedSource.uri),
        baselineDiagnostics,
      );
      c.observations.push({
        kind: 'ide-isolation',
        workspaces: c.vscode.workspace.workspaceFolders.map(
          (folder) => folder.uri.fsPath,
        ),
        nested: h.text,
        diagnostics: baselineDiagnostics,
      });
    },
  },
  ...['eof', 'kill'].map(
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (mode) => ({
      id: 'multiprocess-exit-' + mode,
      title:
        mode === 'eof'
          ? 'MCP A가 EOF로 정상 종료한 뒤 B 저장과 IDE 관찰을 유지한다'
          : '소유 MCP A를 강제 종료한 뒤 B 저장과 IDE 관찰을 유지한다',
      /** 종료 방식별 실제 exit를 확인한 뒤 생존한 관찰자에서 새 저장을 검사한다. */
      async run(c) {
        const a = await c.mcp();
        const b = await c.mcp();
        const d = await c.open('source.java');
        for (const client of [a, b])
          c.assert.equal(
            (await client.call('codocs_get', { ids: ['zone'] })).results[0]
              .document.definition,
            'Zone body [[Direct]]',
          );
        await c.hover(d, 'zoneAuxiliary', 'Zone body');
        const exit = await a.close(mode);
        if (mode === 'eof') c.assert.deepEqual(exit, { code: 0, signal: null });
        else c.assert.ok(exit.signal === 'SIGKILL' || exit.code !== 0);
        const before = await c.fileEvidence('.codocs/zone.yaml');
        const definition = 'Surviving B after ' + mode + ' [[Direct]]';
        const saved = await b.call('codocs_write', {
          mode: 'update',
          id: 'zone',
          revision: before.revision,
          set: { definition },
        });
        const current = await c.fileEvidence('.codocs/zone.yaml');
        c.assert.equal(saved.saved, true);
        c.assert.equal(saved.revision, current.revision);
        c.assert.equal(
          (await b.call('codocs_get', { ids: ['zone'] })).results[0].document
            .definition,
          definition,
        );
        const h = await c.hover(
          d,
          'zoneAuxiliary',
          'Surviving B after ' + mode,
        );
        c.observations.push({
          kind: 'ide-after-exit',
          workspace: c.root,
          hover: h.text,
          terminatedPid: a.pid,
          survivingPid: b.pid,
        });
      },
    }),
  ),
];

const codeReferences = [
  {
    id: 'explicit-code-reference',
    title: '명시 링크·오류 전체 span과 dirty buffer의 실제 행 번호를 검증한다',
    /** 설치한 제품의 실제 링크·진단·현재 buffer 선택을 관찰한다. */
    async run(c) {
      const source =
        '😀 @codocs [[Code Target]]\r\n"@codocs [[Code Target]]#L11"\r\n@codocs [[test:Code Target]]#L11-L12\r\n@codocs [[Code Target]]#L0\r\n@codocs [[Code Target]]#L12-L11\r\n@codocs [[Code Target]]#L999\r\n@codocs [[Absent]]\r\n@codocs [[Twin]]\r\n';
      const d = await c.open('code-reference');
      const eol = new c.vscode.WorkspaceEdit();
      eol.set(d.uri, [c.vscode.TextEdit.setEndOfLine(c.vscode.EndOfLine.CRLF)]);
      c.assert.equal(await c.vscode.workspace.applyEdit(eol), true);
      await c.replace(d, source);
      const links = await c.links(d, 3);
      c.assert.equal(links[0].range.start.character, 3);
      await c.eventually(
        /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ () =>
          c.assert.equal(
            c.vscode.languages
              .getDiagnostics(d.uri)
              .filter((item) =>
                String(item.code).startsWith('codocs.codeReference.'),
              ).length,
            5,
          ),
      );
      const h = await c.hover(d, '@codocs [[Code Target]]#L0');
      c.assert.ok(h.text.includes('행 번호'));
      c.assert.ok(!h.text.includes('First body'));
      const target = await c.open('.codocs/code-target.yaml');
      const disk = target.getText();
      await c.replace(target, '# inserted\n' + disk);
      const dirty = target.getText();
      const version = target.version;
      const latest = await c.links(d, 3);
      await c.execute(latest[2].target);
      c.assert.equal(c.vscode.window.activeTextEditor.document, target);
      c.assert.equal(c.vscode.window.activeTextEditor.selection.start.line, 10);
      c.assert.equal(c.vscode.window.activeTextEditor.selection.end.line, 11);
      c.assert.equal(target.getText(), dirty);
      c.assert.equal(target.version, version);
      c.assert.ok(target.isDirty);
      await c.replace(target, 'id: code-target');
      await c.vscode.window.showTextDocument(target);
      const selection = c.vscode.window.activeTextEditor.selection;
      const bounds = await c.links(d, 3);
      c.assert.equal(await c.execute(bounds[2].target), false);
      c.assert.deepEqual(c.vscode.window.activeTextEditor.selection, selection);
      c.assert.equal(target.getText(), 'id: code-target');
    },
  },
  {
    id: 'reverse-code-reference',
    title: '행 구간의 출현 합집합·같은 행의 열과 YAML 이름 이동을 보존한다',
    /** 실제 저장 source와 미저장 overlay의 정확한 marker 선택을 검사한다. */
    async run(c) {
      const text =
        '@codocs [[Code Target]]#L11-L12 @codocs [[Code Target]]#L12-L13';
      const d = await c.open('code-reference');
      await c.replace(d, text);
      const test = await c.open('code-reference.test.txt');
      await c.replace(test, '@codocs [[Code Target]]#L12');
      const target = await c.open('.codocs/code-target.yaml');
      const h = await c.hover(target, 'Row twelve', '연결된 코드 · 3곳');
      c.assert.equal(c.commands(h).length, 3);
      c.assert.ok(
        c.commands(h).some((item) => item.label === 'code-reference:1:33'),
      );
      const selected = c
        .commands(h)
        .find((item) => item.label === 'code-reference:1:33');
      await c.execute(selected.uri);
      c.assert.equal(c.vscode.window.activeTextEditor.document, d);
      c.assert.equal(
        c.vscode.window.activeTextEditor.document.getText(
          c.vscode.window.activeTextEditor.selection,
        ),
        '@codocs [[Code Target]]#L12-L13',
      );
      const links = await c.links(target);
      c.assert.ok(!links.some((link) => link.range.start.line === 11));
      await c.replace(d, '@codocs [[Code Target]]#L6');
      await c.replace(test, 'no marker');
      const yaml = await c.eventually(
        /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ async () => {
          const values = await c.links(target);
          const found = values.find(
            (link) =>
              link.range.start.line === 5 && link.range.start.character === 2,
          );
          c.assert.ok(found);
          return found;
        },
      );
      await c.execute(yaml.target);
      await c.atTop('.codocs/direct.yaml');
      const overlap = await c.hover(target, '[[Direct]]', 'code-reference:1:1');
      c.assert.ok(c.commands(overlap).length >= 2);
    },
  },
  {
    id: 'whole-code-inlay',
    title:
      '실제 Inlay Hint의 2→1→0·설정·단일 이동 제스처와 원문 불변을 확인한다',
    /** 실제 설치 provider와 renderer 표시를 같은 원문 상태에서 확인한다. */
    async run(c) {
      const code = await c.open('code-reference');
      await c.replace(
        code,
        '@codocs [[Code Target]] @codocs [[Code Target]] @codocs [[Code Target]]#L11',
      );
      const target = await c.open('.codocs/code-target.yaml');
      const before = {
        text: target.getText(),
        dirty: target.isDirty,
        lines: target.lineCount,
        version: target.version,
      };
      const multiple = await c.eventually(
        /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ async () => {
          const hints = await c.hints(target);
          c.assert.equal(hints.length, 1);
          c.assert.equal(
            hints[0].label[0].value,
            '문서 전체에 연결된 코드 · 2곳',
          );
          return hints[0];
        },
      );
      c.assert.equal(multiple.label[0].command, undefined);
      c.assert.equal(multiple.textEdits, undefined);
      await c.ui('visible', '문서 전체에 연결된 코드 · 2곳');
      await c.ui('plain-click', '문서 전체에 연결된 코드 · 2곳');
      c.assert.equal(c.vscode.window.activeTextEditor.document, target);
      const settings = c.vscode.workspace.getConfiguration('editor');
      const original = settings.get('inlayHints.enabled');
      try {
        await settings.update(
          'inlayHints.enabled',
          'off',
          c.vscode.ConfigurationTarget.Workspace,
        );
        await c.ui('hidden', '문서 전체에 연결된 코드');
        await settings.update(
          'inlayHints.enabled',
          'on',
          c.vscode.ConfigurationTarget.Workspace,
        );
        await c.ui('visible', '문서 전체에 연결된 코드 · 2곳');
      } finally {
        await settings.update(
          'inlayHints.enabled',
          original,
          c.vscode.ConfigurationTarget.Workspace,
        );
      }
      await c.replace(
        code,
        '@codocs [[Code Target]] @codocs [[Code Target]]#L11',
      );
      await c.vscode.window.showTextDocument(target);
      await c.write('.gitignore', '');
      await c.eventually(
        /** 불완전한 확인 1곳을 단일 이동으로 확정하지 않는다. */ async () => {
          const hints = await c.hints(target);
          c.assert.equal(
            hints[0].label[0].value,
            '확인된 코드 1곳 · 수집 불완전',
          );
          c.assert.equal(hints[0].label[0].command, undefined);
          c.assert.equal(
            c.commands({ markdown: hints[0].tooltip.value }).length,
            1,
          );
          c.assert.ok(hints[0].tooltip.value.includes('EACCES'));
        },
      );
      await c.write('.gitignore', 'partial/\n');
      await c.eventually(async () => {
        const hints = await c.hints(target);
        c.assert.ok(hints[0].label[0].command);
      });
      await c.ui('gesture', '문서 전체에 연결된 코드 · 1곳');
      await c.eventually(() =>
        c.assert.equal(c.vscode.window.activeTextEditor.document, code),
      );
      c.assert.equal(
        c.vscode.window.activeTextEditor.document.getText(
          c.vscode.window.activeTextEditor.selection,
        ),
        '@codocs [[Code Target]]',
      );
      await c.replace(code, '@codocs [[Code Target]]#L11');
      await c.vscode.window.showTextDocument(target);
      await c.write('.gitignore', '');
      await c.eventually(
        /** 불완전한 확인 0곳을 완료된 부재로 확정하지 않는다. */ async () => {
          const hints = await c.hints(target);
          c.assert.equal(
            hints[0].label[0].value,
            '확인된 코드 0곳 · 수집 불완전',
          );
          c.assert.equal(hints[0].label[0].command, undefined);
        },
      );
      await c.write('.gitignore', 'partial/\n');
      await c.eventually(async () =>
        c.assert.equal((await c.hints(target)).length, 0),
      );
      await c.ui('hidden', '문서 전체에 연결된 코드');
      c.assert.deepEqual(
        {
          text: target.getText(),
          dirty: target.isDirty,
          lines: target.lineCount,
          version: target.version,
        },
        before,
      );
    },
  },
  {
    id: 'code-reference-eligibility',
    title:
      '설치 IDE와 MCP가 Git 추적·ignore·재포함·경계·binary 범위를 공유한다',
    /** 격리 workspace의 Git metadata와 실제 파일 정책을 양쪽 제품에서 확인한다. */
    async run(c) {
      const { execFileSync } = require('node:child_process');
      const names = [
        'ignored-tracked',
        'ignored-untracked',
        'sub/keep',
        'sub/excluded',
        'dist/custom',
        'node_modules/custom',
        'binary',
        'linked',
      ];
      const marker = '@codocs [[Code Target]]\n';
      try {
        for (const name of ['sub', 'scope', 'dist', 'node_modules'])
          await c.fs.mkdir(c.path.join(c.root, name), { recursive: true });
        await c.write('.gitignore', 'partial/\nignored*\nsub/*\n!sub/keep\n');
        await c.write('scope/.gitignore', '*.txt\n!keep.txt\n');
        await c.write('scope/keep.txt', marker);
        await c.write('scope/ignored.txt', marker);
        await c.fs.writeFile(
          c.path.join(c.root, 'utf16'),
          Buffer.from(marker, 'utf16le'),
        );
        for (const name of names.slice(0, 6)) await c.write(name, marker);
        await c.fs.writeFile(
          c.path.join(c.root, 'binary'),
          Buffer.from('\0' + marker),
        );
        execFileSync('git', ['init', '-q'], { cwd: c.root });
        execFileSync('git', ['add', '-f', 'ignored-tracked'], { cwd: c.root });
        await c.fs.mkdir(c.path.join(c.root, '.git', 'excluded-fixture'), {
          recursive: true,
        });
        await c.write('.git/excluded-fixture/text', marker);
        const outside = c.path.join(c.config.temporary, 'outside-code');
        await c.fs.mkdir(outside);
        await c.fs.writeFile(c.path.join(outside, 'source'), marker);
        await c.fs.symlink(
          outside,
          c.path.join(c.root, 'linked'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        const target = await c.open('.codocs/code-target.yaml');
        await c.open('ignored-untracked');
        await c.replace(
          c.vscode.window.activeTextEditor.document,
          marker + marker,
        );
        await c.vscode.window.showTextDocument(target);
        const initial = await c.eventually(
          /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ async () => {
            const values = await c.hints(target);
            c.assert.equal(
              values[0].label[0].value,
              '문서 전체에 연결된 코드 · 5곳',
            );
            return values[0];
          },
        );
        const text = c
          .commands({ markdown: initial.tooltip.value })
          .map((item) => item.label)
          .join('\n');
        c.assert.ok(text.includes('ignored-tracked'));
        c.assert.ok(text.includes('sub/keep'));
        c.assert.ok(text.includes('dist/custom'));
        c.assert.ok(text.includes('node_modules/custom'));
        c.assert.ok(!text.includes('ignored-untracked'));
        c.assert.ok(!text.includes('linked'));
        const mcp = await c.mcp();
        const current = (await mcp.call('codocs_get', { ids: ['code-target'] }))
          .results[0];
        const write = await mcp.call('codocs_write', {
          mode: 'update',
          id: 'code-target',
          revision: current.revision,
          set: { definition: 'Changed eligible whole target' },
        });
        c.assert.deepEqual(
          [
            ...new Set(
              write.writeImpact.impacts.map((item) => item.sourcePath),
            ),
          ].sort(),
          [
            'dist/custom',
            'ignored-tracked',
            'node_modules/custom',
            'scope/keep.txt',
            'sub/keep',
          ],
        );
        await c.closeMcp();
        execFileSync('git', ['rm', '--cached', '--', 'ignored-tracked'], {
          cwd: c.root,
        });
        await c.eventually(
          /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ async () => {
            const values = await c.hints(target);
            c.assert.equal(
              values[0].label[0].value,
              '문서 전체에 연결된 코드 · 4곳',
            );
          },
        );
        await c.write('.gitignore', 'partial/\nsub/*\n!sub/keep\n');
        await c.eventually(
          /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ async () => {
            const values = await c.hints(target);
            c.assert.equal(
              values[0].label[0].value,
              '문서 전체에 연결된 코드 · 7곳',
            );
          },
        ); // 두 출현의 dirty 버퍼가 저장 단일 출현을 대체한다.
      } finally {
        await c.closeMcp();
        await c.fs.rm(c.path.join(c.root, 'linked'), {
          recursive: true,
          force: true,
        });
        for (const name of [
          '.git',
          '.gitignore',
          'ignored-tracked',
          'ignored-untracked',
          'sub',
          'scope',
          'utf16',
          'dist',
          'node_modules',
          'binary',
        ])
          await c.fs.rm(c.path.join(c.root, name), {
            recursive: true,
            force: true,
          });
        await c.fs.rm(c.path.join(c.config.temporary, 'outside-code'), {
          recursive: true,
          force: true,
        });
      }
    },
  },
  {
    id: 'stale-code-reference',
    title: '표기 삭제·서버 재시작·경로 재사용 후 오래된 명시 링크를 거부한다',
    /** 서버와 출처 소유권에 고정한 이전 command의 실행 거부를 확인한다. */
    async run(c) {
      const d = await c.open('code-reference');
      await c.replace(d, '@codocs [[Code Target]]');
      const old = (await c.links(d, 1))[0].target;
      await c.replace(d, 'removed');
      c.assert.equal(await c.execute(old), false);
      await c.replace(d, '@codocs [[Code Target]]');
      const restart = (await c.links(d, 1))[0].target;
      await c.vscode.commands.executeCommand('codocs.restartLanguageServers');
      c.assert.equal(await c.execute(restart), false);
      const replaced = (await c.links(d, 1))[0].target;
      const targetPath = c.path.join(c.root, '.codocs/code-target.yaml');
      await c.fs.rename(targetPath, targetPath + '.previous');
      try {
        await c.fs.writeFile(
          targetPath,
          'id: replacement\nname: Code Target\ndefinition: Replacement\n',
        );
        c.assert.equal(await c.execute(replaced), false);
      } finally {
        await c.fs.rm(targetPath, { force: true });
        await c.fs.rename(targetPath + '.previous', targetPath);
      }
    },
  },
];

module.exports = {
  scenarios: [
    ...navigation,
    ...diagnostics,
    ...multiprocess,
    ...codeReferences.map(
      /** 같은 private 수집 정책에서 명시 참조 사례를 격리한다. */ (
        scenario,
      ) => ({
        ...scenario,
        /** 다른 사례의 의도적인 읽기 실패 fixture를 코드 수집에서 격리한다. */
        async run(c) {
          await c.write('.gitignore', 'partial/\n');
          try {
            await scenario.run(c);
          } finally {
            await c.fs.rm(c.path.join(c.root, '.gitignore'), { force: true });
          }
        },
      }),
    ),
  ],
};
