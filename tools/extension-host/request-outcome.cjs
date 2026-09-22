/** 반환된 Hover 응답의 판정과 다음 요청 중단 여부를 분리한다. */
function classifyRequestOutcome(result, error, cancellation) {
  const success = !error && result?.success === true;
  const cancelled = error === 'Canceled';
  return {
    success,
    cancelled,
    stop: cancelled || Boolean(cancellation),
  };
}

module.exports = { classifyRequestOutcome };
