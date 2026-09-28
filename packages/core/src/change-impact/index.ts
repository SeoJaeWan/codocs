import {
  codeReferenceDestinationKinds,
  type CodeReferenceDestination,
} from '../code-reference/index.js';
import { changeImpactDiagnosticMessages } from '../diagnostics/index.js';
import {
  changeImpactCertainties,
  changeImpactReasons,
  changeImpactStatuses,
} from './domain-values.js';
export * from './domain-values.js';

/** 이전에 확인한 출현의 식별자와 명시 영역이다. 새 위치는 추론하지 않는다. */
export interface ChangeImpactReference {
  occurrenceId: string;
  destination: CodeReferenceDestination;
  domain?: string;
}
/** 같은 저장의 전후 원문과 대상 해석 자료다. */
export interface ChangeImpactInput {
  before: { raw: string; name: string; domains: readonly string[] };
  after: { raw: string; name: string; domains: readonly string[] };
  references: readonly ChangeImpactReference[];
}
/** 한 출현의 여러 확인 사유를 같은 항목으로 유지한다. */
export interface ChangeImpact {
  occurrenceId: string;
  destination: CodeReferenceDestination;
  certainty: (typeof changeImpactCertainties)[keyof typeof changeImpactCertainties];
  reasons: readonly (typeof changeImpactReasons)[keyof typeof changeImpactReasons][];
}
/** 불완전한 계산에서도 독립적으로 확인한 항목을 보존한다. */
export interface ChangeImpactResult {
  status: (typeof changeImpactStatuses)[keyof typeof changeImpactStatuses];
  impacts: readonly ChangeImpact[];
  failures: readonly string[];
}
interface LineCorrespondence {
  matches: readonly number[];
  canDelete: boolean;
}
const maximumCorrespondenceCells = 4_000_000;

/** 모든 최장 공통 부분열의 대응을 확인해 반복 행을 임의로 선택하지 않는다. */
function lineCorrespondence(
  before: readonly string[],
  after: readonly string[],
): readonly LineCorrespondence[] | undefined {
  const width = after.length + 1;
  const cells = (before.length + 1) * width;
  if (cells > maximumCorrespondenceCells) return undefined;
  const prefix = new Uint32Array(cells);
  const suffix = new Uint32Array(cells);
  for (let i = 0; i < before.length; i++)
    for (let j = 0; j < after.length; j++)
      prefix[(i + 1) * width + j + 1] =
        before[i] === after[j]
          ? prefix[i * width + j]! + 1
          : Math.max(prefix[i * width + j + 1]!, prefix[(i + 1) * width + j]!);
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      suffix[i * width + j] =
        before[i] === after[j]
          ? suffix[(i + 1) * width + j + 1]! + 1
          : Math.max(suffix[(i + 1) * width + j]!, suffix[i * width + j + 1]!);
  const optimum = suffix[0]!;
  return before.map(
    /** 최적 경로에 포함될 수 있는 각 행의 일치·삭제를 모두 모은다. */ (
      line,
      i,
    ) => {
      const matches: number[] = [];
      let canDelete = false;
      for (let j = 0; j <= after.length; j++) {
        if (prefix[i * width + j]! + suffix[(i + 1) * width + j]! === optimum)
          canDelete = true;
        if (
          j < after.length &&
          line === after[j] &&
          prefix[i * width + j]! + 1 + suffix[(i + 1) * width + j + 1]! ===
            optimum
        )
          matches.push(j);
      }
      return { matches, canDelete };
    },
  );
}

/** 원문·이름·도메인 변화에서 명백한 무영향을 제외하고 기존 출현별 사유를 계산한다. */
export function calculateChangeImpact(
  input: ChangeImpactInput,
): ChangeImpactResult {
  const changed = input.before.raw !== input.after.raw;
  const needsRows =
    changed &&
    input.references.some(
      (reference) =>
        reference.destination.kind === codeReferenceDestinationKinds.rows,
    );
  const correspondence = needsRows
    ? lineCorrespondence(
        input.before.raw.split(/\r\n|\r|\n/u),
        input.after.raw.split(/\r\n|\r|\n/u),
      )
    : [];
  const impacts: ChangeImpact[] = [];
  for (const reference of input.references) {
    const reasons: ChangeImpact['reasons'][number][] = [];
    let certainty: ChangeImpact['certainty'] =
      changeImpactCertainties.confirmed;
    if (input.before.name !== input.after.name)
      reasons.push(changeImpactReasons.nameChanged);
    if (
      reference.domain !== undefined &&
      input.before.domains.includes(reference.domain) &&
      !input.after.domains.includes(reference.domain)
    )
      reasons.push(changeImpactReasons.domainChanged);
    const destination = reference.destination;
    if (changed && destination.kind === codeReferenceDestinationKinds.document)
      reasons.push(changeImpactReasons.documentChanged);
    if (
      changed &&
      destination.kind === codeReferenceDestinationKinds.rows &&
      correspondence
    ) {
      const region = correspondence.slice(
        destination.startLine - 1,
        destination.endLine,
      );
      if (region.length !== destination.endLine - destination.startLine + 1)
        throw new RangeError(changeImpactDiagnosticMessages.invalidRegion);
      const ambiguous = region.some(
        (line) =>
          line.matches.length > 1 ||
          (line.matches.length > 0 && line.canDelete),
      );
      if (ambiguous) {
        certainty = changeImpactCertainties.possible;
        reasons.push(changeImpactReasons.ambiguousCorrespondence);
      }
      if (region.some((line) => line.matches.length === 0))
        reasons.push(changeImpactReasons.regionChanged);
      const first = region[0]!;
      if (
        first.matches.length === 1 &&
        !first.canDelete &&
        first.matches[0] !== destination.startLine - 1
      )
        reasons.push(changeImpactReasons.precedingLineShift);
      if (
        !ambiguous &&
        region.every((line) => line.matches.length === 1) &&
        region.some(
          (line, i) =>
            i > 0 && line.matches[0] !== region[i - 1]!.matches[0]! + 1,
        )
      )
        reasons.push(changeImpactReasons.regionChanged);
    }
    if (reasons.length)
      impacts.push({
        occurrenceId: reference.occurrenceId,
        destination,
        certainty,
        reasons,
      });
  }
  return {
    status: correspondence
      ? changeImpactStatuses.complete
      : changeImpactStatuses.incomplete,
    impacts,
    failures: correspondence
      ? []
      : [changeImpactDiagnosticMessages.correspondenceLimit],
  };
}
