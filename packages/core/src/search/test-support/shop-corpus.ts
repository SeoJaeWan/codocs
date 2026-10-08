/**
 * 가상 쇼핑몰 "모아마켓" fixture 코퍼스다. 문서 41개, 섹션 165개의 YAML 원문을 경로별로 담는다.
 * core는 파일 IO를 쓰지 못하므로 원본 `.codocs` 문서를 그대로 옮겨 적었다. 원본은 저장소 밖 실험 코퍼스다.
 */
export const shopCorpus: Record<string, string> = {
  'cart/cart-quantity-limit.yaml': `_codocs:
  id: cart-quantity-limit
  name: 장바구니 수량 제한
  parent:
    - 장바구니
수량 한도 적용: |
  상품마다 purchaseLimit(1회 주문 최대 수량)을 두며 기본값은 10이다. 한도는 옵션 SKU가 아니라 productId 단위로 합산한다.
  예를 들어 한도가 10인 티셔츠를 빨강 6개, 파랑 5개 담으면 합계 11개이므로 초과다.
기간 한정 상품 한도: |
  기간 한정 상품은 한 사람이 캠페인 기간 동안 최대 3개까지만 살 수 있다. 결제가 완료된 수량만 누적하며, 결제 후에 취소·환불한 수량은 3개에서 빼주지 않는다.
  결제 전에 취소되거나 만료된 수량은 세지 않는다. 결제 완료 수량을 되돌려주지 않는 이유는 선착순 상품을 한 사람이 반복 취소하며 독점하는 일을 막기 위해서다. 재고 배정은 [[Promotion Campaigns:Flash Sale Inventory]]에 있다.
한도 초과 처리: |
  고객이 직접 담거나 수량을 올릴 때 한도를 넘으면 요청을 거부하고 한도를 안내한다. 병합으로 한도를 넘으면 한도까지 줄이고 안내한다.
  [[장바구니:로그인 병합]]에서 설명한 구분이 여기서도 같다.
재고 부족 시: |
  담으려는 수량이 [[재고:가용 재고]]보다 많으면 가용 재고까지만 담기고 부족하다는 안내를 보여준다. 가용 재고가 0이면 담지 못한다.
  purchaseLimit과 가용 재고 중 작은 값이 실제 상한이다.
`,
  'cart/cart.yaml': `_codocs:
  id: cart
  name: 장바구니
  parent:
    - 쇼핑몰 개요
보관 기간: |
  비회원 장바구니는 마지막 변경 후 7일, 회원 장바구니는 마지막 변경 후 30일 동안 보관하고 그 뒤에 비운다.
  회원이 아닌 구매자는 [[회원:비회원 구매]]의 제약을 받으므로 보관 기간도 짧게 둔다.
담을 수 있는 한도: |
  장바구니에는 SKU 기준으로 최대 100종까지 담을 수 있다. 같은 SKU를 다시 담으면 종류는 늘지 않고 수량만 늘어난다.
  100종을 넘기려 하면 CART_LIMIT_EXCEEDED로 거부하며 수량 한도는 [[장바구니 수량 제한:수량 한도 적용]]을 함께 적용한다.
로그인 병합: |
  비회원으로 담아 둔 장바구니는 로그인할 때 회원 장바구니와 합친다. 같은 SKU는 수량을 더하고, 합친 수량이 한도를 넘으면 한도까지 줄인다.
  직접 담을 때는 한도를 넘으면 거부하지만 병합은 고객의 새 행동이 아니므로 거부하지 않고 줄인다. 이 차이는 [[장바구니 수량 제한:한도 초과 처리]]에도 같다.
옵션 변경: |
  장바구니 안에서 옵션을 바꾸면 같은 상품 안의 다른 SKU로만 교체할 수 있다. 바꾼 SKU가 이미 담겨 있으면 두 수량을 더한다.
  교체 대상 SKU가 품절이면 변경을 거부한다. 옵션 구조는 [[상품 옵션:옵션 구조]]를 따른다.
가격 변동: |
  장바구니는 담은 시점의 가격을 저장하지 않고 항상 현재 판매가로 계산한다. 담은 뒤 가격이 바뀌면 장바구니 상단에 변동 안내를 보여준다.
  가격 표시 형식은 [[가격 표시:표시 구성]]을 따르며, 주문이 만들어지는 순간에 금액이 확정된다.
`,
  'catalog/product-card.yaml': `_codocs:
  id: product-card
  name: 상품 카드
  parent:
    - 상품
표시 제약: |
  ProductCard는 상품명을 최대 2줄까지 보여주고 넘치면 말줄임(...)으로 자른다. 썸네일은 항상 1:1 비율이며 비율이 다른 원본은 중앙을 잘라 맞춘다.
  배지는 카드당 최대 2개이며 우선순위는 품절, 할인율, 신상품 순이다. 3개 이상 해당되면 우선순위가 낮은 배지부터 숨긴다.
  이유는 좁은 목록 화면에서 배지가 상품명을 가리지 않게 하기 위해서다.
가격 영역: |
  ProductCard의 가격은 ProductPrice 컴포넌트([[가격 표시]]에서 정의)만 사용하며 카드가 금액을 직접 포맷하거나 계산하지 않는다.
  카드에는 정가·판매가·할인율만 나오고 쿠폰 적용가는 나오지 않는다. 근거는 [[가격 표시:쿠폰 적용가 표시 범위]]에 있다.
품절 상태: |
  품절 판정은 [[품절 처리:품절 판정]]의 결과를 따른다. soldOut이면 "품절" 배지를 붙이고 장바구니 버튼을 비활성으로 바꾼다.
  카드 전체를 눌러 상세로 이동하는 동작은 품절이어도 유지한다. 재입고 알림을 신청하려면 상세로 가야 하기 때문이다.
  선주문 상품은 가용 재고가 0이어도 품절 배지를 붙이지 않는다.
평점 표시: |
  리뷰가 3개 미만이면 평점과 리뷰 수를 카드에 보여주지 않는다. 표본이 적은 평점이 구매 판단을 왜곡하지 않게 하기 위해서다.
  평점 계산과 표시 자리수는 [[Product Reviews:Rating Display]]가 정한다.
`,
  'catalog/product-option.yaml': `_codocs:
  id: product-option
  name: 상품 옵션
  parent:
    - 상품
옵션 구조: |
  옵션은 최대 3단계(예: 색상, 사이즈, 포장)까지 둘 수 있고 옵션 조합은 상품당 최대 100개다.
  각 조합이 하나의 SKU(skuId)이며 재고·판매 상태는 SKU 단위로 관리하며 [[재고]]가 수량 규칙을 담당한다. 옵션이 없는 상품은 SKU가 하나뿐이다.
옵션 추가금: |
  옵션 추가금은 0 이상이며 상품 판매가의 100%를 넘을 수 없다. 음수 추가금(옵션 할인)은 허용하지 않는다.
  이유는 상품 판매가가 곧 최저 구매가로 [[가격 표시:표시 구성]]에 보이기 때문이다. 옵션 선택만으로 표시 가격보다 싸게 사는 일이 없어야 한다.
품절 옵션 표시: |
  품절된 SKU의 옵션은 숨기지 않고 비활성 상태로 "품절" 문구와 함께 보여준다.
  숨기면 고객이 옵션이 없는 것으로 오해하고 [[품절 처리:재입고 알림]]을 신청할 기회를 잃기 때문이다.
옵션 변경 제약: |
  장바구니에 담은 뒤 옵션 변경은 같은 상품 안의 SKU로 바꾸는 경우만 허용하며 규칙은 [[장바구니:옵션 변경]]에 있다.
  주문이 생성된 뒤에는 옵션을 바꿀 수 없다. 옵션을 바꾸려면 [[Order Cancellation:Self-Service Window]] 안에서 취소하고 다시 주문한다.
`,
  'catalog/product-reviews.yaml': `_codocs:
  id: product-reviews
  name: Product Reviews
  parent:
    - 상품
Eligibility: |
  Only members whose purchase has been confirmed can write a review, and only within 90 days after the confirmation date. Each order item can have exactly one review.
  Guests cannot write reviews because there is no durable account to attach the review to. Confirmation timing is defined in [[Delivery Tracking:Auto Confirmation]].
Rating Display: |
  The average rating is rounded to one decimal place and shown together with the review count. Products with fewer than 3 reviews show no average.
  The [[상품 카드:평점 표시]] section applies the same threshold to product cards so that lists and detail pages never disagree.
Photo Review Reward: |
  A review with at least one photo and 20 or more characters earns 500 points once it passes moderation. The reward is revoked if the review is deleted within 30 days.
  Point grant and expiry follow [[포인트 적립과 소멸:적립 종류]].
Moderation: |
  Offensive, advertising or off-topic reviews are hidden by a CS administrator. Hidden reviews stay in the data store but do not count toward the average.
  Every moderation decision is written to the audit log described in [[Admin Audit Log:Recorded Actions]].
`,
  'catalog/product-search.yaml': `_codocs:
  id: product-search
  name: Product Search
  parent:
    - 상품
Index Freshness: |
  A product change reaches the search index within 1 minute. This covers status changes to SUSPENDED or DISCONTINUED, which must disappear from results within the same window.
  The index is eventually consistent, so the product detail page, not the search result, is the source of truth for price and stock.
Ranking Rules: |
  Results are ordered by text relevance first and by sales count over the last 30 days second.
  Sold-out products sink to the bottom of the list but are never hidden unless the shopper turns on the "in stock only" filter. The sold-out decision follows [[품절 처리:품절 판정]].
Filters: |
  Shoppers can combine at most 5 filters at once: category, price range, free shipping, rating, and in-stock only.
  The free shipping filter uses the rule in [[배송비:배송비 부과 기준]] evaluated for a single unit of the product, not for the cart.
Empty Results: |
  When a query returns nothing, the page shows a spelling suggestion and up to 8 recommended products from the [[상품]] catalog that are ON_SALE, ranked by the [[Product Reviews]] average when tied.
  The search never falls back to showing suspended products, even if they match the query exactly.
`,
  'catalog/product.yaml': `_codocs:
  id: product
  name: 상품
  parent:
    - 쇼핑몰 개요
상품 정의: |
  상품은 productId로 식별하며 이름은 최대 100자다. 카테고리는 최대 4단계까지 둘 수 있고 한 상품은 대표 카테고리 하나에만 속한다.
  실제로 구매하는 단위는 상품이 아니라 [[상품 옵션:옵션 구조]]가 만드는 SKU(skuId)다.
판매 상태: |
  상품 상태는 DRAFT, ON_SALE, SUSPENDED, DISCONTINUED 중 하나다.
  DRAFT에서 ON_SALE로 바꾸려면 대표 이미지·판매가·재고가 모두 있어야 한다. 한 번 DISCONTINUED가 된 상품은 ON_SALE로 되돌릴 수 없다.
  이유는 단종된 상품의 주문·리뷰 이력과 새로 판매하는 상품이 섞이지 않게 하기 위해서다.
노출 규칙: |
  SUSPENDED와 DISCONTINUED 상품은 목록과 검색에 나오지 않으며, 검색 반영 시각은 [[Product Search:Index Freshness]]를 따른다.
  상세 주소로 직접 들어오면 "판매 중지" 안내를 보여주고 구매 버튼은 숨긴다. 기존 주문과 리뷰는 그대로 유지한다.
  목록에서 상품을 보여주는 형태와 제약은 [[상품 카드:표시 제약]]에서 정하고, 구매 가능 수량은 [[재고:가용 재고]]가 정한다.
`,
  'fulfillment/delivery-tracking.yaml': `_codocs:
  id: delivery-tracking
  name: Delivery Tracking
  parent:
    - 배송
Tracking Registration: |
  When a parcel is handed to the carrier the warehouse registers the carrier invoice number, and the order or shipment moves to SHIPPED, matching the [[주문 상태]] definition. Shoppers see the carrier name and a tracking link in the order detail.
  The status change is also sent to the shopper as a transactional notification, see [[알림:거래 알림]].
Sync Interval: |
  The carrier status is polled every 30 minutes. A shopper can force a refresh from the order detail, but only once every 5 minutes.
  The poll stops when the shipment reaches DELIVERED.
Auto Confirmation: |
  Seven days after a shipment is DELIVERED the purchase is confirmed automatically, unless a return has been requested. The shopper can also confirm earlier by pressing the confirm button.
  Confirmation unlocks review writing in [[Product Reviews:Eligibility]] and point accrual in [[포인트 적립과 소멸:적립 시점]]. The 7-day period equals the return window for a change of mind in [[반품:반품 가능 기간]].
Lost Parcel: |
  If the carrier status has not changed for 5 business days after shipping, CS opens an investigation within 3 business days. The shopper chooses between a reshipment and a full refund once the parcel is confirmed lost.
  A lost-parcel refund is the seller's fault, so no return fee is deducted; see [[환불:환불 금액]].
`,
  'fulfillment/refund-timing.yaml': `_codocs:
  id: refund-timing
  name: Refund Timing
  parent:
    - 환불
Processing Deadline: |
  The shop requests the [[환불]] from the payment provider within 2 business days after a return passes inspection or an order cancellation is approved. For refunds above 500,000 KRW the clock starts after the second approval.
  The deadline covers the shop's own processing, not the time the bank or card issuer needs afterwards.
Card Cancellation Lag: |
  After a card approval is cancelled the issuer may take 3 to 5 business days to show it on the statement. The shop is not responsible for this lag, but CS gives the cancellation confirmation number on request.
  Card refunds follow the same rule when points were used for part of the order; the point part is returned at once as described in [[환불:환불 수단]].
Bank Transfer Refund: |
  Bank transfer refunds are sent within 3 business days after the shopper's account is verified. If the transfer fails, CS contacts the shopper and the money is held as unclaimed for up to 14 days.
  Virtual account orders require the shopper to enter an account first, as defined in [[결제 수단:수단별 환불]].
Delay Compensation: |
  If a refund is delayed more than 5 business days beyond the processing deadline because of the shop, 1,000 points are granted automatically as compensation. The compensation is granted once per refund.
  The points follow the normal expiry in [[포인트 적립과 소멸:소멸 규칙]].
`,
  'fulfillment/refund.yaml': `_codocs:
  id: refund
  name: 환불
  parent:
    - 반품
환불 금액: |
  환불 금액은 결제 금액에서 반품 배송비와 배송비 재계산 차감액, 회수할 수 없는 포인트 차감액을 뺀 금액이다.
  일부 상품만 환불하면 주문 쿠폰 할인은 상품 금액 비율로 안분하며 반올림 규칙은 [[Tax and Rounding:Rounding Rule]]을 따른다.
  재계산 차감은 [[배송비:반품 시 재계산]]이, 포인트 차감은 [[포인트 적립과 소멸:환불 시 회수]]가 정한다.
환불 수단: |
  환불은 원래 결제 수단으로 하며 카드는 승인 취소다. 가상계좌로 낸 주문은 고객이 입력한 본인 명의 계좌로 환불한다.
  포인트로 낸 부분은 현금이 아니라 포인트로 돌려준다. 수단별 처리 기한은 [[Refund Timing:Bank Transfer Refund]]에 있다.
쿠폰과 포인트 처리: |
  사용한 쿠폰의 복원은 [[Coupon Issuance:Restoration After Cancellation]]을 따른다. 전액 환불이 아니라 일부 환불이면 쿠폰은 복원하지 않는다.
  사용한 포인트는 환불 금액에 비례해 포인트로 복원하며, 복원 포인트의 소멸일은 처음 적립일 기준을 유지한다.
승인 한도: |
  환불 금액이 500,000원을 넘으면 CS 담당자 한 명의 처리로 끝나지 않고 SUPER_ADMIN의 2차 승인이 필요하다. 승인 규칙은 [[관리자 운영:환불 승인]]에 있다.
  승인 전에는 환불 상태가 PENDING_APPROVAL이며 [[Refund Timing:Processing Deadline]]의 시간은 승인 후부터 센다.
`,
  'fulfillment/return.yaml': `_codocs:
  id: return
  name: 반품
  parent:
    - 쇼핑몰 개요
반품 가능 기간: |
  단순 변심은 상품을 받은 날부터 7일 안에 반품할 수 있다. 상품 불량이나 오배송은 받은 날부터 30일 안이고 문제를 안 날부터 7일 안이면 반품할 수 있다.
  구매확정이 된 주문은 단순 변심 반품이 불가능하지만 불량·오배송은 위 기간 안이면 가능하다.
반품 불가 상품: |
  개봉한 식품, 주문 제작 상품, 개봉한 위생용품은 단순 변심 반품이 불가능하다. 불량이나 오배송이면 이 상품도 반품할 수 있다.
  반품 불가 여부는 상품 상세에 구매 전에 표시해야 하며, 표시하지 않은 상품은 반품 불가로 거절할 수 없다.
반품 배송비 부담: |
  단순 변심 반품은 고객이 왕복 배송비 6,000원을 부담하고 환불 금액에서 차감한다. 불량·오배송은 판매자가 부담하며 차감하지 않는다. 환불 자체는 [[환불]]이 다룬다.
  차감 방식과 순서는 [[환불:환불 금액]]이 정한다. 부분 반품 때문에 무료 배송 조건이 깨지는 경우는 [[배송비:반품 시 재계산]]이 따로 정한다.
검수와 결과: |
  회수한 상품은 2영업일 안에 검수한다. 통과하면 환불을 진행하고 주문 상태를 RETURNED로 바꾼다.
  검수에서 반려되면 상품을 고객에게 되돌려 보내고 상태를 DELIVERED로 되돌린다. 이 전이는 [[주문 상태:허용 전이]]가 허용하는 유일한 되돌림이다.
`,
  'fulfillment/shipping-fee.yaml': `_codocs:
  id: shipping-fee
  name: 배송비
  parent:
    - 배송
배송비 부과 기준: |
  기본 배송비는 3,000원이며 쿠폰과 즉시 할인을 적용한 뒤의 상품 금액이 30,000원 이상이면 무료다. 포인트 사용액은 이 판단에 영향을 주지 않는다.
  쿠폰으로 상품 금액이 30,000원 아래로 내려가면 배송비가 붙는다. 이유는 고객이 실제로 지불하는 상품 금액을 기준으로 해야 같은 상품이라도 쿠폰 사용 여부로 판매 조건이 흔들리지 않기 때문이다.
도서산간 추가: |
  제주와 도서산간 지역은 기본 배송비와 별개로 3,000원을 더 부과한다. 무료 배송 조건을 채워도 이 추가 배송비는 면제되지 않는다.
  VIP 회원도 도서산간 추가 배송비는 낸다. 지역 판정은 주문서 주소의 우편번호를 기준으로 한다.
VIP 무료 배송: |
  VIP 등급 회원은 상품 금액과 관계없이 기본 배송비를 내지 않는다. 등급 혜택의 정의는 [[회원 등급:등급 혜택]]에 있다.
  쿠폰 적용 후 금액이 낮은 주문에도 같은 면제를 적용하며, 배송비 쿠폰은 VIP 주문에서는 쓸 수 있는 금액이 없으므로 선택할 수 없다.
반품 시 재계산: |
  부분 반품으로 남은 상품 금액이 30,000원 미만이 되면 처음 주문의 무료 배송 조건이 깨진 것으로 보고 기본 배송비 3,000원을 환불 금액에서 차감한다.
  VIP는 면제 대상이므로 차감하지 않는다. 환불 금액 계산 순서는 [[환불:환불 금액]]에 있다.
`,
  'fulfillment/shipping.yaml': `_codocs:
  id: shipping
  name: 배송
  parent:
    - 쇼핑몰 개요
출고 기준: |
  결제 완료 후 1~3 영업일 안에 출고한다. 당일 출고 가능으로 표시된 상품은 평일 14:00 이전에 결제가 완료되면 그날 출고한다.
  14:00 이후 결제나 주말 결제는 다음 영업일 출고로 본다. 출고하면 [[주문 상태]]는 SHIPPED가 된다.
분할 배송: |
  한 주문의 상품이 서로 다른 창고에 있으면 배송 단위(shipment)를 나눠 보낸다. 주문 상태는 모든 shipment가 DELIVERED일 때 DELIVERED가 되고 하나라도 SHIPPED이면 SHIPPED다.
  분할 배송이어도 배송비는 주문 한 건에 한 번만 부과한다. 상태 규칙은 [[주문 상태:상태 목록]]에 있다.
배송지 제약: |
  배송은 국내 주소만 가능하다. 제주와 도서산간 지역은 추가 배송비가 붙으며 금액은 [[배송비:도서산간 추가]]에 있다.
  출고 후에는 배송지를 바꿀 수 없다. 출고 전 변경은 PREPARING 이전이면 고객이 직접, 그 뒤에는 CS 요청으로 한다.
배송 추적: |
  출고하면 택배사 송장번호를 등록하고 고객은 주문 상세에서 진행 상황을 볼 수 있다. 상태 동기화 주기와 분실 처리는 [[Delivery Tracking:Sync Interval]]과 [[Delivery Tracking:Lost Parcel]]에 있다.
`,
  'member/account-security.yaml': `_codocs:
  id: account-security
  name: Account Security
  parent:
    - 회원
Password Rules: |
  A password for a [[회원]] account must have at least 10 characters and mix letters, digits and symbols. A password equal to the email local part or to one of the last 3 passwords is rejected.
  Passwords are stored only as salted hashes and are never shown in support tools.
Lockout: |
  Five failed login attempts lock the account for 15 minutes, and the member receives an email about the lock. The counter resets after a successful login.
  The lock applies per account, not per IP address, so shared networks do not lock out other members.
Session Lifetime: |
  A member session lasts 14 days and slides forward on each use. An administrator session lasts 8 hours and does not slide.
  Withdrawing the account or changing the password ends all existing sessions at once.
Two-Factor Authentication: |
  Two-factor authentication is optional for members and mandatory for every administrator role listed in [[관리자 운영:관리자 역할]]. An administrator without it cannot open the admin console.
  Members who enable it are asked for the second factor only on new devices.
`,
  'member/member.yaml': `_codocs:
  id: member
  name: 회원
  parent:
    - 쇼핑몰 개요
가입 조건: |
  만 14세 이상만 가입할 수 있고 이메일 인증을 마쳐야 가입이 완료된다. 이메일은 한 계정에만 쓸 수 있으며 대소문자를 구분하지 않고 비교한다.
  가입이 완료되면 [[Coupon Issuance]]가 정한 웰컴 쿠폰이 발급되며 조건은 [[Coupon Issuance:Welcome Coupon]]에 있다.
휴면 전환: |
  마지막 로그인으로부터 1년이 지나면 휴면 계정으로 바꾸고 개인정보를 분리해 보관한다. 전환 30일 전에 이메일로 안내한다.
  휴면이어도 포인트 소멸은 멈추지 않는다. 휴면을 풀려면 본인 인증 후 로그인하면 된다. 안내 방식은 [[알림:거래 알림]]을 따른다.
탈퇴 제약: |
  진행 중인 주문(PAID, PREPARING, SHIPPED)이나 RETURN_REQUESTED 상태의 주문이 있으면 탈퇴할 수 없다. 남은 포인트와 쿠폰은 탈퇴와 함께 소멸한다.
  주문과 결제 기록은 5년 동안 보관하되 이름·연락처 같은 식별 정보는 분리해 보관한다. 상태 정의는 [[주문 상태:상태 목록]]에 있다.
비회원 구매: |
  비회원도 주문할 수 있지만 포인트와 쿠폰은 쓰지 못한다. 주문 조회는 orderId와 연락처 뒤 4자리로 하며 리뷰는 쓸 수 없다.
  비회원 장바구니의 보관 기간은 [[장바구니:보관 기간]]에 있고 비회원이 로그인하면 [[장바구니:로그인 병합]]이 일어난다.
`,
  'member/membership-tier.yaml': `_codocs:
  id: membership-tier
  name: 회원 등급
  parent:
    - 회원
등급 체계: |
  등급은 BRONZE, SILVER, GOLD, VIP 네 단계이며 가입하면 BRONZE에서 시작한다.
  등급은 [[포인트]]와 [[배송비]] 혜택의 크기를 정하는 값이며 계정 권한과는 무관하다.
산정 기준: |
  최근 6개월의 구매확정 금액 합계에서 같은 기간의 환불 금액을 뺀 값으로 정한다. SILVER는 100,000원, GOLD는 300,000원, VIP는 1,000,000원 이상이다.
  구매확정 시점은 [[Delivery Tracking:Auto Confirmation]]을 따르므로 배송 완료 직후의 주문은 아직 금액에 들어가지 않는다.
산정 시점과 강등: |
  등급은 매월 1일 00:00(KST)에 다시 계산한다. 승급은 여러 단계를 한 번에 오를 수 있지만 강등은 한 번에 한 단계만 내려간다.
  예를 들어 VIP인 회원이 구매가 없어 기준 미달이어도 다음 달에는 GOLD까지만 내려간다. 급격한 혜택 상실을 막기 위한 규칙이다.
등급 혜택: |
  BRONZE는 구매 적립률 1%, SILVER 1.5%, GOLD 2%, VIP 3%를 받는다. VIP는 기본 배송비가 면제되며 규칙은 [[배송비:VIP 무료 배송]]에 있다.
  GOLD 이상은 생일이 있는 달에 생일 쿠폰을 한 장 받는다. 쿠폰 구성은 [[쿠폰 정책:쿠폰 구성]]을 따르며 적립률 계산은 [[포인트 적립과 소멸:구매 적립률]]이 쓴다.
`,
  'ops/admin-audit-log.yaml': `_codocs:
  id: admin-audit-log
  name: Admin Audit Log
  parent:
    - 관리자 운영
Recorded Actions: |
  The log (owned by [[관리자 운영]]) records price changes, stock adjustments, coupon issue and revoke, refund approvals, review moderation, notification template changes, role changes and settlement confirmations. Plain reads of product data are not recorded, but settlement queries are (see Access below).
  Each action maps to a permission in [[관리자 운영:관리자 역할]], so an action without a matching permission never reaches the log.
Record Fields: |
  Every record has adminId, action, target, before, after, reason and a KST timestamp. before and after hold the changed fields only, not the whole object.
  A record without a reason is rejected for the actions that require one, such as price changes and stock adjustments.
Retention and Immutability: |
  Records are kept for 3 years and are append-only. A mistake is corrected by adding a new record that references the old one, never by editing it.
Access: |
  Only SUPER_ADMIN can read the log, and exporting it requires a reason that is itself recorded. SETTLEMENT queries on settlement data are also recorded here, as described in [[관리자 운영:정산 권한]].
`,
  'ops/admin-operations.yaml': `_codocs:
  id: admin-operations
  name: 관리자 운영
  parent:
    - 쇼핑몰 개요
관리자 역할: |
  관리자 역할은 CS, MD, SETTLEMENT, SUPER_ADMIN 네 가지이며 모든 행위를 [[Admin Audit Log]]에 남기고 한 사람이 여러 역할을 가질 수 있다. 모든 역할은 2단계 인증이 필수다.
  인증 규칙은 [[Account Security:Two-Factor Authentication]]에 있다. 역할은 SUPER_ADMIN만 부여하고 회수한다.
가격 변경 권한: |
  판매가와 즉시 할인의 변경은 MD만 할 수 있고 사유 입력이 필수다. 서버는 변경 요청마다 [[할인가 계산:즉시 할인 한도]]를 검사한다.
  CS와 SETTLEMENT는 가격을 볼 수만 있다. 가격 변경은 저장 즉시 반영되지만 검색 화면에는 [[Product Search:Index Freshness]]만큼 늦을 수 있다.
환불 승인: |
  환불은 CS가 처리하되 500,000원을 넘으면 SUPER_ADMIN의 2차 승인이 필요하다. 처리하는 사람과 승인하는 사람은 같을 수 없다.
  금액 계산은 [[환불:환불 금액]]이, 처리 기한은 [[Refund Timing:Processing Deadline]]이 정한다.
쿠폰 발행 권한: |
  쿠폰 발행과 회수는 MD만 할 수 있다. 정률 쿠폰은 최대 할인 금액을 반드시 입력해야 저장할 수 있으며 근거는 [[쿠폰 정책:정률 쿠폰 한도]]에 있다.
  단독 사용 표시는 쿠폰 생성 때만 지정할 수 있다.
정산 권한: |
  SETTLEMENT는 결제·환불 집계 조회와 정산 확정만 할 수 있다. 정산 확정 후에는 해당 기간의 환불 금액을 고칠 수 없고 다음 정산에 반영한다.
  모든 조회와 확정은 [[Admin Audit Log:Access]]에 따라 기록된다.
`,
  'ops/notification-templates.yaml': `_codocs:
  id: notification-templates
  name: Notification Templates
  parent:
    - 알림
Template Identity: |
  Each template has a unique templateId and exists in a ko and an en variant. The variant is chosen by the member's locale, and the ko variant is used when the en variant is missing.
  Templates for transactional messages cannot be deleted, only replaced by a new version.
Variables: |
  Placeholders are written in double curly braces, for example {{orderId}} and {{refundAmount}}. If a required variable has no value the message is not sent and the failure is logged.
  Variable values are formatted by the same rules as the storefront, so amounts follow [[가격 표시:통화와 서식]].
Length Limits: |
  An SMS body is limited to 90 bytes and a longer message is sent as LMS automatically. A push title is limited to 40 characters and a push body to 120 characters.
  Email subjects are limited to 60 characters to avoid truncation in common mail apps.
Channel Fallback: |
  When a push message fails, a transactional message falls back to email within 5 minutes. Marketing messages never fall back to another channel.
  The fallback keeps the original [[알림:발송 시간 제한]] rules, so only transactional messages may fall back at night.
Change Approval: |
  A template change needs approval from a SUPER_ADMIN and takes effect only after approval. Both the request and the approval are recorded in [[Admin Audit Log:Recorded Actions]].
`,
  'ops/notification.yaml': `_codocs:
  id: notification
  name: 알림
  parent:
    - 쇼핑몰 개요
알림 채널: |
  알림은 이메일, SMS, 앱 푸시 세 채널로 보내며 [[Notification Templates]]의 템플릿을 쓴다. 회원이 채널별로 수신 여부를 정할 수 있으나 거래 알림은 끌 수 없다.
  문구와 변수는 템플릿으로 관리하며 규칙은 [[Notification Templates:Template Identity]]에 있다.
거래 알림: |
  주문 완료, 결제, 배송, 환불, 포인트 소멸 예정, 휴면 전환 안내는 거래 알림이다. 수신 동의 없이 보내며 하루 중 어느 시간에도 보낸다.
  거래 알림은 회원이 반드시 알아야 하는 정보이므로 마케팅 수신을 거부해도 계속 받는다.
마케팅 알림 제한: |
  마케팅 알림은 수신에 동의한 회원에게만 보내며 동의는 2년마다 다시 확인한다. 재확인에 답하지 않으면 동의를 철회한 것으로 본다.
  재입고 알림은 신청 자체가 동의이므로 이 동의 확인 대상이 아니다. 대상은 [[품절 처리:재입고 알림]]에 있다.
발송 시간 제한: |
  마케팅 알림과 재입고 알림은 21:00부터 08:00 사이에는 보내지 않고 다음 08:00 이후로 미룬다. 거래 알림은 이 제한을 받지 않는다.
  미룬 알림이 하루를 넘기면 내용이 의미를 잃으므로 24시간이 지난 재입고 알림은 보내지 않고 버린다.
실패 처리: |
  푸시가 실패하면 이메일로 대체할 수 있는지 [[Notification Templates:Channel Fallback]]이 정한다. 이메일이 반송되면 계정에 이메일 오류 표시를 남기고 같은 주소로 마케팅 알림을 보내지 않는다.
`,
  'order/order-cancellation.yaml': `_codocs:
  id: order-cancellation
  name: Order Cancellation
  parent:
    - 주문
Self-Service Window: |
  Shoppers can cancel an [[주문]] themselves while it is in PENDING_PAYMENT or PAID. Once the status becomes PREPARING the self-service cancel button disappears.
  The cutoff is tied to the warehouse picking the goods, which is the first step that cannot be undone cheaply. Transitions are defined in [[주문 상태:허용 전이]].
CS Request Stage: |
  In PREPARING a customer must contact CS. A CS agent may approve the cancellation only if the parcel has not been handed to the carrier; otherwise the request is rejected and the shopper is guided to the return process in [[반품]].
  After approval the order moves to CANCELLED and the picked items go back to stock.
Side Effects: |
  A cancelled paid order triggers a refund according to [[환불:환불 금액]], releases any remaining reservation, and restores coupons by [[Coupon Issuance:Restoration After Cancellation]].
  Points used are restored immediately; earned points were never granted because accrual only happens after purchase confirmation.
Partial Cancellation: |
  Cancelling only some items of an order is not supported. The shopper cancels the whole order and places a new one for the items to keep.
  This keeps coupon and shipping fee calculations simple, because they depend on the full order amount described in [[주문:주문 금액 구성]].
`,
  'order/order-number.yaml': `_codocs:
  id: order-number
  name: 주문 번호
  parent:
    - 주문
형식: |
  orderId는 ORD-YYYYMMDD-NNNNNN 형식이다. 날짜는 주문 생성일(KST)이고 NNNNNN은 그날의 일련번호 6자리다. 하루 주문이 1,000,000건을 넘으면 새 번호를 만들지 않고 생성을 막는다.
  번호에서 고객 정보나 상품 정보를 짐작할 수 없게 일련번호는 날짜 안에서만 증가시킨다.
유일성과 재시도: |
  orderId는 한 번 만들어지면 바뀌지 않는다. 결제를 다시 시도해도 orderId는 그대로이고 시도마다 새 paymentId가 발급된다.
  재시도 횟수 규칙은 [[Payment Failure Handling:Retry Limit]]에 있으며, 이미 승인된 결제가 있는 orderId의 중복 결제는 [[결제:이중 결제 방지]]가 막는다.
외부 노출: |
  고객 화면과 알림에는 orderId만 보여주고 내부 식별자 orderItemId는 노출하지 않는다.
  비회원은 orderId와 주문 시 입력한 연락처 뒤 4자리로 주문을 조회한다. 5번 틀리면 15분 동안 조회를 막는다.
`,
  'order/order-status.yaml': `_codocs:
  id: order-status
  name: 주문 상태
  parent:
    - 주문
상태 목록: |
  주문 상태는 PENDING_PAYMENT, PAID, PREPARING, SHIPPED, DELIVERED, CANCELLED, RETURN_REQUESTED, RETURNED 여덟 가지다.
  상태는 주문 단위로만 가진다. 부분 배송은 주문 상태를 쪼개지 않고 [[배송:분할 배송]]의 배송 단위로 관리한다.
허용 전이: |
  PENDING_PAYMENT는 PAID 또는 CANCELLED로, PAID는 PREPARING 또는 CANCELLED로, PREPARING은 SHIPPED 또는 CANCELLED로 바뀐다.
  SHIPPED는 DELIVERED로, DELIVERED는 RETURN_REQUESTED로, RETURN_REQUESTED는 RETURNED 또는 검수 반려 시 DELIVERED로 바뀐다. 위에 없는 전이와 되돌리는 전이는 모두 거부한다.
  PREPARING에서의 취소는 고객이 직접 할 수 없고 CS 승인이 필요하며 조건은 [[Order Cancellation:CS Request Stage]]에 있다. 반려 사유는 [[반품:검수와 결과]]를 따른다.
결제 대기 만료: |
  PENDING_PAYMENT 상태가 30분 동안 이어지면 주문은 자동으로 CANCELLED가 된다. 가상계좌 주문은 30분이 아니라 입금 기한(3일)에 만료한다.
  만료로 취소되면 예약한 재고, 보류한 쿠폰과 포인트가 모두 풀린다. 재고 쪽 규칙은 [[Stock Reservation:Release Conditions]]에 있다.
종료 상태: |
  CANCELLED와 RETURNED는 종료 상태이며 이후 어떤 상태로도 바뀌지 않는다. 종료된 주문의 재주문은 새 orderId로 만든다.
  종료 상태에서 [[환불]] 처리가 끝나지 않았더라도 주문 상태는 그대로 두고 환불 상태만 따로 관리한다.
`,
  'order/order.yaml': `_codocs:
  id: order
  name: 주문
  parent:
    - 쇼핑몰 개요
주문 생성 조건: |
  주문은 모든 품목이 ON_SALE이고, 가용 재고가 충분하며, 수량이 purchaseLimit 안이고, 배송지가 유효할 때만 만들어진다.
  하나라도 실패하면 주문 전체를 거부하며 이후 단계는 [[결제]]가 맡는다. 그리고 일부 품목만 주문하는 부분 주문은 없다. 재고 예약 실패 처리는 [[Stock Reservation:Oversell Protection]]에 있다.
주문 구성: |
  주문은 orderId와 여러 orderItem으로 이루어지며 orderItem마다 skuId, quantity, unitPrice를 가진다. unitPrice는 주문 시점의 판매가를 스냅샷으로 저장한다.
  주문이 만들어진 뒤 판매가나 쿠폰 정책이 바뀌어도 이미 만들어진 주문의 금액은 달라지지 않는다. 번호 형식은 [[주문 번호:형식]]이 정한다.
주문 금액 구성: |
  결제 금액 = 상품 금액 - 즉시 할인 - 쿠폰 할인 - 포인트 사용액 + 배송비다. 적용 순서는 [[할인가 계산:적용 순서]]를 따른다.
  배송비는 쿠폰 적용 후 상품 금액으로 판단하며 기준은 [[배송비:배송비 부과 기준]]에 있다. 계산한 금액이 100원 미만이 되는 경우는 [[Tax and Rounding:Minimum Payable Amount]]가 막는다.
주문서 입력 제약: |
  수령인, 연락처, 주소는 필수이고 배송 메모는 최대 50자다. 주소는 국내 주소만 허용한다.
  출고 후에는 배송지를 바꿀 수 없으므로 [[주문 상태:허용 전이]]에서 PREPARING 이후의 변경은 CS 요청으로만 다룬다.
`,
  'overview/shop-overview.yaml': `_codocs:
  id: shop-overview
  name: 쇼핑몰 개요
목적과 범위: |
  이 문서 묶음은 가상의 온라인 쇼핑몰 "모아마켓"의 상품·주문·결제·배송·회원·운영 규칙을 정의한다.
  각 문서는 하나의 주제에 대한 제약·조건·예외와 그 판단 근거를 담당하며, 같은 규칙을 두 문서에서 다시 정의하지 않는다.
  실제 구현 방법이 아니라 서비스가 지켜야 하는 규칙만 다룬다.
영역 구성: |
  상품 영역은 [[상품]]과 [[재고]]가, 금액 영역은 [[가격 표시]]와 [[쿠폰 정책]]이 담당한다.
  거래 영역은 [[장바구니]]·[[주문]]·[[결제]]가, 사후 영역은 [[배송]]과 [[반품]]이 담당한다.
  사용자 영역은 [[회원]]과 [[알림]], 운영 영역은 [[관리자 운영]]이 담당한다.
  기간 한정 판매와 이벤트는 [[Promotion Campaigns]]에서 별도로 정한다.
공통 용어: |
  금액은 모두 KRW 원 단위 정수이며 표시 가격은 부가세 10%를 포함한다. 자세한 반올림 규칙은 [[Tax and Rounding:Rounding Rule]]에서 정한다.
  식별자는 productId, skuId, orderId, paymentId, couponId처럼 영어 camelCase로 쓴다.
  시간 기준은 한국 표준시(KST)이며 영업일은 평일에서 공휴일을 뺀 날이다.
`,
  'payment/payment-failure.yaml': `_codocs:
  id: payment-failure
  name: Payment Failure Handling
  parent:
    - 결제
Retry Limit: |
  A shopper can try to pay an order at most three times (see also [[결제]]). Every attempt gets a new paymentId while the orderId stays the same, as defined in [[주문 번호:유일성과 재시도]].
  After the third failure no more attempts are accepted, and the order simply waits in PENDING_PAYMENT until it expires. Switching the payment method does not reset the counter.
Failure Categories: |
  Failures are classified as USER_CANCELLED, CARD_DECLINED, TIMEOUT, or PG_ERROR. Only TIMEOUT and PG_ERROR trigger an automatic status check with the PG.
  USER_CANCELLED and CARD_DECLINED are final for that attempt, and the shopper is shown the reason code in plain language.
Unknown Result Handling: |
  If an attempt times out, the system queries the PG for the real result before allowing any retry. A retry is never sent while the previous result is unknown.
  The rule exists to avoid charging a shopper twice, which is also enforced by [[결제:이중 결제 방지]].
Resource Holding: |
  A failed attempt keeps the coupons, held points and stock reservation untouched, because the shopper may retry within the window. They are released only when the order is cancelled or expires.
  Stock holding limits follow [[Stock Reservation:Reservation Window]]; coupon and point holds follow the same expiry.
`,
  'payment/payment-method.yaml': `_codocs:
  id: payment-method
  name: 결제 수단
  parent:
    - 결제
지원 수단: |
  카드, 계좌이체, 간편결제, 가상계좌 네 가지를 지원한다. 한 주문은 포인트를 제외하면 하나의 결제 수단만 쓸 수 있다.
  포인트와 함께 쓰는 방식은 [[부분 결제:포인트 결합 결제]]에 있다.
가상계좌: |
  가상계좌는 주문마다 새 계좌를 발급하며 입금 기한은 3일이다. 입금액은 결제 금액과 정확히 같아야 하고, 모자라거나 초과하면 입금은 승인되지 않고 CS가 수동으로 환불한다.
  기한이 지나면 주문은 자동 취소된다. 이 주문의 재고 예약 연장은 [[Stock Reservation:Virtual Account Exception]]에 있다.
할부 제약: |
  카드 할부는 결제 금액이 50,000원 이상일 때만 2~12개월로 선택할 수 있고 그보다 적으면 일시불만 가능하다.
  무이자 할부는 캠페인에서 지정한 카드사와 개월 수에 한해서만 제공한다. 캠페인 정의는 [[Promotion Campaigns:Campaign Period]]를 따른다.
수단별 환불: |
  카드는 승인 취소, 계좌이체와 간편결제는 원래 수단으로 환불한다. 가상계좌는 환불 받을 본인 명의 계좌를 고객이 입력해야 한다.
  환불 수단의 상세 규칙은 [[환불:환불 수단]]에 있으며 처리 기한은 [[Refund Timing:Processing Deadline]]을 따른다.
`,
  'payment/payment.yaml': `_codocs:
  id: payment
  name: 결제
  parent:
    - 쇼핑몰 개요
결제 흐름: |
  결제는 주문 생성 후 시작한다. 결제 시도마다 paymentId를 발급하고 외부 결제 대행사(PG)의 승인 결과를 받으면 주문을 PAID로 바꾼다.
  결제 수단별 제약은 [[결제 수단]]에, 포인트 결합은 [[부분 결제]]에, 실패한 시도의 처리는 [[Payment Failure Handling:Retry Limit]]에 있다.
결제 금액 검증: |
  서버는 승인 요청 전에 주문 금액을 다시 계산하고 클라이언트가 보낸 금액과 비교한다. 1원이라도 다르면 PAYMENT_AMOUNT_MISMATCH로 거부한다.
  클라이언트 금액을 신뢰하지 않는 이유는 변조된 요청으로 낮은 금액이 승인되는 일을 막기 위해서다.
이중 결제 방지: |
  같은 orderId에 승인된 결제가 이미 있으면 새 결제 요청은 거부한다. 요청에는 멱등키를 포함하며 같은 멱등키의 재요청은 이전 결과를 그대로 돌려준다.
  결과를 모르는 상태에서 다시 시도하지 않는 규칙은 [[Payment Failure Handling:Unknown Result Handling]]에 있다.
결제 완료 후 처리: |
  승인되면 주문 상태를 PAID로 바꾸고 [[재고:재고 차감 시점]]에 따라 실재고를 줄인다. 이어서 주문 완료 알림을 보내고 포인트 적립 예정 내역을 만든다.
  포인트는 이 시점에 지급하지 않으며 지급 시점은 [[포인트 적립과 소멸:적립 시점]]이 정한다.
`,
  'payment/split-payment.yaml': `_codocs:
  id: split-payment
  name: 부분 결제
  parent:
    - 결제
포인트 결합 결제: |
  주문 금액의 일부를 포인트로, 나머지를 [[결제 수단]] 하나로 낼 수 있다. 포인트 사용액은 결제 요청 시점에 보류하고 승인 성공 후에 실제로 차감한다.
  승인에 실패하면 포인트는 차감되지 않고 보류만 남으며 해제 조건은 주문 만료와 같다.
포인트 사용 한도: |
  포인트는 1,000P 이상부터 100P 단위로 쓸 수 있다. 사용 한도는 쿠폰 적용 후 상품 금액의 50% 이하이며 배송비에는 포인트를 쓸 수 없다.
  쿠폰이 먼저 적용되고 포인트가 나중에 적용되는 순서는 [[할인가 계산:적용 순서]]에 있다. 보유 포인트의 기본 규칙은 [[포인트:사용 조건]]이 정한다.
전액 포인트 결제 불가: |
  위 50% 한도 때문에 포인트만으로 주문 전체를 결제할 수 없다. 최소 결제 금액 100원 규칙도 같은 결과를 보장하며 [[Tax and Rounding:Minimum Payable Amount]]에 있다.
  이 제한은 포인트로만 상품을 가져가는 일을 막고 결제 대행사 승인을 거치는 금액이 항상 남게 한다.
`,
  'pricing/discount-calculation.yaml': `_codocs:
  id: discount-calculation
  name: 할인가 계산
  parent:
    - 가격 표시
할인율 계산: |
  할인율은 (정가 - 판매가) / 정가 x 100을 소수점 이하 버림한 정수 퍼센트다. 예를 들어 정가 19,900원, 판매가 15,900원이면 20.1%이므로 20%다.
  버림을 쓰는 이유는 반올림하면 실제보다 큰 할인율이 표시될 수 있기 때문이다.
즉시 할인 한도: |
  즉시 할인은 정가의 70%를 넘을 수 없다. 판매가가 정가의 30% 미만이 되는 저장 요청은 서버가 거부한다.
  가격 입력 실수로 터무니없는 가격에 팔리는 사고를 막기 위한 한도이며, 변경 권한은 [[관리자 운영:가격 변경 권한]]에 따른다.
적용 순서: |
  금액은 즉시 할인, 상품 쿠폰, 주문 쿠폰, 포인트 순으로 줄어든다. 포인트는 마지막이며 쿠폰이 적용된 뒤의 금액을 기준으로 한도를 계산한다.
  쿠폰 사이의 순서는 [[쿠폰 중복 적용:적용 순서]]가, 포인트 한도는 [[부분 결제:포인트 사용 한도]]가 정한다.
기간 한정 가격: |
  캠페인 기간에 적용하는 가격은 캠페인이 끝나는 즉시 원래 판매가로 돌아온다. 화면 반영은 최대 1분까지 늦을 수 있다.
  기간 한정 가격도 위의 [[할인가 계산:즉시 할인 한도]]를 넘을 수 없으며 세부 규칙은 [[Promotion Campaigns:Flash Sale Price]]에 있다.
`,
  'pricing/inventory.yaml': `_codocs:
  id: inventory
  name: 재고
  parent:
    - 상품
재고 구성: |
  SKU마다 stockQuantity(실재고), reservedQuantity(예약 수량), safetyStock(안전 재고)를 관리한다. safetyStock의 기본값은 5이며 상품별로 0~50까지 바꿀 수 있다.
  safetyStock은 고객에게 팔지 않고 남겨두는 수량으로, 입고 지연이나 검수 불량에 대비한다.
가용 재고: |
  availableQuantity = stockQuantity - reservedQuantity - safetyStock이며 음수가 되면 0으로 본다.
  고객이 [[장바구니]]에 담거나 [[주문]]할 수 있는 수량의 상한은 항상 availableQuantity다. 이 값이 0이면 [[품절 처리:품절 판정]]에 따라 SOLD_OUT이 된다.
재고 차감 시점: |
  주문을 만들 때는 stockQuantity를 줄이지 않고 reservedQuantity만 늘린다. 결제가 완료되면 stockQuantity를 줄이고 같은 수량의 예약을 해제한다.
  예약의 유지 시간과 해제 조건은 [[Stock Reservation:Reservation Window]]에서 정한다. 결제 전에 실재고를 줄이면 미결제 주문이 재고를 오래 묶기 때문이다.
재고 조정 권한: |
  실재고 수동 조정은 MD 또는 SUPER_ADMIN 역할만 할 수 있고 사유 입력이 필수다. 조정할 때마다 [[Admin Audit Log:Recorded Actions]]에 이전 값과 이후 값이 남는다.
  reservedQuantity는 어떤 역할도 직접 고칠 수 없으며 주문 상태 변화로만 바뀐다.
`,
  'pricing/product-price.yaml': `_codocs:
  id: product-price
  name: 가격 표시
  parent:
    - 쇼핑몰 개요
표시 구성: |
  ProductPrice는 정가(listPrice), 판매가(salePrice), 할인율을 보여준다. 할인이 없으면 판매가 하나만 보여준다.
  할인 중이면 정가에 취소선을 긋고 판매가를 더 크게 표시한다. 할인율은 [[할인가 계산:할인율 계산]]이 정한 정수 퍼센트를 쓴다.
통화와 서식: |
  금액은 KRW 정수이며 천 단위마다 쉼표를 찍고 뒤에 "원"을 붙인다. 소수점은 어떤 화면에서도 표시하지 않는다.
  표시 가격은 부가세를 포함한 금액이며 별도 부가세 줄을 보여주지 않는다. 근거는 [[Tax and Rounding:Tax Inclusive Display]]에 있다.
할인율 배지 기준: |
  할인율이 5% 미만이면 할인율 배지는 숨긴다. 단 정가 취소선은 할인이 1원이라도 있으면 계속 보여준다.
  이유는 1~4% 배지가 목록의 시선을 끌어 실제 혜택보다 크게 보이는 것을 막기 위해서다. 배지 개수 제한은 [[상품 카드:표시 제약]]이 정한다.
쿠폰 적용가 표시 범위: |
  쿠폰 적용가는 장바구니와 주문서에서만 보여준다. 상품 목록과 상세에는 "쿠폰 적용 시 최대 혜택가" 같은 문구도 넣지 않는다.
  쿠폰은 회원별 보유 여부와 [[쿠폰 중복 적용:중복 허용 범위]]에 따라 달라져 상품 단위로 확정할 수 없기 때문이다.
`,
  'pricing/sold-out.yaml': `_codocs:
  id: sold-out
  name: 품절 처리
  parent:
    - 재고
품절 판정: |
  SKU의 [[재고:가용 재고]]가 0이면 그 SKU는 SOLD_OUT이다. 옵션이 여러 개인 상품은 모든 SKU가 SOLD_OUT일 때만 상품 전체를 품절로 본다.
  하나라도 팔 수 있는 SKU가 남아 있으면 상품 카드에 품절 배지가 붙지 않는다. 카드의 표시 방식은 [[상품 카드:품절 상태]]에 있다.
장바구니와 주문 제약: |
  품절 SKU는 장바구니에 새로 담을 수 없다. 이미 담겨 있던 품절 SKU는 삭제하지 않고 "품절" 표시만 붙여 유지한다.
  주문서로 진행할 때는 품절 SKU를 자동으로 제외하고 안내한다. 가용 재고보다 많은 수량을 담은 경우의 처리는 [[장바구니 수량 제한:재고 부족 시]]에서 정한다.
재입고 알림: |
  한 회원은 최대 20개 SKU에 재입고 알림을 신청할 수 있다. 가용 재고가 1 이상이 되면 한 번만 발송하고 신청은 자동으로 끝난다.
  재입고 알림은 신청 자체가 동의이므로 마케팅 수신 동의가 따로 필요 없지만, 야간 발송 제한은 똑같이 적용한다. 시간 규칙은 [[알림:발송 시간 제한]]을 따른다.
선주문 예외: |
  선주문(preorder) 상품은 availableQuantity가 0이어도 판매하며 상세에 출고 예정일을 표시한다. 선주문 가능 수량의 상한은 상품마다 별도로 정한다.
  선주문 상품이 일반 재고 상태로 바뀌면 이후부터는 위 [[품절 처리:품절 판정]]을 그대로 적용한다.
`,
  'pricing/stock-reservation.yaml': `_codocs:
  id: stock-reservation
  name: Stock Reservation
  parent:
    - 재고
Reservation Window: |
  Stock (see [[재고]]) is reserved for 30 minutes from the moment an order is created. This equals the PENDING_PAYMENT expiry in [[주문 상태:결제 대기 만료]], so a reservation never outlives its unpaid order.
  Keeping the two timers identical removes the case where an order is still payable but its stock has already been given to someone else.
Virtual Account Exception: |
  Orders paid by virtual account hold the reservation until the deposit deadline, which is 3 days (see [[결제 수단:가상계좌]]). The window can be extended this way only once.
  This is the only case where a reservation is longer than 30 minutes.
Release Conditions: |
  A reservation is released when the order expires, is cancelled, or the deposit deadline passes. A failed payment attempt does not release it, because the shopper may retry within the window; see [[Payment Failure Handling:Resource Holding]].
  Successful payment converts the reservation into a real stock deduction as described in [[재고:재고 차감 시점]].
Oversell Protection: |
  A reservation request that would push availableQuantity below zero is rejected with OUT_OF_STOCK. The system never reserves a partial quantity.
  When the request contains several SKUs, the whole order creation fails; there is no partial order, as stated in [[주문:주문 생성 조건]].
`,
  'pricing/tax-and-rounding.yaml': `_codocs:
  id: tax-and-rounding
  name: Tax and Rounding
  parent:
    - 가격 표시
Tax Inclusive Display: |
  Every price shown to shoppers includes the 10% value-added tax. The storefront never adds tax on top of a displayed price at checkout.
  Because of this, a product priced at 11,000 KRW is charged exactly 11,000 KRW, and the tax portion (1,000 KRW) is only separated on receipts.
Rounding Rule: |
  When a discount is split across several order lines, each line's share is rounded down to a whole won. The remainder is added to the last line so the shares always sum to the original discount.
  The same rule applies when a partial refund has to split an order coupon, as described in [[환불:환불 금액]].
Minimum Payable Amount: |
  After all discounts the payable amount of an order never drops below 100 KRW. Coupons are reduced to honor this floor instead of the order being rejected; see [[쿠폰 중복 적용:최소 결제금액 보장]].
  Points cannot be used to cover the last 100 KRW either, so a fully points-paid order is impossible.
`,
  'promotion/coupon-issuance.yaml': `_codocs:
  id: coupon-issuance
  name: Coupon Issuance
  parent:
    - 쿠폰 정책
Issuance Limits: |
  Each couponId can be issued to one user only once unless the coupon is marked multi. A coupon also has a total issuance cap; download coupons are first-come-first-served and the cap check and the issue happen atomically.
  When the cap is reached the download button shows "closed" and no new coupon is created, even for users who have never tried.
Default Validity: |
  Unless the campaign sets a different end date, an issued coupon is valid for 30 days from the issuance moment. A fixed end date, when present, always wins over the 30-day rule.
Welcome Coupon: |
  A new member receives one welcome coupon after email verification completes: a FIXED 3,000 KRW coupon with a 20,000 KRW minimum order. It is issued once per account and is never reissued after withdrawal and re-registration with the same email.
  Account rules are in [[회원:가입 조건]].
Restoration After Cancellation: |
  When an order is cancelled or refunded in full, a USED coupon returns to ISSUED if it is still within its validity period at that moment. An expired coupon is not restored.
  If the refund is the seller's fault (defect or wrong item), the coupon is restored even when expired and its validity is extended by 7 days. See [[환불:쿠폰과 포인트 처리]] for how partial refunds treat coupons.
Revocation: |
  An administrator with the MD role can revoke a coupon, which moves ISSUED coupons to REVOKED. Coupons in RESERVED are not affected and complete normally if payment succeeds.
  Revocation is written to [[Admin Audit Log:Recorded Actions]] together with the reason.
`,
  'promotion/coupon-policy.yaml': `_codocs:
  id: coupon-policy
  name: 쿠폰 정책
  parent:
    - 쇼핑몰 개요
쿠폰 구성: |
  쿠폰은 couponId로 식별하며 유형(FIXED 정액, RATE 정률), 최소 주문금액, 유효기간, 적용 대상(PRODUCT 상품, ORDER 주문, SHIPPING 배송비)을 가진다.
  하나의 쿠폰은 적용 대상이 하나뿐이며 발행은 [[관리자 운영]]의 MD 권한이다. 대상이 다른 쿠폰을 한 주문에서 함께 쓰는 규칙은 [[쿠폰 중복 적용]]에서 정한다.
정률 쿠폰 한도: |
  RATE 쿠폰은 maxDiscountAmount(최대 할인 금액)를 반드시 가져야 한다. 한도가 없는 정률 쿠폰은 발행 단계에서 거부한다.
  고가 상품에 쓰였을 때 할인액이 예상보다 훨씬 커지는 사고를 막기 위한 규칙이다.
사용 조건: |
  최소 주문금액은 즉시 할인이 적용된 뒤의 금액으로 판단하고 포인트 사용 전 금액을 기준으로 한다. 유효기간이 지난 쿠폰은 쓸 수 없다.
  상품 쿠폰은 적용 대상으로 지정된 상품에만 쓸 수 있다. 중복과 적용 순서는 [[쿠폰 중복 적용:적용 순서]]가 정한다.
쿠폰 사용 상태: |
  쿠폰 상태는 ISSUED, RESERVED, USED, EXPIRED, REVOKED 다섯 가지다. 결제를 시도하면 RESERVED가 되고 승인되면 USED가 된다.
  RESERVED 쿠폰은 주문이 만료되거나 취소되면 ISSUED로 돌아간다. 발급 한도와 회수는 [[Coupon Issuance:Issuance Limits]]와 [[Coupon Issuance:Revocation]]에 있다.
`,
  'promotion/coupon-stacking.yaml': `_codocs:
  id: coupon-stacking
  name: 쿠폰 중복 적용
  parent:
    - 쿠폰 정책
중복 허용 범위: |
  한 주문에서 상품 쿠폰은 같은 상품에 1장까지, 주문 쿠폰은 주문당 1장, 배송비 쿠폰은 주문당 1장만 쓸 수 있다. 서로 다른 상품에는 상품 쿠폰을 각각 쓸 수 있다.
  적용 대상이 다른 쿠폰끼리는 함께 쓸 수 있으며, 같은 couponId로 발급된 여러 장도 한 주문에는 1장만 쓴다.
  이유는 같은 종류의 할인이 겹쳐 상품 가격보다 훨씬 낮아지는 것을 막기 위해서다.
적용 순서: |
  상품 쿠폰, 주문 쿠폰, 배송비 쿠폰 순으로 적용한다. 주문 쿠폰은 상품 쿠폰이 반영된 뒤의 금액을 기준으로 정률 할인을 계산한다.
  배송비 쿠폰은 [[배송비:배송비 부과 기준]]으로 정한 배송비에서만 깎으며 상품 금액에는 영향을 주지 않는다.
최소 결제금액 보장: |
  쿠폰 할인의 합이 결제 금액을 100원 미만으로 만들면 마지막에 적용한 쿠폰의 할인액을 줄여 100원을 남긴다. 주문을 거부하지는 않는다.
  줄어든 쿠폰도 사용 처리되며 차액은 돌려주지 않는다. 이 하한의 근거는 [[Tax and Rounding:Minimum Payable Amount]]에 있고, 위 [[쿠폰 중복 적용:적용 순서]]가 마지막 쿠폰을 정한다.
단독 사용 쿠폰: |
  캠페인 쿠폰 중 exclusive 표시가 된 쿠폰은 다른 어떤 쿠폰과도 함께 쓸 수 없다. 주문에 담긴 쿠폰 선택을 바꿀 때 이미 선택한 쿠폰이 있으면 선택을 교체하도록 안내한다.
  표시 기준은 [[Promotion Campaigns:Exclusive Coupons]]에서 정하며 위 [[쿠폰 중복 적용:중복 허용 범위]]보다 우선한다.
`,
  'promotion/point-accrual.yaml': `_codocs:
  id: point-accrual
  name: 포인트 적립과 소멸
  parent:
    - 포인트
적립 종류: |
  포인트는 구매 적립, 리뷰 적립, 이벤트 적립 세 종류다. 리뷰 적립은 사진 리뷰 500P이며 조건은 [[Product Reviews:Photo Review Reward]]에 있다.
  이벤트 적립의 지급 기준은 캠페인마다 [[Promotion Campaigns:Campaign Period]] 안에서 정한다.
구매 적립률: |
  구매 적립률은 회원 등급별로 BRONZE 1%, SILVER 1.5%, GOLD 2%, VIP 3%다. 적립 기준 금액은 실제 결제 금액에서 배송비와 포인트 사용액을 뺀 금액이다.
  등급은 [[회원 등급:등급 혜택]]에서 정하며 적립 시점의 등급이 아니라 구매확정 시점의 등급을 쓴다. 소수점 이하는 버린다.
적립 시점: |
  구매 적립은 구매확정 때 지급한다. 구매확정은 고객이 직접 누르거나 배송 완료 7일 뒤 자동으로 이뤄지며 자동 확정 규칙은 [[Delivery Tracking:Auto Confirmation]]에 있다.
  결제 완료 시점에 지급하지 않는 이유는 반품·환불될 주문에 포인트가 먼저 나가는 일을 줄이기 위해서다.
소멸 규칙: |
  포인트는 적립일부터 1년이 지나면 소멸한다. 사용과 소멸 모두 먼저 적립한 포인트부터 처리한다(FIFO).
  소멸 30일 전에 [[알림:거래 알림]]으로 소멸 예정 포인트를 안내한다. 휴면 회원도 소멸 일정은 그대로 진행한다.
환불 시 회수: |
  환불로 취소된 금액에 비례해 적립 포인트를 회수한다. 이미 사용한 포인트라서 회수할 수 없는 부분은 환불 금액에서 같은 금액을 차감한다.
  회수와 차감은 [[환불:환불 금액]]을 계산할 때 함께 반영한다.
`,
  'promotion/points.yaml': `_codocs:
  id: points
  name: 포인트
  parent:
    - 쇼핑몰 개요
포인트 정의: |
  포인트는 1P가 1원의 결제 금액으로 쓰이는 적립금이며 [[회원 등급]]에 따라 적립률이 달라진다. 현금으로 환급할 수 없고 다른 회원에게 양도할 수도 없다.
  적립 종류와 시점은 [[포인트 적립과 소멸]]에서, 소멸 규칙도 같은 문서에서 정한다.
사용 조건: |
  포인트는 1,000P 이상부터 100P 단위로 쓸 수 있다. 사용 한도와 보류 방식은 [[부분 결제:포인트 사용 한도]]에서 정한다.
  비회원은 포인트를 쓰거나 적립받을 수 없다.
보유 한도: |
  한 회원이 가질 수 있는 포인트는 최대 500,000P다. 한도를 넘는 적립은 초과분을 지급하지 않고 알림으로 안내한다.
  이 한도는 소멸 예정 포인트를 포함한 보유 잔액을 기준으로 계산한다.
포인트 내역 조회: |
  적립·사용·소멸·회수 내역을 사유와 함께 3년 동안 조회할 수 있다. 회수된 포인트는 원래 적립 내역과 연결해서 보여준다.
  환불로 인한 변동 내역은 [[환불:쿠폰과 포인트 처리]]와 같은 사유 코드로 표시한다.
`,
  'promotion/promotion-campaigns.yaml': `_codocs:
  id: promotion-campaigns
  name: Promotion Campaigns
  parent:
    - 쇼핑몰 개요
Campaign Period: |
  A campaign has a start and an end timestamp in KST and can last at most 31 days. Anything that depends on the campaign, such as special prices, coupons ([[쿠폰 정책]]) or interest-free installments, ends at the same moment.
  Ending is applied within 1 minute; there is no grace period for orders already in the checkout page.
Flash Sale Price: |
  During a campaign a flash sale price replaces the normal salePrice. The price still cannot go below the 70% immediate discount limit defined in [[할인가 계산:즉시 할인 한도]].
  When the campaign ends the price returns to the normal salePrice as described in [[할인가 계산:기간 한정 가격]].
Flash Sale Inventory: |
  Flash sale stock is allocated separately and does not draw from the regular [[재고]] of the same SKU. Unsold flash sale stock returns to regular stock when the campaign ends.
  Each shopper can buy at most 3 units, a limit enforced as described in [[장바구니 수량 제한:기간 한정 상품 한도]].
Exclusive Coupons: |
  A campaign coupon flagged exclusive cannot be combined with any other coupon. The flag can only be set by an MD administrator when the coupon is created and cannot be changed afterwards.
  The combination rule that this flag overrides is in [[쿠폰 중복 적용:중복 허용 범위]], and the exclusive behavior is [[쿠폰 중복 적용:단독 사용 쿠폰]].
`,
};
