import path from 'node:path';

/** 실행 후보의 정확한 버전·VSIX와 job 전용 증거 경로를 검증한다. */
export function parseArguments(
  args,
  environment = process.env,
  platform = process.platform,
) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      !['--version', '--vsix', '--output', '--timeout-ms'].includes(key) ||
      values[key] !== undefined ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new Error(`Invalid UI runner argument: ${key}`);
    values[key] = args[i + 1];
  }
  if (!/^\d+\.\d+\.\d+$/u.test(values['--version'] ?? ''))
    throw new Error('--version must be an exact stable version');
  if (
    !values['--vsix'] ||
    !path.isAbsolute(values['--vsix']) ||
    path.extname(values['--vsix']) !== '.vsix'
  )
    throw new Error('--vsix must be an absolute final candidate VSIX path');
  if (!values['--output'] || !path.isAbsolute(values['--output']))
    throw new Error('--output must be an absolute job evidence directory');
  const timeout = Number(values['--timeout-ms'] ?? 600_000);
  if (!Number.isInteger(timeout) || timeout < 30_000 || timeout > 1_800_000)
    throw new Error('--timeout-ms must be between 30000 and 1800000');
  if (environment.CI !== 'true')
    throw new Error('Actual VS Code UI execution is supported only in CI');
  if (!['win32', 'darwin'].includes(platform))
    throw new Error(`Unsupported UI platform: ${platform}`);
  return {
    version: values['--version'],
    vsix: values['--vsix'],
    output: values['--output'],
    timeout,
  };
}
