/** 열린 팝업을 대상 창·요청 세대·본문과 대조해 완료를 판정한다. */
export function classifyHoverState(state, request) {
  const popup = state?.popup;
  if (
    !popup?.open ||
    state.windowId !== request.windowId ||
    state.generation !== request.generation ||
    popup.target !== request.target
  )
    return { complete: false, reason: 'unrelated-or-closed' };
  const loading = popup.rows
    ? popup.rows.some(
        (row) => row.hasContents && row.contentsText.trim() === 'Loading...',
      )
    : popup.loading;
  const body = popup.rows
    ? popup.rows
        .filter(
          (row) => !row.hasContents || row.contentsText.trim() !== 'Loading...',
        )
        .map((row) => row.body)
        .join('\n')
    : popup.body;
  if (loading) return { complete: false, reason: 'loading' };
  if (!body?.includes(request.expectedBody))
    return { complete: false, reason: 'missing-expected-body' };
  return { complete: true, reason: 'expected-body-without-loading' };
}

/** 관측된 Loading 행의 첫 등장과 첫 소멸 사이만 계산한다. */
export function observedLoading(transitions) {
  const first = transitions.find(
    (event) => event.kind === 'dom' && event.entered && event.popup.loading,
  );
  if (!first) return { observed: false, durationMs: null, first: null };
  const gone = transitions.find(
    (event) =>
      event.kind === 'dom' &&
      event.monotonicMs > first.monotonicMs &&
      !event.popup.loading,
  );
  return {
    observed: true,
    durationMs: gone ? gone.monotonicMs - first.monotonicMs : null,
    first,
  };
}
