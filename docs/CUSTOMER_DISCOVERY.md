# Customer Discovery

No interviews have been conducted yet. Nothing below is evidence. This is the plan and
the hypothesis ledger to be filled with real, attributed evidence. No quotes, logos,
customers, or traction are invented.

## Target participants

- Treasurers, heads of settlement operations, and treasury analysts at payments companies
  with roughly $50M to $1B annual volume that prefund settlement accounts.
- Cross-border PSPs, remittance platforms, marketplaces, and payroll platforms that run
  payouts across weekends and multiple corridors.

## Recruitment plan (five design partners)

1. Warm introductions from payments and treasury networks.
2. Founder and operator communities in cross-border payments and stablecoins.
3. Targeted outreach to settlement-ops leaders, offering the shadow-mode pilot as the hook.
4. Relevant Slack and Discord communities (for example the Build on Circle community).
5. A short, specific screener so calls are with the right role.

Target five design partners willing to run shadow mode on read-only data.

## Interview guide (non-leading)

Open with the current world, not the product.

- Walk me through how you decided funding amounts for your settlement accounts last Friday.
- When did you last come close to missing a payout or settlement? What happened?
- How do you size the buffer you keep in each settlement wallet or account? What drives the number?
- What happens to funding decisions over a weekend or a holiday?
- Who signs off on moving money, and what do they need to see before they approve?
- How do you prove after the fact that every obligation was covered?
- Which systems hold the data you would need to answer that, and how connected are they?
- If you could see one number before each cutoff, what would it be?

## Questions the discovery must answer

- Current prefunding: how is the buffer sized, and how much is idle on a typical day?
- Settlement failures: frequency, cause, and cost of late or missed settlements and emergency top-ups.
- Approval workflow: who approves, what evidence they require, and where two-person control applies.
- System integrations: where positions and obligations live and how hard read access is.
- Willingness to run shadow mode: would they connect read-only data to see the counterfactual savings?

## Hypothesis ledger

| # | Hypothesis | How to test | Evidence | Confidence |
|---|-----------|-------------|----------|------------|
| H1 | Payments companies in the ICP hold materially more prefunding than needed | Ask for buffer sizing and idle balances | none yet | low |
| H2 | Missed or late settlements and emergency top-ups happen often enough to matter | Frequency and cost questions | none yet | low |
| H3 | Approvers will accept a machine-verifiable coverage certificate as evidence | Show the certificate, ask if it changes their sign-off | none yet | low |
| H4 | A 24/7 stablecoin rail is usable in their operating and compliance context | Ask about weekend funding and stablecoin posture | none yet | low |
| H5 | They will grant read-only access to positions and obligations for a shadow pilot | Offer the pilot, observe willingness | none yet | low |
| H6 | The pricing model clears their ROI bar | Present pricing hypotheses after value is shown | none yet | low |

Confidence stays low until attributed evidence is recorded. Each interview updates the
Evidence and Confidence columns with a dated, sourced note.
