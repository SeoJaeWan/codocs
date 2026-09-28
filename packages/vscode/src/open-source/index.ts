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

/** 현재 확장 실행의 최근 실패만 기억하여 반복 클릭 로그를 억제한다. */
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

/** 외부 입력에서 source URI와 서버 토큰의 형태를 확인한다. */
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

/** 최신 선택 확인 후 기존 dirty buffer를 보존하며 (0,0) 빈 선택으로 연다. */
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
    const viewColumn = host.findExistingViewColumn(uri);
    phase = openSourceFailureReasons.displayFailed;
    await host.showDocument(document, {
      preview: false,
      ...(viewColumn === undefined ? {} : { viewColumn }),
      selection: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
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
/** 알 수 없는 throw 값도 Output에 기록할 문자열로 바꾼다. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
