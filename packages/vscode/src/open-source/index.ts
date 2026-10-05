import {
  openSourceFailureReasons,
  type OpenSourceFailureReason,
} from './domain-values.js';

export { openSourceFailureReasons } from './domain-values.js';

/** 서버가 생성하는 유일한 원문 명령과 검증 요청이다. */
export const openSourceCommand = 'codocs.openSource';
export const confirmSourceMethod = 'codocs/confirmSource';
export const snapshotChangedMethod = 'codocs/snapshotChanged';

/** 출처 서버가 발급한 불투명 후보 선택이다. */
export interface OpenSourceCommandArgument {
  sourceUri: string;
  token: string;
}
/** VS Code와 LSP가 공유하는 UTF-16 좌표다. */
export interface OpenSourcePosition {
  line: number;
  character: number;
}
/** 편집기에 적용할 빈 선택의 범위다. */
export interface OpenSourceRange {
  start: OpenSourcePosition;
  end: OpenSourcePosition;
}
/** 원문 열기 경계의 현재 editor buffer다. */
export interface OpenSourceDocument {
  uri: string;
  text: string;
}
/** 기존 탭 재사용과 빈 선택을 적용하는 표시 옵션이다. */
export interface OpenSourceShowOptions {
  preview: false;
  viewColumn?: number;
  selection: OpenSourceRange;
}
/** 서버 확인과 탭 API를 분리하는 host 경계다. */
export interface OpenSourceHost<
  Document extends OpenSourceDocument = OpenSourceDocument,
> {
  confirmSource: (argument: OpenSourceCommandArgument) => Promise<unknown>;
  findOpenDocument: (uri: string) => Document | undefined;
  findExistingViewColumn: (uri: string) => number | undefined;
  openDocument: (uri: string) => Promise<Document>;
  showDocument: (
    document: Document,
    options: OpenSourceShowOptions,
  ) => Promise<void>;
  reportError: (error: unknown) => void;
}

/** 실패 경계에 대응하는 고정 안내 문구다. */
const failureMessages = {
  [openSourceFailureReasons.invalidSelection]:
    '원문 링크 인자가 유효하지 않습니다.',
  [openSourceFailureReasons.sourceInvalidated]:
    '출처 문서 또는 language server 세션이 무효화되었습니다.',
  [openSourceFailureReasons.confirmationRejected]:
    '최신 대상 확인이 거부되었습니다. 링크를 다시 조회하세요.',
  [openSourceFailureReasons.confirmationFailed]:
    '최신 대상 확인 요청에 실패했습니다.',
  [openSourceFailureReasons.fileAccessFailed]:
    '확인된 원문 파일에 접근하지 못했습니다.',
  [openSourceFailureReasons.displayFailed]:
    '확인된 원문을 편집기에 표시하지 못했습니다.',
  [openSourceFailureReasons.destinationUnavailable]:
    '확인된 행·위치가 현재 편집기 원문에 없습니다.',
};

/** 출처를 보존한 사용자 클릭 실패이며 토큰은 출력하지 않는다. */
export class OpenSourceFailure extends Error {
  readonly reason: OpenSourceFailureReason;
  readonly sourceUri: string | undefined;

  /** 원문 이동의 실패 경계와 라이브러리 오류 상세를 함께 보관한다. */
  constructor(
    reason: OpenSourceFailureReason,
    selection?: OpenSourceCommandArgument,
    cause?: unknown,
  ) {
    const detail = cause === undefined ? '' : errorMessage(cause);
    super(`${failureMessages[reason]}${detail ? ` ${detail}` : ''}`, { cause });
    this.name = 'OpenSourceFailure';
    this.reason = reason;
    this.sourceUri = selection?.sourceUri;
  }
}

/** 현재 확장 실행의 최근 실패만 기억하여 반복 클릭 로그를 억제한다.
 * */
export class OpenSourceFailureReporter {
  readonly #appendLine: (message: string) => void;
  readonly #reported = new Set<string>();

  /** Output 쓰기 경계만 받으며 패널 열기나 영구 파일을 만들지 않는다. */
  constructor(appendLine: (message: string) => void) {
    this.#appendLine = appendLine;
  }

