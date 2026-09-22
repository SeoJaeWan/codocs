import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));

/** 지원하는 런타임이 아니면 실행 전에 필요한 버전을 안내한다. */
export function assertNodeVersion() {
  const expected = readFileSync(
    path.join(root, '.node-version'),
    'utf8',
  ).trim();
  if (process.versions.node !== expected) {
    throw new Error(
      `Node ${expected}가 필요합니다. 현재 ${process.versions.node}입니다. Node 버전을 전환한 뒤 다시 실행하세요.`,
    );
  }
}

/** pnpm 실행 환경과 PATH에서 실제 CLI를 찾아 고정 버전을 확인한다. */
export function resolvePnpm(env = process.env, repository = root) {
  const candidates = [
    path.join(repository, 'node_modules/pnpm/bin/pnpm.cjs'),
    path.join(repository, 'node_modules/pnpm/bin/pnpm.mjs'),
    env.npm_execpath,
  ];
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    candidates.push(
      path.join(directory, 'pnpm'),
      path.join(directory, 'pnpm.cjs'),
      path.join(directory, 'node_modules/pnpm/bin/pnpm.cjs'),
      path.join(directory, 'node_modules/pnpm/bin/pnpm.mjs'),
      path.join(directory, '../lib/node_modules/pnpm/bin/pnpm.cjs'),
      path.join(directory, '../lib/node_modules/pnpm/bin/pnpm.mjs'),
    );
  }
  const expected = JSON.parse(
    readFileSync(path.join(repository, 'package.json'), 'utf8'),
  ).packageManager.split('@')[1];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const resolved = realpathSync(candidate);
    try {
      const manifest = JSON.parse(
        readFileSync(path.resolve(resolved, '../../package.json'), 'utf8'),
      );
      if (manifest.name !== 'pnpm' || manifest.version !== expected) continue;
      const version = execFileSync(process.execPath, [resolved, '--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (version === expected) return resolved;
    } catch {
      /* 실행할 수 없는 PATH 항목은 다음 후보로 넘긴다. */
    }
  }
  throw new Error(
    `pnpm ${expected}를 찾을 수 없습니다. pnpm으로 이 명령을 실행하거나 PATH에 설치하세요.`,
  );
}
