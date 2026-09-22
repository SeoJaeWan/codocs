const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  access,
  appendFile,
  mkdir,
  readFile,
  writeFile,
} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const vscode = require('vscode');
const { classifyRequestOutcome } = require('./request-outcome.cjs');
const { runCod18 } = require('./cod18.cjs');

const extensionIdentifier = 'codocs.codocs';
const restartCommand = 'codocs.restartLanguageServers';
const openSourceCommand = 'codocs.openSource';
const progress = [];

/** 실행 단계와 시각을 실패 후 읽을 수 있는 evidence에 기록한다. */
async function checkpoint(phase, detail = {}) {
  const progressPath = process.env.COD16_PROGRESS_PATH;
  if (!progressPath) return;
  progress.push({ phase, at: new Date().toISOString(), ...detail });
  await appendFile(
    progressPath,
    `${JSON.stringify(progress.at(-1))}\n`,
    'utf8',
  );
}

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
  while (
    timeoutMilliseconds === null ||
    Date.now() - started < timeoutMilliseconds
  ) {
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

/** Hover 배열의 Markdown 원문을 한 문자열로 합친다. */
function hoverMarkdown(hovers) {
  return hovers
    .flatMap((hover) =>
      Array.isArray(hover.contents) ? hover.contents : [hover.contents],
    )
    .map((content) =>
      typeof content === 'string' ? content : (content.value ?? ''),
    )
    .join('\n');
}

/** 실제 VS Code Hover provider 명령을 실행한다. */
async function executeHover(document, position, timeoutMilliseconds = 10_000) {
  let timer;
  /** Hover 요청 제한 시간이 지나면 명시적인 fixture 실패를 반환한다. */
  const timeout = (resolve, reject) => {
    void resolve;
    /** 제한 시간을 넘긴 Hover 요청을 거부한다. */
    const failAfterTimeout = () =>
      reject(new Error('executeHoverProvider timed out'));
    timer = setTimeout(failAfterTimeout, timeoutMilliseconds);
  };
  try {
    return await Promise.race([
      vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        document.uri,
        position,
      ),
      new Promise(timeout),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Hover 반환값을 단계 evidence에 직렬화할 수 있는 형태로 만든다. */
function hoverSnapshot(hovers) {
  if (hovers === undefined || hovers === null) return hovers;
  const snapshot = [];
  for (const hover of hovers) {
    const contents = [];
    for (const content of hover.contents)
      contents.push({ value: content.value, isTrusted: content.isTrusted });
    snapshot.push({ range: hover.range, contents });
  }
  return snapshot;
}

/** Markdown command URI에서 첫 원문 열기 인자를 복원한다. */
function commandArgument(markdown) {
  const match = /command:codocs\.openSource\?([^\s)]+)/u.exec(markdown);
  assert.ok(match, 'codocs.openSource command URI was not found');
  const values = JSON.parse(decodeURIComponent(match[1]));
  assert.ok(Array.isArray(values) && values.length === 1);
  return values[0];
}

/** 지정 URI를 표시 중인 탭 수를 반환한다. */
function tabsForUri(uri) {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input && tab.input.uri?.toString() === uri.toString())
    .length;
}

/** p 분위수의 nearest-rank 값을 반환한다. */
function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

/** Extension Host 공통 환경을 활성화하고 서버 PID를 확인한다. */
async function activateExtension(extensionRoot, performanceMode = false) {
  await checkpoint('activate-extension:start');
  const folders = vscode.workspace.workspaceFolders ?? [];
  assert.ok(folders.length > 0);
  const extension = vscode.extensions.getExtension(extensionIdentifier);
  assert.ok(extension, `Extension is not installed: ${extensionIdentifier}`);
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(restartCommand));
  assert.ok(commands.includes(openSourceCommand));
  const serverPath = path.join(extensionRoot, 'dist/server/index.cjs');
  /** 모든 workspace folder에 language server가 시작됐는지 확인한다. */
  const checkInitialProcesses = () => {
    const current = serverProcesses(serverPath);
    return current.length === folders.length ? current : undefined;
  };
  const initialProcesses = await waitFor(
    'one server per workspace folder',
    checkInitialProcesses,
    performanceMode ? null : 15_000,
  );
  await checkpoint('activate-extension:ready', {
    workspaceFolders: folders.length,
    serverProcesses: initialProcesses.length,
  });
  return { extension, folders, serverPath, initialProcesses };
}

/** 실제 Hover·원문 열기·탭 보존·workspace 라우팅을 검증한다. */
async function verifyHoverAndOpenSource(fixtureRoot) {
  const sourcePath = path.join(fixtureRoot, 'parent', 'nested', 'source.java');
  const document = await vscode.workspace.openTextDocument(sourcePath);
  await vscode.window.showTextDocument(document, { preview: false });
  const composite = 'reservationReturnZones';
  const compositeStart = document.getText().indexOf(composite);
  assert.ok(compositeStart >= 0);
  const reservationPosition = document.positionAt(compositeStart + 3);
  const returnZonePosition = document.positionAt(compositeStart + 15);
  await checkpoint('functional:hover-input', {
    uri: document.uri.toString(),
    languageId: document.languageId,
    text: document.getText(),
    reservationPosition,
    returnZonePosition,
  });
  let reservationAttempts = 0;
  const reservation = await waitFor(
    'reservation Hover',
    /** 예약 토큰의 본문이 준비된 Hover를 반환한다. */
    async () => {
      const hovers = await executeHover(document, reservationPosition);
      reservationAttempts += 1;
      if (reservationAttempts === 1)
        await checkpoint('functional:hover-first-response', {
          value: hoverSnapshot(hovers),
        });
      return hoverMarkdown(hovers).includes('예약 본문')
        ? { hovers, markdown: hoverMarkdown(hovers) }
        : undefined;
    },
    30_000,
  );
  await checkpoint('functional:hover-reservation');
  const returnZone = await waitFor(
    'return-zone Hover',
    /** 반납 구역 토큰의 본문이 준비된 Hover를 반환한다. */
    async () => {
      const hovers = await executeHover(document, returnZonePosition);
      return hoverMarkdown(hovers).includes('반납 본문')
        ? { hovers, markdown: hoverMarkdown(hovers) }
        : undefined;
    },
    30_000,
  );
  await checkpoint('functional:hover-return-zone');
  assert.match(reservation.markdown, /반납 구역/u);
  assert.doesNotMatch(reservation.markdown, /반납 본문/u);
  assert.match(returnZone.markdown, /예약/u);
  assert.doesNotMatch(returnZone.markdown, /예약 본문/u);
  const reservationRange = reservation.hovers[0].range;
  const returnZoneRange = returnZone.hovers[0].range;
  assert.equal(document.getText(reservationRange), 'reservation');
  assert.equal(document.getText(returnZoneRange), 'ReturnZones');
  const trusted = returnZone.hovers
    .flatMap((hover) => hover.contents)
    .find((content) => content.value?.includes('command:codocs.openSource'));
  assert.deepEqual(trusted.isTrusted, { enabledCommands: [openSourceCommand] });

  const nestedStart = document.getText().indexOf('nestedZone');
  const nestedHovers = await waitFor(
    'nearest nested workspace Hover',
    /** 중첩 workspace 문서만 포함한 Hover를 반환한다. */
    async () => {
      const hovers = await executeHover(
        document,
        document.positionAt(nestedStart + 2),
      );
      return hoverMarkdown(hovers).includes('Nested Zone') ? hovers : undefined;
    },
    30_000,
  );
  await checkpoint('functional:hover-nearest-workspace');
  assert.doesNotMatch(hoverMarkdown(nestedHovers), /Parent Zone/u);
  const parentStart = document.getText().indexOf('parentZone');
  const parentHovers = await executeHover(
    document,
    document.positionAt(parentStart + 2),
  );
  assert.equal(parentHovers.length, 0);

  const argument = commandArgument(returnZone.markdown);
  const sourceUri = vscode.Uri.file(
    path.join(
      fixtureRoot,
      'parent',
      'nested',
      '.codocs',
      '한글 원문',
      '반납 구역.yaml',
    ),
  );
  assert.match(sourceUri.fsPath, /한글 원문[/\\]반납 구역\.yaml$/u);
  assert.equal(argument.sourceUri, document.uri.toString());
  assert.match(argument.token, /^[\w-]{32}$/u);
  const beforeOpenTabs = tabsForUri(sourceUri);
  assert.equal(
    await vscode.commands.executeCommand(openSourceCommand, argument),
    true,
  );
  const openedEditor = vscode.window.activeTextEditor;
  assert.equal(openedEditor.document.uri.toString(), sourceUri.toString());
  assert.deepEqual(openedEditor.selection, new vscode.Selection(0, 0, 0, 0));
  assert.equal(tabsForUri(sourceUri), beforeOpenTabs + 1);
  await checkpoint('functional:open-source-saved');
  assert.equal(
    await vscode.commands.executeCommand(openSourceCommand, argument),
    true,
  );
  assert.equal(tabsForUri(sourceUri), beforeOpenTabs + 1);

  const diskYaml = await readFile(sourceUri.fsPath, 'utf8');
  const dirtyYaml = `${diskYaml}# unsaved fixture edit\r\n`;
  await replaceDocument(openedEditor.document, dirtyYaml);
  openedEditor.selection = new vscode.Selection(0, 1, 0, 1);
  assert.equal(openedEditor.document.isDirty, true);
  assert.equal(
    await vscode.commands.executeCommand(openSourceCommand, argument),
    true,
  );
  const reopenedEditor = vscode.window.activeTextEditor;
  assert.equal(reopenedEditor.document, openedEditor.document);
  assert.equal(reopenedEditor.document.getText(), dirtyYaml);
  assert.equal(reopenedEditor.document.isDirty, true);
  assert.equal(await readFile(sourceUri.fsPath, 'utf8'), diskYaml);
  assert.deepEqual(reopenedEditor.selection, new vscode.Selection(0, 0, 0, 0));
  assert.equal(tabsForUri(sourceUri), beforeOpenTabs + 1);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  assert.equal(reopenedEditor.document.isDirty, false);
  await checkpoint('functional:open-source-dirty-preserved');

  const definitionPath = path.join(
    fixtureRoot,
    'parent',
    'nested',
    'definition.js',
  );
  const definitionDocument =
    await vscode.workspace.openTextDocument(definitionPath);
  const callOffset = definitionDocument
    .getText()
    .lastIndexOf('preservedDefinition');
  const definitions = await waitFor(
    'built-in JavaScript definition provider',
    /** 기본 JavaScript 정의 결과가 준비되면 반환한다. */
    async () => {
      const values = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        definitionDocument.uri,
        definitionDocument.positionAt(callOffset + 2),
      );
      return values?.length ? values : undefined;
    },
    30_000,
  );
  const definitionTarget = definitions[0].targetUri ?? definitions[0].uri;
  const definitionRange =
    definitions[0].targetSelectionRange ?? definitions[0].range;
  assert.equal(definitionTarget.toString(), definitionDocument.uri.toString());
  assert.equal(definitionRange.start.line, 0);
  await checkpoint('functional:definition-provider');

  return {
    document,
    sourcePath,
    reservationRange: {
      start: reservationRange.start,
      end: reservationRange.end,
    },
    returnZoneRange: { start: returnZoneRange.start, end: returnZoneRange.end },
    generatedCommandTrusted: true,
    nearestWorkspaceOnly: true,
    openedUri: sourceUri.toString(),
    crlfAndUnicodePathOpened: true,
    existingTabReused: true,
    dirtyYamlPreserved: true,
    dirtySelectionResetToTop: true,
    defaultDefinitionProviderPreserved: true,
  };
}

