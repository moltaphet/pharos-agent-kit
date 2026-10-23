// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A deliberately tiny contract for the Batch Executor's testnet run. Its one function does not depend on who calls it,
// which is exactly what makes a call safe to send through Multicall3 (the caller seen by the contract is Multicall3).
contract Counter {
    mapping(uint256 => uint256) public count;

    event Ping(uint256 indexed id, uint256 n);

    function ping(uint256 id) external {
        uint256 n;
        unchecked {
            n = ++count[id];
        }
        emit Ping(id, n);
    }
}
