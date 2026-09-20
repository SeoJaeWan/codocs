import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const fixtureSchemaVersion = 1;
export const supportedDocumentCounts = [100, 1_000, 5_000, 10_000];

const kinds = ['policy', 'procedure', 'decision', 'discussion'];
const statuses = ['proposed', 'confirmed', 'deprecated'];
const domainCount = 7;

/** Returns the SHA-256 digest of a UTF-8 value. */
export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Produces a deterministic hexadecimal token for one fixture position. */
function token(seed, index) {
  return sha256(`${seed}\0${index}`);
}

/** Returns a stable fixture document and its serialized YAML. */
export function fixtureDocument(seed, index) {
  const key = token(seed, index);
  const ordinal = String(index + 1).padStart(5, '0');
  const id = `cod14-doc-${ordinal}`;
  const name = `COD14 Document ${ordinal} ${key.slice(0, 8)}`;
  const definition = `Deterministic performance document ${ordinal} ${key.slice(8, 24)}.`;
  const domains = [
    `cod14-domain-${Number.parseInt(key.slice(24, 26), 16) % domainCount}`,
  ];
  const kind = kinds[Number.parseInt(key.slice(26, 28), 16) % kinds.length];
  const status =
    statuses[Number.parseInt(key.slice(28, 30), 16) % statuses.length];
  const document = {
    id,
    name,
    definition,
    domains,
    kind,
    status,
    path: `.codocs/document-${ordinal}.yaml`,
  };
  const yaml = [
    `id: ${JSON.stringify(id)}`,
    `name: ${JSON.stringify(name)}`,
    `definition: ${JSON.stringify(definition)}`,
    'domains:',
    `  - ${JSON.stringify(domains[0])}`,
    `kind: ${kind}`,
    `status: ${status}`,
    '',
  ].join('\n');
  return { document, yaml };
}

/** Creates a deterministic fixture, manifest, and expected-value file. */
export async function generateFixture({ directory, documentCount, seed }) {
  if (!supportedDocumentCounts.includes(documentCount))
    throw new Error(
      `Document count must be one of: ${supportedDocumentCounts.join(', ')}`,
    );
  const resolved = path.resolve(directory);
  const codocsDirectory = path.join(resolved, '.codocs');
  await rm(resolved, { recursive: true, force: true });
  await mkdir(codocsDirectory, { recursive: true });

  const documents = [];
  const files = [];
  for (let index = 0; index < documentCount; index++) {
    const { document, yaml } = fixtureDocument(seed, index);
    documents.push(document);
    files.push({ path: document.path, sha256: sha256(yaml) });
    await writeFile(path.join(resolved, document.path), yaml, 'utf8');
  }

  const expectedValues = {
    schemaVersion: fixtureSchemaVersion,
    seed,
    documentCount,
    documents,
  };
  const expectedJson = `${JSON.stringify(expectedValues, null, 2)}\n`;
  const expectedValuesDigest = sha256(JSON.stringify(expectedValues));
  const manifest = {
    schemaVersion: fixtureSchemaVersion,
    generator: 'tools/performance/generator.mjs',
    seed,
    documentCount,
    composition: {
      fileFormat: 'yaml',
      documentsPerFile: 1,
      domainCount,
      kinds,
      statuses,
      references: 'none',
    },
    expectedValuesDigest,
    files,
  };
  const manifestDigest = sha256(JSON.stringify(manifest));
  await writeFile(
    path.join(resolved, 'fixture-manifest.json'),
    `${JSON.stringify({ ...manifest, manifestDigest }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(resolved, 'expected-values.json'),
    expectedJson,
    'utf8',
  );
  return { manifest, manifestDigest, expectedValues, expectedValuesDigest };
}
