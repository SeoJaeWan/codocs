import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from '@codocs/workspace';
import { expect } from 'vitest';
import { createCodocsGuideHandler } from '../src/guide/index.js';
import { createCodocsServer } from '../src/server/index.js';
import { rmWithRetry } from '../../../tools/test/support/retrying-fs.js';

/** 저장소의 가이드 원문 위치다. 배포 산출물 없이 소스 서버가 읽는다. */
export const sourceGuideRoot = pathToFileURL(
  path.resolve('docs/guide') + path.sep,
);

/** 도구 호출 결과에서 포장 필드만 가진 형태다. */
export interface ToolResponse {
  structuredContent: Record<string, unknown>;
  content: { type: string; text: string }[];
  isError: boolean;
}

/** 실제 파일을 가진 프로젝트와 그 위에서 도는 in-process MCP 연결이다. */
export interface InProcessProject {
  project: string;
  session: WorkspaceQuerySession;
  client: Client;
  /** 파일 변경 뒤 감시기가 시작한 색인 재구성을 포함해 현재 디스크 기준 색인이 끝나길 기다린다. */
  settle(): Promise<void>;
  /** 클라이언트·서버·세션을 닫고 임시 프로젝트를 지운다. */
  close(): Promise<void>;
}

/** 임시 프로젝트를 만들고 실제 세션과 SDK 서버·클라이언트를 메모리 전송으로 연결한다.
 * @param prefix 임시 폴더 이름 접두어다.
 * @param files 프로젝트 루트 기준 상대 경로와 원문이다.
 * @param guideRoot 가이드 원문 위치다.
 */
export async function openInProcessProject(
  prefix: string,
  files: Record<string, string> = {},
  guideRoot: URL = sourceGuideRoot,
): Promise<InProcessProject> {
  await mkdir('.workbench', { recursive: true });
  const project = await mkdtemp(path.resolve(`.workbench/${prefix}`));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, name)), { recursive: true });
    await writeFile(path.join(project, name), text);
  }
  const session = createWorkspaceQuerySession({ cwd: project });
  const server = createCodocsServer(
    session,
    createCodocsGuideHandler(guideRoot),
  );
  const client = new Client({ name: 'in-process-test', version: '1' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    project,
    session,
    client,
    /** 진행 중이거나 새로 시작한 재구성이 끝난 색인을 기다린다. */
    async settle(): Promise<void> {
      await session.refresh();
    },
    /** 연결을 닫은 뒤 세션과 임시 프로젝트를 정리한다. */
    async close(): Promise<void> {
      await client.close();
      await server.close();
      await session.close();
      await rmWithRetry(project, { recursive: true, force: true });
    },
  };
}

/** 도구를 호출하고 JSON 텍스트와 구조 결과가 같은 객체임을 확인한 뒤 포장 전체를 돌려준다. */
export async function callWrapped(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ response: ToolResponse; body: Record<string, unknown> }> {
  const response = (await client.callTool({
    name,
    arguments: args,
  })) as unknown as ToolResponse;
  expect(JSON.parse(response.content[0]!.text)).toEqual(
    response.structuredContent,
  );
  return { response, body: response.structuredContent };
}
