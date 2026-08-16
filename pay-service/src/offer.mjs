import {
  BOARD_HOST,
  CAPACITY,
  NETWORK,
  PAY_HOST,
  PRICE_ATOMIC,
  PRICE_USDC,
  SERVICE_ID,
  SERVICE_NAME,
  USDC_BASE
} from "./constants.mjs";

export function offerDocument({ payTo, capacityUsed = 0 }) {
  return {
    id: SERVICE_ID,
    name: SERVICE_NAME,
    host: PAY_HOST,
    board: BOARD_HOST,
    price: {
      amount: PRICE_USDC,
      asset: "USDC",
      network: NETWORK,
      atomic: PRICE_ATOMIC,
      asset_address: USDC_BASE,
      pay_to: payTo,
      scheme: "exact"
    },
    capacity: { limit: CAPACITY, used: capacityUsed },
    delivery_target_days: 7,
    limitations: [
      "Public GitHub repositories only",
      "No private credentials or deploy access",
      "No security certification or guaranteed score",
      "One focused draft pull request per paid order",
      "Manual refunds only — no automatic on-chain refund"
    ],
    independence:
      "Payment never buys rank, score, editorial treatment, security outcome, merge, deploy, or publication. The board only observes change after the maintainer publishes the package.",
    inquiry: `${PAY_HOST}/api/inquiry`,
    x402_pay_route: `${PAY_HOST}/api/pay/{reservation}`
  };
}

export function discoveryDocument({ payTo }) {
  return {
    x402Version: 2,
    host: PAY_HOST,
    resources: [
      {
        resource: `${PAY_HOST}/api/pay/{reservation}`,
        type: "http",
        accepts: [
          {
            scheme: "exact",
            network: NETWORK,
            amount: PRICE_ATOMIC,
            asset: USDC_BASE,
            payTo,
            maxTimeoutSeconds: 60,
            extra: { name: "USDC", version: "2" }
          }
        ]
      }
    ]
  };
}
