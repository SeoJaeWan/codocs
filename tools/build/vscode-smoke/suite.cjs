'use strict';
// Extension Host가 require로 불러오는 검증 모듈이다. 압축을 푼 VSIX 폴더 밖의 저장소 파일을 가져오지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');

/** 확장의 식별자다. */
const extensionId = 'seojaewan.codocs';
/** 등록되어 있어야 하는 명령이다. */
const restartCommand = 'codocs.restartLanguageServers';
/** 언어 서버가 뜰 때까지 Hover를 기다리는 최대 시간(ms)이다. */
const hoverDeadlineMs = 90_000;
/** Hover를 다시 묻기 전 간격(ms)이다. */
const hoverIntervalMs = 500;

/**
 * Hover 목록의 내용을 하나의 문자열로 합친다.
 * @param hovers executeHoverProvider가 돌려준 Hover 목록
 * @returns 모든 내용을 이어 붙인 문자열
 */
function hoverText(hovers) {
  return (hovers ?? [])
    .flatMap(
      /** Hover 하나의 내용 조각을 배열로 만든다. */ (hover) =>
        [hover.contents].flat(),
    )
    .map(
      /** 조각을 문자열로 바꾼다. */ (part) =>
        typeof part === 'string' ? part : (part.value ?? ''),
    )
    .join('\n');
}

/**
 * 조건이 참이 될 때까지 마감 안에서 간격을 두고 다시 확인한다.
 * @param check 값을 돌려주는 확인 함수. 참인 값이면 끝난다.
 * @param options 마감·간격(ms)과 시간 함수. 시간 함수는 시험에서 주입한다.
 * @returns 마지막으로 확인한 값과 성공 여부
 */
async function pollUntil(check, options) {
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    /** 간격만큼 기다린다. */ ((ms) =>
      new Promise(
        /** 간격만큼 기다린 뒤 이어간다. */ (resolve) =>
          setTimeout(resolve, ms),
      ));
  const limit = now() + options.deadlineMs;
  let last = await check();
  while (!last && now() < limit) {
    await wait(options.intervalMs);
    last = await check();
  }
  return { ok: Boolean(last), last };
}

/**
 * 확장 활성화, 명령 등록, 참조 위치의 Hover 값을 확인한다.
 * @param vscode VS Code API
 * @param env 원본 문서 경로(CODOCS_SMOKE_SOURCE)와 대상 문서 이름(CODOCS_SMOKE_TARGET)
 * @param timing 시험에서 바꾸는 Hover 마감·간격·시간 함수
 */
async function runChecks(vscode, env, timing = {}) {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `확장 ${extensionId}를 찾을 수 없습니다`);
  await extension.activate();
  assert.equal(extension.isActive, true, '확장이 활성화되지 않았습니다');

  const commands = await vscode.commands.getCommands(true);
  assert.ok(
    commands.includes(restartCommand),
    `명령 ${restartCommand}가 등록되지 않았습니다`,
  );

  const source = env.CODOCS_SMOKE_SOURCE;
  const target = env.CODOCS_SMOKE_TARGET;
  assert.ok(source && target, '검증 문서 경로와 대상 이름이 필요합니다');
  const text = fs.readFileSync(source, 'utf8');
  const offset = text.indexOf(`[[${target}]]`);
  assert.ok(offset >= 0, `원본 문서에 [[${target}]] 참조가 없습니다`);
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(source),
  );
  const position = document.positionAt(offset + 2 + 1);
  const result = await pollUntil(
    /** 참조 위치의 Hover에 대상 이름이 담겼는지 묻는다. */ async () => {
      const hovers = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        document.uri,
        position,
      );
      const content = hoverText(hovers);
      return content.includes(target) ? content : '';
    },
    {
      deadlineMs: hoverDeadlineMs,
      intervalMs: hoverIntervalMs,
      ...timing,
    },
  );
  assert.ok(
    result.ok,
    `[[${target}]] 위치의 Hover에 대상 이름이 ${hoverDeadlineMs}ms 안에 나타나지 않았습니다`,
  );
}

/** Extension Host가 호출하는 진입점이다. 실패하면 거부해 VS Code를 비정상 종료시킨다. */
async function run() {
  await runChecks(require('vscode'), process.env);
}

module.exports = { run, runChecks, hoverText, pollUntil };
