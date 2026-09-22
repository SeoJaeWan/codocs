const vscode = require('vscode');
const fs = require('node:fs');

/** UI 행동을 대신 실행하지 않고 실제 편집기·탭·진단만 기록한다. */
function activate(context) {
  const destination = process.env.CODOCS_UI_STATE;
  if (!destination) return;
  /** 문서의 현재 URI·버전·미저장 원문을 읽는다. */
  const documentState = (document) => ({
    uri: document.uri.toString(),
    version: document.version,
    dirty: document.isDirty,
    text: document.getText(),
  });
  /** 화면 조작 결과를 원자적으로 게시해 부분 JSON 읽기를 방지한다. */
  const publish = () => {
    try {
      const editor = vscode.window.activeTextEditor;
      const value = {
        at: Date.now(),
        active: editor
          ? {
              ...documentState(editor.document),
              selections: editor.selections.map(
                /** 읽기 전용 상태를 수집하고 자원을 정리한다. */ (
                  selection,
                ) => ({
                  start: {
                    line: selection.start.line,
                    character: selection.start.character,
                  },
                  end: {
                    line: selection.end.line,
                    character: selection.end.character,
                  },
                  empty: selection.isEmpty,
                }),
              ),
            }
          : null,
        documents: vscode.workspace.textDocuments.map(documentState),
        tabs: vscode.window.tabGroups.all.flatMap(
          /** 읽기 전용 상태를 수집하고 자원을 정리한다. */ (group) =>
            group.tabs.map(
              /** 읽기 전용 상태를 수집하고 자원을 정리한다. */ (tab) => ({
                uri:
                  tab.input instanceof vscode.TabInputText
                    ? tab.input.uri.toString()
                    : null,
                active: tab.isActive,
                dirty: tab.isDirty,
              }),
            ),
        ),
        diagnostics: vscode.languages.getDiagnostics().flatMap(
          /** 읽기 전용 상태를 수집하고 자원을 정리한다. */ ([
            uri,
            diagnostics,
          ]) =>
            diagnostics.map(
              /** 읽기 전용 상태를 수집하고 자원을 정리한다. */ (
                diagnostic,
              ) => ({
                uri: uri.toString(),
                source: diagnostic.source,
                code:
                  typeof diagnostic.code === 'object'
                    ? diagnostic.code.value
                    : diagnostic.code,
                severity: diagnostic.severity,
                message: diagnostic.message,
                range: {
                  start: diagnostic.range.start,
                  end: diagnostic.range.end,
                },
              }),
            ),
        ),
        codocsActive:
          vscode.extensions.getExtension('codocs.codocs')?.isActive === true,
      };
      fs.writeFileSync(`${destination}.next`, JSON.stringify(value));
      fs.renameSync(`${destination}.next`, destination);
    } catch (error) {
      console.error('Codocs UI observer:', error);
    }
  };
  const timer = setInterval(publish, 100);
  context.subscriptions.push({
    /** 읽기 전용 상태를 수집하고 자원을 정리한다. */ dispose() {
      clearInterval(timer);
    },
  });
  publish();
}
exports.activate = activate;
