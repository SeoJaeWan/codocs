const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const vscode = require('vscode');
const { recordApiRequest } = require('./api-request-progress.cjs');
let activeConfig;

/** all 실행에서 한 대기 시나리오만 취소하는 내구 제어 파일이다. */
function checkCancellation() {
  if (!activeConfig) return;
  const file = path.join(activeConfig.output, 'cancel-scenarios.json');
  if (!fs.existsSync(file)) return;
  const selected = JSON.parse(fs.readFileSync(file, 'utf8')).scenarios;
  if (selected?.includes(activeConfig.performanceSession.scenario)) {
    const error = new Error(
      `취소된 시나리오: ${activeConfig.performanceSession.scenario}`,
    );
    error.name = 'ScenarioCancelled';
    throw error;
  }
}

/** 시나리오의 관측 대기만 지정한 간격으로 재개한다. */
const sleep = (ms) =>
  new Promise(
    /** 지정 간격 뒤 대기 중인 측정을 재개한다. */ (resolve) =>
      setTimeout(resolve, ms),
  );
/** 서로 다른 프로세스의 발생 시각을 같은 호스트 epoch에 사상한다. */
const epoch = (c) => c.timeOrigin + c.monotonicMs;
/** 현재 프로세스의 벽시계와 단조 시계를 함께 붙인다. */
const clock = () => ({
  wallTime: new Date().toISOString(),
  monotonicMs: performance.now(),
  timeOrigin: performance.timeOrigin,
  pid: process.pid,
});
/** 제품이 이미 남긴 생명주기 이벤트만 읽는다. */
const events = (session) =>
  fs
    .readdirSync(session.eventsDirectory)
    .filter((name) => /^events-\d+\.jsonl$/u.test(name))
    .flatMap(
      /** PID별 이벤트 파일을 줄 단위로 파싱한다. */ (name) =>
        fs
          .readFileSync(path.join(session.eventsDirectory, name), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse),
    )
    .filter((event) => event.sessionId === session.id);
/** 타이밍 구간 밖에서 완료 표본을 즉시 보존한다. */
const record = (config, sample) =>
  fs.appendFileSync(
    path.join(
      config.output,
      `scenario-samples-${config.performanceSession.scenario}-${config.performanceSession.iteration}-${config.performanceSession.windowRole ?? 'main'}.jsonl`,
    ),
    `${JSON.stringify(sample)}\n`,
  );

/** 감시 ready와 최초 완료 색인 게시가 모두 실제로 발생할 때까지 관측한다. */
async function ready(session) {
  for (;;) {
    checkCancellation();
    const observed = events(session);
    const index = observed.find(
      (e) =>
        e.kind === 'index-published' &&
        e.detail.initial &&
        e.detail.status === 'complete',
    );
    const watcher = observed.find((e) => e.kind === 'watcher-ready');
    if (index && watcher)
      return {
        index,
        watcher,
        end: epoch(index.occurred) > epoch(watcher.occurred) ? index : watcher,
      };
    await sleep(25);
  }
}

/** 명령 호출과 Promise 반환만 재며 본문 직렬화는 그 뒤에 수행한다. */
async function hover(uri, line) {
  checkCancellation();
  const begin = clock();
  const response = await vscode.commands.executeCommand(
    'vscode.executeHoverProvider',
    uri,
    new vscode.Position(line, 1),
  );
  const end = clock();
  checkCancellation();
  const text = (response ?? [])
    .flatMap((item) => item.contents ?? [])
    .map((item) =>
      typeof item === 'string' ? item : (item.value ?? String(item)),
    )
    .join('\n');
  return { begin, end, durationMs: end.monotonicMs - begin.monotonicMs, text };
}

/** 현재 시나리오가 소유한 코드 문서를 VS Code에 연다. */
async function openProbe(session) {
  const uri = vscode.Uri.file(path.join(session.workspace, 'probe.java'));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  return uri;
}

