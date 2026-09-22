/** 부분 검증의 성공을 전체 AC 통과로 올리지 않고 누락·실패를 보존한다. */
function summarizeAcceptance(rows) {
  return Array.from(
    { length: 12 },
    /** AC별 부분 결과를 보수적으로 집계한다. */ (_, index) => {
      const ac = `AC-${String(index + 1).padStart(3, '0')}`;
      const checks = rows.filter((row) => row.ac === ac);
      const status = checks.some((row) => row.status === 'fail')
        ? 'fail'
        : !checks.length || checks.some((row) => row.status !== 'pass')
          ? 'skip'
          : 'pass';
      return { ac, status, checks };
    },
  );
}

exports.summarizeAcceptance = summarizeAcceptance;
