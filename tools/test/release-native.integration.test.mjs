import { test } from 'node:test';
import { verifyVersionedCandidate } from '../ci/release-candidate-fixture.mjs';

// 기본 OS 검사는 기존 후보의 기능·설치를 담당하고 버전 재계산은 하지 않는다.
test(
  '명시적 native 실행은 최종 버전 후보 하나로 최소·고정 stable 기능과 lifecycle을 검증한다',
  { skip: process.env.CODOCS_VERIFY_GUI !== '1' },
  /** GUI opt-in일 때만 공식 CLI fixture의 native 소비를 확인한다. */ async () => {
    await verifyVersionedCandidate({ gui: true });
  },
);
