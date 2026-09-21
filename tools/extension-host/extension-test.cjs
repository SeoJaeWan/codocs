/* eslint-disable codocs/korean-jsdoc -- Extension Host 검증 스크립트는 독립 실행 증거다. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { access, mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

const extensionIdentifier = 'codocs.codocs';
const restartCommand = 'codocs.restartLanguageServers';

function serverProcesses(serverPath) {
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(serverPath) && line.includes('--node-ipc'))
    .map((line) => Number.parseInt(line.split(/\s+/u)[0], 10))
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
}

async function waitFor(description, check, timeoutMilliseconds = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function expectMissing(target) {
  try {
    await access(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Expected path to remain absent: ${target}`);
}

async function replaceDocument(document, text) {
  const edit = new vscode.WorkspaceEdit();
  const lastLine = document.lineAt(document.lineCount - 1);
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
    text,
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

async function killAndWaitForRestart(serverPath, pid, expectedCount) {
  process.kill(pid, 'SIGKILL');
  return waitFor('language server automatic restart', () => {
    const current = serverProcesses(serverPath);
    return current.length === expectedCount && !current.includes(pid)
      ? current
      : undefined;
  });
}

exports.run = async function run() {
  const fixtureRoot = process.env.COD15_FIXTURE_ROOT;
  const extensionRoot = process.env.COD15_EXTENSION_ROOT;
  const evidencePath = process.env.COD15_EVIDENCE_PATH;
  assert.ok(fixtureRoot, 'COD15_FIXTURE_ROOT is required');
  assert.ok(extensionRoot, 'COD15_EXTENSION_ROOT is required');
  assert.ok(evidencePath, 'COD15_EVIDENCE_PATH is required');

  const folders = vscode.workspace.workspaceFolders ?? [];
  assert.equal(folders.length, 4);
  const missingCodocs = path.join(fixtureRoot, 'missing', '.codocs');
  await expectMissing(missingCodocs);

  const extension = vscode.extensions.getExtension(extensionIdentifier);
  assert.ok(extension, `Extension is not installed: ${extensionIdentifier}`);
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(restartCommand));

  const serverPath = path.join(extensionRoot, 'dist/server/index.cjs');
  const initialProcesses = await waitFor(
    'one server per workspace folder',
    () => {
      const current = serverProcesses(serverPath);
      return current.length === folders.length ? current : undefined;
    },
  );
  await expectMissing(missingCodocs);

  const sourcePath = path.join(fixtureRoot, 'parent', 'nested', 'source.java');
  const diskText = await readFile(sourcePath, 'utf8');
  const document = await vscode.workspace.openTextDocument(sourcePath);
  await vscode.window.showTextDocument(document);
  const unsavedText =
    'class Broken {\n  // nestedZone 😀\n  String value = "nestedZone";\n  nestedZone(\n';
  await replaceDocument(document, unsavedText);
  const editedVersion = document.version;
  assert.equal(document.isDirty, true);
  assert.equal(document.getText(), unsavedText);
  assert.equal(await readFile(sourcePath, 'utf8'), diskText);

  await vscode.commands.executeCommand(restartCommand);
  const afterManualRestart = await waitFor(
    'manual language server restart',
    () => {
      const current = serverProcesses(serverPath);
      return current.length === folders.length &&
        current.every((pid) => !initialProcesses.includes(pid))
        ? current
        : undefined;
    },
  );
  assert.equal(document.version, editedVersion);
  assert.equal(document.getText(), unsavedText);
  assert.equal(document.isDirty, true);
  assert.equal(await readFile(sourcePath, 'utf8'), diskText);

  await mkdir(missingCodocs);
  await writeFile(
    path.join(missingCodocs, 'created-zone.yaml'),
    'id: created-zone\nname: Created Zone\ndefinition: created\ndomains: [test]\n',
    'utf8',
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(serverProcesses(serverPath).length, folders.length);
  await writeFile(
    path.join(missingCodocs, 'created-zone.yaml'),
    'id: created-zone\nname: Changed Zone\ndefinition: changed\ndomains: [test]\n',
    'utf8',
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(serverProcesses(serverPath).length, folders.length);

  let crashProcesses = afterManualRestart;
  let crashPid = crashProcesses[0];
  const crashedPids = [];
  for (let crash = 0; crash < 3; crash += 1) {
    const previousProcesses = crashProcesses;
    crashedPids.push(crashPid);
    crashProcesses = await killAndWaitForRestart(
      serverPath,
      crashPid,
      folders.length,
    );
    const replacement = crashProcesses.find(
      (pid) => !previousProcesses.includes(pid),
    );
    assert.ok(replacement, 'Restarted server PID was not observed');
    crashPid = replacement;
  }
  const finalCrashPid = crashPid;
  crashedPids.push(finalCrashPid);
  process.kill(finalCrashPid, 'SIGKILL');
  const stoppedProcesses = await waitFor('restart budget exhaustion', () => {
    const current = serverProcesses(serverPath);
    return current.length === folders.length - 1 &&
      !current.includes(finalCrashPid)
      ? current
      : undefined;
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(serverProcesses(serverPath).length, folders.length - 1);

  await vscode.commands.executeCommand(restartCommand);
  const afterRecovery = await waitFor(
    'manual recovery after crash stop',
    () => {
      const current = serverProcesses(serverPath);
      return current.length === folders.length ? current : undefined;
    },
  );
  assert.equal(document.version, editedVersion);
  assert.equal(document.getText(), unsavedText);
  assert.equal(document.isDirty, true);
  assert.equal(await readFile(sourcePath, 'utf8'), diskText);

  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        vscodeVersion: vscode.version,
        extensionIdentifier,
        extensionActive: extension.isActive,
        workspaceFolderCount: folders.length,
        serverCount: initialProcesses.length,
        manualRestartReplacedAllProcesses: true,
        unsavedDocument: {
          version: editedVersion,
          textPreservedAfterRestart: document.getText() === unsavedText,
          dirtyAfterRestart: document.isDirty,
          diskUnchanged: (await readFile(sourcePath, 'utf8')) === diskText,
        },
        missingCodocsNotGenerated: true,
        createdAndChangedCodocsObservedWithoutProcessLoss: true,
        automaticRestartsObserved: 3,
        repeatedCrashStoppedOneServer:
          stoppedProcesses.length === folders.length - 1,
        manualRecoveryRestoredAllServers:
          afterRecovery.length === folders.length,
        crashedPids,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};
