import { describe, expect, it } from 'vitest';
import { nameValueRange } from './index.js';

describe('nameValueRange', () => {
  it('문서 원문의 name 값 위치와 이름을 반환한다', () => {
    const text = 'id: order\nname: 주문\ndefinition: 설명\n';
    const start = text.indexOf('주문');

    expect(nameValueRange(text)).toEqual({
      name: '주문',
      range: { start, end: start + '주문'.length },
    });
  });

  it('따옴표로 감싼 name은 따옴표를 제외한 값 위치를 반환한다', () => {
    const text = "id: order\nname: '주문'\ndefinition: 설명\n";
    const start = text.indexOf('주문');

    expect(nameValueRange(text)).toEqual({
      name: '주문',
      range: { start, end: start + '주문'.length },
    });
  });

  it('name이 없으면 undefined를 반환한다', () => {
    expect(nameValueRange('id: order\ndefinition: 설명\n')).toBeUndefined();
  });

  it('name이 빈 문자열이면 undefined를 반환한다', () => {
    expect(nameValueRange("id: order\nname: ''\n")).toBeUndefined();
  });

  it('YAML을 해석할 수 없으면 undefined를 반환한다', () => {
    expect(nameValueRange('id: [order\nname: 주문\n')).toBeUndefined();
  });
});
