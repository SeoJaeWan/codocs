const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { access, mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

const extensionIdentifier = 'codocs.codocs';
const restartCommand = 'codocs.restartLanguageServers';

/** 실행 중인 language server 프로세스의 PID를 찾는다. */
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

/** 조건이 충족될 때까지 Extension Host 상태를 기다린다. */
async function waitFor(description, check, timeoutMilliseconds = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    const value = await check();
    if (value !== undefined) return value;
    /** 짧은 간격 뒤 조건을 다시 확인한다. */
    const waitInterval = (resolve) => setTimeout(resolve, 100);
    await new Promise(waitInterval);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

/** 대상 경로가 아직 존재하지 않는지 확인한다. */
async function expectMissing(target) {
  try {
    await access(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Expected path to remain absent: ${target}`);
}

/** 열린 문서 전체를 지정한 텍스트로 교체한다. */
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

/** language server를 종료하고 자동 재시작 결과를 기다린다. */
async function killAndWaitForRestart(serverPath, pid, expectedCount) {
  process.kill(pid, 'SIGKILL');
  /** 재시작된 프로세스 집합이 기대한 상태인지 확인한다. */
  const checkRestart = () => {
    const current = serverProcesses(serverPath);
    return current.length === expectedCount && !current.includes(pid)
      ? current
      : undefined;
  };
  return waitFor('language server automatic restart', checkRestart);
}

/** Extension Host 시나리오를 실행하고 증거 파일을 기록한다. */
async function run() {
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
  /** 모든 workspace folder에 language server가 시작됐는지 확인한다. */
  const checkInitialProcesses = () => {
    const current = serverProcesses(serverPath);
    return current.length === folders.length ? current : undefined;
  };
  const initialProcesses = await waitFor(
    'one server per workspace folder',
    checkInitialProcesses,
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
  /** 수동 재시작이 모든 기존 프로세스를 교체했는지 확인한다. */
  const checkManualRestart = () => {
    const current = serverProcesses(serverPath);
    return current.length === folders.length &&
      current.every((pid) => !initialProcesses.includes(pid))
      ? current
      : undefined;
  };
  const afterManualRestart = await waitFor(
    'manual language server restart',
    checkManualRestart,
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
  /** 파일 감시자가 변경을 처리할 시간을 확보한다. */
  const waitForChange = (resolve) => setTimeout(resolve, 500);
  await new Promise(waitForChange);
  assert.equal(serverProcesses(serverPath).length, folders.length);
  await writeFile(
    path.join(missingCodocs, 'created-zone.yaml'),
    'id: created-zone\nname: Changed Zone\ndefinition: changed\ndomains: [test]\n',
    'utf8',
  );
  await new Promise(waitForChange);
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
  /** 재시작 예산이 소진되어 한 서버가 중단됐는지 확인한다. */
  const checkStoppedProcesses = () => {
    const current = serverProcesses(serverPath);
    return current.length === folders.length - 1 &&
      !current.includes(finalCrashPid)
      ? current
      : undefined;
  };
  const stoppedProcesses = await waitFor(
    'restart budget exhaustion',
    checkStoppedProcesses,
  );
  /** 중단 상태가 유지되는지 확인할 시간을 확보한다. */
  const waitForStop = (resolve) => setTimeout(resolve, 1_000);
  await new Promise(waitForStop);
  assert.equal(serverProcesses(serverPath).length, folders.length - 1);

  await vscode.commands.executeCommand(restartCommand);
  /** 수동 복구 명령 뒤 모든 language server가 돌아왔는지 확인한다. */
  const checkAfterRecovery = () => {
    const current = serverProcesses(serverPath);
    return current.length === folders.length ? current : undefined;
  };
  const afterRecovery = await waitFor(
    'manual recovery after crash stop',
    checkAfterRecovery,
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
}

exports.run = run;
