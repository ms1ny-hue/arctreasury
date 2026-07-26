# Circle developer-controlled wallets (Arc Testnet)

ArcTreasury signs on-chain settlements through a **signer abstraction** (`packages/chain/src/signer.ts`). Circle is the production signer; it is the wallet + submission layer only. It never decides policy or human approval, both of which are enforced and persisted in the API before a signer is ever called.

## Why a credential step is required

Circle developer-controlled wallets require **your** Circle account: an API key and an entity secret you generate in the Circle console. These cannot be self-provisioned. The code path is fully built and tested; it activates the moment the credentials + wallet exist.

## Provisioning (one time, local)

1. Create a Circle developer account. In the Console, create a **testnet API key**.
2. Generate + **register an entity secret** (Console → Configurator, or the official
   `@circle-fin/developer-controlled-wallets` SDK `registerEntitySecretCiphertext`).
   Registration downloads a **recovery file** — the only recovery if the entity secret
   is lost. Store it separately from the entity secret. Never paste it anywhere.
3. Put these in a local, gitignored env (never printed, never committed):
   ```
   CIRCLE_API_KEY=...
   CIRCLE_ENTITY_SECRET=...            # 32-byte hex, already registered
   CIRCLE_ARC_BLOCKCHAIN=ARC-TESTNET   # confirmed Circle enum for Arc Testnet (EOA)
   ```
3. Create the wallet set + Arc wallet:
   ```
   pnpm tsx scripts/circle/register-wallet.ts
   ```
   Prints only the wallet-set id, wallet id, and public address. Set `CIRCLE_WALLET_ID` and `CIRCLE_WALLET_ADDRESS`.
4. Fund the wallet address with Arc Testnet gas: https://faucet.circle.com
5. Grant contract roles (run once by the deploying admin, locally). Maker/checker
   is kept separate — the script **refuses** to make the Circle wallet an approver
   unless you explicitly opt into the weaker model:
   ```
   # Option A — true signer separation (recommended for the strongest claim):
   #   Circle wallet = proposer + executor; a SEPARATE approver wallet = approver.
   pnpm tsx scripts/circle/grant-roles.ts <CIRCLE_WALLET_ADDRESS> <SEPARATE_APPROVER_ADDRESS>

   # Option B — application-enforced approval (single wallet, must be disclosed):
   #   Circle wallet = proposer + approver + executor; approval separation lives in
   #   the app (Postgres CAS maker/checker), NOT on-chain. No cryptographic-separation claim.
   pnpm tsx scripts/circle/grant-roles.ts <CIRCLE_WALLET_ADDRESS> --app-enforced
   ```
   Option A additionally requires a UI "connect wallet & approve on-chain" step and
   an execute path that requires `getProposal.approved == true` before executing.
6. Set `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_ARC_BLOCKCHAIN`, `CIRCLE_WALLET_ID`, `CIRCLE_WALLET_ADDRESS` in Vercel production.
7. **Remove `DEPLOYER_PRIVATE_KEY` from Vercel.** In production the raw-key signer is refused regardless; removing the value means it is not present at all.

## Signer selection (enforced)

- **Vercel production**: Circle if configured, else `DisabledSigner`. The raw key is never used.
- **Local dev**: Circle if configured; otherwise the raw key only when `ALLOW_LOCAL_SIGNER=true` is set explicitly.

`/api/status` reports `signer.signerProvider`, `signer.circleConfigured`, `signer.walletNetwork`, and `signer.rawKeyReachable` (must be `false` in production). No secrets are exposed.

## Settlement authority

No provider response alone settles a proposal. Execution settles only when the Arc contract reports `getProposal(...).executed == true`. A lost HTTP response or Circle "complete" without an Arc receipt never marks a proposal settled; the durable reconciler resolves it against on-chain state.
