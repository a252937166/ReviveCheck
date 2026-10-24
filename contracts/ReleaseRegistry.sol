// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice An open release-review registry. Anyone records a sealed report for a
/// release they own; anyone may review the current revision. A new submission
/// starts a new revision, so an earlier decision never covers a newer report.
/// A decision records the reviewer's opinion, not the truth of the report.
contract ReleaseRegistry {
    struct Release {
        address owner;
        uint64 revision;
        bytes32 reportHash;
    }

    mapping(bytes32 => Release) private releases;
    // releaseId => reviewer => (revision << 1) | approved
    mapping(bytes32 => mapping(address => uint256)) private decisions;

    error EmptyReport();
    error EmptyName();
    error UnknownRelease();
    error StaleReport();

    event ReportSubmitted(bytes32 indexed releaseId, address indexed owner, uint64 indexed revision, bytes32 reportHash, bytes32 name);
    event ReportReviewed(bytes32 indexed releaseId, address indexed reviewer, uint64 indexed revision, bytes32 reportHash, bool approved);

    /// @dev name is a short release label packed into bytes32 (for example "pusd-token-list").
    function releaseId(address owner, bytes32 name) public pure returns (bytes32) {
        return keccak256(abi.encode(owner, name));
    }

    function submit(bytes32 name, bytes32 reportHash) external returns (bytes32 id, uint64 revision) {
        if (name == bytes32(0)) revert EmptyName();
        if (reportHash == bytes32(0)) revert EmptyReport();
        id = releaseId(msg.sender, name);
        Release storage release = releases[id];
        release.owner = msg.sender;
        revision = release.revision + 1;
        release.revision = revision;
        release.reportHash = reportHash;
        emit ReportSubmitted(id, msg.sender, revision, reportHash, name);
    }

    /// @dev The reviewer names the report they read; a decision on a superseded report reverts.
    function review(bytes32 id, bytes32 reportHash, bool approved) external {
        Release storage release = releases[id];
        if (release.revision == 0) revert UnknownRelease();
        if (release.reportHash != reportHash) revert StaleReport();
        decisions[id][msg.sender] = (uint256(release.revision) << 1) | (approved ? 1 : 0);
        emit ReportReviewed(id, msg.sender, release.revision, reportHash, approved);
    }

    function releaseOf(bytes32 id) external view returns (address owner, uint64 revision, bytes32 reportHash) {
        Release storage release = releases[id];
        return (release.owner, release.revision, release.reportHash);
    }

    /// @return reviewed whether the reviewer decided on the current revision
    /// @return approved the decision, meaningful only when reviewed is true
    function decisionOf(bytes32 id, address reviewer) external view returns (bool reviewed, bool approved) {
        uint256 packed = decisions[id][reviewer];
        reviewed = releases[id].revision != 0 && packed >> 1 == releases[id].revision;
        approved = reviewed && packed & 1 == 1;
    }
}