/** 현재 설치된 VSIX의 기능·재시작 흐름을 실행한다. */
async function runFunctional(fixtureRoot, extensionRoot) {
  await checkpoint('functional:start');
  const missingCodocs = path.join(fixtureRoot, 'missing', '.codocs');
  await expectMissing(missingCodocs);
  const activated = await activateExtension(extensionRoot);
  await expectMissing(missingCodocs);
  const cod18 = await runCod18({
    vscode,
    fixtureRoot,
    checkpoint,
    waitFor,
    replaceDocument,
    executeHover,
    hoverMarkdown,
    commandArgument,
  });
  let hoverEvidence;
  const legacyStarted = Date.now();
  try {
    hoverEvidence = await verifyHoverAndOpenSource(fixtureRoot);
  } catch (error) {
    const row = {
      ac: 'AC-010',
      name: 'legacy code Hover/open source',
      status: 'fail',
      error: error.stack,
      durationMilliseconds: Date.now() - legacyStarted,
    };
    cod18.push(row);
    await checkpoint('cod18:scenario', row);
    const sourcePath = path.join(
      fixtureRoot,
      'parent',
      'nested',
      'source.java',
    );
    hoverEvidence = {
      sourcePath,
      document: await vscode.workspace.openTextDocument(sourcePath),
      failure: error.stack,
    };
  }
  const definitionStarted = Date.now();
  try {
    const doc = await vscode.workspace.openTextDocument(
      path.join(fixtureRoot, 'parent', 'nested', 'definition.js'),
    );
    const definitions = await waitFor(
      'independent native definition',
      /** 기본 JavaScript 정의 제공자의 준비를 기다린다. */
      async () => {
        const values = await vscode.commands.executeCommand(
          'vscode.executeDefinitionProvider',
          doc.uri,
          new vscode.Position(1, 3),
        );
        return values?.length ? values : undefined;
      },
      30000,
    );
    assert.equal(
      (definitions[0].targetUri ?? definitions[0].uri).toString(),
      doc.uri.toString(),
    );
    assert.equal(
      (definitions[0].targetSelectionRange ?? definitions[0].range).start.line,
      0,
    );
    cod18.push({
      ac: 'AC-012',
      name: 'native JavaScript definition',
      status: 'pass',
      durationMilliseconds: Date.now() - definitionStarted,
    });
  } catch (error) {
    cod18.push({
      ac: 'AC-012',
      name: 'native JavaScript definition',
      status: 'fail',
      error: error.stack,
      durationMilliseconds: Date.now() - definitionStarted,
    });
  }
  const document = hoverEvidence.document;
  const sourcePath = hoverEvidence.sourcePath;
  const diskText = await readFile(sourcePath, 'utf8');
  await vscode.window.showTextDocument(document, { preview: false });
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
    const current = serverProcesses(activated.serverPath);
    return current.length === activated.folders.length &&
      current.every((pid) => !activated.initialProcesses.includes(pid))
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
  assert.equal(
    serverProcesses(activated.serverPath).length,
    activated.folders.length,
  );
  await writeFile(
    path.join(missingCodocs, 'created-zone.yaml'),
    'id: created-zone\nname: Changed Zone\ndefinition: changed\ndomains: [test]\n',
    'utf8',
  );
  await new Promise(waitForChange);
  assert.equal(
    serverProcesses(activated.serverPath).length,
    activated.folders.length,
  );

  let crashProcesses = afterManualRestart;
  let crashPid = crashProcesses[0];
  const crashedPids = [];
  for (let crash = 0; crash < 3; crash += 1) {
    const previousProcesses = crashProcesses;
    crashedPids.push(crashPid);
    crashProcesses = await killAndWaitForRestart(
      activated.serverPath,
      crashPid,
      activated.folders.length,
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
    const current = serverProcesses(activated.serverPath);
    return current.length === activated.folders.length - 1 &&
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
  assert.equal(
    serverProcesses(activated.serverPath).length,
    activated.folders.length - 1,
  );

  await vscode.commands.executeCommand(restartCommand);
  /** 수동 복구 명령 뒤 모든 language server가 돌아왔는지 확인한다. */
  const checkAfterRecovery = () => {
    const current = serverProcesses(activated.serverPath);
    return current.length === activated.folders.length ? current : undefined;
  };
  const afterRecovery = await waitFor(
    'manual recovery after crash stop',
    checkAfterRecovery,
  );
  assert.equal(document.version, editedVersion);
  assert.equal(document.getText(), unsavedText);
  assert.equal(document.isDirty, true);
  assert.equal(await readFile(sourcePath, 'utf8'), diskText);
  await checkpoint('functional:complete');

  return {
    vscodeVersion: vscode.version,
    extensionIdentifier,
    extensionActive: activated.extension.isActive,
    extensionHost: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
    },
    workspaceFolderCount: activated.folders.length,
    serverCount: activated.initialProcesses.length,
    hoverAndOpenSource: {
      failure: hoverEvidence.failure,
      reservationRange: hoverEvidence.reservationRange,
      returnZoneRange: hoverEvidence.returnZoneRange,
      generatedCommandTrusted: hoverEvidence.generatedCommandTrusted,
      nearestWorkspaceOnly: hoverEvidence.nearestWorkspaceOnly,
      openedUri: hoverEvidence.openedUri,
      crlfAndUnicodePathOpened: hoverEvidence.crlfAndUnicodePathOpened,
      existingTabReused: hoverEvidence.existingTabReused,
      dirtyYamlPreserved: hoverEvidence.dirtyYamlPreserved,
      dirtySelectionResetToTop: hoverEvidence.dirtySelectionResetToTop,
      defaultDefinitionProviderPreserved:
        hoverEvidence.defaultDefinitionProviderPreserved,
    },
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
      stoppedProcesses.length === activated.folders.length - 1,
    manualRecoveryRestoredAllServers:
      afterRecovery.length === activated.folders.length,
    crashedPids,
    cod18,
  };
}

/** 실제 executeHoverProvider 호출의 정확성과 지연 시간을 측정한다. */
async function runPerformance(fixtureRoot, extensionRoot) {
  const options = JSON.parse(process.env.COD16_PERFORMANCE_OPTIONS);
  const fixtureMetadata = JSON.parse(process.env.COD16_FIXTURE_METADATA);
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const resources = { beforeReadiness: process.memoryUsage() };
  /** 부모가 보낸 중단 신호를 다음 요청 전에 확인한다. */
  const cancellationReason = async () => {
    const target = process.env.COD16_CANCEL_PATH;
    if (!target) return null;
    try {
      return (await readFile(target, 'utf8')).trim() || 'signal';
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  };
  const eventLoopPhases = {};
  /** 단계가 끝날 때만 누적 지연을 읽고 다음 단계의 히스토그램을 초기화한다. */
  const captureResources = async (boundary, memory) => {
    const count = delay.count;
    const eventLoop = {
      count,
      minimumMilliseconds: count ? delay.min / 1e6 : null,
      medianMilliseconds: count ? delay.percentile(50) / 1e6 : null,
      p95Milliseconds: count ? delay.percentile(95) / 1e6 : null,
      maximumMilliseconds: count ? delay.max / 1e6 : null,
    };
    eventLoopPhases[boundary] = eventLoop;
    await checkpoint('performance:resources', { boundary, memory, eventLoop });
    delay.reset();
  };
  await captureResources('before-readiness', resources.beforeReadiness);
  await checkpoint('performance:start', {
    requestedWarmups: options.warmupRuns,
    requestedMeasured: options.queryRuns,
  });
  const activated = await activateExtension(extensionRoot, true);
  const sourcePath = path.join(
    fixtureRoot,
    'parent',
    'nested',
    'performance.txt',
  );
  const document = await vscode.workspace.openTextDocument(sourcePath);
  await vscode.window.showTextDocument(document, { preview: false });
  const width = Math.max(4, String(options.documents - 1).length);
  /** 실제 반환 내용이 fixture의 ID·정의 및 원문 링크를 포함하는지 판별한다. */
  const query = async (index) => {
    const serial = String(index).padStart(width, '0');
    const started = performance.now();
    const hovers = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider',
      document.uri,
      new vscode.Position(index, 5),
    );
    const durationMilliseconds = performance.now() - started;
    const markdown = hoverMarkdown(hovers ?? []);
    const expectedDefinition =
      index >= 10 && index < 20 ? '긴 성능 본문 ' : `성능 본문 ${serial}`;
    return {
      durationMilliseconds,
      hoverCount: hovers?.length ?? 0,
      success:
        (hovers?.length ?? 0) > 0 &&
        markdown.includes(`Performance Term ${serial}`) &&
        markdown.includes(`perf-term-${serial}`) &&
        markdown.includes(expectedDefinition) &&
        markdown.includes('command:codocs.openSource'),
      markdown,
    };
  };
  /** 준비 확인 호출도 실제 완료 시간과 정확성을 모두 기록한다. */
  let readinessAttempts = 0;
  const readiness = [];
  let ready = false;
  while (!ready) {
    const cancellation = await cancellationReason();
    if (cancellation)
      throw new Error(`Hover measurement interrupted by ${cancellation}`);
    readinessAttempts += 1;
    await checkpoint('performance:readiness-request-start', {
      run: readinessAttempts,
      index: 0,
      startedAt: new Date().toISOString(),
    });
    const started = performance.now();
    let result;
    let error;
    try {
      result = await query(0);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const durationMilliseconds =
      result?.durationMilliseconds ?? performance.now() - started;
    const observation = {
      run: readinessAttempts,
      index: 0,
      durationMilliseconds,
      success: !error && result.success,
      hoverCount: result?.hoverCount ?? null,
      ...(error
        ? { error }
        : result.success
          ? {}
          : { markdown: result.markdown }),
    };
    readiness.push(observation);
    await checkpoint('performance:readiness-request-complete', {
      ...observation,
    });
    if (error) throw new Error(`Hover readiness request failed: ${error}`);
    if (!result.success && result.hoverCount > 0)
      throw new Error('Hover readiness returned incorrect fixture content');
    ready = result.success;
    if (!ready)
      await new Promise(
        /** 다음 준비 확인 전에 간격을 둔다. */
        (resolve) => setTimeout(resolve, 100),
      );
  }
  resources.afterReadiness = process.memoryUsage();
  await captureResources('after-readiness', resources.afterReadiness);
  await checkpoint('performance:index-ready', { readinessAttempts });
  let state = options.seed >>> 0;
  /** 고정 seed에서 다음 조회 위치를 선택한다. */
  const nextIndex = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % fixtureMetadata.queryableDocumentCount;
  };
  const warmups = [];
  const samples = [];
  const failures = [];
  /** 각 요청을 끝까지 기다리고 완료 시간을 보고 IO 전에 확정한다. */
  const observe = async (phase, run) => {
    const beforeCancellation = await cancellationReason();
    if (beforeCancellation)
      throw new Error(`Hover measurement interrupted by ${beforeCancellation}`);
    const index = nextIndex();
    await checkpoint(`performance:${phase}-request-start`, {
      run,
      index,
      position: { line: index, character: 5 },
      startedAt: new Date().toISOString(),
    });
    let result;
    let error;
    let started = performance.now();
    try {
      result = await query(index);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const durationMilliseconds =
      result?.durationMilliseconds ?? performance.now() - started;
    const cancellation = await cancellationReason();
    const { success, cancelled, stop } = classifyRequestOutcome(
      result,
      error,
      cancellation,
    );
    const observation = {
      run,
      index,
      durationMilliseconds,
      success,
      cancelled,
      ...(error ? { error } : success ? {} : { markdown: result.markdown }),
    };
    await checkpoint(`performance:${phase}-request-complete`, observation);
    if (!success && !cancelled) failures.push({ phase, ...observation });
    if (stop)
      throw new Error(
        `Hover measurement interrupted during ${cancellation ?? error}`,
      );
    return observation;
  };
  for (let run = 0; run < options.warmupRuns; run += 1)
    warmups.push(await observe('warmup', run));
  resources.afterWarmup = process.memoryUsage();
  await captureResources('after-warmup', resources.afterWarmup);
  await checkpoint('performance:warmup-complete', {
    completed: warmups.length,
  });
  for (let run = 0; run < options.queryRuns; run += 1)
    samples.push(await observe('measured', run));
  resources.afterMeasured = process.memoryUsage();
  await captureResources('after-measured', resources.afterMeasured);
  delay.disable();
  const durations = samples
    .filter((sample) => sample.success)
    .map((sample) => sample.durationMilliseconds);
  const p95Milliseconds = percentile(durations, 0.95);
  const accuracyFailureCount = failures.length;
  await checkpoint('performance:measured-complete', {
    p95Milliseconds,
    accuracyFailureCount,
  });
  return {
    vscodeVersion: vscode.version,
    extensionIdentifier,
    extensionActive: activated.extension.isActive,
    extensionHost: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
    },
    workspaceFolderCount: activated.folders.length,
    serverCount: activated.initialProcesses.length,
    performance: {
      warmupRuns: options.warmupRuns,
      queryRuns: options.queryRuns,
      targetMilliseconds: options.targetMilliseconds,
      readinessAttempts,
      attemptedReadiness: readinessAttempts,
      completedReadiness: readiness.length,
      readiness,
      attemptedWarmupRuns: warmups.length,
      completedWarmupRuns: warmups.length,
      warmups,
      attemptedMeasuredRuns: samples.length,
      completedMeasuredRuns: samples.length,
      samples,
      pending: null,
      measurementBoundary:
        'vscode.executeHoverProvider 호출 직전부터 Promise 완료까지. 정확성 확인·보고 직렬화는 요청 시간 밖.',
      successfulLatencySampleCount: durations.length,
      medianMilliseconds: percentile(durations, 0.5),
      p95Milliseconds,
      maximumMilliseconds: durations.length ? Math.max(...durations) : null,
      accuracyFailureCount,
      failures,
      memory: resources,
      eventLoopDelay: {
        phases: eventLoopPhases,
      },
      passed:
        accuracyFailureCount === 0 &&
        warmups.length === options.warmupRuns &&
        samples.length === options.queryRuns,
    },
  };
}

/** Extension Host 시나리오를 실행하고 증거 파일을 기록한다. */
async function runInteractiveUi(fixtureRoot, extensionRoot) {
  await activateExtension(extensionRoot);
  const root = path.join(fixtureRoot, 'parent', 'nested', '.codocs');
  await writeFile(
    path.join(root, 'ui-a.yaml'),
    'id: ui-a\nname: UI 복수\ndefinition: candidate A\n',
  );
  await writeFile(
    path.join(root, 'ui-b.yaml'),
    'id: ui-b\nname: UI 복수\ndefinition: candidate B\n',
  );
  const sourcePath = path.join(root, 'ui-source.yaml');
  await writeFile(
    sourcePath,
    'id: ui-source\nname: UI 검증\ndefinition: |\n  [[예약]]\n  [[UI 복수]]\n',
  );
  const doc = await vscode.workspace.openTextDocument(sourcePath);
  await vscode.window.showTextDocument(doc, { preview: false });
  const events = [];
  const editorListener = vscode.window.onDidChangeActiveTextEditor(
    /** 실제 UI의 탭 전환을 기록한다. */ (editor) => {
      events.push({
        at: new Date().toISOString(),
        kind: 'editor',
        uri: editor?.document.uri.toString(),
        selection: editor?.selection,
        dirty: editor?.document.isDirty,
      });
    },
  );
  const selectionListener = vscode.window.onDidChangeTextEditorSelection(
    /** 실제 UI의 선택 위치를 기록한다. */
    (event) => {
      events.push({
        at: new Date().toISOString(),
        kind: 'selection',
        uri: event.textEditor.document.uri.toString(),
        selections: event.selections,
      });
    },
  );
  await checkpoint('ui:ready', {
    fixtureRoot,
    sourcePath,
    version: vscode.version,
  });
  await waitFor(
    'UI evidence release file',
    /** UI 관찰 종료 표시를 기다린다. */
    async () => {
      try {
        await access(path.join(fixtureRoot, 'ui-done'));
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    900000,
  );
  editorListener.dispose();
  selectionListener.dispose();
  return {
    vscodeVersion: vscode.version,
    method:
      'interactive UI session; acceptance is recorded separately from editor telemetry',
    events,
  };
}

/** 선택한 검증 모드의 실제 Host 증거를 기록한다. */
async function run() {
  const fixtureRoot = process.env.COD16_FIXTURE_ROOT;
  const extensionRoot = process.env.COD16_EXTENSION_ROOT;
  const evidencePath = process.env.COD16_EVIDENCE_PATH;
  assert.ok(fixtureRoot, 'COD16_FIXTURE_ROOT is required');
  assert.ok(extensionRoot, 'COD16_EXTENSION_ROOT is required');
  assert.ok(evidencePath, 'COD16_EVIDENCE_PATH is required');
  await checkpoint('run:start', { vscodeVersion: vscode.version });
  const evidence =
    process.env.COD18_UI === '1'
      ? await runInteractiveUi(fixtureRoot, extensionRoot)
      : process.env.COD16_HOVER_PERFORMANCE === '1'
        ? await runPerformance(fixtureRoot, extensionRoot)
        : await runFunctional(fixtureRoot, extensionRoot);
  await writeFile(
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  await checkpoint('run:evidence-written');
}

exports.run = run;
