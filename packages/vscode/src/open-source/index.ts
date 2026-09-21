import { createHash } from 'node:crypto';

/** 언어 서버와 JSON command URI로 공유하는 원문 열기 명령 이름이다. */
export const openSourceCommand = 'codocs.openSource';

/** VS Code와 LSP가 공유하는 UTF-16 좌표다. */
export interface OpenSourcePosition {
  line: number;
  character: number;
}

/** 언어 서버가 확인한 원문 좌표 계약이다. */
export interface OpenSourceRange {
  start: OpenSourcePosition;
  end: OpenSourcePosition;
}

/** command URI가 전달하는 확인된 원문 관측 계약이다. */
export interface OpenSourceCommandArgument {
  uri: string;
  range?: OpenSourceRange;
  catalogVersion: number;
  revision?: string;
}

/** 원문 열기 경계가 현재 editor buffer에서 관찰한 문서다. */
export interface OpenSourceDocument {
  uri: string;
  text: string;
}

/** 기존 탭 재사용과 선택 적용에 필요한 editor 표시 옵션이다. */
export interface OpenSourceShowOptions {
  preview: false;
  viewColumn?: number;
  selection?: OpenSourceRange;
}

/** 원문 열기를 실제 editor API와 분리한 VS Code host 경계다. */
export interface OpenSourceHost<
  Document extends OpenSourceDocument = OpenSourceDocument,
> {
  findOpenDocument: (uri: string) => Document | undefined;
  findExistingViewColumn: (uri: string) => number | undefined;
  openDocument: (uri: string) => Promise<Document>;
  showDocument: (
    document: Document,
    options: OpenSourceShowOptions,
  ) => Promise<void>;
}

/** unknown 명령 인자를 language-server의 JSON command 계약으로 검증한다. */
function validArgument(value: unknown): value is OpenSourceCommandArgument {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<OpenSourceCommandArgument>;
  try {
    if (
      typeof candidate.uri !== 'string' ||
      new URL(candidate.uri).protocol !== 'file:' ||
      !Number.isSafeInteger(candidate.catalogVersion) ||
      (candidate.catalogVersion ?? -1) < 0
    )
      return false;
  } catch {
    return false;
  }
  if (
    candidate.revision !== undefined &&
    (typeof candidate.revision !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(candidate.revision))
  )
    return false;
  const range = candidate.range;
  if (range === undefined) return true;
  if (typeof range !== 'object' || range === null) return false;
  const parts = [
    range.start?.line,
    range.start?.character,
    range.end?.line,
    range.end?.character,
  ];
  if (!parts.every((part) => Number.isSafeInteger(part) && Number(part) >= 0))
    return false;
  return (
    range.start.line < range.end.line ||
    (range.start.line === range.end.line &&
      range.start.character <= range.end.character)
  );
}

/** VS Code와 LSP가 공유하는 UTF-16 좌표가 현재 editor 원문 안에 있는지 확인한다. */
export function rangeFitsText(text: string, range: OpenSourceRange): boolean {
  const lines = text.split(/\r\n|\r|\n/u);
  /** 한 좌표가 현재 줄의 UTF-16 길이를 넘지 않는지 확인한다. */
  const fits = (position: OpenSourceRange['start']): boolean => {
    const line = lines[position.line];
    return line !== undefined && position.character <= line.length;
  };
  return fits(range.start) && fits(range.end);
}

/** SDK Hover contents의 Markdown 배열에서 생성한 원문 링크만 허용한다. */
export function trustGeneratedOpenSourceHoverContents(contents: unknown): void {
  const items: readonly unknown[] = Array.isArray(contents)
    ? (contents as readonly unknown[])
    : [contents];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const markdown = item as Record<string, unknown>;
    if (
      typeof markdown.value !== 'string' ||
      !markdown.value.includes(`](command:${openSourceCommand}?`)
    )
      continue;
    markdown.isTrusted = { enabledCommands: [openSourceCommand] };
  }
}

/** 현재 editor text를 원문과 같은 UTF-8 byte revision으로 계산한다. */
function editorRevision(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 검증된 URI의 원문 탭을 재사용하고 확인 가능한 범위만 선택한다. */
export async function openSource<Document extends OpenSourceDocument>(
  argument: unknown,
  host: OpenSourceHost<Document>,
): Promise<boolean> {
  if (!validArgument(argument)) return false;
  const existing = host.findOpenDocument(argument.uri);
  const document = existing ?? (await host.openDocument(argument.uri));
  const viewColumn = host.findExistingViewColumn(argument.uri);
  const selection =
    argument.range &&
    argument.revision !== undefined &&
    editorRevision(document.text) === argument.revision &&
    rangeFitsText(document.text, argument.range)
      ? argument.range
      : undefined;
  await host.showDocument(document, {
    preview: false,
    ...(viewColumn === undefined ? {} : { viewColumn }),
    ...(selection === undefined ? {} : { selection }),
  });
  return true;
}
