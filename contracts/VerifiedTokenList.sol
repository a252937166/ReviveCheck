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
///
/// v2 (2026-10-24): an existing entry belongs to the owner of the release it names.
/// Only that owner, or the curator when one is set, can replace or delist it. The v1
/// contract deployed on the V3 testnet let any release owner replace any entry; its
/// source is kept under contracts/deployed/v1.
contract VerifiedTokenList {
    using ReviveCheckGuard for IReleaseRegistry;

    struct Entry {
        bytes32 releaseId;
        bytes32 reportHash;
        address reviewer;
    }

    IReleaseRegistry public immutable registry;
    /// @notice When set, only this reviewer's approvals count, and the curator may replace or delist any entry.
    /// Zero lets each lister name the reviewer they rely on; entries are then protected by release ownership only.
    address public immutable curator;
    mapping(address => Entry) public entryOf;

    error ReviewerNotAllowed(address reviewer);
    error NotReleaseOwner();
    error DecimalsMismatch(uint8 chainDecimals);
    error EntryOwnedByAnother(address owner);
    error NoEntry();

    event Listed(address indexed token, bytes32 indexed releaseId, address indexed reviewer, bytes32 reportHash, uint8 decimals);
    event Delisted(address indexed token, bytes32 indexed releaseId, address indexed by);

    constructor(IReleaseRegistry registry_, address curator_) {
        registry = registry_;
        curator = curator_;
    }

    function version() external pure returns (uint8) {
        return 2;
    }

    /// @notice List `token` on the current approval of `releaseId`, as that release's owner.
    /// An existing entry can be replaced only by the owner of the release it names, or by the curator.
    function list(address token, bytes32 releaseId, bytes32 reportHash, address reviewer, uint8 decimals) external {
        if (curator != address(0) && reviewer != curator) revert ReviewerNotAllowed(reviewer);
        registry.requireApproved(releaseId, reviewer, reportHash);
        (address owner, , ) = registry.releaseOf(releaseId);
        if (msg.sender != owner) revert NotReleaseOwner();
        _requireControl(token);
        uint8 chainDecimals = IERC20Decimals(token).decimals();
        if (chainDecimals != decimals) revert DecimalsMismatch(chainDecimals);
        entryOf[token] = Entry(releaseId, reportHash, reviewer);
        emit Listed(token, releaseId, reviewer, reportHash, decimals);
    }

    /// @notice Remove `token`'s entry: the owner of the release it names, or the curator.
    function delist(address token) external {
        Entry memory entry = entryOf[token];
        if (entry.releaseId == bytes32(0)) revert NoEntry();
        _requireControl(token);
        delete entryOf[token];
        emit Delisted(token, entry.releaseId, msg.sender);
    }

    function isListed(address token) external view returns (bool) {
        Entry memory entry = entryOf[token];
        return entry.releaseId != bytes32(0) && registry.isApproved(entry.releaseId, entry.reviewer, entry.reportHash);
    }

    /// @dev An existing entry belongs to the owner of the release it names; the curator, when set, may override.
    function _requireControl(address token) private view {
        Entry storage entry = entryOf[token];
        if (entry.releaseId == bytes32(0)) return;
        if (curator != address(0) && msg.sender == curator) return;
        (address entryOwner, , ) = registry.releaseOf(entry.releaseId);
        if (msg.sender != entryOwner) revert EntryOwnedByAnother(entryOwner);
    }
}
