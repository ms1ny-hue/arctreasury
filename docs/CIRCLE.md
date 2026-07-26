# Circle developer-controlled wallets (Arc Testnet)

ArcTreasury signs on-chain settlements through a **signer abstraction** (`packages/chain/src/signer.ts`). Circle is the production signer; it is the wallet + submission layer only. It never decides policy or human approval, both of which are enforced and persisted in the API before a signer is ever called.

## Why a credential step is required

Circle developer-controlled wallets require **your** Circle account: an API key and an entity secret you generate in the Circle console. These cannot be self-provisioned. The code path is fully built and tested; it activates the moment the credentials + wallet exist.

## Provisioning (one time, local)

1. Create a Circle developer account and an **entity secret** in the Circle console. Register the entity secret ciphertext there.
2. Put these in a local, gitignored env (never printed, never committed):
   ```
   CIRCLE_API_KEY=...
   CIRCLE_ENTITY_SECRET=...            # 32-byte hex
   CIRCLE_ARC_BLOCKCHAIN=...           # Circle's Arc Testnet blockchain id, from Circle docs — not guessed
   ```
3. Create the wallet set + Arc wallet:
   ```
   pnpm tsx scripts/circle/register-wallet.ts
   ```
   Prints only the wallet-set id, wallet id, and public address. Set `CIRCLE_WALLET_ID` and `CIRCLE_WALLET_ADDRESS`.
4. Fund the wallet address with Arc Testnet gas: https://faucet.circle.com
5. Grant it the contract roles (run once by the deploying admin, locally):
   ```
   pnpm tsx scripts/circle/grant-roles.ts <CIRCLE_WALLET_ADDRESS>
   ```
6. Set `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_ARC_BLOCKCHAIN`, `CIRCLE_WALLET_ID`, `CIRCLE_WALLET_ADDRESS` in Vercel production.
7. **Remove `DEPLOYER_PRIVATE_KEY` from Vercel.** In production the raw-key signer is refused regardless; removing the value means it is not present at all.

## Signer selection (enforced)

- **Vercel production**: Circle if configured, else `DisabledSigner`. The raw key is never used.
- **Local dev**: Circle if configured; otherwise the raw key only when `ALLOW_LOCAL_SIGNER=true` is set explicitly.

`/api/status` reports `signer.signerProvider`, `signer.circleConfigured`, `signer.walletNetwork`, and `signer.rawKeyReachable` (must be `false` in production). No secrets are exposed.

## Settlement authority

No provider response alone settles a proposal. Execution settles only when the Arc contract reports `getProposal(...).executed == true`. A lost HTTP response or Circle "complete" without an Arc receipt never marks a proposal settled; the durable reconciler resolves it against on-chain state.
