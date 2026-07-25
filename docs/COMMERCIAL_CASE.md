# Commercial Case

## Ideal customer profile

A cross-border PSP, remittance platform, B2B payment provider, marketplace, payroll
platform, or fintech that operates settlement or payouts 24/7 across multiple
counterparties, corridors, wallets, or chains, must prefund settlement accounts before
incoming fiat or receivables arrive, and processes roughly $50M to $1B in annual payment
volume. Large enough that liquidity inefficiency is expensive, not large enough to be
served well by a bespoke bank-grade treasury stack.

## Buyer and users

- Economic buyer: Head of Treasury, Treasurer, CFO, VP Payments, or Head of Settlement Operations.
- Daily users: treasury analyst and settlement-operations manager.
- Approver: treasury director or controller.

## Current workflow (what we are replacing)

Analysts assemble positions from bank portals, custodian dashboards, and spreadsheets,
apply static buffers sized for the worst case, and make funding decisions under time
pressure before cutoffs and weekends. Evidence that obligations were covered is
reconstructed after the fact.

## Pain and trigger events

- A delayed receivable or a large payout batch that threatens an SLA.
- Weekend and holiday windows when banks are closed but payouts continue.
- Month-end and audit periods when coverage evidence is demanded.
- A near-miss or an actual missed settlement.

## Alternatives and positioning

Kyriba, Trovata, and general TMS platforms focus on forecasting and cash visibility.
Fireblocks and custodians focus on custody and transfer. ArcTreasury is neither. It is
the decisioning and orchestration layer between forecasting/data systems and
custody/settlement rails: it turns a forecast plus contractual obligations plus rail
availability into a governed, verifiable, minimal funding action. It is non-custodial and
rail-neutral, with Arc as a first-class 24/7 rail.

## Measurable outcomes

- Lower average prefunded balances and peak prefunding.
- Fewer emergency top-ups and fewer failed or late settlements.
- Higher payment volume supported per dollar of liquidity.
- Fewer hours assembling positions and approvals; faster decisions with complete audit evidence.

## ROI formulas (shadow mode)

Shadow mode compares ArcTreasury's recommended dynamic funding against a configurable
static-buffer baseline without moving money. Every figure is computed from the dataset:

- Capital released = static buffer minus verified minimum top-up.
- Dollar-hours idle = amount times hours idle, summed. Lower is better.
- Prefunding reduction percent = capital released divided by static buffer.
- Avoided shortfalls = obligations that would breach under the downside scenario with no action.

In the Northstar demo, against a 3,000,000 USDC static buffer, the verified minimum top-up is
2,010,000 USDC, a 33.0 percent reduction in prefunding, while all mandatory obligations stay
covered under stress. Figures are counterfactual and not annualized.

## Shadow-mode pilot

A prospect connects read-only position and obligation data. ArcTreasury runs in shadow for a
few settlement cycles, producing the recommendation, the certificate, and the counterfactual
savings next to the customer's actual static-buffer practice, with zero money movement. The
pilot succeeds if capital released and avoided shortfalls are material and the coverage
evidence is trusted.

## Pricing hypotheses (unvalidated)

- Platform fee by settlement volume tier, plus a per-certificate or per-approved-action fee.
- A shadow-mode pilot at low or no cost to prove savings before the platform fee starts.
These are hypotheses to test in discovery, not commitments.

## Integration dependencies

Read access to positions and obligations (bank, custodian, ledger, or CSV), customer-controlled
wallets or an authorized custodian for execution, and rail calendars. ArcTreasury does not hold
customer funds.

## Regulatory and custody perimeter

Non-custodial decisioning and orchestration software. It does not make legal or compliance
determinations, does not perform sanctions screening, and does not replace accounting or
reconciliation. The on-chain contract governs only the balance it custodies.

## Commercial kill criteria

- Prospects will not grant read access to positions and obligations.
- Static buffers are already near-optimal, so released capital is immaterial.
- Approvers will not trust a machine-generated coverage certificate as evidence.
- The regulatory perimeter forces custody, which is out of scope.

## Unvalidated assumptions

That treasurers will act on a minimal-funding recommendation over a familiar static buffer,
that the certificate is accepted as audit evidence, that a 24/7 stablecoin rail is usable in
their operating and compliance context, and that the pricing model clears their ROI bar. These
are the first things customer discovery must test.
