import { codocsDirectoryName } from '../project-root/index.js';
import {
  discoverCodocsOwners,
  isCodeDirectoryExcluded,
  type CodeCollectionFailure,
  type CodeFilePolicy,
} from './code-file-access.js';
import {
  codocsLocationStates,
  type CodocsLocationState,
} from './domain-values.js';

/** 인정된 하위 .codocs 집합과 판정에 쓴 규칙이다. 루트 .codocs는 항상 인정하므로 담지 않는다. */
export interface CodocsLocations {
  /** 인정된 하위 .codocs의 소유 폴더이며 프로젝트 상대 경로를 `/`로 구분한다. */
  owners: readonly string[];
  /** 위치 판정과 감시 제외에 쓰는 ignore 규칙이다. Git 추적 집합은 비어 있다. */
  policy: CodeFilePolicy;
  /** 규칙을 확인하지 못한 범위다. 비어 있지 않으면 일부 하위 .codocs를 확인하지 못했다. */
  failures: readonly CodeCollectionFailure[];
}

/**
 * .gitignore 계층과 루트 .codocsignore로 제외되지 않은 하위 .codocs를 찾는다. 루트 .codocs는 결과에 넣지 않는다.
 * Git 명령을 실행하지 않고 파일 원문도 읽지 않으며 ignore 확인 실패는 failures로 돌려준다.
 * @param projectRoot 프로젝트 루트 절대 경로다.
 * @param excludedDirectories 통째로 제외할 하위 폴더이며 프로젝트 상대 경로를 `/`로 구분한다. 다른 작업 공간 폴더로 열린 폴더가 해당한다.
 */
export async function discoverCodocsLocations(
  projectRoot: string,
  excludedDirectories: readonly string[] = [],
): Promise<CodocsLocations> {
  const discovered = await discoverCodocsOwners(
    projectRoot,
    excludedDirectories,
  );
  return {
    owners: discovered.owners,
    policy: discovered.policy,
    failures: discovered.failures,
  };
}

/** 경로가 폴더 자신이거나 그 아래인지 확인한다. 빈 폴더는 프로젝트 전체다. */
function isWithinDirectory(relative: string, directory: string): boolean {
  return (
    directory === '' ||
    relative === directory ||
    relative.startsWith(directory + '/')
  );
}

/**
 * 폴더 하나의 항목이 확인하지 못한 규칙 범위에 있는지 판단한다.
 * 루트 .codocsignore 실패는 정책 필드로, 폴더 .gitignore 실패는 unknownIgnoreDirectories로 반영되어 있다.
 * 경로 없는 실패와 폴더 열거 실패는 실패 목록에서 확인한다.
 * @param parent 판정할 항목을 담은 폴더의 프로젝트 상대 경로다.
 */
function isUnknownScope(locations: CodocsLocations, parent: string): boolean {
  const { policy } = locations;
  if (policy.codocsIgnoreUnknown) return true;
  for (const directory of policy.unknownIgnoreDirectories)
    if (isWithinDirectory(parent, directory)) return true;
  return locations.failures.some(
    /** 경로 없는 실패는 전체를, 폴더 열거 실패는 그 폴더 아래를 확인하지 못한 것이다. */ (
      failure,
    ) => {
      if (failure.path === undefined) return true;
      const name = failure.path.slice(failure.path.lastIndexOf('/') + 1);
      if (name === '.gitignore' || name === '.codocsignore') return false;
      return isWithinDirectory(parent, failure.path);
    },
  );
}

/**
 * 소유 폴더의 .codocs가 .gitignore·루트 .codocsignore로 제외되지 않은 위치인지 판정한다. 파일 시스템은 읽지 않는다.
 * 루트 .codocs는 규칙과 무관하게 인정하고, 아직 없는 위치도 규칙으로 판정한다.
 * 바깥 폴더부터 확인하며 먼저 확인하지 못한 범위를 만나면 unknown, 제외된 폴더를 만나면 excluded다.
 * @param locations 마지막으로 확인한 위치 규칙이다. 없으면 하위 .codocs는 unknown이다.
 * @param ownerDirectory .codocs를 담은 폴더의 프로젝트 상대 경로이며 `/`로 구분한다. 빈 문자열은 루트다.
 */
export function classifyCodocsLocation(
  locations: CodocsLocations | undefined,
  ownerDirectory: string,
): CodocsLocationState {
  if (!ownerDirectory) return codocsLocationStates.recognized;
  if (!locations) return codocsLocationStates.unknown;
  if (locations.owners.includes(ownerDirectory))
    return codocsLocationStates.recognized;
  const parts = [...ownerDirectory.split('/'), codocsDirectoryName];
  for (let end = 1; end <= parts.length; end++) {
    if (isUnknownScope(locations, parts.slice(0, end - 1).join('/')))
      return codocsLocationStates.unknown;
    if (
      isCodeDirectoryExcluded(locations.policy, parts.slice(0, end).join('/'))
    )
      return codocsLocationStates.excluded;
  }
  return codocsLocationStates.recognized;
}
