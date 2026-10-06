import type { WorkspaceListInput } from '@codocs/workspace';
import { z } from 'zod';
import { guideTopics } from '../guide/domain-values.js';

const userFields = z.record(z.string(), z.unknown());

/** 직접 호출의 접근자·희소 배열·회수된 Proxy를 실행 전에 거부한다. */
function dataOnly(input: unknown, ancestors = new Set<object>()): boolean {
  if (input === null || ['string', 'boolean'].includes(typeof input))
    return true;
  if (typeof input === 'number') return Number.isFinite(input);
  if (typeof input !== 'object') return false;
  try {
    if (ancestors.has(input)) return false;
    const array = Array.isArray(input);
    const prototype: unknown = Object.getPrototypeOf(input);
    if (!array && prototype !== Object.prototype && prototype !== null)
      return false;
    ancestors.add(input);
    const keys = Reflect.ownKeys(input);
    if (array && keys.length !== input.length + 1) return false;
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        typeof key !== 'string' ||
        !descriptor?.enumerable ||
        !('value' in descriptor)
      )
        return false;
      if (
        array &&
        (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= input.length)
      )
        return false;
      if (!dataOnly(descriptor.value, ancestors)) return false;
    }
    ancestors.delete(input);
    return true;
  } catch {
    return false;
  }
}

/** 공개 도구 이름에 대응하는 입력 타입이다. */
export type CodocsToolName =
  | 'codocs_list'
  | 'codocs_get'
  | 'codocs_refresh'
  | 'codocs_validate'
  | 'codocs_guide'
  | 'codocs_write'
  | 'codocs_rename';

const listSchema = z.strictObject({ parent: z.string().optional() });
const getSchema = z.strictObject({ addresses: z.array(z.string()) });
const validateSchema = z.strictObject({ path: z.string().optional() });
const guideSchema = z.strictObject({ topic: z.enum(guideTopics).optional() });
const writeSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('create'),
    path: z.string(),
    document: userFields,
  }),
  z.strictObject({
    mode: z.literal('update'),
    id: z.string(),
    revision: z.string(),
    set: userFields.optional(),
    unset: z.array(z.string()).optional(),
  }),
  /** 문서 전체를 교체한다. set·unset과 섞을 수 없고 알 수 없는 속성은 거부한다. */
  z.strictObject({
    mode: z.literal('replace'),
    id: z.string(),
    revision: z.string(),
    document: userFields,
  }),
]);

const renameBase = {
  id: z.string().min(1),
  /** 있으면 이 문서의 최상위 섹션 이름 변경이며 newName은 새 섹션 이름이다. */
  section: z.string().min(1).optional(),
  newName: z.string(),
  selections: z
    .array(
      z.strictObject({
        sourcePath: z.string(),
        occurrenceIndex: z.number().int().nonnegative(),
        targetPath: z.string(),
      }),
    )
    .optional(),
};
const renameSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('preview'), ...renameBase }),
  z.strictObject({
    mode: z.literal('apply'),
    ...renameBase,
    revisions: z.record(z.string(), z.string().min(1)),
  }),
]);

/** 형식만 확인해 문서 자체의 상세 검증 진단은 변경 계획에 맡긴다. */
export function parseWriteInput(
  input: unknown,
): z.infer<typeof writeSchema> | undefined {
  if (!dataOnly(input)) return undefined;
  const result = writeSchema.safeParse(input);
  return result.success ? result.data : undefined;
}

/** 이름 변경 입력의 형식만 확인한다. 이름 충돌과 선택의 유효성은 workspace 계산에 맡긴다. */
export function parseRenameInput(
  input: unknown,
): z.infer<typeof renameSchema> | undefined {
  if (!dataOnly(input)) return undefined;
  const result = renameSchema.safeParse(input);
  return result.success ? result.data : undefined;
}

/** 일곱 도구의 공개 입력 계약이다. 등록 여부와 별개로 같은 원본을 검증에 사용한다.
 * */
export const codocsInputSchemas = new Map<CodocsToolName, z.ZodType>([
  ['codocs_list', listSchema],
  ['codocs_get', getSchema],
  ['codocs_refresh', z.strictObject({})],
  ['codocs_validate', validateSchema],
  ['codocs_guide', guideSchema],
  ['codocs_write', writeSchema],
  ['codocs_rename', renameSchema],
]);

/** SDK에 제공하는 JSON Schema는 실행 검증과 동일한 Zod 원본에서 생성한다.
 * */
export function codocsJsonInputSchema(
  name: CodocsToolName,
): Record<string, unknown> {
  return {
    ...(name === 'codocs_write' || name === 'codocs_rename'
      ? { type: 'object' }
      : {}),
    ...z.toJSONSchema(codocsInputSchemas.get(name)!),
  };
}

/** 목록 입력을 알 수 없는 속성 없이 보존한다. */
export function parseListInput(input: unknown): WorkspaceListInput | undefined {
  if (!dataOnly(input)) return undefined;
  const result = listSchema.safeParse(input);
  if (!result.success) return undefined;
  const { parent } = result.data;
  return parent === undefined ? {} : { parent };
}

/** 이름 주소를 첫 등장 순서로 중복 제거한 뒤 1~20개를 허용한다. 주소 문법은 조회에서 주소마다 판정한다.
 * */
export function parseGetInput(
  input: unknown,
): { addresses: string[] } | undefined {
  if (!dataOnly(input)) return undefined;
  const result = getSchema.safeParse(input);
  if (!result.success) return undefined;
  const addresses = [...new Set(result.data.addresses)];
  return addresses.length >= 1 && addresses.length <= 20
    ? { addresses }
    : undefined;
}

/** 선택 경로를 입력 그대로 보존하며 알 수 없는 속성은 거부한다. */
export function parseValidateInput(
  input: unknown,
): { path?: string } | undefined {
  if (!dataOnly(input)) return undefined;
  const result = validateSchema.safeParse(input);
  if (!result.success) return undefined;
  return result.data.path === undefined ? {} : { path: result.data.path };
}

/** 생략한 주제를 보존하고 주제 원본에 없는 값과 알 수 없는 속성을 거부한다. */
export function parseGuideInput(
  input: unknown,
): z.infer<typeof guideSchema> | undefined {
  if (!dataOnly(input)) return undefined;
  const result = guideSchema.safeParse(input);
  return result.success ? result.data : undefined;
}

/** 입력 형태만 확인하고 문서 내용 진단은 변경 계획에 맡긴다. */
export function acceptsToolInput(
  name: CodocsToolName,
  input: unknown,
): boolean {
  if (!dataOnly(input)) return false;
  if (name === 'codocs_get') return parseGetInput(input) !== undefined;
  if (name === 'codocs_list') return parseListInput(input) !== undefined;
  if (name === 'codocs_validate')
    return parseValidateInput(input) !== undefined;
  const result = codocsInputSchemas.get(name)!.safeParse(input);
  if (!result.success) return false;
  return true;
}
