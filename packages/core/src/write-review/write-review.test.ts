import { describe, expect, it } from 'vitest';
import { buildCatalog, scanStatuses, type Catalog } from '../catalog/index.js';
import { changePlanModes } from '../change-plan/index.js';
import { parseYaml } from '../parser/index.js';
import {
  buildReviewIndex,
  decideReview,
  extractNewSentences,
  findQuotedSentence,
  judgeOverlap,
  linksToDocument,
  pickReviewCandidates,
  planReviewTargets,
  reviewCopiedBy,
  reviewDecisions,
  reviewTokenPayload,
  sentenceSimilarity,
  splitSentences,
  type ReviewSection,
  type ReviewTarget,
} from './index.js';

/** 문서 하나의 YAML 원문을 만든다. */
function documentSource(
  id: string,
  name: string,
  sections: Record<string, string>,
): string {
  const body = Object.entries(sections)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`)
    .join('');
  return `_codocs:\n  id: ${id}\n  name: ${JSON.stringify(name)}\n${body}`;
}

/** 경로별 원문을 실제 파서로 관측해 Catalog를 만든다. */
function catalogFromSources(sources: Record<string, string>): Catalog {
  return buildCatalog({
    status: scanStatuses.complete,
    observations: Object.entries(sources).map(([path, source]) => ({
      path,
      parsed: parseYaml(source, path),
    })),
  });
}

/** 섹션 하나를 만든다. 주소는 `문서:섹션`이다. */
function section(
  documentPath: string,
  documentName: string,
  sectionName: string,
  body: string,
): ReviewSection {
  return {
    documentPath,
    documentName,
    sectionName,
    address: `${documentName}:${sectionName}`,
    body,
  };
}

describe('splitSentences: 문장 나누기', () => {
  it('줄로 나눈 뒤 마침표 다음 공백에서 문장을 끊는다', () => {
    expect(
      splitSentences('첫 문장이다. 둘째 문장이다.\n- 셋째 줄이다.'),
    ).toEqual(['첫 문장이다.', '둘째 문장이다.', '- 셋째 줄이다.']);
  });

  it('숫자 뒤의 마침표 다음 공백에서는 끊지 않는다', () => {
    expect(splitSentences('버전 1. 2를 쓴다.')).toEqual(['버전 1. 2를 쓴다.']);
  });

  it('빈 줄과 앞뒤 공백은 문장으로 남기지 않는다', () => {
    expect(splitSentences('  가 문장이다.  \n\n  ')).toEqual(['가 문장이다.']);
  });
});

describe('sentenceSimilarity: 닮은 정도', () => {
  it('공백과 구두점만 다른 두 문장의 닮은 정도는 1이다', () => {
    expect(
      sentenceSimilarity('저장은 한 번만 한다.', '저장은 한번만 한다'),
    ).toBe(1);
  });

  it('공통 2-gram이 없는 두 문장의 닮은 정도는 0이다', () => {
    expect(sentenceSimilarity('가나다', '라마바')).toBe(0);
  });
});

describe('extractNewSentences: 새로 쓴 문장 뽑기', () => {
  it('이전 본문이 없으면 반영 뒤 본문의 모든 문장이 새 문장이다', () => {
    expect(extractNewSentences(undefined, '가 문장이다. 나 문장이다.')).toEqual(
      ['가 문장이다.', '나 문장이다.'],
    );
  });

  it('이전 본문에 이미 있던 문장은 새 문장이 아니다', () => {
    const before = '- 휴지통은 30일 뒤 비운다.';
    const after = '- 휴지통은 30일 뒤 비운다.\n- 비운 항목은 복원하지 않는다.';
    expect(extractNewSentences(before, after)).toEqual([
      '- 비운 항목은 복원하지 않는다.',
    ]);
  });

  it('지운 문장과 닮은 정도 0.8 이상인 문장은 조금 고친 것으로 보고 새 문장에서 뺀다', () => {
    const before = '원래 상위 폴더가 휴지통에 있으면 바탕화면으로 간다.';
    const after = '원래 상위 폴더가 휴지통에 있으면 바탕화면으로 돌아간다.';
    expect(extractNewSentences(before, after)).toEqual([]);
  });

  it('지운 문장과 닮지 않은 문장은 새 문장으로 남긴다', () => {
    const before = '감시 주기는 1분이다.';
    const after = '커밋 작성자는 저장소 주인 계정으로 한다.';
    expect(extractNewSentences(before, after)).toEqual([after]);
  });

  it('기존 줄 끝에 덧붙인 문장은 새 문장으로 잡는다', () => {
    const before = '- 작업은 매시 17분(UTC)에 돈다.';
    const after =
      '- 작업은 매시 17분(UTC)에 돈다. 커밋 작성자는 저장소 주인 계정으로 한다.';
    expect(extractNewSentences(before, after)).toEqual([
      '커밋 작성자는 저장소 주인 계정으로 한다.',
    ]);
  });
});

describe('findQuotedSentence: 인용이 든 문장 찾기', () => {
  it('공백·구두점을 지운 포함 관계로 인용이 든 문장을 찾는다', () => {
    const body = '첫 문장이다. 커밋 작성자는 저장소 주인 계정이다.';
    expect(findQuotedSentence(body, '커밋 작성자는 저장소 주인 계정')).toBe(
      '커밋 작성자는 저장소 주인 계정이다.',
    );
  });

  it('인용 끝에 마침표를 붙였어도 문장을 찾는다', () => {
    const body = '- 환경 변수는 Zod로 검증한다';
    expect(findQuotedSentence(body, '환경 변수는 Zod로 검증한다.')).toBe(body);
  });

  it('포함 관계가 없으면 닮은 정도 0.6 이상인 가장 닮은 문장을 고른다', () => {
    const body = '다른 이야기다. 휴지통 비우기는 실제로 파일을 지우지 않는다.';
    expect(
      findQuotedSentence(body, '휴지통 비우기는 실제로 파일을 안 지운다.'),
    ).toBe('휴지통 비우기는 실제로 파일을 지우지 않는다.');
  });

  it('글자가 거의 없는 문장은 포함 관계로 인용에 들어맞지 않는다', () => {
    const body = '-\n전혀 관계없는 내용을 담은 문장이다.';
    expect(findQuotedSentence(body, '커밋 작성자는 주인 계정이다.')).toBe(
      undefined,
    );
  });

  it('닮은 문장이 없으면 찾지 못한다', () => {
    expect(findQuotedSentence('가나다라마바사.', '아자차카타파하.')).toBe(
      undefined,
    );
  });
});

describe('linksToDocument: 문장의 문서 링크 확인', () => {
  it.each([
    ['문서 링크', '자세한 규칙은 [[Git 규칙]]에 있다.', true],
    ['섹션 링크', '자세한 규칙은 [[Git 규칙:커밋]]에 있다.', true],
    ['이름이 앞부분만 같은 다른 문서 링크', '[[Git 규칙 모음]]을 본다.', false],
    ['링크 없는 이름', 'Git 규칙을 따른다.', false],
  ])('%s이면 %s를 돌려준다', (_, text, expected) => {
    expect(linksToDocument(text, 'Git 규칙')).toBe(expected);
  });

  it('이름에 콜론이 있으면 \\:로 쓴 링크를 찾는다', () => {
    expect(linksToDocument('[[a\\:b:섹션]]을 본다.', 'a:b')).toBe(true);
  });
});

describe('pickReviewCandidates: 후보 섹션 고르기', () => {
  it('새 글과 용어가 겹치는 다른 문서의 섹션을 점수가 높은 순서로 고른다', () => {
    const strong = section(
      'b.yaml',
      '배포',
      'CI',
      '커밋 작성자 저장소 주인 계정 커밋',
    );
    const weak = section('c.yaml', '규칙', '커밋', '커밋은 작게 나눈다');
    const none = section('d.yaml', '휴지통', '복원', '휴지통 항목 복원');
    const index = buildReviewIndex([weak, none, strong]);
    expect(
      pickReviewCandidates(
        index,
        'a.yaml',
        '커밋 작성자는 저장소 주인 계정이다',
      ),
    ).toEqual([strong, weak]);
  });

  it('새 글이 들어가는 문서 자신의 섹션은 후보로 고르지 않는다', () => {
    const own = section('a.yaml', '나', '다른 섹션', '커밋 작성자 저장소 주인');
    const other = section('b.yaml', '배포', 'CI', '커밋 작성자');
    const index = buildReviewIndex([own, other]);
    expect(
      pickReviewCandidates(index, 'a.yaml', '커밋 작성자 저장소 주인'),
    ).toEqual([other]);
  });

  it('후보는 최대 10개까지만 고른다', () => {
    const sections = Array.from({ length: 12 }, (_, at) =>
      section(`d${at}.yaml`, `문서${at}`, '본문', '커밋 작성자'),
    );
    const index = buildReviewIndex(sections);
    expect(pickReviewCandidates(index, 'a.yaml', '커밋 작성자')).toHaveLength(
      10,
    );
  });
});

describe('planReviewTargets: 요청 종류별 새 문장과 후보', () => {
  const base = {
    'a.yaml': documentSource('a', '휴지통', {
      복원: '- 원래 폴더가 없으면 바탕화면으로 간다.',
    }),
    'b.yaml': documentSource('b', '배포', {
      ['CI']: '- 커밋 작성자는 저장소 주인 계정이다.',
    }),
  };

  it('create는 문서의 모든 섹션의 모든 문장을 새 문장으로 보고 섹션마다 대상을 만든다', () => {
    const catalog = catalogFromSources(base);
    const data = {
      _codocs: { id: 'c', name: '규칙' },
      커밋: '커밋 작성자는 저장소 주인 계정이다. 커밋은 작게 나눈다.',
      브랜치: '브랜치는 main에서 딴다.',
    };
    const targets = planReviewTargets(catalog, [
      { index: 0, mode: changePlanModes.create, path: 'c.yaml', data },
    ]);
    expect(targets.map((target) => [target.address, target.sentences])).toEqual(
      [
        [
          '규칙:커밋',
          ['커밋 작성자는 저장소 주인 계정이다.', '커밋은 작게 나눈다.'],
        ],
        ['규칙:브랜치', ['브랜치는 main에서 딴다.']],
      ],
    );
    expect(
      targets[0]?.candidates.map((candidate) => candidate.address),
    ).toEqual(['배포:CI']);
  });

  it('update는 반영 뒤 섹션에서 이전 섹션에 없던 문장만 새 문장으로 본다', () => {
    const catalog = catalogFromSources(base);
    const data = {
      _codocs: { id: 'a', name: '휴지통' },
      복원: '- 원래 폴더가 없으면 바탕화면으로 간다.\n- 커밋 작성자는 저장소 주인 계정이다.',
    };
    const targets = planReviewTargets(catalog, [
      { index: 0, mode: changePlanModes.update, path: 'a.yaml', data },
    ]);
    expect(targets.map((target) => target.sentences)).toEqual([
      ['- 커밋 작성자는 저장소 주인 계정이다.'],
    ]);
  });

  it('replace도 섹션마다 이전에 없던 문장만 새 문장으로 본다', () => {
    const catalog = catalogFromSources(base);
    const data = {
      _codocs: { id: 'a', name: '휴지통' },
      복원: '- 원래 폴더가 없으면 바탕화면으로 간다.',
      비우기: '비우기는 확인 상자를 띄운다.',
    };
    const targets = planReviewTargets(catalog, [
      { index: 0, mode: changePlanModes.replace, path: 'a.yaml', data },
    ]);
    expect(
      targets.map((target) => [target.sectionName, target.sentences]),
    ).toEqual([['비우기', ['비우기는 확인 상자를 띄운다.']]]);
  });

  it.each([
    ['unset·position처럼 섹션 글이 그대로인 update', changePlanModes.update],
    ['delete', changePlanModes.delete],
    ['move', changePlanModes.move],
  ])('%s에는 새 문장이 없어 대상을 만들지 않는다', (_, mode) => {
    const catalog = catalogFromSources(base);
    const targets = planReviewTargets(catalog, [
      {
        index: 0,
        mode,
        path: mode === changePlanModes.move ? 'z.yaml' : 'a.yaml',
        ...(mode === changePlanModes.move ? { previousPath: 'a.yaml' } : {}),
        ...(mode === changePlanModes.update
          ? {
              data: {
                _codocs: { id: 'a', name: '휴지통' },
                복원: '- 원래 폴더가 없으면 바탕화면으로 간다.',
              },
            }
          : {}),
      },
    ]);
    expect(targets).toEqual([]);
  });

  it('같은 요청에서 함께 만드는 다른 문서의 섹션도 후보로 고른다', () => {
    const catalog = catalogFromSources(base);
    const targets = planReviewTargets(catalog, [
      {
        index: 0,
        mode: changePlanModes.create,
        path: 'c.yaml',
        data: {
          _codocs: { id: 'c', name: '정렬' },
          규칙: '폴더가 파일보다 먼저 온다.',
        },
      },
      {
        index: 1,
        mode: changePlanModes.create,
        path: 'd.yaml',
        data: {
          _codocs: { id: 'd', name: '시작 메뉴' },
          목록: '폴더가 파일보다 먼저 온다.',
        },
      },
    ]);
    expect(
      targets.map((target) => [target.address, target.candidates[0]?.address]),
    ).toEqual([
      ['정렬:규칙', '시작 메뉴:목록'],
      ['시작 메뉴:목록', '정렬:규칙'],
    ]);
  });

  it('지운 문서와 옮긴 문서의 원래 경로는 후보로 고르지 않는다', () => {
    const catalog = catalogFromSources(base);
    const data = {
      _codocs: { id: 'c', name: '규칙' },
      커밋: '커밋 작성자는 저장소 주인 계정이다.',
    };
    const targets = planReviewTargets(catalog, [
      { index: 0, mode: changePlanModes.create, path: 'c.yaml', data },
      { index: 1, mode: changePlanModes.delete, path: 'b.yaml' },
    ]);
    expect(targets[0]?.candidates).toEqual([]);
  });

  it('제외 경로의 문서는 후보로 고르지 않는다', () => {
    const catalog = catalogFromSources(base);
    const data = {
      _codocs: { id: 'c', name: '규칙' },
      커밋: '커밋 작성자는 저장소 주인 계정이다.',
    };
    const targets = planReviewTargets(
      catalog,
      [{ index: 0, mode: changePlanModes.create, path: 'c.yaml', data }],
      (path) => path === 'b.yaml',
    );
    expect(targets[0]?.candidates).toEqual([]);
  });

  it('제외 경로의 문서에 쓰는 글은 대상을 만들지 않는다', () => {
    const catalog = catalogFromSources(base);
    const data = {
      _codocs: { id: 'c', name: '규칙' },
      커밋: '커밋 작성자는 저장소 주인 계정이다.',
    };
    const targets = planReviewTargets(
      catalog,
      [{ index: 0, mode: changePlanModes.create, path: 'c.yaml', data }],
      (path) => path === 'c.yaml',
    );
    expect(targets).toEqual([]);
  });
});

describe('judgeOverlap: 링크로 방향 정하기', () => {
  /** 새 문장과 후보 본문 하나로 대상을 만든다. */
  function targetOf(sentence: string, candidateBody: string): ReviewTarget {
    return {
      index: 0,
      documentPath: 'a.yaml',
      documentName: '배포',
      sectionName: 'CI',
      address: '배포:CI',
      sentences: [sentence],
      candidates: [section('b.yaml', 'Git 규칙', '커밋', candidateBody)],
    };
  }

  it.each([
    [
      '새 문장만 후보 문서를 가리키면 새 글이 옮겨 적은 것',
      '커밋 작성자는 주인 계정이다([[Git 규칙]]).',
      '커밋 작성자는 주인 계정이다.',
      reviewCopiedBy.new,
    ],
    [
      '후보 문장만 이 문서를 가리키면 후보가 옮겨 적은 것',
      '커밋 작성자는 주인 계정이다.',
      '커밋 작성자는 주인 계정이다([[배포:CI]]).',
      reviewCopiedBy.existing,
    ],
    [
      '양쪽 문장에 링크가 없으면 방향을 모르는 것',
      '커밋 작성자는 주인 계정이다.',
      '커밋 작성자는 주인 계정이다.',
      reviewCopiedBy.unknown,
    ],
    [
      '양쪽 문장이 서로를 가리키면 방향을 모르는 것',
      '커밋 작성자는 주인 계정이다([[Git 규칙]]).',
      '커밋 작성자는 주인 계정이다([[배포]]).',
      reviewCopiedBy.unknown,
    ],
  ])('%s으로 판단한다', (_, mine, theirs, expected) => {
    const target = targetOf(mine, theirs);
    const finding = {
      candidate: 'Git 규칙:커밋',
      newQuote: '커밋 작성자는 주인 계정이다',
      candidateQuote: '커밋 작성자는 주인 계정이다',
    };
    expect(judgeOverlap(target, finding)).toEqual({
      ...finding,
      copiedBy: expected,
    });
  });

  it('후보 섹션에서 인용이 든 문장을 찾지 못하면 방향을 모르는 것으로 두고 항목을 버리지 않는다', () => {
    const target = targetOf(
      '커밋 작성자는 주인 계정이다([[Git 규칙]]).',
      '전혀 다른 내용만 적힌 문장이다.',
    );
    const finding = {
      candidate: 'Git 규칙:커밋',
      newQuote: '커밋 작성자는 주인 계정이다',
      candidateQuote: '모델이 지어낸 인용 문장이다',
    };
    expect(judgeOverlap(target, finding)).toEqual({
      ...finding,
      copiedBy: reviewCopiedBy.unknown,
    });
  });

  it('한 줄의 다른 문장에 있는 링크는 방향 판단에 쓰지 않는다', () => {
    const target = targetOf(
      '커밋 작성자는 주인 계정이다.',
      '커밋 작성자는 주인 계정이다. 배포는 [[배포]]에서 정한다.',
    );
    const finding = {
      candidate: 'Git 규칙:커밋',
      newQuote: '커밋 작성자는 주인 계정이다',
      candidateQuote: '커밋 작성자는 주인 계정이다',
    };
    expect(judgeOverlap(target, finding).copiedBy).toBe(reviewCopiedBy.unknown);
  });
});

describe('decideReview: 처리 결과 정하기', () => {
  it.each([
    ['겹침이 없으면 저장', [], reviewDecisions.save],
    [
      '새 글만 상대를 가리키면 막음',
      [reviewCopiedBy.new],
      reviewDecisions.block,
    ],
    [
      '상대만 이 문서를 가리키면 저장하고 알림',
      [reviewCopiedBy.existing],
      reviewDecisions.saveWithOverlaps,
    ],
    ['방향을 모르면 막음', [reviewCopiedBy.unknown], reviewDecisions.block],
    [
      '여러 쌍 가운데 하나라도 막음이면 막음',
      [reviewCopiedBy.existing, reviewCopiedBy.unknown],
      reviewDecisions.block,
    ],
  ])('%s으로 정한다', (_, directions, expected) => {
    expect(decideReview(directions.map((copiedBy) => ({ copiedBy })))).toBe(
      expected,
    );
  });
});

describe('reviewTokenPayload: 확인 값 원문', () => {
  it('같은 항목은 같은 원문을 만든다', () => {
    const items = [
      { index: 0, mode: changePlanModes.create, path: 'a.yaml', raw: 'x' },
    ];
    expect(reviewTokenPayload(items)).toBe(reviewTokenPayload([...items]));
  });

  it.each([
    ['원문', { raw: 'y' }],
    ['경로', { path: 'b.yaml' }],
    ['종류', { mode: changePlanModes.replace }],
  ])('%s이 다르면 다른 원문을 만든다', (_, change) => {
    const item = {
      index: 0,
      mode: changePlanModes.create,
      path: 'a.yaml',
      raw: 'x',
    };
    expect(reviewTokenPayload([{ ...item, ...change }])).not.toBe(
      reviewTokenPayload([item]),
    );
  });
});