/** 새 창의 지정 코드 위치에 편집기를 연 뒤 CDP 관측 자식을 기다린다. */
async function ui(config) {
  const session = config.performanceSession;
  const manifest = JSON.parse(fs.readFileSync(session.corpusManifest, 'utf8'));
  const line = manifest.requests.findIndex(
    (request) => request.id === 'normal0001',
  );
  if (line < 0) throw new Error('첫 Hover 대상이 corpus에 없습니다');
  const request = manifest.requests[line];
  const uri = vscode.Uri.file(path.join(session.workspace, 'probe.java'));
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
  });
  editor.revealRange(
    new vscode.Range(line, 0, line, request.id.length),
    vscode.TextEditorRevealType.InCenter,
  );
  const observerConfig = path.join(session.profile, 'ui-observer.json');
  const sampleFile = path.join(
    config.output,
    `scenario-samples-${session.scenario}-${session.iteration}-main.jsonl`,
  );
  fs.writeFileSync(
    observerConfig,
    JSON.stringify({
      output: config.output,
      profile: session.profile,
      sampleFile,
      scenario: session.scenario,
      iteration: session.iteration,
      windowId: process.env.CODOCS_PERFORMANCE_WINDOW_ID,
      launchStarted: JSON.parse(process.env.CODOCS_PERFORMANCE_LAUNCH_STARTED),
      target: request.id,
      expectedBody: request.expected.definition,
      readiness: events(session).filter((event) =>
        ['index-start', 'index-published', 'watcher-ready'].includes(
          event.kind,
        ),
      ),
    }),
  );
  await new Promise(
    /** 관측 자식의 종료와 오류를 확장 Host에 전달한다. */ (
      resolve,
      reject,
    ) => {
      const child = spawn(
        process.env.CODOCS_PERFORMANCE_OBSERVER_NODE,
        [
          path.join(config.root, 'packages/vscode/test-runner/ui-observer.mjs'),
          observerConfig,
        ],
        { windowsHide: true, stdio: 'inherit' },
      );
      child.once('error', reject);
      child.once(
        'exit',
        /** 관측 자식의 취소와 실패를 구분한다. */ (code) => {
          if (code === 0) return resolve();
          try {
            checkCancellation();
          } catch (error) {
            return reject(error);
          }
          reject(new Error(`CDP 관측 종료 코드: ${code}`));
        },
      );
    },
  );
}

