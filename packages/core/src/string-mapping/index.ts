import { CST, isMap, isScalar, isSeq } from 'yaml';
import type { FieldPath, OffsetRange } from '../diagnostics/index.js';

/** 해석 문자열의 각 UTF-16 코드 단위를 실제 스칼라 원문 구간에 연결한다. AST/CST는 공개하지 않는다. @codocs [[문자열 위치 대응]] */
export interface StringSourceMapping {
  fieldPath: FieldPath;
  value: string;
  sourceRanges: readonly OffsetRange[];
}
/** 문자열 변환 중 원문 기여 구간을 유지하는 내부 코드 단위다. */
interface Unit extends OffsetRange {
  value: string;
}
/** 실제 개행과 들여쓰기를 따로 보존한 스칼라 줄이다. */
interface ScalarLine {
  indent: Unit[];
  content: Unit[];
  newline: Unit[];
}
/** 긴 본문에서도 함수 호출의 인수 상한을 넘지 않고 코드 단위를 추가한다. */
function append(target: Unit[], ...parts: readonly Unit[][]): void {
  for (const part of parts) for (const unit of part) target.push(unit);
}
/** 원문 코드 단위를 직접 토큰 offset에 연결한다. */
function units(source: string, offset: number): Unit[] {
  const result: Unit[] = [];
  for (let index = 0; index < source.length; index++)
    result.push({
      value: source[index] ?? '',
      start: offset + index,
      end: offset + index + 1,
    });
  return result;
}
/** 변환된 문자열의 각 코드 단위에 동일한 실제 기여 구간을 연결한다. */
function replacement(value: string, contributing: readonly Unit[]): Unit[] {
  const first = contributing[0];
  const last = contributing[contributing.length - 1];
  if (!first || !last) return [];
  return units(value, 0).map(
    /** 변환 문자의 실제 기여 구간을 복사한다. */ (unit) => ({
      value: unit.value,
      start: first.start,
      end: last.end,
    }),
  );
}
/** 코드 단위의 문자열을 재구성한다. */
function text(value: readonly Unit[]): string {
  return value.map((unit) => unit.value).join('');
}
/** 토큰 원문 줄을 CRLF와 LF 구간을 보존하며 나눈다. */
function splitLines(value: Unit[]): ScalarLine[] {
  const result: ScalarLine[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index < value.length && value[index]?.value !== '\n') continue;
    const crlf = value[index - 1]?.value === '\r' && index < value.length;
    const end = crlf ? index - 1 : index;
    const line = value.slice(start, end);
    let indent = 0;
    while (line[indent]?.value === ' ') indent++;
    result.push({
      indent: line.slice(0, indent),
      content: line.slice(indent),
      newline: value.slice(end, index < value.length ? index + 1 : index),
    });
    start = index + 1;
  }
  return result;
}
/** flow 줄의 앞뒤 공백과 탭만 YAML 규칙에 따라 제거한다. */
function trimFlow(value: Unit[], leading: boolean, trailing: boolean): Unit[] {
  let start = 0;
  let end = value.length;
  if (leading)
    while (value[start]?.value === ' ' || value[start]?.value === '\t') start++;
  if (trailing)
    while (
      end > start &&
      (value[end - 1]?.value === ' ' || value[end - 1]?.value === '\t')
    )
      end--;
  return value.slice(start, end);
}
/** plain·single quote의 줄 접기를 적용하되 각 문자 기여 구간을 유지한다. */
function unfold(value: Unit[]): Unit[] {
  const lines = splitLines(value);
  if (lines.length === 1) return value;
  const result: Unit[] = [];
  let separator: Unit[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    const content = trimFlow(
      [...line.indent, ...line.content],
      index > 0,
      index < lines.length - 1,
    );
    if (index === 0) append(result, content);
    else if (index === lines.length - 1 || content.length > 0)
      append(result, separator, content);
    else if (text(separator) === '\n') {
      append(result, separator);
      separator = replacement('\n', line.newline);
    } else separator = replacement('\n', [...separator, ...line.newline]);
    if (content.length > 0 || index === 0)
      separator = replacement(' ', line.newline);
  }
  return result;
}
/** single quote의 두 작은따옴표를 한 문자로 해석한다. */
function singleQuoted(value: Unit[]): Unit[] {
  const folded = unfold(value.slice(1, -1));
  const result: Unit[] = [];
  for (let index = 0; index < folded.length; index++) {
    const current = folded[index];
    if (current?.value === "'" && folded[index + 1]?.value === "'") {
      append(result, replacement("'", folded.slice(index, index + 2)));
      index++;
    } else if (current) result.push(current);
  }
  return result;
}
/** double quote의 escape와 줄 접기를 yaml의 공개 scalar 해석으로 확인한다. */
function doubleQuoted(value: Unit[]): Unit[] {
  const result: Unit[] = [];
  for (let index = 1; index < value.length - 1; index++) {
    const current = value[index];
    if (!current) continue;
    if (current.value === '\r' && value[index + 1]?.value === '\n') continue;
    if (current.value === '\n') {
      const start = index;
      let breaks = 0;
      while ([' ', '\t', '\r', '\n'].includes(value[index + 1]?.value ?? '')) {
        if (
          value[index + 1]?.value === '\r' &&
          value[index + 2]?.value !== '\n'
        )
          break;
        if (value[++index]?.value === '\n') breaks++;
      }
      append(
        result,
        replacement(
          breaks ? '\n'.repeat(breaks) : ' ',
          value.slice(start, index + 1),
        ),
      );
    } else if (current.value === '\\') {
      const start = index;
      const next = value[++index]?.value;
      if (
        next === '\n' ||
        (next === '\r' && value[index + 1]?.value === '\n')
      ) {
        if (next === '\r') index++;
        while (
          value[index + 1]?.value === ' ' ||
          value[index + 1]?.value === '\t'
        )
          index++;
        continue;
      }
      // YAML 1.2 숫자 escape의 자릿수다. 실제 해석값은 공개 CST API에서 얻는다.
      const escapeDigits =
        next === 'x' ? 2 : next === 'u' ? 4 : next === 'U' ? 8 : 0;
      index += escapeDigits;
      const raw = value.slice(start, index + 1);
      const resolved = CST.resolveAsScalar({
        type: 'double-quoted-scalar',
        offset: 0,
        indent: 0,
        source: `"${text(raw)}"`,
      });
      if (resolved) append(result, replacement(resolved.value, raw));
    } else if (current.value === ' ' || current.value === '\t') {
      const start = index;
      while (
        value[index + 1]?.value === ' ' ||
        value[index + 1]?.value === '\t'
      )
        index++;
      const next = value[index + 1]?.value;
      if (next !== '\n' && !(next === '\r' && value[index + 2]?.value === '\n'))
        append(result, value.slice(start, index + 1));
    } else result.push(current);
  }
  return result;
}
/** 블록의 들여쓰기·접기·chomping을 원문 줄 단위로 적용한다. */
function blockScalar(token: CST.BlockScalar): Unit[] {
  const headerToken = token.props[0];
  const header =
    headerToken && 'source' in headerToken ? headerToken.source : '';
  const headerLength = token.props.reduce(
    (length, prop) => length + ('source' in prop ? prop.source.length : 0),
    0,
  );
  const lines = splitLines(units(token.source, token.offset + headerLength));
  const sourceEnd = token.offset + headerLength + token.source.length;
  const eof: Unit[] = [{ value: '', start: sourceEnd, end: sourceEnd }];
  const explicitIndent = Number(header.match(/[1-9]/u)?.[0] ?? 0);
  const chomp = header.includes('+') ? '+' : header.includes('-') ? '-' : '';
  let chompStart = lines.length;
  while (chompStart > 0 && lines[chompStart - 1]?.content.length === 0)
    chompStart--;
  const result: Unit[] = [];
  if (chompStart === 0) {
    if (chomp === '+' && token.source.length > 0)
      for (const line of lines.slice(0, Math.max(1, lines.length - 1)))
        append(
          result,
          replacement('\n', line.newline.length ? line.newline : eof),
        );
    return result;
  }
  let trimIndent = token.indent + explicitIndent;
  let contentStart = 0;
  for (let index = 0; index < chompStart; index++) {
    const line = lines[index];
    if (!line) continue;
    if (line.content.length === 0) {
      if (!explicitIndent && line.indent.length > trimIndent)
        trimIndent = line.indent.length;
    } else {
      if (!explicitIndent) trimIndent = line.indent.length;
      contentStart = index;
      break;
    }
  }
  for (let index = lines.length - 1; index >= chompStart; index--)
    if ((lines[index]?.indent.length ?? 0) > trimIndent) {
      chompStart = index + 1;
      break;
    }
  for (const line of lines.slice(0, contentStart))
    append(
      result,
      line.indent.slice(trimIndent),
      replacement('\n', line.newline),
    );
  let separator: Unit[] = [];
  let previousMoreIndented = false;
  for (let index = contentStart; index < chompStart; index++) {
    const line = lines[index];
    if (!line) continue;
    const content = [...line.indent.slice(trimIndent), ...line.content];
    if (header[0] === '|') {
      append(result, separator, content);
      separator = replacement('\n', line.newline);
    } else if (
      line.indent.length > trimIndent ||
      line.content[0]?.value === '\t'
    ) {
      if (text(separator) === ' ') separator = replacement('\n', separator);
      else if (!previousMoreIndented && text(separator) === '\n')
        separator = replacement('\n\n', separator);
      append(result, separator, content);
      separator = replacement('\n', line.newline);
      previousMoreIndented = true;
    } else if (line.content.length === 0) {
      if (text(separator) === '\n') {
        append(result, separator);
        separator = replacement('\n', line.newline);
      } else separator = replacement('\n', [...separator, ...line.newline]);
    } else {
      append(result, separator, line.content);
      separator = replacement(' ', line.newline);
      previousMoreIndented = false;
    }
  }
  const last = lines[chompStart - 1];
  // YAML의 clip/keep는 EOF에 실제 개행이 없어도 마지막 LF를 생성한다.
  const ending: Unit[] = last?.newline.length ? last.newline : eof;
  if (chomp !== '-') append(result, replacement('\n', ending));
  if (chomp === '+') {
    for (let index = chompStart; index < lines.length; index++) {
      const line = lines[index];
      if (!line) continue;
      append(result, line.indent.slice(trimIndent));
      if (index < lines.length - 1)
        append(result, replacement('\n', line.newline));
    }
    if (text(result).slice(-1) !== '\n') append(result, replacement('\n', eof));
  }
  return result;
}
/** 공개 AST/CST의 문자열 스칼라만 매핑하고 해석값 일치가 확인된 결과만 공개한다. @codocs [[문자열 위치 대응]]#L18-L25 */
export function collectStringMappings(
  value: unknown,
  fieldPath: FieldPath,
  mappings: StringSourceMapping[],
): void {
  if (isMap(value)) {
    for (const pair of value.items)
      if (isScalar(pair.key))
        collectStringMappings(
          pair.value,
          [...fieldPath, String(pair.key.value)],
          mappings,
        );
  } else if (isSeq(value)) {
    for (let index = 0; index < value.items.length; index++)
      collectStringMappings(
        value.items[index],
        [...fieldPath, index],
        mappings,
      );
  } else if (
    isScalar(value) &&
    typeof value.value === 'string' &&
    value.srcToken &&
    CST.isScalar(value.srcToken)
  ) {
    const token = value.srcToken;
    const raw = units(token.source, token.offset);
    const mapped =
      token.type === 'block-scalar'
        ? blockScalar(token)
        : token.type === 'single-quoted-scalar'
          ? singleQuoted(raw)
          : token.type === 'double-quoted-scalar'
            ? doubleQuoted(raw)
            : unfold(raw);
    if (text(mapped) === value.value)
      mappings.push({
        fieldPath,
        value: value.value,
        sourceRanges: mapped.map(({ start, end }) => ({ start, end })),
      });
  }
}
