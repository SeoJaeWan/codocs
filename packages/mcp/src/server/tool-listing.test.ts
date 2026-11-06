import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  openInProcessProject,
  type InProcessProject,
} from '../../test-support/in-process.js';
import { codocsJsonInputSchema } from '../tool-input/index.js';

const toolNames = [
  'codocs_list',
  'codocs_get',
  'codocs_search',
  'codocs_refresh',
  'codocs_validate',
  'codocs_write',
  'codocs_rename',
  'codocs_guide',
] as const;

let opened: InProcessProject;

beforeAll(async () => {
  opened = await openInProcessProject('mcp-listing-');
});
afterAll(async () => {
  await opened.close();
});

describe('MCP 서버의 도구 목록과 안내', () => {
  it('도구 목록은 실행 가능한 여덟 도구를 정해진 순서로 나열한다', async () => {
    const names = (await opened.client.listTools()).tools.map(
      (tool) => tool.name,
    );

    expect(names).toEqual(toolNames);
  });

  it.each(toolNames)(
    '%s의 입력 스키마는 도구 입력 계약의 JSON Schema와 같다',
    async (name) => {
      const tool = (await opened.client.listTools()).tools.find(
        (item) => item.name === name,
      );

      expect(tool?.inputSchema).toEqual(codocsJsonInputSchema(name));
    },
  );

  it('폐기된 codocs_duplicates를 호출하면 알 수 없는 도구 오류로 거절한다', async () => {
    await expect(
      opened.client.callTool({ name: 'codocs_duplicates', arguments: {} }),
    ).rejects.toThrow(/Unknown tool: codocs_duplicates/u);
  });

  it('초기화 안내에 검색 시작 시점과 결과 사용법을 담는다', () => {
    const instructions = opened.client.getInstructions();

    expect(instructions).toContain('codocs_search');
    expect(instructions).toContain('codocs_get');
    expect(instructions).toContain('[[링크]]');
    expect(instructions).toContain('emptyQueries');
  });

  it('codocs_search는 설명에 codocs_get 연결을 담고 검색어 수 한도를 스키마로 노출한다', async () => {
    const search = (await opened.client.listTools()).tools.find(
      (tool) => tool.name === 'codocs_search',
    );

    expect(search?.description).toContain('codocs_get');
    expect(search?.inputSchema).toMatchObject({
      type: 'object',
      properties: { queries: { minItems: 1, maxItems: 10 } },
      required: ['queries'],
      additionalProperties: false,
    });
  });

  it('codocs_write는 최상위 type이 object이고 changes·replace·delete·move를 스키마와 설명에 노출한다', async () => {
    const write = (await opened.client.listTools()).tools.find(
      (tool) => tool.name === 'codocs_write',
    )!;

    expect(write.inputSchema.type).toBe('object');
    const schema = JSON.stringify(write.inputSchema);
    for (const word of ['changes', 'replace', 'delete', 'move'])
      expect(schema).toContain(word);
    expect(write.description).toContain('changes');
  });

  it.each(['codocs_write', 'codocs_validate'])(
    '%s 설명에 프로젝트 루트 기준 path 규칙과 하위 .codocs 경로 예시를 담는다',
    async (name) => {
      const tool = (await opened.client.listTools()).tools.find(
        (item) => item.name === name,
      )!;

      expect(tool.description).toContain('프로젝트 루트');
      expect(tool.description).toContain('.codocs/orders/order.yaml');
      expect(tool.description).toContain('packages/core/.codocs/a.yaml');
    },
  );
});
