import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** 명시한 VS Code 앱 또는 GUI 실행 파일의 버전과 CLI 진입점을 확인한다. */
export async function resolveRuntime(input, platform = process.platform) {
  const target = await realpath(input);
  let executable;
  let resources;
  if (platform === 'darwin') {
    const application = target.endsWith('.app')
      ? target
      : target.slice(0, target.indexOf('.app/') + 4);
    if (!application.endsWith('.app'))
      throw new Error('VS Code .app 경로가 필요합니다.');
    resources = path.join(application, 'Contents/Resources/app');
    const product = JSON.parse(
      await readFile(path.join(resources, 'product.json'), 'utf8'),
    );
    const pkg = JSON.parse(
      await readFile(path.join(resources, 'package.json'), 'utf8'),
    );
    executable = path.join(
      application,
      'Contents/MacOS',
      Number(pkg.version.split('.')[1]) <= 109 ? 'Electron' : product.nameShort,
    );
  } else {
    executable = target;
    resources = path.join(path.dirname(target), 'resources/app');
  }
  const pkg = JSON.parse(
    await readFile(path.join(resources, 'package.json'), 'utf8'),
  );
  const cli = path.join(resources, 'out/cli.js');
  await Promise.all([access(executable), access(cli)]);
  return { executable, cli, version: pkg.version };
}

/** 반복 가능한 GUI 경로와 VSIX, 결과 위치 및 Playwright 전달 인자를 읽는다. */
export function parseArguments(args) {
  const options = { codePaths: [], playwright: [] };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--') {
      options.playwright = args.slice(i + 1);
      break;
    }
    if (name === '--help') return { help: true };
    if (!['--code-path', '--vsix', '--output'].includes(name))
      throw new Error(`알 수 없는 옵션: ${name}`);
    const value = args[++i];
    if (!value || value.startsWith('--'))
      throw new Error(`${name} 값이 필요합니다.`);
    if (name === '--code-path') options.codePaths.push(value);
    else options[name.slice(2)] = value;
  }
  if (!options.vsix || !options.codePaths.length)
    throw new Error('--vsix와 하나 이상의 --code-path가 필요합니다.');
  return options;
}
