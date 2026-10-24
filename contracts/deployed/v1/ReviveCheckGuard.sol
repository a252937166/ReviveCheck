// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The read surface of the ReviveCheck ReleaseRegistry deployed on Portaldot V3.
interface IReleaseRegistry {
    function releaseOf(bytes32 id) external view returns (address owner, uint64 revision, bytes32 reportHash);
    function decisionOf(bytes32 id, address reviewer) external view returns (bool reviewed, bool approved);
}

/// @notice Middleware for contracts that act only on releases approved in the ReleaseRegistry.
/// An approval covers one exact report on the current revision; a newer submission
/// opens a new revision, so every check here fails until it is approved again.
library ReviveCheckGuard {
    error ReleaseNotApproved(bytes32 id);
    error ReportMismatch(bytes32 id, bytes32 expected, bytes32 current);

    /// @return true when `reviewer` approved the current revision and it carries `reportHash`
    function isApproved(IReleaseRegistry registry, bytes32 id, address reviewer, bytes32 reportHash) internal view returns (bool) {
        (, uint64 revision, bytes32 current) = registry.releaseOf(id);
        if (revision == 0 || current != reportHash) return false;
        (bool reviewed, bool approved) = registry.decisionOf(id, reviewer);
        return reviewed && approved;
    }

    /// @return count how many of `reviewers` approved the current revision
    function approvals(IReleaseRegistry registry, bytes32 id, address[] memory reviewers) internal view returns (uint256 count) {
        for (uint256 i; i < reviewers.length; ++i) {
            (bool reviewed, bool approved) = registry.decisionOf(id, reviewers[i]);
            if (reviewed && approved) ++count;
        }
    }

    function requireApproved(IReleaseRegistry registry, bytes32 id, address reviewer, bytes32 reportHash) internal view {
        (, , bytes32 current) = registry.releaseOf(id);
        if (current != reportHash) revert ReportMismatch(id, reportHash, current);
        if (!isApproved(registry, id, reviewer, reportHash)) revert ReleaseNotApproved(id);
    }
}
