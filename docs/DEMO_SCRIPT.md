# Three-Minute Demo Script

Run `pnpm demo` for the terminal walkthrough, or open the dashboard at
`pnpm --filter @arctreasury/web dev`. The scenario is Northstar Pay.

## 0:00 to 0:20, the problem

Northstar Pay must fund weekend merchant and contractor payouts, but a Friday fiat
receivable is delayed to Monday. Static buffers trap capital; underfunding causes missed
payouts. The environment badge shows Arc Testnet, Simulation, Demo Data, so it is clear
what is real.

## 0:20 to 0:50, forecast and obligations

Show the 48-hour forecast for the EU settlement wallet. Base case stays covered. The
downside scenario (delayed receivable, outflows up five percent) breaches the stressed
reserve, with the earliest shortfall at the weekend contractor payout. Show the obligations
table and rail availability: the EUR bank rail is past its Friday cutoff and closed for the
weekend.

## 0:50 to 1:20, optimization

Show the recommended action: the smallest safe rebalance from the US wallet to the EU wallet,
2,010,000 USDC over the 24/7 Arc rail. Show the latest safe execution time, the binding
constraint (weekend payout SLA plus closed bank rail), and the shadow-mode comparison against a
3,000,000 USDC static buffer: 990,000 USDC released, prefunding down 33.0 percent, all mandatory
obligations still covered.

## 1:20 to 1:45, controls

Show the Settlement Coverage Certificate with its base-case and stressed coverage and its
SHA-256 commitment. Show the deterministic policy checks, all passing. Then attempt an unsafe
larger release of 3,500,000 USDC and show it is blocked: it exceeds the per-transaction cap, so
the verifier fails and the proposal cannot become approvable.

## 1:45 to 2:20, human approval and Arc

Approve the safe proposal with the human approver. The proposal moves to approved. Execute over
the Arc rail. In the live path this submits a real Arc Testnet transaction through the deployed
executor after simulation.

## 2:20 to 2:40, proof

Show the transaction hash, block number, and the Arc explorer link. Verify the private
certificate against its on-chain commitment: the recomputed SHA-256 matches the bytes32 stored
on Arc, without revealing any treasury data. Show the audit hash-chain is intact.

## 2:40 to 3:00, recovery and business value

Simulate a delayed route. The prior approval is invalidated and re-execution of the settled
proposal is refused; ArcTreasury replans into a new proposal without repeating the original
settlement. Close on the measurable outcome: lower prefunding, capital released, and every
obligation covered on time, with complete audit evidence.

## Judge takeaway in one line

AI prepared the analysis, deterministic policy and an independent verifier gated it, a human
approved it, Arc executed it, and the certificate proves coverage. AI never moved the money.
