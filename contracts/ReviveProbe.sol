// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice A small testnet probe for comparing native and Ethereum RPC readback.
contract ReviveProbe {
    address public immutable owner;
    uint256 public value;
    uint256 public revision;

    event ValueChanged(address indexed caller, uint256 previousValue, uint256 nextValue, uint256 revision);
    error UnauthorizedCaller();

    constructor(uint256 initialValue) {
        owner = msg.sender;
        value = initialValue;
    }

    function setValue(uint256 nextValue) external {
        if (msg.sender != owner) revert UnauthorizedCaller();
        uint256 previousValue = value;
        value = nextValue;
        revision += 1;
        emit ValueChanged(msg.sender, previousValue, nextValue, revision);
    }
}
