// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A tiny contract for the Saga Executor's real-network proof (scripts/testnet-saga.mjs). A saga step credits an id, and its
// compensation debits it, so the chain itself shows how many times a step really ran and whether it was undone.
contract Ledger {
    mapping(uint256 => uint256) public balance;

    event Credited(uint256 indexed id, uint256 balance);
    event Debited(uint256 indexed id, uint256 balance);

    function credit(uint256 id) external {
        uint256 n = ++balance[id];
        emit Credited(id, n);
    }

    function debit(uint256 id) external {
        uint256 n = --balance[id]; // reverts below zero: a compensation can never undo what never happened
        emit Debited(id, n);
    }
}
