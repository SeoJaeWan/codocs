import type * as vscode from 'vscode';
import { VscodeExtensionRuntime } from './vscode-client/index.js';

export * from './open-source/index.js';

let runtime: VscodeExtensionRuntime | undefined;

/** VS Code Extension Host에서 폴더별 language client를 시작한다. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const active = new VscodeExtensionRuntime(context);
  runtime = active;
  await active.activate();
}

/** 활성화 중 만든 모든 client, process, watcher와 listener를 정리한다. */
export async function deactivate(): Promise<void> {
  const active = runtime;
  runtime = undefined;
  await active?.deactivate();
}