/** Hover Markdown의 이스케이프를 원문 비교에 맞게 되돌린다. */
function markdownText(result) {
  return result.text.replace(/\\([\\`*_{}\[\]()#+\-.!>])/gu, '$1');
}

/** ID·본문·원문 링크를 독립 corpus 기대값과 비교한다. */
function correct(result, expected) {
  if (expected.kind !== 'hover') return !result.text.includes('**현재 ID:**');
  const plain = markdownText(result);
  return (
    result.text.includes(expected.id) &&
    plain.includes(expected.definition) &&
    result.text.includes('command:codocs.openSource?')
  );
}

/** launch 직전부터 최초 색인과 실제 감시 준비까지 측정한다. */
async function startup(config, extension) {
  const session = config.performanceSession;
  await extension.activate();
  await openProbe(session);
  const observed = await ready(session);
  const launchStarted = JSON.parse(
    process.env.CODOCS_PERFORMANCE_LAUNCH_STARTED,
  );
  const durationMs = epoch(observed.end.occurred) - epoch(launchStarted);
  record(config, {
    status: durationMs >= 0 ? 'completed' : 'incorrect',
    durationMs: Math.max(0, durationMs),
    start: launchStarted,
    end: observed.end.occurred,
    extensionHostPid: process.pid,
    serverPid: observed.index.occurred.pid,
    folder: session.workspace,
    clockMapping: 'timeOrigin + monotonicMs on the same host',
    clockUncertaintyMs: null,
    observationMethod:
      'opt-in product lifecycle JSONL; synchronous write after occurrence clock',
  });
}

/** 준비와 warmup 뒤 1000개 Hover API 결과를 순서대로 측정한다. */
async function api(config, extension) {
  const session = config.performanceSession;
  await extension.activate();
  const uri = await openProbe(session);
  const readiness = await ready(session);
  const manifest = JSON.parse(fs.readFileSync(session.corpusManifest, 'utf8'));
  const count = manifest.requests.length;
  let incorrect = 0;
  for (let i = 0; i < config.settings.apiWarmup; i++) {
    const line = i % count;
    const request = manifest.requests[line];
    await recordApiRequest(
      config,
      'warmup',
      i,
      { id: request.id, line, category: request.category },
      () => hover(uri, line),
    );
  }
  for (let i = 0; i < config.settings.targets.api; i++) {
    const line = i % count;
    const request = manifest.requests[line];
    const result = await recordApiRequest(
      config,
      'measured',
      i,
      { id: request.id, line, category: request.category },
      () => hover(uri, line),
    );
    const valid = correct(result, request.expected);
    if (!valid) incorrect++;
    const plain = markdownText(result);
    record(config, {
      status: valid ? 'completed' : 'incorrect',
      durationMs: result.durationMs,
      request: { id: request.id, category: request.category, line },
      begin: result.begin,
      end: result.end,
      validation: {
        id: result.text.includes(request.id),
        body:
          request.expected.definition == null
            ? null
            : plain.includes(request.expected.definition),
        sourceLink: result.text.includes('command:codocs.openSource?'),
      },
      readiness: readiness.end.occurred,
      warmupCount: config.settings.apiWarmup,
      configuration: config.settings,
      ...(valid ? {} : { observed: result.text.slice(0, 500) }),
    });
  }
  if (incorrect)
    throw new Error(`${incorrect} API Hover 결과가 corpus 기대값과 다릅니다`);
}

/** 첫 조회는 쓰기 완료 직후, 다음 조회는 직전 응답 뒤 50ms 간격으로 직렬화한다. */
async function propagation(config, extension, external) {
  const session = config.performanceSession;
  await extension.activate();
  const uri = await openProbe(session);
  await ready(session);
  const manifest = JSON.parse(fs.readFileSync(session.corpusManifest, 'utf8'));
  const line = manifest.requests.findIndex((item) => item.id === 'normal0001');
  if (line < 0) throw new Error('고정된 propagation 대상이 없습니다');
  const target = path.join(
    session.workspace,
    '.codocs/performance/normal-0001.yaml',
  );
  const targetUri = vscode.Uri.file(target);
  for (let i = 0; i < config.settings.targets[session.scenario]; i++) {
    checkCancellation();
    const token = `cod20-${session.scenario}-${i}-${Date.now()}`;
    const source = fs.readFileSync(target, 'utf8');
    const changed = source.replace(/definition: .*/u, `definition: "${token}"`);
    let alreadyReflected = false;
    if (external) fs.writeFileSync(target, changed);
    else {
      const document = await vscode.workspace.openTextDocument(targetUri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        targetUri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        ),
        changed,
      );
      if (!(await vscode.workspace.applyEdit(edit)))
        throw new Error('저장 전 편집 실패');
      alreadyReflected = markdownText(await hover(uri, line)).includes(token);
      if (!(await document.save())) throw new Error('저장 실패');
    }
    const start = clock();
    const queries = [];
    for (;;) {
      checkCancellation();
      const response = await hover(uri, line);
      const found = markdownText(response).includes(token);
      queries.push({ begin: response.begin, end: response.end, found });
      if (found) {
        record(config, {
          status: 'completed',
          durationMs: response.end.monotonicMs - start.monotonicMs,
          start,
          end: response.end,
          token,
          queries,
          alreadyReflected,
          pollIntervalMs: config.settings.propagationPollMs,
        });
        break;
      }
      await sleep(config.settings.propagationPollMs);
    }
  }
}

/** 새 문서 버전과 고유 원문을 편집 전에 구독해 상응하는 이벤트만 수집한다. */
async function edits(config, extension, duringIndex) {
  const session = config.performanceSession;
  await extension.activate();
  const uri = await openProbe(session);
  if (!duringIndex) await ready(session);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  for (let i = 0; i < config.settings.targets[session.scenario]; i++) {
    checkCancellation();
    if (duringIndex) {
      const observed = events(session).sort(
        (a, b) => epoch(a.occurred) - epoch(b.occurred),
      );
      const last = observed
        .filter(
          (event) =>
            event.kind === 'index-start' || event.kind === 'index-published',
        )
        .at(-1);
      if (last?.kind !== 'index-start') break;
    }
    const token = `cod20-edit-${session.scenario}-${i}`;
    const previousVersion = document.version;
    let finish;
    const changed = new Promise(
      /** 명령 전에 일치하는 문서 변경을 기다릴 resolver를 보관한다. */ (
        resolve,
      ) => {
        finish = resolve;
      },
    );
    const listener = vscode.workspace.onDidChangeTextDocument(
      /** 같은 문서의 새 버전과 고유 내용을 함께 대조한다. */ (event) => {
        if (
          event.document.uri.toString() === uri.toString() &&
          event.document.version > previousVersion &&
          event.document.getText().includes(token)
        )
          finish({ end: clock(), version: event.document.version });
      },
    );
    const start = clock();
    try {
      const applied = await editor.edit(
        /** 현재 코드 줄을 새 버전으로 바꾸는 실제 편집 명령이다. */ (
          builder,
        ) =>
          builder.replace(
            new vscode.Range(0, 0, 0, document.lineAt(0).text.length),
            `normal0001(); // ${token}`,
          ),
      );
      if (!applied) throw new Error('편집 명령 실패');
      const matched = await changed;
      const observed = events(session).sort(
        (a, b) => epoch(a.occurred) - epoch(b.occurred),
      );
      const intervalStart = observed
        .filter(
          (e) => e.kind === 'index-start' && epoch(e.occurred) <= epoch(start),
        )
        .at(-1);
      const intervalEnd =
        intervalStart &&
        observed.find(
          (e) =>
            e.kind === 'index-published' &&
            epoch(e.occurred) >= epoch(intervalStart.occurred),
        );
      const indexing =
        intervalStart &&
        (!intervalEnd || epoch(intervalEnd.occurred) >= epoch(matched.end));
      record(config, {
        status: duringIndex && !indexing ? 'incorrect' : 'completed',
        durationMs: matched.end.monotonicMs - start.monotonicMs,
        start,
        end: matched.end,
        token,
        version: matched.version,
        classification: indexing ? 'during-index' : 'after-index',
        indexInterval: {
          start: intervalStart?.occurred ?? null,
          end: intervalEnd?.occurred ?? null,
        },
      });
      if (duringIndex && !indexing) break;
    } finally {
      listener.dispose();
    }
  }
}

