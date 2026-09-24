import { describe, expect, it } from 'vitest';
import { discoveryPath } from './discovery-path.js';

describe('조회 경로의 OS 구분자 경계', () => {
  it.each([
    {
      os: 'Windows',
      separator: '\\',
      input: '.codocs/한글 공간/Mixed.yaml',
      expected: '.codocs\\한글 공간\\Mixed.yaml',
    },
    {
      os: 'macOS',
      separator: '/',
      input: '.codocs/한글 공간/Mixed.yaml',
      expected: '.codocs/한글 공간/Mixed.yaml',
    },
    {
      os: 'Windows',
      separator: '\\',
      input: '.codocs/연결/../가.yaml',
      expected: '.codocs\\연결\\..\\가.yaml',
    },
    {
      os: 'macOS',
      separator: '/',
      input: '.codocs/연결/../가.yaml',
      expected: '.codocs/연결/../가.yaml',
    },
    {
      os: 'Windows',
      separator: '\\',
      input: '.codocs\\A/B.yaml',
      expected: '.codocs\\A\\B.yaml',
    },
    {
      os: 'macOS',
      separator: '/',
      input: '.codocs/A\\B.yaml',
      expected: '.codocs/A\\B.yaml',
    },
  ] as const)(
    '$os 입력 $input이면 경계 의미를 보존한 $expected를 반환한다',
    ({ separator, input, expected }) => {
      expect(discoveryPath(input, separator)).toBe(expected);
    },
  );
});
