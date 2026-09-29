import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  buildCatalog,
  parseYaml,
  validateDocument,
  scanStatuses,
  referenceResolutionStatuses,
} from '@codocs/core';

it('배포 원본 예제 네 개는 유효하고 명시한 참조·역참조 관계를 유지한다', () => {
  const directory = path.resolve('examples/.codocs');
  const files = readdirSync(directory)
    .filter((file) => /\.ya?ml$/u.test(file))
    .sort();
  expect(files).toEqual([
    'fulfillment.yaml',
    'order.yaml',
    'receipt.yaml',
    'shipping-policy.yaml',
  ]);
  const expected: Record<
    string,
    { references: string[]; referencedBy: string[]; occurrences: number }
  > = {
    'sample-fulfillment': {
      references: ['sample-order', 'sample-shipping-policy'],
      referencedBy: ['sample-order'],
      occurrences: 2,
    },
    'sample-order': {
      references: ['sample-fulfillment', 'sample-receipt'],
      referencedBy: [
        'sample-fulfillment',
        'sample-receipt',
        'sample-shipping-policy',
      ],
      occurrences: 2,
    },
    'sample-receipt': {
      references: ['sample-order'],
      referencedBy: ['sample-order'],
      occurrences: 1,
    },
    'sample-shipping-policy': {
      references: ['sample-order'],
      referencedBy: ['sample-fulfillment'],
      occurrences: 1,
    },
  };
  const observations = files.map((file) => {
    const parsed = parseYaml(
      readFileSync(path.join(directory, file), 'utf8'),
      file,
    );
    if (!parsed.success) throw new Error(JSON.stringify(parsed.diagnostics));
    const validated = validateDocument({
      data: parsed.data,
      source: parsed.source,
      fields: parsed.fields,
      path: file,
      ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
    });
    expect(validated.errors).toEqual([]);
    expect(validated.warnings).toEqual([]);
    return { path: file, parsed };
  });
  const catalog = buildCatalog({ status: scanStatuses.complete, observations });
  expect(catalog.documents.size).toBe(4);
  for (const document of catalog.documents.values()) {
    if (document.id === undefined) throw new Error('배포 예제에 ID가 없다');
    const contract = expected[document.id]!;
    expect(document.references.map((value) => value.id).sort()).toEqual(
      contract.references,
    );
    expect(document.referencedBy.map((value) => value.id).sort()).toEqual(
      contract.referencedBy,
    );
    expect(document.occurrences).toHaveLength(contract.occurrences);
    expect(
      document.occurrences.every(
        (item) =>
          item.resolution.status === referenceResolutionStatuses.resolved,
      ),
    ).toBe(true);
    expect(
      document.diagnostics.map((issue) => [issue.code, issue.severity]),
    ).toEqual(
      document.id === 'sample-order'
        ? [['deprecated_reference', 'warning']]
        : [],
    );
  }
});