/** 독립 VS Code 프로세스의 실제 Hover 전파와 다른 프로젝트의 격리를 확인한다. */
async function multiwindow(config, extension) {
  const session = config.performanceSession;
  await extension.activate();
  const uri = await openProbe(session);
  const readiness = await ready(session);
  const manifest = JSON.parse(fs.readFileSync(session.corpusManifest, 'utf8'));
  const line = manifest.requests.findIndex((item) => item.id === 'normal0001');
  if (line < 0) throw new Error('multiwindow 조회 대상 없음');
  const control = session.controlDirectory;
  /** 다른 창의 실패로 이 phase가 중단되면 대기를 끝낸다. */
  const checkAbort = () => {
    checkCancellation();
    if (fs.existsSync(path.join(control, 'abort')))
      throw new Error(`multiwindow ${session.phase} 중단`);
  };
  fs.writeFileSync(
    path.join(control, `ready-${session.windowRole}.json`),
    JSON.stringify({
      windowRole: session.windowRole,
      pid: process.pid,
      serverPid: readiness.index.occurred.pid,
      start: JSON.parse(process.env.CODOCS_PERFORMANCE_LAUNCH_STARTED),
      ready: readiness.end.occurred,
    }),
  );
  const changeFile = path.join(control, 'change.json');
  while (!fs.existsSync(changeFile)) {
    checkAbort();
    await sleep(25);
  }
  const change = JSON.parse(fs.readFileSync(changeFile, 'utf8'));
  const start = clock();
  const queries = [];
  if (session.isolated) {
    const verified = path.join(control, 'verify-isolation');
    while (!fs.existsSync(verified)) {
      checkAbort();
      await sleep(25);
    }
    const result = await hover(uri, line);
    const expected = manifest.requests[line].expected;
    const isolated =
      correct(result, expected) && !markdownText(result).includes(change.token);
    record(config, {
      status: isolated ? 'completed' : 'incorrect',
      durationMs: result.end.monotonicMs - start.monotonicMs,
      phase: session.phase,
      windowRole: session.windowRole,
      extensionHostPid: process.pid,
      serverPid: readiness.index.occurred.pid,
      folder: session.workspace,
      start,
      end: result.end,
      validation: { isolated, expectedProjectId: manifest.projectId },
    });
    if (!isolated)
      throw new Error('다른 프로젝트의 변경이 격리되지 않았습니다');
    return;
  }
  for (;;) {
    checkAbort();
    const result = await hover(uri, line);
    const found = markdownText(result).includes(change.token);
    queries.push({ begin: result.begin, end: result.end, found });
    if (found) {
      record(config, {
        status: 'completed',
        durationMs: result.end.monotonicMs - start.monotonicMs,
        phase: session.phase,
        windowRole: session.windowRole,
        extensionHostPid: process.pid,
        serverPid: readiness.index.occurred.pid,
        folder: session.workspace,
        start,
        end: result.end,
        queries,
      });
      fs.writeFileSync(
        path.join(control, `done-${session.windowRole}`),
        'true',
      );
      return;
    }
    await sleep(config.settings.propagationPollMs);
  }
}

