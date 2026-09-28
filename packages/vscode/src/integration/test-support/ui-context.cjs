const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

/** API는 준비·관측에만 사용하며 제품 provider와 원문 명령은 호출하지 않는다. */
exports.uiContext =
  /** 현재 UI 입력·응답 관측을 연결한다. */ function uiContext(
    config,
    driver,
    until,
  ) {
    /** 실제 파일 URI를 만든다. */
    const uri = (relative) =>
      vscode.Uri.file(path.join(config.workspace, relative));
    /** 화면에 파일과 목표 행을 준비한다. */
    async function open(relative) {
      const document = await vscode.workspace.openTextDocument(uri(relative));
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      editor.revealRange(new vscode.Range(0, 0, document.lineCount - 1, 0));
      return document;
    }
    /** 다음 UI 입력의 미저장 상태를 준비한다. */
    async function replace(document, text) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        ),
        text,
      );
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      assert.equal(document.getText(), text);
    }
    /** 클릭 결과의 실제 파일·상단 빈 선택을 관측한다. */
    async function atTop(relative) {
      return until(
        /** 현재 UI 입력·응답 관측을 연결한다. */ () => {
          const editor = vscode.window.activeTextEditor;
          return (
            editor?.document.uri.toString() === uri(relative).toString() &&
            editor.selection.isEmpty &&
            editor.selection.start.line === 0 &&
            editor.selection.start.character === 0 &&
            editor
          );
        },
        `opened at top: ${relative}`,
      );
    }
    /** 현재 URI에 해당하는 실제 탭만 반환한다. */
    const tabs = (relative) =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) => tab.input?.uri?.toString() === uri(relative).toString(),
        );
    /** 서버가 게시한 실제 진단을 코드로 관측한다. */
    const diagnostics = (relative, code) =>
      vscode.languages
        .getDiagnostics(uri(relative))
        .filter(
          (item) =>
            (typeof item.code === 'object' ? item.code.value : item.code) ===
            code,
        );
    /** 클릭 전후의 editor·선택·탭 상태를 읽는다. */
    const editorState = () => {
      const editor = vscode.window.activeTextEditor;
      return {
        uri: editor?.document.uri.toString(),
        selection: editor && [
          editor.selection.start.line,
          editor.selection.start.character,
          editor.selection.end.line,
          editor.selection.end.character,
        ],
        tabs: vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .map((tab) => tab.input?.uri?.toString()),
      };
    };
    /** owned 프로필의 Output 로그만 관측하며 패널은 열지 않는다. */
    async function output() {
      const contents = [];
      /** VS Code가 만든 Codocs 채널 로그를 읽는다. */
      async function visit(directory) {
        let entries;
        try {
          entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
          if (error.code === 'ENOENT') return;
          throw error;
        }
        for (const entry of entries) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(file);
          else if (/codocs.*\.log$/iu.test(entry.name))
            contents.push(await fs.readFile(file, 'utf8'));
        }
      }
      await visit(path.join(config.profile, 'logs'));
      return contents.join('\n');
    }
    /** 사례의 dirty editor를 되돌린 뒤 탭과 fixture를 복원한다. */
    async function reset() {
      await driver.dismiss();
      for (const document of vscode.workspace.textDocuments) {
        if (!document.isDirty || document.uri.scheme !== 'file') continue;
        assert.ok(
          document.uri.fsPath.startsWith(config.workspace + path.sep),
          'only owned fixture may be reverted',
        );
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand(
          'workbench.action.revertAndCloseActiveEditor',
        );
      }
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      const { createFixture } = await import('./ui-fixture.mjs');
      await createFixture(config.workspace);
    }
    return {
      assert,
      fs,
      path,
      vscode,
      config,
      driver,
      until,
      uri,
      open,
      replace,
      atTop,
      tabs,
      diagnostics,
      editorState,
      output,
      reset,
    };
  };
