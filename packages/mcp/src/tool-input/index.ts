import {
  documentKinds,
  documentStatuses,
  validateDocument,
} from '@codocs/core';
import type { WorkspaceListInput } from '@codocs/workspace';
import { z } from 'zod';

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
  | 'codocs_write';

const listSchema = z.strictObject({
  cursor: z.string().optional(),
  domain: z.string().optional(),
  kind: z.enum(documentKinds).optional(),
  status: z.enum(documentStatuses).optional(),
});
const getSchema = z.strictObject({ ids: z.array(z.string().min(1)) });
const validateSchema = z.strictObject({ path: z.string().optional() });
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
]);

/** 여섯 도구의 공개 입력 계약이다. 등록 여부와 별개로 같은 원본을 검증에 사용한다. */
export const codocsInputSchemas = new Map<CodocsToolName, z.ZodType>([
  ['codocs_list', listSchema],
  ['codocs_get', getSchema],
  ['codocs_refresh', z.strictObject({})],
  ['codocs_validate', validateSchema],
  [
    'codocs_guide',
    z.strictObject({
      topic: z
        .enum([
          'overview',
          'schema',
          'writing',
          'examples',
          'updating',
          'validation',
        ])
        .optional(),
    }),
  ],
  ['codocs_write', writeSchema],
]);

/** SDK에 제공하는 JSON Schema는 실행 검증과 동일한 Zod 원본에서 생성한다. */
export function codocsJsonInputSchema(
  name: CodocsToolName,
): Record<string, unknown> {
  return z.toJSONSchema(codocsInputSchemas.get(name)!);
}

/** 목록 입력을 알 수 없는 속성 없이 보존한다. */
export function parseListInput(input: unknown): WorkspaceListInput | undefined {
  if (!dataOnly(input)) return undefined;
  const result = listSchema.safeParse(input);
  if (!result.success) return undefined;
  const { cursor, domain, kind, status } = result.data;
  return {
    ...(cursor === undefined ? {} : { cursor }),
    ...(domain === undefined ? {} : { domain }),
    ...(kind === undefined ? {} : { kind }),
    ...(status === undefined ? {} : { status }),
  };
}

/** ID를 첫 등장 순서로 중복 제거한 뒤 1~20개를 허용한다. */
export function parseGetInput(input: unknown): { ids: string[] } | undefined {
  if (!dataOnly(input)) return undefined;
  const result = getSchema.safeParse(input);
  if (!result.success) return undefined;
  const ids = [...new Set(result.data.ids)];
  return ids.length >= 1 && ids.length <= 20 ? { ids } : undefined;
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

/** 입력 필드와 기존 문서 구조를 확인하되 사용자 필드를 보존한다. */
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
  if (name !== 'codocs_write') return true;
  const request = writeSchema.parse(input);
  return (
    request.mode === 'update' ||
    validateDocument({ data: request.document }).success
  );
}
