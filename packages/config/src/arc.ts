/**
 * Arc Testnet network constants.
 *
 * SOURCE OF TRUTH: https://docs.arc.io/arc/references/connect-to-arc
 * and https://docs.arc.io/arc/references/contract-addresses
 * Verified 2026-07-25. These are public, real values. Do NOT invent or edit
 * without re-checking the docs. Anything network-specific lives here, not
 * scattered as magic strings.
 */
export const ARC_TESTNET = {
  chainId: 5042002,
  name: "Arc Testnet",
  // Native gas token on Arc is USDC with 18 decimals.
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    primary: "https://rpc.testnet.arc.network",
    blockdaemon: "https://rpc.blockdaemon.testnet.arc.network",
    drpc: "https://rpc.drpc.testnet.arc.network",
    quicknode: "https://rpc.quicknode.testnet.arc.network",
  },
  explorerUrl: "https://testnet.arcscan.app",
  faucetUrl: "https://faucet.circle.com",
  contracts: {
    usdc: "0x3600000000000000000000000000000000000000",
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    usyc: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
    cctpTokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    fxEscrow: "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
} as const;

export function explorerTx(hash: string): string {
  return `${ARC_TESTNET.explorerUrl}/tx/${hash}`;
}
export function explorerAddress(addr: string): string {
  return `${ARC_TESTNET.explorerUrl}/address/${addr}`;
}
