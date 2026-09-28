import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Windows 장치 경로 대신 실행별 빈 일반 파일로 사용자 Git 설정을 격리한다. */
export function createGitFixtureEnvironment() {
  // 커밋 훅의 저장소·index·설정 환경을 fixture로 넘기지 않는다.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/iu.test(key)),
  );
  const directory = mkdtempSync(path.join(os.tmpdir(), 'codocs-git-config-'));
  const config = path.join(directory, 'empty.gitconfig');
  writeFileSync(config, '');
  process.once(
    'exit',
    /** 이 프로세스가 만든 설정만 모든 하위 실행 종료 뒤 정리한다. */ () => {
      rmSync(directory, { recursive: true, force: true });
    },
  );
  return {
    ...environment,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.autocrlf',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.longpaths',
    GIT_CONFIG_VALUE_1: 'true',
  };
}