/** 설치된 제품 VSIX와 시나리오 하나를 공식 Extension Host에서 실행한다. */
async function run() {
  const config = JSON.parse(
    fs.readFileSync(process.env.CODOCS_VSCODE_CONFIG, 'utf8'),
  );
  activeConfig = config;
  const scenario = config.performanceSession?.scenario ?? 'unknown';
  try {
    const extension = vscode.extensions.getExtension('codocs.codocs');
    if (!extension) throw new Error('설치된 VSIX 확장이 없습니다');
    if (
      fs.realpathSync(extension.extensionPath) !==
      fs.realpathSync(config.extension)
    )
      throw new Error('이번 실행에 설치한 VSIX가 아닙니다');
    if (scenario === 'startup') await startup(config, extension);
    else if (scenario === 'first-ui' || scenario === 'reentry-ui')
      await ui(config);
    else if (scenario === 'api') await api(config, extension);
    else if (scenario === 'save') await propagation(config, extension, false);
    else if (scenario === 'external')
      await propagation(config, extension, true);
    else if (scenario === 'edit-indexing' || scenario === 'edit-ready')
      await edits(config, extension, scenario === 'edit-indexing');
    else if (scenario === 'multiwindow') await multiwindow(config, extension);
    else
      throw new Error(
        `성능 시나리오 ${scenario} 측정 모듈을 사용할 수 없습니다`,
      );
  } catch (error) {
    fs.writeFileSync(
      path.join(config.output, `scenario-error-${scenario}.json`),
      JSON.stringify({
        scenario,
        error: String(error.stack ?? error),
        cancelled: error.name === 'ScenarioCancelled',
      }),
    );
    throw error;
  }
}

exports.run = run;
