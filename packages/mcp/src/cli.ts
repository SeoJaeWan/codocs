#!/usr/bin/env node
import process from 'node:process';
import { startCodocsStdio } from './server/index.js';

const cwd = process.cwd();

/** 시작 또는 종료 오류를 stderr에 남기고 종료 코드를 설정한다. */
function reportFailure(error: unknown): void {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
}

/** 시작 인수는 생략 또는 --project 경로 하나만 허용한다. */
function projectArgument(args: readonly string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === '--project' && args[1]) return args[1];
  throw new Error('Usage: codocs-mcp [--project <path>]');
}

/** EOF와 종료 신호를 중복 호출해도 같은 정리 작업을 기다린다. */
async function main(): Promise<void> {
  const project = projectArgument(process.argv.slice(2));
  const state: {
    owner?: Awaited<ReturnType<typeof startCodocsStdio>>;
    ending: boolean;
  } = { ending: false };
  /** 여러 종료 신호를 같은 소유자 정리로 연결한다. */
  const shutdown = (): void => {
    state.ending = true;
    if (state.owner) void state.owner.close().catch(reportFailure);
  };
  process.stdin.once('end', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  state.owner = await startCodocsStdio({
    cwd,
    ...(project ? { project } : {}),
  });
  if (state.ending) await state.owner.close();
  else process.stderr.write('Codocs MCP server ready\n');
}

main().catch(reportFailure);
