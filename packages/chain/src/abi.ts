/** Minimal ABIs. The executor ABI mirrors TreasuryPolicyExecutor.sol. */
export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export const EXECUTOR_ABI = [
  {
    type: "function",
    name: "registerProposal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "destination", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "policyHash", type: "bytes32" },
      { name: "inputHash", type: "bytes32" },
      { name: "certificateCommitment", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "approveProposal", stateMutability: "nonpayable", inputs: [{ name: "proposalId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "executeProposal", stateMutability: "nonpayable", inputs: [{ name: "proposalId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "cancelProposal", stateMutability: "nonpayable", inputs: [{ name: "proposalId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "certificateCommitmentOf", stateMutability: "view", inputs: [{ name: "proposalId", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "isExecuted", stateMutability: "view", inputs: [{ name: "proposalId", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;
