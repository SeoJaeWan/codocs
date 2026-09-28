import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMcp } from './mcp-client.cjs';
import { createSourceCli } from '../../../../mcp/test-support/source-cli.ts';

for (const mode of ['eof', 'kill'])
  test(
    mode === 'eof'
      ? '직접 소유 MCP의 stdin을 닫으면 신호 없이 코드 0으로 종료한다'
      : '직접 소유 MCP를 강제 종료하면 해당 PID의 종료 방식을 기록한다',
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
      const project = await mkdtemp(
        path.join(os.tmpdir(), 'cod27-mcp-client-'),
      );
      const observations = [];
      let client;
      const sourceCli = await createSourceCli();
      try {
        await mkdir(path.join(project, '.codocs'));
        await writeFile(
          path.join(project, '.codocs/a.yaml'),
          'id: a\nname: A\ndefinition: ready\ndomains: [test]\n',
        );
        client = await startMcp({
          node: process.execPath,
          entry: sourceCli.entry,
          project,
          /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ record: (
            value,
          ) => observations.push(value),
        });
        assert.equal(
          (await client.call('codocs_get', { ids: ['a'] })).results[0].document
            .definition,
          'ready',
        );
        const exit = await client.close(mode);
        if (mode === 'eof') assert.deepEqual(exit, { code: 0, signal: null });
        else assert.ok(exit.signal === 'SIGKILL' || exit.code !== 0);
        assert.throws(() => process.kill(client.pid, 0));
        assert.equal(
          observations.filter((item) => item.kind === 'exit').length,
          1,
        );
        assert.equal(
          observations.find((item) => item.kind === 'shutdown').mode,
          mode,
        );
        assert.deepEqual(await client.close(), exit);
      } finally {
        await client?.close('kill');
        await sourceCli.close();
        await rm(project, { recursive: true, force: true });
      }
    },
  );
