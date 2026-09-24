import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureEslint } from '../test/support/eslint.js';

const eslint = createFixtureEslint();
const preamble = `import { referenceResolutionStatuses, scanStatuses, type ReferenceResolution, type ReferenceResolutionStatus, type ScanStatus } from '@codocs/core';\n`;

describe('도메인 값 ESLint 규칙: 선언 문맥 검사', () => {
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
  ])(
    '도메인 선언 문맥에 %s를 쓰면 직접 문자열 사용을 진단한다',
    async (code) => {
      const results = await eslint.lintText(preamble + code, {
        filePath: path.join(process.cwd(), 'packages/workspace/src/index.ts'),
      });
      const messages = results.flatMap((result) => result.messages);
      expect(messages.filter((message) => message.fatal)).toEqual([]);
      expect(
        messages.filter(
          (message) => message.ruleId === 'codocs/no-raw-domain-value',
        ),
      ).toHaveLength(1);
    },
  );
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
  ])(
    '상수나 일반 문자열로 %s를 쓰면 도메인 값 오류를 진단하지 않는다',
    async (code) => {
      const results = await eslint.lintText(preamble + code, {
        filePath: path.join(process.cwd(), 'packages/workspace/src/index.ts'),
      });
      const messages = results.flatMap((result) => result.messages);
      expect(messages.filter((message) => message.fatal)).toEqual([]);
      expect(
        messages.filter(
          (message) => message.ruleId === 'codocs/no-raw-domain-value',
        ),
      ).toEqual([]);
    },
  );
  it('같은 confirmed 문자열을 서로 다른 도메인에 쓰면 각 선언의 상수를 안내한다', async () => {
    const code = `import { type CatalogConfirmation, type DocumentStatus } from '@codocs/core';
const observed: CatalogConfirmation = 'confirmed';
const document: DocumentStatus = 'confirmed';`;
    const results = await eslint.lintText(preamble + code, {
      filePath: path.join(process.cwd(), 'packages/workspace/src/index.ts'),
    });
    const messages = results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId === 'codocs/no-raw-domain-value')
        .map((message) => message.message),
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('catalogConfirmations.confirmed');
    expect(messages[1]).toContain('documentStatuses.confirmed');
  });
});

describe('도메인 값 ESLint 규칙: 자동 수정', () => {
  it('별칭으로 가져온 상수가 있으면 직접 문자열을 별칭 상수로 수정한다', async () => {
    const fixing = createFixtureEslint({ fix: true });
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

  it('type-only import만 있으면 값으로 자동 수정하지 않고 진단을 남긴다', async () => {
    const fixing = createFixtureEslint({ fix: true });
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
});
