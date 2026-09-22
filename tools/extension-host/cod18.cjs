const assert = require('node:assert/strict');
const {
  mkdir,
  writeFile,
  readFile,
  rename,
  unlink,
  symlink,
} = require('node:fs/promises');
const path = require('node:path');

/** 실제 설치 Host에서 독립 사례를 계속 실행하고 프로토콜 증거를 남긴다. */
async function runCod18({
  vscode,
  fixtureRoot,
  checkpoint,
  waitFor,
  replaceDocument,
  executeHover,
  hoverMarkdown,
  commandArgument,
}) {
  const root = path.join(fixtureRoot, 'parent', 'nested');
  const knowledge = path.join(root, '.codocs', 'cod18');
  await mkdir(knowledge, { recursive: true });
  const rows = [];
  /** 한 사례의 실패가 뒤의 독립 검증을 차단하지 않도록 기록한다. */
  async function scenario(ac, name, verify) {
    const started = Date.now();
    let row;
    try {
      const evidence = await verify();
      row = { ac, name, status: 'pass', evidence };
    } catch (error) {
      row = { ac, name, status: 'fail', error: error.stack };
    }
    row.durationMilliseconds = Date.now() - started;
    row.method =
      'installed-host-provider-and-command; not actual UI click/cache evidence';
    rows.push(row);
    await checkpoint('cod18:scenario', row);
  }
  /** fixture 문서를 쓰고 경로를 반환한다. */
  async function yaml(file, text) {
    const target = path.join(knowledge, file);
    await writeFile(target, text, 'utf8');
    return target;
  }
  /** 본문 링크를 최신 편집기 문서에서 조회한다. */
  async function links(document) {
    return (
      (await vscode.commands.executeCommand(
        'vscode.executeLinkProvider',
        document.uri,
      )) ?? []
    );
  }
  /** 본문 문자열이 등장한 위치의 Hover를 읽는다. */
  async function hover(document, text) {
    return hoverMarkdown(
      await executeHover(
        document,
        document.positionAt(document.getText().indexOf(text) + 2),
      ),
    );
  }
  /** 단일 링크가 준비될 때까지 기다린다. */
  async function ready(document) {
    return waitFor(
      'COD18 document links',
      async () => {
        const values = await links(document);
        return values.length ? values : undefined;
      },
      15000,
    );
  }
  /** 서버 생성 명령 링크를 실행한다. UI 클릭 증거로 집계하지 않는다. */
  async function open(link) {
    assert.ok(link.target, 'confirmed reference must have a target');
    return vscode.commands.executeCommand(
      'codocs.openSource',
      commandArgument(link.target.toString()),
    );
  }
  const targetText =
    'id: cod18-target\nname: 검증 대상\ndomains: [검증]\ndefinition: initial target body\n';
  const target = await yaml('한글 대상.yaml', targetText);
  const source = await vscode.workspace.openTextDocument(
    await yaml(
      'source.yaml',
      'id: cod18-source\nname: 검증 출처\ndefinition: "😀 [[검증 대상]] [[검증:검증 대상]] [[검증 대상]]"\nexamples: ["[[검증 대상]]"]\ndomains: ["[[검증 대상]]"]\n',
    ),
  );
  await vscode.window.showTextDocument(source, { preview: false });
  await scenario(
    'AC-001',
    'CRLF quoted escape/folded/self/malformed and missing reference ranges',
    /** 원문 표현이 다른 참조 범위를 확인한다. */ async () => {
      const text =
        'id: syntax-source\r\nname: 문법 출처\r\ndefinition: "\\uD83D\\uDE00 [[검증 대상]] [[문법 출처]] [[missing]] [[bad:]]"\r\nexamples:\r\n  - >-\r\n    [[검증 대상]]\r\n  - \'[[검증:검증 대상]]\'\r\n';
      const doc = await vscode.workspace.openTextDocument(
        await yaml('syntax.yaml', text),
      );
      const values = await ready(doc);
      assert.equal(values.length, 3);
      assert.deepEqual(
        values.map((value) => doc.getText(value.range)),
        ['[[검증 대상]]', '[[검증 대상]]', '[[검증:검증 대상]]'],
      );
      assert.deepEqual(
        values.map((value) => value.range.start.line),
        [2, 5, 6],
      );
      assert.equal(values[0].range.start.character, 26);
      return values;
    },
  );

  await scenario(
    'AC-001',
    'LF UTF-16 repeated/domain/field boundaries',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      const values = await ready(source);
      assert.equal(values.length, 4);
      assert.deepEqual(
        values.map((link) => source.getText(link.range)),
        [
          '[[검증 대상]]',
          '[[검증:검증 대상]]',
          '[[검증 대상]]',
          '[[검증 대상]]',
        ],
      );
      assert.equal(values[0].range.start.character, 16);
      return values;
    },
  );
  await scenario(
    'AC-010',
    'YAML new/existing/dirty tab top and disk preservation',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      const [link] = await ready(source);
      assert.equal(await open(link), true);
      const editor = vscode.window.activeTextEditor;
      assert.equal(editor.document.uri.fsPath, target);
      assert.deepEqual(editor.selection, new vscode.Selection(0, 0, 0, 0));
      const tabs = vscode.window.tabGroups.all.flatMap(
        (group) => group.tabs,
      ).length;
      const original = editor.document.getText();
      await replaceDocument(editor.document, `${original}# dirty\n`);
      editor.selection = new vscode.Selection(1, 1, 2, 2);
      assert.equal(await open(link), true);
      assert.equal(vscode.window.activeTextEditor.document, editor.document);
      assert.deepEqual(editor.selection, new vscode.Selection(0, 0, 0, 0));
      assert.equal(editor.document.getText(), `${original}# dirty\n`);
      assert.equal(editor.document.isDirty, true);
      assert.equal(await readFile(target, 'utf8'), targetText);
      assert.equal(
        vscode.window.tabGroups.all.flatMap((group) => group.tabs).length,
        tabs,
      );
      await vscode.commands.executeCommand('workbench.action.files.revert');
      return { top: true, diskPreserved: true, tabsPreserved: true };
    },
  );
  await scenario(
    'AC-002',
    'unsaved replacement/insertion/deletion latest ranges',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      const disk = await readFile(source.uri.fsPath, 'utf8');
      const [old] = await ready(source);
      await replaceDocument(
        source,
        'id: cod18-source\nname: 검증 출처\ndefinition: "[[missing]]"\n',
      );
      await waitFor('removed links', async () =>
        (await links(source)).length === 0 ? true : undefined,
      );
      assert.equal(await open(old), false);
      await replaceDocument(
        source,
        'id: cod18-source\nname: 검증 출처\ndefinition: |\n  inserted\n  [[검증 대상]]\n',
      );
      const values = await ready(source);
      assert.equal(values.length, 1);
      assert.equal(values[0].range.start.line, 4);
      assert.equal(source.isDirty, true);
      assert.equal(await readFile(source.uri.fsPath, 'utf8'), disk);
      return values;
    },
  );
  await scenario(
    'AC-003',
    'ambiguous YAML body has no target; each Hover candidate opens',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      await yaml(
        'ambiguous-a.yaml',
        'id: cod18-a\nname: 복수 후보\ndefinition: A\n',
      );
      await yaml(
        'ambiguous-b.yaml',
        'id: cod18-b\nname: 복수 후보\ndefinition: B\n',
      );
      const doc = await vscode.workspace.openTextDocument(
        await yaml(
          'ambiguous-source.yaml',
          'id: cod18-ambiguous\nname: 복수 출처\ndefinition: "[[복수 후보]]"\n',
        ),
      );
      const markdown = await waitFor(
        'ambiguous hover',
        /** 복수 후보의 경로 구분을 기다린다. */ async () => {
          const value = await hover(doc, '[[복수 후보]]');
          return value.replaceAll('\\', '').includes('ambiguous-b.yaml')
            ? value
            : undefined;
        },
      );
      assert.equal((await links(doc)).filter((link) => link.target).length, 0);
      const commands = [
        ...markdown.matchAll(/command:codocs\.openSource\?([^\s)]+)/gu),
      ];
      assert.equal(commands.length, 2);
      const opened = [];
      for (const match of commands) {
        const result = await vscode.commands.executeCommand(
          'codocs.openSource',
          JSON.parse(decodeURIComponent(match[1]))[0],
        );
        opened.push({
          result,
          uri: vscode.window.activeTextEditor?.document.uri.toString(),
        });
      }
      await checkpoint('cod18:ambiguous-results', { markdown, opened });
      assert.deepEqual(
        opened.map((entry) => entry.result),
        [true, true],
        'individual candidate links must open, unlike source text',
      );
      return { markdown, opened };
    },
  );
  await scenario(
    'AC-004',
    'content revision change opens from existing token',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      const [old] = await ready(source);
      await writeFile(
        target,
        targetText.replace('initial target body', 'updated target body'),
      );
      await waitFor(
        'updated YAML hover',
        /** 완료 snapshot의 새 토큰을 기다린다. */ async () => {
          const values = await links(source);
          return values[0]?.target?.toString() !== old.target.toString() &&
            values.length
            ? true
            : undefined;
        },
      );
      assert.equal(
        await open(old),
        true,
        'content-only revision must not demand link reselection',
      );
      return { existingTokenOpened: true };
    },
  );
  await scenario(
    'AC-004',
    'confirmed move updates existing token',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      const [old] = await ready(source);
      const moved = path.join(knowledge, 'moved.yaml');
      await rename(target, moved);
      await waitFor(
        'moved target',
        /** 최신 링크가 이동 경로를 여는지 확인한다. */ async () => {
          const fresh = await links(source);
          if (!fresh.length) return undefined;
          if (!(await open(fresh[0]))) return undefined;
          return vscode.window.activeTextEditor.document.uri.fsPath === moved
            ? true
            : undefined;
        },
      );
      assert.equal(await open(old), true);
      assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, moved);
      return { moved };
    },
  );
  await scenario(
    'AC-005',
    'delete and old path reuse cannot open unrelated document',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      const [old] = await ready(source);
      await unlink(path.join(knowledge, 'moved.yaml'));
      await writeFile(
        target,
        'id: unrelated\nname: unrelated\ndefinition: unrelated\n',
      );
      await waitFor('deleted link removed', async () =>
        (await links(source)).length === 0 ? true : undefined,
      );
      assert.equal(await open(old), false);
      return { oldTokenRejected: true };
    },
  );
  await scenario(
    'AC-006',
    'absent YAML hover/link removed; source and broken diagnostic remain',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      assert.equal((await links(source)).length, 0);
      assert.equal(await hover(source, '[[검증 대상]]'), '');
      assert.match(source.getText(), /\[\[검증 대상\]\]/u);
      const diagnostics = await waitFor(
        'broken reference diagnostic',
        /** 확인된 끊어진 참조 진단을 기다린다. */
        async () => {
          const values = vscode.languages.getDiagnostics(source.uri);
          await checkpoint('cod18:missing-diagnostics', { values });
          return values.some((value) => value.code === 'reference_not_found')
            ? values
            : undefined;
        },
      );
      return diagnostics;
    },
  );
  await scenario(
    'AC-011',
    'deprecated occurrence warning/link retained and state refreshed',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      const deprecated = await yaml(
        'deprecated.yaml',
        'id: cod18-deprecated\nname: 폐기 대상\nstatus: deprecated\ndefinition: deprecated body\n',
      );
      const doc = await vscode.workspace.openTextDocument(
        await yaml(
          'deprecated-source.yaml',
          'id: deprecated-source\nname: 폐기 참조\ndefinition: "[[폐기 대상]] [[폐기 대상]]"\n',
        ),
      );
      await ready(doc);
      const warnings = await waitFor(
        'deprecated warnings',
        /** 출현별 경고 게시를 기다린다. */ async () => {
          const values = vscode.languages
            .getDiagnostics(doc.uri)
            .filter((value) => value.code === 'deprecated_reference');
          return values.length === 2 ? values : undefined;
        },
      );
      for (const warning of warnings) {
        assert.equal(warning.severity, vscode.DiagnosticSeverity.Warning);
        assert.equal(warning.message, '폐기 상태의 문서를 참조하고 있습니다.');
        assert.equal(doc.getText(warning.range), '[[폐기 대상]]');
      }
      const currentLinks = await waitFor(
        'deprecated links used for opening',
        /** 실제 열기에 사용할 두 출현의 링크 자체를 확인한다. */ async () => {
          const values = await links(doc);
          return values.length === 2 &&
            values.every(
              (value) =>
                value.target && doc.getText(value.range) === '[[폐기 대상]]',
            )
            ? values
            : undefined;
        },
      );
      assert.equal(await open(currentLinks[0]), true);
      await writeFile(
        deprecated,
        'id: cod18-deprecated\nname: 폐기 대상\ndefinition: active body\n',
      );
      await waitFor(
        'warning removed',
        /** 상태 변경 뒤 경고 제거를 기다린다. */ async () =>
          vscode.languages
            .getDiagnostics(doc.uri)
            .every((value) => value.code !== 'deprecated_reference')
            ? true
            : undefined,
      );
      return warnings;
    },
  );
  await scenario(
    'AC-012',
    'invalid current ID name reference survives content revision',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      const invalid = await yaml(
        'invalid-id.yaml',
        'name: ID 오류 대상\ndefinition: first\n',
      );
      const doc = await vscode.workspace.openTextDocument(
        await yaml(
          'invalid-id-source.yaml',
          'id: invalid-id-source\nname: ID 오류 출처\ndefinition: "[[ID 오류 대상]]"\n',
        ),
      );
      const [old] = await ready(doc);
      const initialOpen = await open(old);
      await writeFile(invalid, 'name: ID 오류 대상\ndefinition: second\n');
      await waitFor('ID error content updated', async () =>
        (await links(doc))[0]?.target?.toString() !== old.target.toString()
          ? true
          : undefined,
      );
      const afterRevisionOpen = await open(old);
      await checkpoint('cod18:invalid-id-results', {
        initialOpen,
        afterRevisionOpen,
      });
      assert.equal(initialOpen, true);
      assert.equal(
        afterRevisionOpen,
        true,
        'valid name reference must not require valid current ID after content change',
      );
      return { initialOpen, afterRevisionOpen };
    },
  );
  await scenario(
    'AC-012',
    'partial scan preserves confirmed candidate information',
    /** 설치 Host에서 해당 계약의 반환값과 부수 효과를 확인한다. */
    async () => {
      await symlink(
        path.join(knowledge, 'not-present.yaml'),
        path.join(knowledge, 'unreadable.yaml'),
      );
      const codePath = path.join(root, 'partial.java');
      await writeFile(codePath, 'cod18Deprecated\n');
      const doc = await vscode.workspace.openTextDocument(codePath);
      const markdown = await waitFor('partial hover', async () => {
        const value = await hover(doc, 'cod18Deprecated');
        return value.includes('일부 문서') ? value : undefined;
      });
      assert.match(markdown, /폐기 대상/u);
      assert.match(
        markdown,
        /command:codocs\.openSource/u,
        'confirmed candidate link must remain in partial observation',
      );
      const opened = await vscode.commands.executeCommand(
        'codocs.openSource',
        commandArgument(markdown),
      );
      await checkpoint('cod18:partial-open', { markdown, opened });
      assert.equal(
        opened,
        true,
        'confirmed candidate must remain usable in partial observation',
      );
      return { markdown };
    },
  );
  await unlink(path.join(knowledge, 'unreadable.yaml'));
  const recovery = await vscode.workspace.openTextDocument(
    path.join(root, 'partial.java'),
  );
  await waitFor('complete scan after partial fixture removal', async () =>
    !(await hover(recovery, 'cod18Deprecated')).includes('일부 문서')
      ? true
      : undefined,
  );
  await scenario(
    'AC-007',
    'duplicate top retains auxiliary and disambiguated paths',
    /** 중복 최상위와 보조 후보를 함께 확인한다. */ async () => {
      await yaml(
        'duplicate-a.yaml',
        'id: duplicate\nname: 같은 이름\ndomains: [동일]\ndefinition: A\n',
      );
      await yaml(
        'duplicate-b.yaml',
        'id: duplicate\nname: 같은 이름\ndomains: [동일]\ndefinition: B\n',
      );
      await yaml(
        'auxiliary.yaml',
        'id: auxiliary\nname: 보조 후보\ndefinition: auxiliary body\n',
      );
      const codePath = path.join(root, 'duplicates.java');
      await writeFile(codePath, 'duplicateAuxiliary\n');
      const doc = await vscode.workspace.openTextDocument(codePath);
      const markdown = await waitFor(
        'duplicate and auxiliary hover',
        async () => {
          const value = await hover(doc, 'duplicate');
          return value.includes('보조 후보') ? value : undefined;
        },
      );
      assert.match(markdown.replaceAll('\\', ''), /duplicate-a.yaml/u);
      assert.match(markdown.replaceAll('\\', ''), /duplicate-b.yaml/u);
      assert.match(markdown, /함께 매칭된 용어/u);
      return { markdown };
    },
  );
  await scenario(
    'AC-008',
    'current plus duplicate alias suppresses notice; previous-only remains',
    /** 현재 및 이전 ID 출현의 안내를 비교한다. */ async () => {
      await yaml(
        'current.yaml',
        'id: current\nname: 현재 후보\ndefinition: current body\ndeprecatedAliases:\n  - id: current\n  - id: previous\n',
      );
      const codePath = path.join(root, 'aliases.java');
      await writeFile(
        codePath,
        'current\nprevious\nauxiliaryCurrent\nauxiliaryPrevious\ncurrentPrevious\n',
      );
      const doc = await vscode.workspace.openTextDocument(codePath);
      await waitFor('current hover', async () =>
        (await hover(doc, 'current')).includes('현재 후보') ? true : undefined,
      );
      const current = await hover(doc, 'current');
      const previous = await hover(doc, 'previous');
      const auxiliaryCurrent = await hover(doc, 'auxiliaryCurrent');
      const auxiliaryPrevious = await hover(doc, 'auxiliaryPrevious');
      const mixed = await hover(doc, 'currentPrevious');
      assert.doesNotMatch(current, /이전 ID입니다/u);
      assert.match(previous, /이전 ID입니다/u);
      assert.doesNotMatch(auxiliaryCurrent, /이전 ID입니다/u);
      assert.match(auxiliaryPrevious, /이전 ID/u);
      assert.match(mixed, /같은 식별자의 다른 위치/u);
      assert.match(mixed, /이전 ID입니다/u);
      return { current, previous, auxiliaryCurrent, auxiliaryPrevious, mixed };
    },
  );
  await scenario(
    'AC-009',
    'alias-duplicate YAML diagnostic remains; only that Hover cause is hidden',
    /** 별칭 진단과 다른 필드 진단을 분리한다. */ async () => {
      const targetPath = await yaml(
        'invalid-alias.yaml',
        'id: invalid-alias\nname: 별칭 오류\ndefinition: body\ndomains: [" "]\ndeprecatedAliases:\n  - id: invalid-alias\n',
      );
      const targetDocument =
        await vscode.workspace.openTextDocument(targetPath);
      const codePath = path.join(root, 'invalid-alias.java');
      await writeFile(codePath, 'invalidAlias\n');
      const doc = await vscode.workspace.openTextDocument(codePath);
      const markdown = await waitFor('invalid alias hover', async () => {
        const value = await hover(doc, 'invalidAlias');
        return value.includes('별칭 오류') ? value : undefined;
      });
      const diagnostics = await waitFor(
        'alias diagnostic',
        /** 별칭 중복 진단 게시를 기다린다. */ async () => {
          const values = vscode.languages.getDiagnostics(targetDocument.uri);
          return values.some((item) =>
            item.message.includes('이전 ID가 현재 ID와 같습니다'),
          )
            ? values
            : undefined;
        },
      );
      assert.doesNotMatch(markdown, /이전 ID가 현재 ID와 같습니다/u);
      assert.match(markdown, /빈 문자열이나 공백뿐인 문자열/u);
      return { markdown, diagnostics };
    },
  );
  await scenario(
    'NFR-004',
    'external Markdown is escaped and only generated command trusted',
    /** 외부 명령 문자열의 실행 신뢰를 검사한다. */ async () => {
      await yaml(
        'escape.yaml',
        'id: escape-term\nname: "[escape](command:evil)"\ndefinition: "<script>alert(1)</script> [evil](command:evil)"\n',
      );
      const codePath = path.join(root, 'escape.java');
      await writeFile(codePath, 'escapeTerm\n');
      const doc = await vscode.workspace.openTextDocument(codePath);
      const values = await waitFor('escaped hover', async () => {
        const result = await executeHover(doc, new vscode.Position(0, 2));
        return hoverMarkdown(result).includes('evil') ? result : undefined;
      });
      const markdown = hoverMarkdown(values);
      assert.doesNotMatch(markdown, /\]\(command:evil\)/u);
      for (const content of values.flatMap((value) => value.contents)) {
        if (content.value?.includes('command:codocs.openSource'))
          assert.deepEqual(content.isTrusted, {
            enabledCommands: ['codocs.openSource'],
          });
      }
      return { markdown };
    },
  );
  // 전체 AC 수용 판정은 이 프로토콜 부분 검사와 실제 UI 증거를 함께 검토한다.
  await scenario(
    'AC-003',
    'relationship-only code Hover link opens referenced document',
    /** 코드에 직접 매칭되지 않은 관계 링크도 선택 대상으로 검사한다. */ async () => {
      const codePath = path.join(root, 'relationship.java');
      await writeFile(codePath, 'reservation\n');
      const doc = await vscode.workspace.openTextDocument(codePath);
      const markdown = await waitFor('relationship hover', async () => {
        const value = await hover(doc, 'reservation');
        return value.includes('이 문서가 참조') ? value : undefined;
      });
      const section = markdown.split('이 문서가 참조')[1];
      const opened = await vscode.commands.executeCommand(
        'codocs.openSource',
        commandArgument(section),
      );
      await checkpoint('cod18:relationship-open', { markdown, opened });
      assert.equal(opened, true);
      assert.match(
        vscode.window.activeTextEditor.document.uri.fsPath,
        /반납 구역.yaml$/u,
      );
      return { markdown, opened };
    },
  );
  await scenario(
    'AC-011',
    'ordinary/previous-only/ambiguous references have no deprecated warning',
    /** 폐기 상태와 이전 ID를 구분한다. */ async () => {
      await yaml(
        'negative-warning.yaml',
        'id: negative-warning\nname: 일반 대상\ndefinition: ordinary\ndeprecatedAliases:\n  - id: old-negative\n',
      );
      const doc = await vscode.workspace.openTextDocument(
        await yaml(
          'negative-source.yaml',
          'id: negative-source\nname: 일반 출처\ndefinition: "[[일반 대상]] [[복수 후보]]"\n',
        ),
      );
      await ready(doc);
      const values = vscode.languages.getDiagnostics(doc.uri);
      assert.equal(
        values.filter((value) => value.code === 'deprecated_reference').length,
        0,
      );
      return values;
    },
  );
  await scenario(
    'AC-003',
    'reverse relationship selection expires when the relation disappears',
    /** 역참조만으로 노출된 선택과 관계 삭제 뒤의 거부를 확인한다. */ async () => {
      const targetPath = await yaml(
        'reverse-target.yaml',
        'id: reverse-target\nname: 역참조 대상\ndefinition: first body\n',
      );
      const referrerPath = await yaml(
        'reverse-source.yaml',
        'id: reverse-source\nname: 역참조 출처\ndefinition: "[[역참조 대상]]"\n',
      );
      const codePath = path.join(root, 'reverse.java');
      await writeFile(codePath, 'reverseTarget\n');
      const doc = await vscode.workspace.openTextDocument(codePath);
      const markdown = await waitFor('reverse relation hover', async () => {
        const value = await hover(doc, 'reverseTarget');
        return value.includes('이 문서를 참조') ? value : undefined;
      });
      const selection = commandArgument(markdown.split('이 문서를 참조')[1]);
      assert.equal(
        await vscode.commands.executeCommand('codocs.openSource', selection),
        true,
      );
      assert.equal(
        vscode.window.activeTextEditor.document.uri.fsPath,
        referrerPath,
      );
      await writeFile(
        referrerPath,
        'id: reverse-source\nname: 역참조 출처\ndefinition: removed\n',
      );
      await waitFor(
        'reverse relation removed',
        /** 새 관측에서 역참조가 사라졌는지 확인한다. */ async () => {
          const value = await hover(doc, 'reverseTarget');
          return value.includes('first body') &&
            !value.includes('이 문서를 참조')
            ? value
            : undefined;
        },
      );
      assert.equal(
        await vscode.commands.executeCommand('codocs.openSource', selection),
        false,
      );
      await writeFile(
        targetPath,
        'id: reverse-target\nname: 역참조 대상\ndefinition: newest body\n',
      );
      const newest = await waitFor(
        'next hover newest content',
        /** 다음 조회에서 새 본문을 기다린다. */ async () => {
          const value = await hover(doc, 'reverseTarget');
          return value.includes('newest body') ? value : undefined;
        },
      );
      assert.doesNotMatch(newest, /first body/u);
      return { markdown, newest, staleRelationRejected: true };
    },
  );
  for (const [ac, reason] of [
    [
      'AC-001',
      'protocol syntax cases exercised; visible UI range matrix not exhaustive',
    ],
    [
      'AC-002',
      'close/cancellation/controlled async race not exercised through actual UI',
    ],
    [
      'AC-003',
      'actual source click and each rendered Hover click require UI evidence',
    ],
    [
      'AC-004',
      'next query and click checked; already-visible Hover immediate refresh excluded by approved follow-up',
    ],
    [
      'AC-005',
      'visible stale click and no-popup observation require UI evidence',
    ],
    ['AC-006', 'visible no-popup observation requires UI evidence'],
    [
      'AC-007',
      'same-name without-domain YAML case and same-domain code case exercised; actual UI not exercised',
    ],
    [
      'AC-008',
      'mixed current/previous occurrences checked programmatically; rendered UI matrix not exhaustive',
    ],
    [
      'AC-009',
      'protocol case exercised; actual visible diagnostics/hover not exercised',
    ],
    ['AC-010', 'actual rendered code/YAML link click requires UI evidence'],
    [
      'AC-011',
      'ordinary/alias/ambiguous negative cases exercised; unconfirmed negative case not exercised',
    ],
    ['AC-012', 'preparing/failed controlled host states not induced'],
  ])
    rows.push({
      ac,
      name: 'remaining acceptance coverage',
      status: 'skip',
      reason,
      durationMilliseconds: 0,
    });
  await checkpoint('cod18:matrix', { rows });
  return rows;
}

exports.runCod18 = runCod18;
