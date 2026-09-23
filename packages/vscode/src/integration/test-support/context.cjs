const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

/** 등록된 실제 provider·명령을 연결하는 시험 문맥을 만든다. */
exports.context =
  /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ function context(
    config,
  ) {
    const root = path.join(config.temporary, 'workspace');
    /** 실제 상태가 기대 결과에 도달할 때까지 제한 시간 안에서 다시 조회한다. */
    async function eventually(action, timeout = 15000) {
      const end = Date.now() + timeout;
      let error;
      while (Date.now() < end) {
        try {
          return await action();
        } catch (caught) {
          error = caught;
        }
        await new Promise(
          /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
            resolve,
          ) => setTimeout(resolve, 75),
        );
      }
      throw error ?? new Error('관측 제한 시간 초과');
    }
    /** fixture의 실제 파일 URI를 만든다. */
    function uri(relative) {
      return vscode.Uri.file(path.join(root, relative));
    }
    /** 파일을 실제 편집기에 연다. */
    async function open(relative) {
      const document = await vscode.workspace.openTextDocument(uri(relative));
      await vscode.window.showTextDocument(document, { preview: false });
      return document;
    }
    /** 지정 문자열 출현의 UTF-16 위치를 원문에서 찾는다. */
    function position(document, text, occurrence = 0, offset = 1) {
      let index = -1;
      for (let i = 0; i <= occurrence; i++)
        index = document.getText().indexOf(text, index + 1);
      assert.ok(index >= 0, `원문에 없음: ${text}`);
      return document.positionAt(index + offset);
    }
    /** 실제 Hover provider의 Markdown을 원형과 함께 조회한다. */
    async function hover(document, text, expected, occurrence = 0, offset = 1) {
      return eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
          const values = await vscode.commands.executeCommand(
            'vscode.executeHoverProvider',
            document.uri,
            position(document, text, occurrence, offset),
          );
          const markdown = (values ?? [])
            .flatMap((item) => item.contents)
            .map((item) => (typeof item === 'string' ? item : item.value))
            .join('\n');
          const plainText = markdown
            .replace(/\\([\\`*{}[\]()#+\-.!_>])/gu, '$1')
            .replace(/[*`]/gu, '');
          if (expected !== undefined)
            assert.ok(
              plainText.includes(expected),
              `호버에 ${expected} 없음: ${markdown}`,
            );
          return { markdown, text: plainText, values };
        },
      );
    }
    /** provider가 반환한 command URI만 추출한다. */
    function commands(hoverResult) {
      return [
        ...hoverResult.markdown.matchAll(/\[([^\]]*)\]\((command:[^)]+)\)/gu),
      ].map((match) => ({
        label: match[1].replace(/\\([\\`*{}[\]()#+\-.!_>])/gu, '$1'),
        uri: vscode.Uri.parse(match[2]),
      }));
    }
    /** VS Code URI가 이미 디코딩한 인수를 그대로 사용해 반환 명령을 호출한다. */
    async function execute(target) {
      assert.equal(target.scheme, 'command');
      assert.equal(target.path, 'codocs.openSource');
      return vscode.commands.executeCommand(
        target.path,
        ...JSON.parse(target.query),
      );
    }
    /** 반환된 호버에서 표시 이름에 해당하는 명령을 선택한다. */
    function command(hoverResult, label) {
      const item = commands(hoverResult).find(
        (item) => item.label === label || item.label.includes(label),
      );
      assert.ok(item, `호버 명령 없음: ${label}`);
      return item.uri;
    }
    /** 실제 DocumentLink provider의 최신 응답을 조회한다. */
    async function links(document, count) {
      return eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
          const links = await vscode.commands.executeCommand(
            'vscode.executeLinkProvider',
            document.uri,
          );
          if (count !== undefined) assert.equal(links.length, count);
          return links;
        },
      );
    }
    /** 원문 이동의 실제 URI와 상단 빈 선택을 검사한다. */
    async function atTop(relative) {
      await eventually(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {
          const editor = vscode.window.activeTextEditor;
          assert.equal(
            editor?.document.uri.toString(),
            uri(relative).toString(),
          );
          assert.equal(editor.selection.start.line, 0);
          assert.equal(editor.selection.start.character, 0);
          assert.ok(editor.selection.isEmpty);
        },
      );
    }
    /** 실제 WorkspaceEdit로 미저장 버퍼를 교체한다. */
    async function replace(document, content) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        ),
        content,
      );
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      assert.equal(document.getText(), content);
    }
    /** 시험 파일의 저장 내용을 바꾼다. */
    async function write(relative, content) {
      await fs.writeFile(path.join(root, relative), content);
    }
    /** 실제 탭에서 해당 URI가 열린 횟수를 센다. */
    function tabs(relative) {
      return vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) => tab.input?.uri?.toString() === uri(relative).toString(),
        );
    }
    /** 게시된 실제 진단을 코드로 조회한다. */
    function diagnostics(document, code) {
      return vscode.languages
        .getDiagnostics(document.uri)
        .filter(
          (item) =>
            (typeof item.code === 'object' ? item.code.value : item.code) ===
            code,
        );
    }
    return {
      root,
      config,
      vscode,
      fs,
      path,
      assert,
      eventually,
      uri,
      open,
      position,
      hover,
      commands,
      command,
      execute,
      links,
      atTop,
      replace,
      write,
      tabs,
      diagnostics,
    };
  };
