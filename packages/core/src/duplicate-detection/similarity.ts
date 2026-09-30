import { duplicateDetectionConfig } from './config.js';

/** 정규화한 코드 포인트 열에서 겹치는 n-gram의 중복 없는 집합을 만든다. 길이가 n보다 짧으면 전체를 한 조각으로 본다. */
export function buildGrams(points: readonly string[]): ReadonlySet<string> {
  const size = duplicateDetectionConfig.gramSize;
  const grams = new Set<string>();
  if (points.length <= size) {
    grams.add(points.join(''));
    return grams;
  }
  for (let index = 0; index + size <= points.length; index++)
    grams.add(points.slice(index, index + size).join(''));
  return grams;
}

/** 두 n-gram 집합의 Jaccard 값이다. 두 집합이 모두 비어 있으면 0이다. */
export function jaccard(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  const [small, large] =
    left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const gram of small) if (large.has(gram)) shared++;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Jaccard가 기준을 넘을 수 있는지 크기만으로 미리 확인한다. 실제 값보다 항상 크거나 같은 상한을 쓴다. */
export function jaccardCanReach(
  leftSize: number,
  rightSize: number,
  threshold: number,
): boolean {
  const max = Math.max(leftSize, rightSize);
  return max > 0 && Math.min(leftSize, rightSize) / max >= threshold;
}

/** 순서를 유지한 최장 공통 부분 수열 길이다. */
function lcsLength(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  let previous = new Uint16Array(right.length + 1);
  let current = new Uint16Array(right.length + 1);
  for (const leftPoint of left) {
    for (let column = 1; column <= right.length; column++)
      current[column] =
        leftPoint === right[column - 1]
          ? (previous[column - 1] ?? 0) + 1
          : Math.max(previous[column] ?? 0, current[column - 1] ?? 0);
    [previous, current] = [current, previous];
  }
  return previous[right.length] ?? 0;
}

/** 순서 유사도다. 최장 공통 부분 수열 길이의 두 배를 두 길이의 합으로 나눈다. */
export function orderedSimilarity(
  left: readonly string[],
  right: readonly string[],
): number {
  const total = left.length + right.length;
  return total === 0 ? 0 : (2 * lcsLength(left, right)) / total;
}
