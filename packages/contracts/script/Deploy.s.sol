// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TreasuryPolicyExecutor} from "../src/TreasuryPolicyExecutor.sol";

/**
 * Reproducible Arc Testnet deployment.
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY  testnet key (funded with Arc USDC gas via faucet.circle.com)
 *   ARC_USDC_ADDRESS      0x3600000000000000000000000000000000000000
 *   DEMO_VAULT_ADDRESS    allowlisted destination the executor may fund
 *
 * Run via deploy.sh, which also records the address/ABI under deployments/.
 */
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        address vault = vm.envAddress("DEMO_VAULT_ADDRESS");
        uint256 maxSingle = vm.envOr("MAX_SINGLE_AMOUNT", uint256(3_000_000e6));
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        TreasuryPolicyExecutor exec = new TreasuryPolicyExecutor(deployer, maxSingle);
        exec.setTokenAllowed(usdc, true);
        exec.setDestinationAllowed(vault, true);
        vm.stopBroadcast();

        console2.log("TreasuryPolicyExecutor:", address(exec));
        console2.log("admin/deployer:", deployer);
        console2.log("usdc:", usdc);
        console2.log("vault:", vault);
        console2.log("maxSingleAmount:", maxSingle);
    }
}
