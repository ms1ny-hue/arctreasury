// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TreasuryPolicyExecutor} from "../src/TreasuryPolicyExecutor.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// Drives random register/approve/execute sequences and tracks the exact total
/// that SHOULD have left the contract.
contract Handler is Test {
    TreasuryPolicyExecutor public exec;
    MockUSDC public usdc;
    address public vault;
    address public admin;
    uint256 public executedTotal;
    uint256 public nonce;

    constructor(TreasuryPolicyExecutor _exec, MockUSDC _usdc, address _vault, address _admin) {
        exec = _exec;
        usdc = _usdc;
        vault = _vault;
        admin = _admin;
    }

    function flow(uint256 amount, bool approve, bool execute) external {
        amount = bound(amount, 1, 3_000_000e6);
        bytes32 id = keccak256(abi.encode(nonce++));
        vm.startPrank(admin);
        exec.registerProposal(id, address(usdc), vault, amount, uint64(block.timestamp + 1 hours), bytes32(0), bytes32(0), bytes32(0));
        if (approve) exec.approveProposal(id);
        if (approve && execute) {
            if (usdc.balanceOf(address(exec)) >= amount) {
                exec.executeProposal(id);
                executedTotal += amount;
            }
        }
        vm.stopPrank();
    }
}

contract InvariantTest is Test {
    TreasuryPolicyExecutor exec;
    MockUSDC usdc;
    Handler handler;
    address admin = address(0xA11CE);
    address vault = address(0xDEAD);
    uint256 constant FUND = 1_000_000_000e6;

    function setUp() public {
        vm.startPrank(admin);
        exec = new TreasuryPolicyExecutor(admin, 3_000_000e6);
        usdc = new MockUSDC();
        exec.setTokenAllowed(address(usdc), true);
        exec.setDestinationAllowed(vault, true);
        vm.stopPrank();
        usdc.mint(address(exec), FUND);
        handler = new Handler(exec, usdc, vault, admin);
        targetContract(address(handler));
    }

    /// Conservation: everything that left the contract landed in the vault, and
    /// the sum equals the handler's independently tracked executed total. No
    /// double execution, no leak, no over-payment can violate this.
    function invariant_conservation() public view {
        assertEq(usdc.balanceOf(vault), handler.executedTotal());
        assertEq(usdc.balanceOf(address(exec)), FUND - handler.executedTotal());
    }
}
