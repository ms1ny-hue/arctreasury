// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TreasuryPolicyExecutor} from "../src/TreasuryPolicyExecutor.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract TreasuryPolicyExecutorTest is Test {
    TreasuryPolicyExecutor exec;
    MockUSDC usdc;

    address admin = address(0xA11CE);
    address vault = address(0xDEAD);
    address outsider = address(0xB0B);
    uint256 constant MAX = 3_000_000e6;
    uint256 constant FUND = 10_000_000e6;

    bytes32 constant PID = keccak256("proposal-1");
    bytes32 constant POLICY_HASH = keccak256("policy");
    bytes32 constant INPUT_HASH = keccak256("input");
    bytes32 constant CERT = keccak256("certificate-commitment");

    function setUp() public {
        vm.startPrank(admin);
        exec = new TreasuryPolicyExecutor(admin, MAX);
        usdc = new MockUSDC();
        exec.setTokenAllowed(address(usdc), true);
        exec.setDestinationAllowed(vault, true);
        vm.stopPrank();
        usdc.mint(address(exec), FUND);
    }

    function _register(bytes32 id, uint256 amount, uint64 expiry) internal {
        vm.prank(admin);
        exec.registerProposal(id, address(usdc), vault, amount, expiry, POLICY_HASH, INPUT_HASH, CERT);
    }

    // --- Happy path ---
    function test_registerApproveExecute() public {
        _register(PID, 2_010_000e6, uint64(block.timestamp + 1 hours));
        vm.prank(admin);
        exec.approveProposal(PID);
        vm.prank(admin);
        exec.executeProposal(PID);
        assertEq(usdc.balanceOf(vault), 2_010_000e6);
        assertTrue(exec.isExecuted(PID));
    }

    function test_certificateCommitmentStored() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        assertEq(exec.certificateCommitmentOf(PID), CERT);
    }

    // --- Authorization ---
    function test_onlyProposerCanRegister() public {
        vm.prank(outsider);
        vm.expectRevert();
        exec.registerProposal(PID, address(usdc), vault, 1e6, uint64(block.timestamp + 1 hours), POLICY_HASH, INPUT_HASH, CERT);
    }

    function test_onlyApproverCanApprove() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        vm.prank(outsider);
        vm.expectRevert();
        exec.approveProposal(PID);
    }

    function test_onlyExecutorCanExecute() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        vm.prank(admin);
        exec.approveProposal(PID);
        vm.prank(outsider);
        vm.expectRevert();
        exec.executeProposal(PID);
    }

    // --- Core invariants ---
    function test_cannotExecuteUnapproved() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        vm.prank(admin);
        vm.expectRevert(TreasuryPolicyExecutor.NotApproved.selector);
        exec.executeProposal(PID);
    }

    function test_cannotExecuteTwice() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        vm.startPrank(admin);
        exec.approveProposal(PID);
        exec.executeProposal(PID);
        vm.expectRevert(TreasuryPolicyExecutor.AlreadyExecuted.selector);
        exec.executeProposal(PID);
        vm.stopPrank();
    }

    function test_cannotRegisterDuplicate() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        vm.prank(admin);
        vm.expectRevert(TreasuryPolicyExecutor.ProposalExists.selector);
        exec.registerProposal(PID, address(usdc), vault, 1e6, uint64(block.timestamp + 1 hours), POLICY_HASH, INPUT_HASH, CERT);
    }

    function test_expiredCannotApproveOrExecute() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.startPrank(admin);
        vm.expectRevert(TreasuryPolicyExecutor.Expired.selector);
        exec.approveProposal(PID);
        vm.stopPrank();
    }

    function test_rejectDisallowedDestination() public {
        vm.prank(admin);
        vm.expectRevert(TreasuryPolicyExecutor.DestinationNotAllowed.selector);
        exec.registerProposal(PID, address(usdc), outsider, 1e6, uint64(block.timestamp + 1 hours), POLICY_HASH, INPUT_HASH, CERT);
    }

    function test_rejectDisallowedToken() public {
        vm.prank(admin);
        vm.expectRevert(TreasuryPolicyExecutor.TokenNotAllowed.selector);
        exec.registerProposal(PID, address(0x1234), vault, 1e6, uint64(block.timestamp + 1 hours), POLICY_HASH, INPUT_HASH, CERT);
    }

    function test_rejectAmountAboveCap() public {
        vm.prank(admin);
        vm.expectRevert(TreasuryPolicyExecutor.AmountTooLarge.selector);
        exec.registerProposal(PID, address(usdc), vault, MAX + 1, uint64(block.timestamp + 1 hours), POLICY_HASH, INPUT_HASH, CERT);
    }

    function test_pauseBlocksExecution() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        vm.startPrank(admin);
        exec.approveProposal(PID);
        exec.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        exec.executeProposal(PID);
        vm.stopPrank();
    }

    function test_cancelBlocksExecution() public {
        _register(PID, 1e6, uint64(block.timestamp + 1 hours));
        vm.startPrank(admin);
        exec.approveProposal(PID);
        exec.cancelProposal(PID);
        vm.expectRevert(TreasuryPolicyExecutor.ProposalIsCancelled.selector);
        exec.executeProposal(PID);
        vm.stopPrank();
    }

    // --- Fuzz ---
    function testFuzz_executeTransfersExactAmount(uint256 amount) public {
        amount = bound(amount, 1, MAX);
        bytes32 id = keccak256(abi.encode("fuzz", amount));
        _register(id, amount, uint64(block.timestamp + 1 hours));
        vm.startPrank(admin);
        exec.approveProposal(id);
        exec.executeProposal(id);
        vm.stopPrank();
        assertEq(usdc.balanceOf(vault), amount);
    }

    function testFuzz_registerRejectsZeroOrOverCap(uint256 amount) public {
        bytes32 id = keccak256(abi.encode("fuzz2", amount));
        vm.prank(admin);
        if (amount == 0) {
            vm.expectRevert(TreasuryPolicyExecutor.AmountZero.selector);
            exec.registerProposal(id, address(usdc), vault, amount, uint64(block.timestamp + 1 hours), POLICY_HASH, INPUT_HASH, CERT);
        } else if (amount > MAX) {
            vm.expectRevert(TreasuryPolicyExecutor.AmountTooLarge.selector);
            exec.registerProposal(id, address(usdc), vault, amount, uint64(block.timestamp + 1 hours), POLICY_HASH, INPUT_HASH, CERT);
        }
    }
}
