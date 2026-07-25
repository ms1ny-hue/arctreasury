// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TreasuryPolicyExecutor
 * @notice Minimal, auditable execution perimeter for ArcTreasury liquidity
 *         actions. It is NOT a DeFi protocol. It moves ONLY tokens it holds, to
 *         allowlisted destinations, for proposals that a human approver has
 *         explicitly approved on-chain, and only once.
 *
 * CONTROL PERIMETER (documented on purpose): this contract governs ONLY the
 * ERC-20 balance it custodies and the permissions below. It has no authority
 * over external bank, custodian, or exchange accounts. Only opaque commitments
 * (policy hash, input hash, certificate commitment) are stored on-chain; no
 * balances, forecasts, counterparties, or payout schedules are ever written.
 *
 * Safety: AccessControl roles, Pausable, ReentrancyGuard, SafeERC20,
 * checks-effects-interactions, per-proposal single execution, expiry, token &
 * destination allowlists, per-transaction amount cap, and a deploy-chain guard.
 */
contract TreasuryPolicyExecutor is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    struct Proposal {
        address token;
        address destination;
        uint256 amount;
        uint64 expiry;
        bytes32 policyHash;
        bytes32 inputHash;
        bytes32 certificateCommitment;
        bool approved;
        bool executed;
        bool cancelled;
        bool exists;
    }

    uint256 public immutable deployChainId;
    uint256 public maxSingleAmount;

    mapping(bytes32 => Proposal) private _proposals;
    mapping(address => bool) public allowedTokens;
    mapping(address => bool) public allowedDestinations;

    event TokenAllowed(address indexed token, bool allowed);
    event DestinationAllowed(address indexed destination, bool allowed);
    event MaxSingleAmountSet(uint256 amount);
    event ProposalRegistered(bytes32 indexed proposalId, address indexed token, address indexed destination, uint256 amount, uint64 expiry, bytes32 certificateCommitment);
    event ProposalApproved(bytes32 indexed proposalId, address indexed approver);
    event ProposalCancelled(bytes32 indexed proposalId);
    event ProposalExecuted(bytes32 indexed proposalId, address indexed destination, uint256 amount);

    error UnknownProposal();
    error ProposalExists();
    error NotApproved();
    error AlreadyExecuted();
    error ProposalIsCancelled();
    error Expired();
    error TokenNotAllowed();
    error DestinationNotAllowed();
    error AmountZero();
    error AmountTooLarge();
    error WrongChain();
    error BadExpiry();

    constructor(address admin, uint256 maxSingleAmount_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, admin);
        _grantRole(APPROVER_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);
        deployChainId = block.chainid;
        maxSingleAmount = maxSingleAmount_;
        emit MaxSingleAmountSet(maxSingleAmount_);
    }

    // --- Admin configuration ---
    function setTokenAllowed(address token, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setDestinationAllowed(address destination, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedDestinations[destination] = allowed;
        emit DestinationAllowed(destination, allowed);
    }

    function setMaxSingleAmount(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxSingleAmount = amount;
        emit MaxSingleAmountSet(amount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // --- Proposal lifecycle ---
    function registerProposal(
        bytes32 proposalId,
        address token,
        address destination,
        uint256 amount,
        uint64 expiry,
        bytes32 policyHash,
        bytes32 inputHash,
        bytes32 certificateCommitment
    ) external onlyRole(PROPOSER_ROLE) {
        if (_proposals[proposalId].exists) revert ProposalExists();
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (!allowedDestinations[destination]) revert DestinationNotAllowed();
        if (amount == 0) revert AmountZero();
        if (amount > maxSingleAmount) revert AmountTooLarge();
        if (expiry <= block.timestamp) revert BadExpiry();

        _proposals[proposalId] = Proposal({
            token: token,
            destination: destination,
            amount: amount,
            expiry: expiry,
            policyHash: policyHash,
            inputHash: inputHash,
            certificateCommitment: certificateCommitment,
            approved: false,
            executed: false,
            cancelled: false,
            exists: true
        });

        emit ProposalRegistered(proposalId, token, destination, amount, expiry, certificateCommitment);
    }

    function approveProposal(bytes32 proposalId) external onlyRole(APPROVER_ROLE) {
        Proposal storage p = _proposals[proposalId];
        if (!p.exists) revert UnknownProposal();
        if (p.cancelled) revert ProposalIsCancelled();
        if (p.executed) revert AlreadyExecuted();
        if (block.timestamp > p.expiry) revert Expired();
        p.approved = true;
        emit ProposalApproved(proposalId, msg.sender);
    }

    function cancelProposal(bytes32 proposalId) external {
        if (!hasRole(APPROVER_ROLE, msg.sender) && !hasRole(PROPOSER_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, APPROVER_ROLE);
        }
        Proposal storage p = _proposals[proposalId];
        if (!p.exists) revert UnknownProposal();
        if (p.executed) revert AlreadyExecuted();
        p.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    function executeProposal(bytes32 proposalId)
        external
        onlyRole(EXECUTOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (block.chainid != deployChainId) revert WrongChain();
        Proposal storage p = _proposals[proposalId];
        if (!p.exists) revert UnknownProposal();
        if (p.cancelled) revert ProposalIsCancelled();
        if (!p.approved) revert NotApproved();
        if (p.executed) revert AlreadyExecuted();
        if (block.timestamp > p.expiry) revert Expired();
        if (!allowedTokens[p.token]) revert TokenNotAllowed();
        if (!allowedDestinations[p.destination]) revert DestinationNotAllowed();
        if (p.amount > maxSingleAmount) revert AmountTooLarge();

        // checks-effects-interactions: mark executed BEFORE the external call.
        p.executed = true;

        IERC20(p.token).safeTransfer(p.destination, p.amount);
        emit ProposalExecuted(proposalId, p.destination, p.amount);
    }

    // --- Views ---
    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function certificateCommitmentOf(bytes32 proposalId) external view returns (bytes32) {
        return _proposals[proposalId].certificateCommitment;
    }

    function isExecuted(bytes32 proposalId) external view returns (bool) {
        return _proposals[proposalId].executed;
    }
}
