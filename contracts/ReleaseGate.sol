// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice A report review workflow. An approval records the reviewer's decision,
/// not independent execution or correctness of the referenced report.
contract ReleaseGate {
    address public immutable owner;
    address public immutable reviewer;
    bytes32 public reportHash;
    bool public approved;
    uint256 public revision;

    error UnauthorizedCaller();
    error InvalidReviewer();
    error EmptyReport();

    event ReportSubmitted(bytes32 indexed reportHash, uint256 indexed revision);
    event ReportReviewed(bytes32 indexed reportHash, uint256 indexed revision, address indexed reviewer, bool approved);

    constructor(address reviewer_) {
        if (reviewer_ == address(0)) revert InvalidReviewer();
        owner = msg.sender;
        reviewer = reviewer_;
    }

    function submit(bytes32 hash) external {
        if (msg.sender != owner) revert UnauthorizedCaller();
        if (hash == bytes32(0)) revert EmptyReport();
        reportHash = hash;
        approved = false;
        revision += 1;
        emit ReportSubmitted(hash, revision);
    }

    function review(bool decision) external {
        if (msg.sender != reviewer) revert UnauthorizedCaller();
        if (reportHash == bytes32(0)) revert EmptyReport();
        approved = decision;
        emit ReportReviewed(reportHash, revision, msg.sender, decision);
    }
}
