// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IReleaseRegistry, ReviveCheckGuard} from "./ReviveCheckGuard.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @notice A token list that consumes the ReleaseRegistry as middleware. An entry is
/// accepted only from the release owner, only while the named reviewer has approved
/// that exact report, and only if the token contract itself reports the listed
/// decimals. `isListed` re-reads the registry, so an entry stops counting as soon as
/// its release moves to an unapproved revision. Entries are enumerated from events.
contract VerifiedTokenList {
    using ReviveCheckGuard for IReleaseRegistry;

    struct Entry {
        bytes32 releaseId;
        bytes32 reportHash;
        address reviewer;
    }

    IReleaseRegistry public immutable registry;
    /// @notice When set, only this reviewer's approvals count. Zero lets each lister name the reviewer they rely on.
    address public immutable curator;
    mapping(address => Entry) public entryOf;

    error ReviewerNotAllowed(address reviewer);
    error NotReleaseOwner();
    error DecimalsMismatch(uint8 chainDecimals);

    event Listed(address indexed token, bytes32 indexed releaseId, address indexed reviewer, bytes32 reportHash, uint8 decimals);

    constructor(IReleaseRegistry registry_, address curator_) {
        registry = registry_;
        curator = curator_;
    }

    function list(address token, bytes32 releaseId, bytes32 reportHash, address reviewer, uint8 decimals) external {
        if (curator != address(0) && reviewer != curator) revert ReviewerNotAllowed(reviewer);
        registry.requireApproved(releaseId, reviewer, reportHash);
        (address owner, , ) = registry.releaseOf(releaseId);
        if (msg.sender != owner) revert NotReleaseOwner();
        uint8 chainDecimals = IERC20Decimals(token).decimals();
        if (chainDecimals != decimals) revert DecimalsMismatch(chainDecimals);
        entryOf[token] = Entry(releaseId, reportHash, reviewer);
        emit Listed(token, releaseId, reviewer, reportHash, decimals);
    }

    function isListed(address token) external view returns (bool) {
        Entry memory entry = entryOf[token];
        return entry.releaseId != bytes32(0) && registry.isApproved(entry.releaseId, entry.reviewer, entry.reportHash);
    }
}
