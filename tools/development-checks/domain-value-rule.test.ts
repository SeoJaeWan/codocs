import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
const preamble = `import { referenceResolutionStatuses, scanStatuses, type ReferenceResolution, type ReferenceResolutionStatus, type ScanStatus } from '@codocs/core';\n`;

/** 실제 프로젝트 타입 해석으로 도메인 규칙만 검사한다. */
async function domainMessages(code: string): Promise<string[]> {
  const results = await eslint.lintText(preamble + code, {
    filePath: path.join(process.cwd(), 'packages/workspace/src/index.ts'),
  });
  expect(
    results.flatMap((result) =>
      result.messages.filter((message) => message.fatal),
    ),
  ).toEqual([]);
  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === 'codocs/no-raw-domain-value')
      .map((message) => message.message),
  );
}

describe('도메인 값의 선언 문맥 검사', /** raw 값과 일반 문자열을 구별한다. */ () => {
  it.each([
    `const result: ReferenceResolution = { status: 'ambiguous', candidates: [] };`,
    `const result = { status: 'ambiguous', candidates: [] } satisfies ReferenceResolution;`,
    `declare let result: ReferenceResolution; result.status = 'ambiguous';`,
    `declare const result: ReferenceResolution; result.status === 'ambiguous';`,
    `declare const result: ReferenceResolution; result['status'] === 'ambiguous';`,
    `declare function use(value: ReferenceResolutionStatus): void; use('ambiguous');`,
    `function value(): ReferenceResolutionStatus { return 'ambiguous'; }`,
    `const value = (): ReferenceResolutionStatus => 'ambiguous';`,
    `const value: ReferenceResolutionStatus = 'ambiguous';`,
    `declare const result: ReferenceResolution; switch (result.status) { case 'ambiguous': break; }`,
    `const value: { status: typeof scanStatuses.partial } = { status: 'partial' };`,
    `declare const flag: boolean; const value: ScanStatus = flag ? 'partial' : scanStatuses.complete;`,
    `const value: ReferenceResolutionStatus = 'ambiguous' as const;`,
    `const value: ReferenceResolutionStatus | undefined = 'ambiguous';`,
    `const values: ReferenceResolutionStatus[] = ['ambiguous'];`,
    `type Alias = ReferenceResolutionStatus; const value: Alias = 'ambiguous';`,
    'const value: ReferenceResolutionStatus = `ambiguous`;',
    `declare const result: ReferenceResolution; if (result.status !== referenceResolutionStatuses.invalid) result.status === 'ambiguous';`,
    `function value(): ReferenceResolution { return { status: 'ambiguous', candidates: [] }; }`,
    `const value: { nested: ReferenceResolution } = { nested: { status: 'ambiguous', candidates: [] } };`,
  ])('도메인 문맥의 직접 문자열을 거부한다: %s', async (code) => {
    expect(await domainMessages(code)).toHaveLength(1);
  });
  it.each([
    `const title = 'ambiguous';`,
    `declare const result: ReferenceResolution; const text = result.status + 'ambiguous';`,
    `const value: { status: string } = { status: 'ambiguous' };`,
    `type Other = 'ambiguous' | 'missing'; const value: Other = 'ambiguous';`,
    `const result = { status: 'ambiguous' };`,
    `const result: ReferenceResolution = { status: referenceResolutionStatuses.ambiguous, candidates: [] };`,
    `import { referenceResolutionStatuses as values } from '@codocs/core'; const value: ReferenceResolutionStatus = values.ambiguous;`,
    `declare const other: ReferenceResolution; const value: ReferenceResolutionStatus = other.status;`,
    `declare function read(): ReferenceResolutionStatus; const value: ReferenceResolutionStatus = read();`,
    `const input = 'status: ambiguous';`,
    `const value = 'utf8'; typeof value === 'string';`,
  ])('원본 상수·기존 값·일반 문자열을 허용한다: %s', async (code) => {
    expect(await domainMessages(code)).toEqual([]);
  });
  it('같은 철자라도 선언이 연결된 도메인을 안내한다', /** 다른 confirmed 의미를 혼동하지 않는다. */ async () => {
    const code = `import { type CatalogConfirmation, type DocumentStatus } from '@codocs/core';
const observed: CatalogConfirmation = 'confirmed';
const document: DocumentStatus = 'confirmed';`;
    const messages = await domainMessages(code);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('catalogConfirmations.confirmed');
    expect(messages[1]).toContain('documentStatuses.confirmed');
  });
});

it('자동 수정은 import 별칭을 보존하고 불필요한 const 단언을 제거한다', /** 실제 수정 결과를 다시 검사한다. */ async () => {
  const fixing = new ESLint({ cwd: process.cwd(), fix: true });
  const results = await fixing.lintText(
    `import { referenceResolutionStatuses as values, type ReferenceResolutionStatus } from '@codocs/core';
const value: ReferenceResolutionStatus = 'ambiguous' as const;
console.log(value);`,
    { filePath: path.join(process.cwd(), 'packages/workspace/src/index.ts') },
  );
  expect(results[0]?.output).toContain('values.ambiguous');
  expect(results[0]?.output).not.toContain('as const');
  expect(
    results[0]?.messages.filter(
      (message) => message.ruleId === 'codocs/no-raw-domain-value',
    ),
  ).toEqual([]);
});

it('type-only import를 값으로 사용하는 잘못된 자동 수정을 하지 않는다', /** 수정 불가능한 사용은 진단만 남긴다. */ async () => {
  const fixing = new ESLint({ cwd: process.cwd(), fix: true });
  const results = await fixing.lintText(
    `import type { referenceResolutionStatuses, ReferenceResolutionStatus } from '@codocs/core';
const value: ReferenceResolutionStatus = 'ambiguous';
console.log(value);`,
    { filePath: path.join(process.cwd(), 'packages/workspace/src/index.ts') },
  );
  expect(
    results[0]?.messages.filter(
      (message) => message.ruleId === 'codocs/no-raw-domain-value',
    ),
  ).toHaveLength(1);
  expect(results[0]?.output).toBeUndefined();
});
