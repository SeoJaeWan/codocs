import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { installMcp } from '../../../tools/build/verify-release.mjs';
import { startMcp } from '../src/integration/test-support/mcp-client.cjs';
const archive = path.resolve(process.argv[2]);
const root = path.resolve(import.meta.dirname, '../../..');
await mkdir(path.join(root, '.workbench'), { recursive: true });
const output = await mkdtemp(path.join(root, '.workbench/installed-mcp-'));
const report = {
  platform: process.platform,
  node: process.version,
  archive,
  sha256: createHash('sha256')
    .update(await readFile(archive))
    .digest('hex'),
  output,
  results: [],
};
const installed = await installMcp(archive, path.join(output, 'consumer'));
const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const cases = [
  {
    id: 'non-git-eligibility',
    eligibility: true,
    definition: 'Changed whole document',
  },
  {
    id: 'git-policy-refresh',
    eligibility: true,
    git: true,
    definition: before
      .map((value, i) => (i === 2 ? 'Changed tracked target' : value))
      .join('\n'),
  },
  {
    id: 'within',
    definition: [
      'one',
      'two',
      'changed',
      'four',
      'five',
      'six',
      'seven',
      'eight',
    ].join('\n'),
    reason: 'region_changed',
  },
  {
    id: 'preceding',
    definition: ['inserted', ...before].join('\n'),
    reason: 'preceding_line_shift',
  },
  {
    id: 'after',
    definition: [...before.slice(0, 7), 'changed after'].join('\n'),
    unaffected: true,
  },
  {
    id: 'deleted',
    definition: before.filter((_, i) => i !== 2).join('\n'),
    reason: 'region_changed',
  },
  { id: 'name', set: { name: 'Renamed' }, reason: 'name_changed' },
  { id: 'domain', set: { domains: ['other'] }, reason: 'domain_changed' },
  {
    id: 'repeated',
    before: ['repeat', 'repeat', 'repeat', 'repeat'],
    definition: 'repeat\nrepeat\nrepeat',
    possible: true,
  },
  { id: 'unchanged', definition: before.join('\n'), unchanged: true },
  {
    id: 'calculation-limit',
    before: Array.from({ length: 2100 }, (_, i) => `row ${i}`),
    definition: Array.from({ length: 2101 }, (_, i) => `after ${i}`).join('\n'),
    incomplete: true,
  },
  {
    id: 'index-failure',
    definition: before
      .map((value, i) => (i === 2 ? 'changed' : value))
      .join('\n'),
    fault: 'index',
    reason: 'region_changed',
  },
  {
    id: 'collection-failure',
    definition: before
      .map((value, i) => (i === 2 ? 'changed' : value))
      .join('\n'),
    fault: 'collection',
    reason: 'region_changed',
  },
  { id: 'save-failure', definition: 'failure', fault: 'save', rejected: true },
];
/** 독립 프로젝트의 현재 저장 원문을 설치한 공개 CLI로 검증한다. */
async function scenario(spec) {
  const project = path.join(output, spec.id);
  await mkdir(path.join(project, '.codocs'), { recursive: true });
  const raw =
    'id: target\nname: Target\ndomains: [test]\ndefinition: |\n' +
    (spec.before ?? before).map((value) => '  ' + value + '\n').join('');
  await writeFile(path.join(project, '.codocs/target.yaml'), raw);
  await writeFile(
    path.join(project, 'code'),
    '@codocs [[Target]]#L7-L8\n@codocs [[Target]]\n@codocs [[test:Target]]#L7-L8\n',
  );
  await writeFile(path.join(project, 'denied'), '@codocs [[Target]]#L7-L8\n');
  if (spec.eligibility) {
    for (const directory of ['scope', 'dist', 'node_modules'])
      await mkdir(path.join(project, directory));
    await writeFile(path.join(project, '.gitignore'), 'ignored*\n');
    await writeFile(
      path.join(project, 'scope/.gitignore'),
      '*.txt\n!keep.txt\n',
    );
    for (const file of [
      'ignored',
      'ignored-extra',
      'scope/ignored.txt',
      'scope/keep.txt',
      'dist/custom',
      'node_modules/custom',
    ])
      await writeFile(path.join(project, file), '@codocs [[Target]]\n');
    await writeFile(
      path.join(project, 'utf16'),
      Buffer.from('@codocs [[Target]]', 'utf16le'),
    );
    if (spec.git) {
      execFileSync('git', ['init', '--quiet'], { cwd: project });
      execFileSync('git', ['add', '-f', '--', 'ignored'], { cwd: project });
    }
  }
  const control = path.join(project, 'fault-control.json');
  await writeFile(control, JSON.stringify({ mode: spec.fault ?? '' }));
  const fault = path.join(project, 'fault.cjs');
  await writeFile(
    fault,
    `const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path');let applied=false;const mode=()=>JSON.parse(sync.readFileSync(${JSON.stringify(control)},'utf8')).mode;const read=fs.readFile,rename=fs.rename,open=fs.open;fs.open=async function(file,...args){if(mode()==='collection'&&String(file).endsWith(path.sep+'denied'))throw Object.assign(new Error('fixture open denied'),{code:'EACCES'});return open(file,...args);};fs.readFile=async function(file,...args){const m=mode();if((m==='index'&&applied&&String(file).endsWith(path.join('.codocs','target.yaml')))||(m==='collection'&&String(file).endsWith(path.sep+'denied'))){const e=Object.assign(new Error('fixture read denied'),{code:'EACCES'});throw e;}return read(file,...args);};fs.rename=async function(source,dest){if(mode()==='save'&&String(dest).endsWith(path.join('.codocs','target.yaml')))throw Object.assign(new Error('fixture save denied'),{code:'EACCES'});const result=await rename(source,dest);if(String(dest).endsWith(path.join('.codocs','target.yaml')))applied=true;return result;};require('node:module').syncBuiltinESMExports();`,
  );
  const events = [];
  const client = await startMcp({
    node: process.execPath,
    entry: installed.entry,
    project,
    preload: [fault],
    /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ record: (
      value,
    ) => events.push(value),
  });
  let result;
  try {
    const current = await client.call('codocs_get', { ids: ['target'] });
    const revision = current.results[0].revision;
    result = await client.call('codocs_write', {
      mode: 'update',
      id: 'target',
      revision,
      set: spec.set ?? {
        definition: spec.unchanged
          ? current.results[0].document.definition
          : spec.definition,
      },
    });
    if (spec.rejected) {
      assert.equal(result.saved, false);
      assert.equal(result.writeImpact, undefined);
      assert.equal(
        await readFile(path.join(project, '.codocs/target.yaml'), 'utf8'),
        raw,
      );
    } else if (spec.unchanged) {
      assert.equal(result.changed, false);
      assert.equal(result.writeImpact, undefined);
    } else {
      assert.equal(result.success, true);
      assert.equal(result.saved, true);
      assert.equal(result.changed, true);
      assert.equal(result.writeImpact.basis, 'saved_files');
      assert.equal(result.writeImpact.target.beforeRevision, revision);
      assert.equal('before' in result.writeImpact, false);
      assert.equal('after' in result.writeImpact, false);
      assert.equal('raw' in result.writeImpact, false);
      if (spec.eligibility)
        assert.deepEqual(
          [
            ...new Set(
              result.writeImpact.impacts.map((item) => item.sourcePath),
            ),
          ].sort(),
          [
            'code',
            'denied',
            'dist/custom',
            ...(spec.git ? ['ignored'] : []),
            'node_modules/custom',
            'scope/keep.txt',
          ],
        );
      if (spec.git) {
        assert.equal(result.writeImpact.collection.status, 'complete');
        execFileSync('git', ['rm', '--cached', '--', 'ignored'], {
          cwd: project,
        });
        const untracked = await client.call('codocs_write', {
          mode: 'update',
          id: 'target',
          revision: result.revision,
          set: {
            definition: before
              .map((value, i) =>
                i === 2 ? 'Changed after tracking removal' : value,
              )
              .join('\n'),
          },
        });
        assert.equal(untracked.writeImpact.collection.status, 'complete');
        assert.ok(
          !untracked.writeImpact.impacts.some((item) =>
            item.sourcePath.startsWith('ignored'),
          ),
        );
        await writeFile(path.join(project, '.gitignore'), '');
        const included = await client.call('codocs_write', {
          mode: 'update',
          id: 'target',
          revision: untracked.revision,
          set: {
            definition: before
              .map((value, i) =>
                i === 2 ? 'Changed after ignore removal' : value,
              )
              .join('\n'),
          },
        });
        assert.equal(included.writeImpact.collection.status, 'complete');
        assert.deepEqual(
          [
            ...new Set(
              included.writeImpact.impacts.map((item) => item.sourcePath),
            ),
          ].sort(),
          [
            'code',
            'denied',
            'dist/custom',
            'ignored',
            'ignored-extra',
            'node_modules/custom',
            'scope/keep.txt',
          ],
        );
      }
      const rows = result.writeImpact.impacts.filter(
        (item) =>
          item.sourcePath === 'code' && item.destination.kind === 'rows',
      );
      if (spec.unaffected) assert.equal(rows.length, 0);
      if (spec.reason)
        assert.ok(
          rows.some((item) => item.reasons.includes(spec.reason)),
          JSON.stringify(result),
        );
      if (spec.possible)
        assert.ok(rows.some((item) => item.certainty === 'possible'));
      if (spec.incomplete)
        assert.equal(result.writeImpact.calculation.status, 'incomplete');
      if (spec.id === 'index-failure') {
        assert.equal(result.indexUpdated, false);
        assert.ok(result.revision);
        await writeFile(control, '{"mode":""}');
        await client.call('codocs_refresh', {});
        assert.equal(
          (await client.call('codocs_get', { ids: ['target'] })).results[0]
            .revision,
          result.revision,
        );
      }
      if (spec.id === 'collection-failure') {
        assert.equal(result.writeImpact.collection.status, 'incomplete');
        assert.ok(result.writeImpact.collection.failures.length);
      }
      assert.ok(
        result.writeImpact.impacts.some(
          (item) => item.destination.kind === 'document',
        ),
      );
    }
  } finally {
    await writeFile(control, '{"mode":""}');
    const exit = await client.close();
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.throws(() => process.kill(client.pid, 0));
  }
  return { id: spec.id, passed: true, result, events };
}
for (const spec of cases) {
  const started = Date.now();
  try {
    report.results.push({
      ...(await scenario(spec)),
      milliseconds: Date.now() - started,
    });
  } catch (error) {
    report.results.push({
      id: spec.id,
      passed: false,
      error: error.stack ?? String(error),
      milliseconds: Date.now() - started,
    });
  }
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(report, null, 2),
  );
}
for (const spec of cases)
  await rm(path.join(output, spec.id), { recursive: true, force: true });
await rm(path.join(output, 'consumer'), { recursive: true, force: true });
report.cleaned = true;
await writeFile(
  path.join(output, 'result.json'),
  JSON.stringify(report, null, 2),
);
// 결과·hash는 보존하고 설치·fixture와 모든 소유 자식은 정리했다.
console.log(
  JSON.stringify({
    output,
    passed: report.results.filter((item) => item.passed).length,
    total: report.results.length,
  }),
);
if (report.results.some((item) => !item.passed)) process.exitCode = 1;
