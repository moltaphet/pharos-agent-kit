// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A tiny contract whose functions fail in the ways the dApp Support Agent (task 27) should recognise on Pharos Atlantic testnet: a built-in panic and a custom error.
// (The other failure types in the demo use the demo USDC and the deliberately risky token.) Nothing here has any value.
contract FailLab {
    error TooSmall(uint256 sent, uint256 minimum);

    function divide(uint256 a, uint256 b) external pure returns (uint256) { return a / b; }
    function atLeast(uint256 minimum) external payable returns (bool) { if (msg.value < minimum) revert TooSmall(msg.value, minimum); return true; }
}