  /** 사유·출처·오류 상세가 같은 최근 실패는 한 번만 출력한다. */
  report(error: unknown): void {
    const message =
      error instanceof OpenSourceFailure
        ? `[${error.reason}] ${error.message}${error.sourceUri ? ` 출처: ${error.sourceUri}` : ''}`
        : error instanceof Error
          ? error.message
          : String(error);
    if (this.#reported.has(message)) return;
    this.#reported.add(message);
    if (this.#reported.size > 100)
      this.#reported.delete(this.#reported.values().next().value!);
    this.#appendLine(`Codocs 원문 이동 실패: ${message}`);
  }
}

/** 외부 입력에서 source URI와 서버 토큰의 형태를 확인한다.
 * */
export function validSourceArgument(
  value: unknown,
): value is OpenSourceCommandArgument {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as Partial<OpenSourceCommandArgument>;
  return (
    isFileUri(input.sourceUri) &&
    typeof input.token === 'string' &&
    /^[\w-]{32}$/u.test(input.token)
  );
}

/** file URI 이외의 명령·네트워크 대상은 허용하지 않는다. */
function isFileUri(value: unknown): value is string {
  try {
    return typeof value === 'string' && new URL(value).protocol === 'file:';
  } catch {
    return false;
  }
}

/** 생성한 명령만 Markdown 신뢰 목록에 허용한다. */
export function trustGeneratedOpenSourceHoverContents(contents: unknown): void {
  const items: readonly unknown[] = Array.isArray(contents)
    ? contents
    : [contents];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const markdown = item as Record<string, unknown>;
    if (
      typeof markdown.value === 'string' &&
      markdown.value.includes(`](command:${openSourceCommand}?`)
    )
      markdown.isTrusted = { enabledCommands: [openSourceCommand] };
  }
}

/** 최신 선택 확인 후 기존 dirty buffer를 보존하며 연다. 전체 문서 대상은 (0,0) 빈 선택을 적용하고, 행·위치 대상은 현재 원문에서 그 범위를 선택한다. 확인된 행·위치가 현재 원문에 없으면 선택하지 않고 destination_unavailable 실패를 기록한다.
 * */
export async function openSource<Document extends OpenSourceDocument>(
  argument: unknown,
  host: OpenSourceHost<Document>,
): Promise<boolean> {
  if (!validSourceArgument(argument)) {
    host.reportError(
      new OpenSourceFailure(openSourceFailureReasons.invalidSelection),
    );
    return false;
  }
  let phase: OpenSourceFailureReason =
    openSourceFailureReasons.confirmationFailed;
  try {
    const result = await host.confirmSource(argument);
    if (
      typeof result !== 'object' ||
      result === null ||
      !('uri' in result) ||
      !isFileUri(result.uri)
    ) {
      host.reportError(
        new OpenSourceFailure(
          openSourceFailureReasons.confirmationRejected,
          argument,
        ),
      );
      return false;
    }
    const uri = result.uri;
    phase = openSourceFailureReasons.fileAccessFailed;
    const document =
      host.findOpenDocument(uri) ?? (await host.openDocument(uri));
    const destination =
      'destination' in result ? result.destination : { kind: 'top' };
    const selection = sourceSelection(document.text, destination);
    if (!selection) {
      host.reportError(
        new OpenSourceFailure(
          openSourceFailureReasons.destinationUnavailable,
          argument,
        ),
      );
      return false;
    }
    const viewColumn = host.findExistingViewColumn(uri);
    phase = openSourceFailureReasons.displayFailed;
    await host.showDocument(document, {
      preview: false,
      ...(viewColumn === undefined ? {} : { viewColumn }),
      selection,
    });
    return true;
  } catch (error: unknown) {
    // 확인 뒤의 삭제·권한 변경도 Output에만 기록한다.
    host.reportError(
      error instanceof OpenSourceFailure
        ? error
        : new OpenSourceFailure(phase, argument, error),
    );
    return false;
  }
}

/** 실제 현재 buffer의 두 끝이 존재할 때만 선택하며 범위를 보정하지 않는다.
 * */
export function sourceSelection(
  text: string,
  destination: unknown,
): OpenSourceRange | undefined {
  if (
    typeof destination !== 'object' ||
    destination === null ||
    !('kind' in destination)
  )
    return undefined;
  if (destination.kind === 'top')
    return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const rows = text.split(/\r\n|\r|\n/u);
  if (
    destination.kind === 'rows' &&
    'startLine' in destination &&
    'endLine' in destination
  ) {
    const start = destination.startLine,
      end = destination.endLine;
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end > rows.length
    )
      return undefined;
    return {
      start: { line: start - 1, character: 0 },
      end: { line: end - 1, character: rows[end - 1]!.length },
    };
  }
  if (destination.kind === 'occurrence' && 'range' in destination) {
    const range = destination.range as Partial<OpenSourceRange> | null;
    /** 현재 buffer에 존재하는 실제 UTF-16 끝인지 확인한다. */
    const valid = (
      position: OpenSourcePosition | undefined,
    ): position is OpenSourcePosition =>
      !!position &&
      Number.isSafeInteger(position.line) &&
      Number.isSafeInteger(position.character) &&
      position.line >= 0 &&
      position.line < rows.length &&
      position.character >= 0 &&
      position.character <= rows[position.line]!.length;
    if (
      !range ||
      !valid(range.start) ||
      !valid(range.end) ||
      range.end.line < range.start.line ||
      (range.end.line === range.start.line &&
        range.end.character < range.start.character)
    )
      return undefined;
    if (
      !('markerText' in destination) ||
      typeof destination.markerText !== 'string'
    )
      return undefined;
    const selected =
      range.start.line === range.end.line
        ? rows[range.start.line]!.slice(
            range.start.character,
            range.end.character,
          )
        : [
            rows[range.start.line]!.slice(range.start.character),
            ...rows.slice(range.start.line + 1, range.end.line),
            rows[range.end.line]!.slice(0, range.end.character),
          ].join('\n');
    if (selected !== destination.markerText) return undefined;
    return { start: { ...range.start }, end: { ...range.end } };
  }
  return undefined;
}

/** 알 수 없는 throw 값도 Output에 기록할 문자열로 바꾼다. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
