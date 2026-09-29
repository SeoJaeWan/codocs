import { readFileSync } from 'node:fs';

/** 소스·내부 dist·독립 번들 모두 자신의 제품 manifest 버전을 응답한다. */
export function getMcpVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(manifest.version)
  )
    throw new Error('MCP 제품 manifest 버전 불일치');
  return manifest.version;
}
