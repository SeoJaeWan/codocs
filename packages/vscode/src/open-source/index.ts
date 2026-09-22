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
    const viewColumn = host.findExistingViewColumn(uri);
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
