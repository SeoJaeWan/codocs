const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
/** 실제 Extension Host 준비 완료 후 실패·시간 제한·취소 경로를 유발한다. */
exports.run =
  /** 실제 확장의 등록과 provider 응답을 확인한다. */ async function run() {
    const config = JSON.parse(
      await fs.readFile(process.env.CODOCS_VSCODE_CONFIG, 'utf8'),
    );
    const extension = vscode.extensions.getExtension('seojaewan.codocs');
    if (extension?.packageJSON.version !== config.extensionVersion)
      throw new Error('설치된 확장 ID/버전 불일치');
    if (
      !extension.extensionPath.startsWith(
        path.join(config.output, 'extensions'),
      )
    )
      throw new Error('설치 경로 불일치');
    await extension.activate();
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(config.workspace, 'probe.java')),
    );
    const deadline = Date.now() + 10000;
    let ready = false;
    while (Date.now() < deadline) {
      const hover = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        document.uri,
        new vscode.Position(0, 1),
      );
      if (
        hover?.some((item) =>
          item.contents.some((content) =>
            content.value?.includes('Lifecycle ready'),
          ),
        )
      ) {
        ready = true;
        break;
      }
      await new Promise(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
          resolve,
        ) => setTimeout(resolve, 50),
      );
    }
    if (!ready) throw new Error('생명주기 fixture provider 준비 실패');
    await fs.writeFile(
      path.join(config.output, 'ready.json'),
      JSON.stringify({
        ready,
        extensionId: extension.id,
        extensionVersion: extension.packageJSON.version,
        extensionPath: extension.extensionPath,
        vscode: vscode.version,
        node: process.versions.node,
      }),
    );
    if (config.mode === 'failure') throw new Error('의도한 기능 실패');
    await new Promise(
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {},
    );
  };
