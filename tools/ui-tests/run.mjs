import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  glob,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertNodeVersion, root } from '../check/runtime.mjs';
import { parseArguments, resolveRuntime } from './runtime.mjs';

try {
  assertNodeVersion();
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(
      'pnpm test:ui --vsix <archive> --code-path <VS Code.app|GUI executable> [--code-path <another version>] [--output <new directory>] [-- <Playwright options>]',
    );
  } else {
    const vsix = await realpath(options.vsix);
    const runtimes = await Promise.all(
      options.codePaths.map((input) => resolveRuntime(input)),
    );
    if (
      new Set(runtimes.map((runtime) => runtime.version)).size !==
      runtimes.length
    )
      throw new Error('같은 VS Code 버전을 중복 지정할 수 없습니다.');
    const base = path.join(root, '.workbench/ui-tests');
    await mkdir(base, { recursive: true });
    const output = options.output
      ? path.resolve(options.output)
      : await mkdtemp(path.join(base, 'run-'));
    if (options.output) await mkdir(output);
    const sources = {};
    for await (const file of glob('tools/ui-tests/**/*.{mjs,cjs,json}', {
      cwd: root,
    })) {
      sources[file] = createHash('sha256')
        .update(await readFile(path.join(root, file)))
        .digest('hex');
    }
    const metadata = {
      at: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      playwright: JSON.parse(
        await readFile(
          path.join(root, 'node_modules/@playwright/test/package.json'),
          'utf8',
        ),
      ).version,
      vsix,
      sha256: createHash('sha256')
        .update(await readFile(vsix))
        .digest('hex'),
      runtimes,
      baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      sources,
    };
    await writeFile(
      path.join(output, 'environment.json'),
      JSON.stringify(metadata, null, 2),
    );
    console.log(`UI 테스트 결과: ${output}`);
    const require = createRequire(import.meta.url);
    const child = spawn(
      process.execPath,
      [
        require.resolve('@playwright/test/cli'),
        'test',
        '--config',
        path.join(import.meta.dirname, 'playwright.config.mjs'),
        ...options.playwright,
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          CODOCS_UI_RUN: JSON.stringify({ ...metadata, output }),
        },
      },
    );
    /** 신호를 이번 실행의 Playwright 프로세스에만 전달한다. */
    const interrupt = () => child.kill('SIGINT');
    /** 종료 요청을 테스트 프로세스에 전달해 fixture 정리를 요청한다. */
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.on('error', (error) => {
      console.error(error);
      process.exitCode = 2;
    });
    child.on(
      'exit',
      /** 격리된 UI 실행의 준비와 결과를 확인한다. */ (code) => {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
        process.exitCode = code ?? 1;
      },
    );
  }
} catch (error) {
  console.error('UI 환경 준비 실패:', error);
  process.exitCode = 2;
}
