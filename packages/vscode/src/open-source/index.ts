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
  if (!validSourceArgument(argument)) return false;
  try {
    const result = await host.confirmSource(argument);
    if (
      typeof result !== 'object' ||
      result === null ||
      !('uri' in result) ||
      !isFileUri(result.uri)
    )
      return false;
    const uri = result.uri;
    const document =
      host.findOpenDocument(uri) ?? (await host.openDocument(uri));
    const destination =
      'destination' in result ? result.destination : { kind: 'top' };
    const selection = sourceSelection(document.text, destination);
    if (!selection) return false;
    const viewColumn = host.findExistingViewColumn(uri);
    await host.showDocument(document, {
      preview: false,
      ...(viewColumn === undefined ? {} : { viewColumn }),
      selection,
    });
    return true;
  } catch (error: unknown) {
    // 삭제·권한 변경은 확인 이후에도 발생할 수 있으며 사용자 팝업을 만들지 않는다.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    const name = error instanceof Error ? error.name : undefined;
    if (
      ![
        'ENOENT',
        'EACCES',
        'EPERM',
        'FileNotFound',
        'NoPermissions',
        'Unavailable',
      ].includes(String(code)) &&
      name !== 'FileSystemError'
    )
      host.reportError(error);
    return false;
  }
}

/** 실제 현재 buffer의 두 끝이 존재할 때만 선택하며 범위를 보정하지 않는다. */
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
