/** 효과 측정 케이스의 언어 구분이다. 검색어에 쓴 언어 기준이다. */
export type BenchmarkLanguage = 'ko' | 'en' | 'mixed';

/** 대화 맥락에서 검색어를 만들고 필요한 섹션을 정한 효과 측정 케이스 하나다. */
export interface BenchmarkCase {
  id: string;
  language: BenchmarkLanguage;
  /** 대화 맥락 요약이다. 2~4턴을 한두 문장으로 줄였다. */
  context: string;
  /** AI가 사용자 어휘로 만든 검색어다. 문서·섹션 이름을 그대로 베끼지 않는다. */
  queries: string[];
  /** 작업에 필요한 섹션이다. `문서 이름:섹션 이름` 형식이다. */
  needed: string[];
}

/** shop fixture 코퍼스(가상 쇼핑몰 문서 41개)에 대한 효과 측정 케이스다. */
export const benchmarkCases: BenchmarkCase[] = [
  {
    id: 'guest-cart-merge-limit',
    language: 'ko',
    context:
      '사용자: 비회원이 담아 둔 장바구니가 로그인하면 어떻게 되는지 구현해야 해. AI: 합친 수량이 한도를 넘을 때가 문제겠네요. 사용자: 맞아, 거부할지 줄일지 정해야 해.',
    queries: [
      '비회원 로그인 후 장바구니 합치기',
      '합친 수량이 한도를 넘으면',
      '병합할 때 수량 줄이기 거부하기',
    ],
    needed: ['장바구니:로그인 병합', '장바구니 수량 제한:한도 초과 처리'],
  },
  {
    id: 'product-card-badge',
    language: 'ko',
    context:
      '사용자: 목록 화면의 상품 카드 컴포넌트를 새로 만들어야 해. AI: 이름 줄 수와 배지 규칙을 확인해야겠네요.',
    queries: [
      '카드 상품명 몇 줄까지 보여주나',
      '배지 최대 개수와 숨기는 우선순위',
      '썸네일 비율',
    ],
    needed: ['상품 카드:표시 제약'],
  },
  {
    id: 'coupon-restore-on-cancel',
    language: 'ko',
    context:
      '사용자: 쿠폰 쓴 주문을 전체 취소하면 쿠폰이 돌아오는지 확인해 줘. AI: 만료된 쿠폰이나 일부 환불 경우도 봐야겠네요.',
    queries: [
      '주문 취소하면 쿠폰 되살리기',
      '유효기간 지난 쿠폰 돌려주나',
      '일부만 환불하면 쿠폰은 어떻게',
    ],
    needed: [
      'Coupon Issuance:Restoration After Cancellation',
      '환불:쿠폰과 포인트 처리',
    ],
  },
  {
    id: 'large-refund-approval',
    language: 'en',
    context:
      'User: add the approval step for big refunds. AI: I need the amount threshold and who approves. User: also who may process it.',
    queries: [
      'large refund needs second approval',
      'refund amount threshold super admin',
      'who can process a refund',
    ],
    needed: ['환불:승인 한도', '관리자 운영:환불 승인'],
  },
  {
    id: 'free-shipping-with-coupon',
    language: 'mixed',
    context:
      '사용자: 장바구니에서 쿠폰 적용하면 배송비가 갑자기 붙는다는 CS가 들어왔어. AI: 무료 배송 기준 금액이 쿠폰 전인지 후인지 확인할게요.',
    queries: [
      'free shipping threshold 쿠폰 적용 후 금액',
      '무료배송 기준 금액',
      '쿠폰 쓰면 배송비가 붙는 이유',
    ],
    needed: ['배송비:배송비 부과 기준'],
  },
  {
    id: 'vip-remote-area-fee',
    language: 'ko',
    context:
      '사용자: 제주 사는 VIP 고객이 배송비를 냈다고 문의했어. AI: 등급 면제와 지역 추가 요금의 관계를 확인해야겠네요.',
    queries: [
      'VIP 배송비 면제 범위',
      '제주 섬 지역 추가 요금',
      '등급 혜택에 배송이 포함되나',
    ],
    needed: ['배송비:VIP 무료 배송', '배송비:도서산간 추가'],
  },
  {
    id: 'payment-retry-policy',
    language: 'ko',
    context:
      '사용자: 결제 실패했을 때 재시도 로직을 짜야 해. AI: 횟수 제한과 타임아웃 후 처리, 잡아 둔 자원을 확인해야 해요.',
    queries: [
      '결제 몇 번까지 다시 시도할 수 있나',
      '결제 실패하면 쿠폰과 포인트는 유지되나',
      '응답이 없을 때 PG에 결과 물어보기',
    ],
    needed: [
      'Payment Failure Handling:Retry Limit',
      'Payment Failure Handling:Resource Holding',
      'Payment Failure Handling:Unknown Result Handling',
    ],
  },
  {
    id: 'virtual-account-reservation',
    language: 'ko',
    context:
      '사용자: 무통장 입금 주문은 재고를 언제까지 잡아 두지? AI: 입금 기한과 예약 시간의 예외를 찾아볼게요.',
    queries: [
      '무통장 입금 기한 며칠',
      '입금 기다리는 동안 재고 잡아두는 시간',
      '가상계좌 주문 자동 취소',
    ],
    needed: [
      '결제 수단:가상계좌',
      'Stock Reservation:Virtual Account Exception',
    ],
  },
  {
    id: 'points-only-payment',
    language: 'ko',
    context:
      '사용자: 포인트만으로 전액 결제하게 해 달라는 요청이 있어. AI: 가능한지, 사용 한도와 단위를 확인할게요.',
    queries: [
      '포인트로만 결제 가능한가',
      '포인트 사용 최대 비율',
      '포인트 최소 사용 단위',
    ],
    needed: [
      '부분 결제:포인트 사용 한도',
      '부분 결제:전액 포인트 결제 불가',
      '포인트:사용 조건',
    ],
  },
  {
    id: 'point-accrual-timing',
    language: 'ko',
    context:
      '사용자: 구매 후 포인트가 언제 들어오는지 안내 문구를 써야 해. AI: 확정 시점과 자동 확정 기준을 확인해야겠네요.',
    queries: [
      '포인트는 언제 들어오나',
      '구매확정 자동으로 되는 시점',
      '배송 완료 후 며칠 지나면 확정',
    ],
    needed: [
      '포인트 적립과 소멸:적립 시점',
      'Delivery Tracking:Auto Confirmation',
    ],
  },
  {
    id: 'review-eligibility',
    language: 'en',
    context:
      'User: build the review write screen. AI: I need who may write, the time limit and the photo reward.',
    queries: [
      'who is allowed to write a review',
      'review deadline after purchase confirmation',
      'photo review points reward',
    ],
    needed: [
      'Product Reviews:Eligibility',
      'Product Reviews:Photo Review Reward',
    ],
  },
  {
    id: 'rating-hidden-threshold',
    language: 'ko',
    context:
      '사용자: 리뷰가 적은 상품은 별점이 안 보이는데 맞는 동작이야? AI: 카드와 상세 모두 기준을 확인할게요.',
    queries: [
      '리뷰 적은 상품 별점 숨김',
      '평균 평점 소수점 자리수',
      '평점 표시 최소 리뷰 개수',
    ],
    needed: ['상품 카드:평점 표시', 'Product Reviews:Rating Display'],
  },
  {
    id: 'return-window-fee',
    language: 'ko',
    context:
      '사용자: 단순 변심 반품 정책을 안내 페이지에 쓸 거야. AI: 기간과 택배비 부담을 정리할게요.',
    queries: [
      '단순 변심 반품 기한',
      '반품 택배비 누가 부담하나',
      '받은 날부터 며칠 안에 가능',
    ],
    needed: ['반품:반품 가능 기간', '반품:반품 배송비 부담'],
  },
  {
    id: 'partial-return-shipping-recalc',
    language: 'ko',
    context:
      '사용자: 일부 상품만 반품했는데 환불액에서 배송비가 빠졌대. AI: 무료 배송 조건이 깨지는 경우를 확인해 볼게요.',
    queries: [
      '일부만 반품하면 배송비 차감',
      '무료 배송 조건 다시 계산',
      '환불 금액에서 빼는 항목 순서',
    ],
    needed: ['배송비:반품 시 재계산', '환불:환불 금액'],
  },
  {
    id: 'lost-parcel',
    language: 'en',
    context:
      'User: a customer says the parcel never arrived. AI: Let me look up the lost parcel handling and compensation.',
    queries: [
      'parcel not arriving what to do',
      'carrier tracking has no update for days',
      'lost shipment reshipment or refund',
    ],
    needed: ['Delivery Tracking:Lost Parcel'],
  },
  {
    id: 'refund-timing',
    language: 'en',
    context:
      'User: customers ask why the card refund is not on the statement. AI: I will check the refund timing rules.',
    queries: [
      'how long does a card refund take',
      'refund not showing on statement',
      'bank transfer refund days',
    ],
    needed: [
      'Refund Timing:Card Cancellation Lag',
      'Refund Timing:Bank Transfer Refund',
    ],
  },
  {
    id: 'night-notification',
    language: 'ko',
    context:
      '사용자: 푸시를 밤에 보내도 되는지 정해야 해. AI: 알림 종류별 시간 제한을 확인해야겠네요.',
    queries: [
      '밤에 푸시 보내도 되나',
      '마케팅 메시지 발송 금지 시간대',
      '재입고 알림 야간 발송',
    ],
    needed: ['알림:발송 시간 제한'],
  },
  {
    id: 'restock-alert',
    language: 'ko',
    context:
      '사용자: 품절 상품이 다시 들어오면 알려주는 기능을 붙일 거야. AI: 신청 개수 제한과 발송 횟수를 확인할게요.',
    queries: [
      '재입고되면 알려주기 신청 최대 개수',
      '품절 상품 다시 들어오면 알림 한 번만',
    ],
    needed: ['품절 처리:재입고 알림'],
  },
  {
    id: 'sold-out-option-display',
    language: 'mixed',
    context:
      '사용자: 옵션 선택 UI에서 sold out 옵션을 숨겨야 해? AI: 옵션 표시 규칙과 품절 판정 기준을 확인할게요.',
    queries: [
      'sold out 옵션 숨김 여부',
      '품절된 옵션 비활성 표시',
      '옵션 조합 SKU 단위 판정',
    ],
    needed: ['상품 옵션:품절 옵션 표시', '품절 처리:품절 판정'],
  },
  {
    id: 'available-stock-formula',
    language: 'ko',
    context:
      '사용자: 재고가 있는데 담기지 않는다는 문의야. AI: 가용 재고 계산식에 뭐가 들어가는지 확인해야겠네요.',
    queries: [
      '살 수 있는 수량 계산식',
      '안전 재고 기본값',
      '예약된 수량도 빼는지',
    ],
    needed: ['재고:재고 구성', '재고:가용 재고'],
  },
  {
    id: 'coupon-stacking',
    language: 'ko',
    context:
      '사용자: 쿠폰 여러 장을 한 주문에 쓸 수 있게 해 달라고 해. AI: 중복 범위와 순서, 단독 쿠폰 예외를 확인할게요.',
    queries: [
      '쿠폰 여러 장 같이 쓰기',
      '상품 쿠폰 먼저 주문 쿠폰 나중',
      '다른 쿠폰과 못 쓰는 쿠폰',
    ],
    needed: [
      '쿠폰 중복 적용:중복 허용 범위',
      '쿠폰 중복 적용:적용 순서',
      '쿠폰 중복 적용:단독 사용 쿠폰',
    ],
  },
  {
    id: 'rate-coupon-cap',
    language: 'ko',
    context:
      '사용자: 퍼센트 쿠폰 발행 화면을 만드는 중이야. AI: 필수 입력과 발행 권한을 확인해야 해요.',
    queries: ['퍼센트 쿠폰 최대 할인 금액 필수', '쿠폰 발행은 누가 할 수 있나'],
    needed: ['쿠폰 정책:정률 쿠폰 한도', '관리자 운영:쿠폰 발행 권한'],
  },
  {
    id: 'flash-sale-limit',
    language: 'en',
    context:
      'User: the flash sale item must be limited per customer. AI: I will check the purchase cap and where its stock comes from.',
    queries: [
      'limit per customer for limited time item',
      'flash sale purchase cap three units',
      'campaign stock separate from regular stock',
    ],
    needed: [
      '장바구니 수량 제한:기간 한정 상품 한도',
      'Promotion Campaigns:Flash Sale Inventory',
    ],
  },
  {
    id: 'unpaid-order-expiry',
    language: 'ko',
    context:
      '사용자: 주문하고 결제 안 하면 언제 자동 취소돼? AI: 만료 시간과 재고 예약 시간이 같은지 볼게요.',
    queries: [
      '주문 후 결제 안 하면 자동 취소',
      '미결제 주문 만료 시간',
      '재고 예약 유지 시간',
    ],
    needed: [
      '주문 상태:결제 대기 만료',
      'Stock Reservation:Reservation Window',
    ],
  },
  {
    id: 'order-cancel-timing',
    language: 'ko',
    context:
      '사용자: 상품 준비 중인 주문을 고객이 취소하려 해. AI: 직접 취소 가능한 시점과 일부만 취소 가능 여부를 확인할게요.',
    queries: [
      '주문 취소 언제까지 직접 가능',
      '상품 준비중일 때 취소 요청',
      '일부 상품만 취소할 수 있나',
    ],
    needed: [
      'Order Cancellation:Self-Service Window',
      'Order Cancellation:CS Request Stage',
      'Order Cancellation:Partial Cancellation',
    ],
  },
  {
    id: 'tier-demotion',
    language: 'ko',
    context:
      '사용자: VIP였는데 한 달 만에 등급이 내려갔다는 항의가 왔어. AI: 산정 주기와 강등 규칙을 확인해야겠네요.',
    queries: [
      '등급 내려가는 기준',
      'VIP가 한 번에 몇 단계 떨어지나',
      '등급 계산 주기',
    ],
    needed: ['회원 등급:산정 시점과 강등', '회원 등급:산정 기준'],
  },
  {
    id: 'account-lockout',
    language: 'en',
    context:
      'User: write the login error messages. AI: I need the lock rule and whether admins need extra authentication.',
    queries: [
      'login failed too many times',
      'account lock duration minutes',
      'admin two factor required',
    ],
    needed: [
      'Account Security:Lockout',
      'Account Security:Two-Factor Authentication',
    ],
  },
  {
    id: 'dormant-and-withdrawal',
    language: 'ko',
    context:
      '사용자: 오래 접속 안 한 계정 처리와 탈퇴 조건을 정리해 줘. AI: 휴면 기준과 탈퇴 막는 경우를 확인할게요.',
    queries: [
      '오래 로그인 안 한 계정 처리',
      '휴면 되기 전 안내',
      '진행 중인 주문이 있으면 탈퇴 가능한가',
    ],
    needed: ['회원:휴면 전환', '회원:탈퇴 제약'],
  },
  {
    id: 'price-change-audit',
    language: 'ko',
    context:
      '사용자: 가격을 바꾼 사람과 사유를 추적하고 싶어. AI: 변경 권한과 기록 항목, 보관 기간을 확인할게요.',
    queries: [
      '가격 바꿀 수 있는 사람',
      '변경 이력 사유 기록 항목',
      '관리자 기록 보관 기간 수정 가능 여부',
    ],
    needed: [
      '관리자 운영:가격 변경 권한',
      'Admin Audit Log:Record Fields',
      'Admin Audit Log:Retention and Immutability',
    ],
  },
  {
    id: 'discount-rate-badge',
    language: 'ko',
    context:
      '사용자: 할인율 배지에 몇 퍼센트로 찍히는지 맞춰야 해. AI: 계산 방식과 배지 표시 기준을 확인할게요.',
    queries: [
      '할인 퍼센트 소수점 처리 버림 반올림',
      '몇 퍼센트부터 배지 보여주나',
    ],
    needed: ['할인가 계산:할인율 계산', '가격 표시:할인율 배지 기준'],
  },
  {
    id: 'tax-rounding',
    language: 'en',
    context:
      'User: totals differ by a won on the receipt. AI: I will check tax display, discount rounding and the minimum payable amount.',
    queries: [
      'VAT included in displayed price',
      'how a discount is split across order lines rounding',
      'lowest amount a customer can pay',
    ],
    needed: [
      'Tax and Rounding:Tax Inclusive Display',
      'Tax and Rounding:Rounding Rule',
      'Tax and Rounding:Minimum Payable Amount',
    ],
  },
  {
    id: 'search-sold-out-ranking',
    language: 'mixed',
    context:
      '사용자: 검색 결과에서 품절 상품을 어디에 보여줄지 정해야 해. AI: 정렬 규칙과 품절 판정 기준을 확인할게요.',
    queries: [
      'search results ordering sold out products',
      '검색 결과 정렬 기준 판매량',
      '품절 상품은 숨기나 맨 아래로 보내나',
    ],
    needed: ['Product Search:Ranking Rules', '품절 처리:품절 판정'],
  },
  {
    id: 'order-id-format',
    language: 'ko',
    context:
      '사용자: 주문번호를 고객에게 보여줄 때 규칙이 있나? AI: 번호 형식, 재시도 때 바뀌는지, 외부 노출을 확인할게요.',
    queries: [
      '주문번호 생성 형식',
      '결제 다시 시도하면 주문번호 바뀌나',
      '비회원 주문 조회 방법',
    ],
    needed: [
      '주문 번호:형식',
      '주문 번호:유일성과 재시도',
      '주문 번호:외부 노출',
    ],
  },
  {
    id: 'split-shipment',
    language: 'ko',
    context:
      '사용자: 한 주문이 두 창고에서 따로 나가는 경우를 처리해야 해. AI: 배송 단위별 상태와 출고 마감을 확인할게요.',
    queries: [
      '상품이 여러 창고에 있을 때 따로 보내기',
      '나눠 보내는 주문의 상태 결정',
      '당일 출고 마감 시각',
    ],
    needed: ['배송:분할 배송', '배송:출고 기준'],
  },
  {
    id: 'notification-template-limits',
    language: 'en',
    context:
      'User: we are writing new message templates. AI: I need length limits and how the language variant is chosen.',
    queries: [
      'sms character limit',
      'push notification title length',
      'which language version is sent when missing',
    ],
    needed: [
      'Notification Templates:Length Limits',
      'Notification Templates:Template Identity',
    ],
  },
  {
    id: 'double-payment',
    language: 'ko',
    context:
      '사용자: 같은 주문이 두 번 결제됐다는 제보가 있어. AI: 중복 방지와 금액 검증 규칙을 확인해야겠네요.',
    queries: [
      '같은 주문 두 번 결제 막기',
      '멱등키 재요청 처리',
      '클라이언트가 보낸 금액이 다를 때',
    ],
    needed: ['결제:이중 결제 방지', '결제:결제 금액 검증'],
  },
  {
    id: 'settlement-role',
    language: 'ko',
    context:
      '사용자: 정산 담당자 계정 권한을 정리해 줘. AI: 할 수 있는 일과 확정 후 수정 가능 여부를 볼게요.',
    queries: ['정산 담당자가 할 수 있는 일', '정산 확정 후 환불 금액 수정'],
    needed: ['관리자 운영:정산 권한'],
  },
  {
    id: 'welcome-coupon',
    language: 'ko',
    context:
      '사용자: 신규 가입자에게 주는 쿠폰 조건이 뭐였지? AI: 발급 조건과 재가입 시 처리를 확인할게요.',
    queries: [
      '신규 가입하면 주는 쿠폰',
      '탈퇴 후 재가입하면 또 주나',
      '가입 완료 조건 이메일 인증',
    ],
    needed: ['Coupon Issuance:Welcome Coupon', '회원:가입 조건'],
  },
];
