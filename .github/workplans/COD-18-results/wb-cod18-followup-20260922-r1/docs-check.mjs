import assert from 'node:assert/strict';
import {
  loadWorkspace,
  buildWorkspaceCatalog,
} from '../../../../packages/workspace/dist/index.js';
const scan = await loadWorkspace({ cwd: process.cwd() });
assert.equal(scan.status, 'complete');
assert.deepEqual(scan.diagnostics, []);
const catalog = buildWorkspaceCatalog(scan);
const diagnostics = [...catalog.documents.values()].flatMap(
  (item) => item.diagnostics,
);
assert.deepEqual(diagnostics, []);
const seen = new Set();
const pending = ['.codocs/index.yaml'];
while (pending.length) {
  const next = pending.pop();
  if (seen.has(next)) continue;
  seen.add(next);
  const document = catalog.documents.get(next);
  assert.ok(document, next);
  for (const reference of document.references) pending.push(reference.path);
}
const unreachable = [...catalog.documents.keys()].filter(
  (item) => !seen.has(item),
);
assert.deepEqual(unreachable, []);
console.log(
  JSON.stringify({
    scanStatus: scan.status,
    documents: catalog.documents.size,
    diagnostics: diagnostics.length,
    reachable: seen.size,
    unreachable,
  }),
);
