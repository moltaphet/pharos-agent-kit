// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Transfers the fixed token directly from the signing payer to a recipient once per invoice.
/// @dev The router is not a vault and does not retain payments or permit agents to spend without a payer transaction.
contract InvoicePaymentRouter {
    address public immutable token;
    mapping(address => mapping(bytes32 => bool)) public paid;
    bool private entered;

    event InvoicePaid(
        address indexed payer,
        bytes32 indexed invoiceId,
        address indexed recipient,
        address token,
        uint256 amount
    );

    error InvalidToken();
    error InvalidInvoice();
    error InvalidRecipient();
    error InvalidAmount();
    error AlreadyPaid();
    error TransferFailed();
    error ReentrantCall();

    constructor(address paymentToken) {
        if (paymentToken.code.length == 0) revert InvalidToken();
        token = paymentToken;
    }

    function payInvoice(bytes32 invoiceId, address recipient, uint256 amount) external {
        if (entered) revert ReentrantCall();
        if (invoiceId == bytes32(0)) revert InvalidInvoice();
        if (recipient == address(0) || recipient == address(this) || recipient == token) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (paid[msg.sender][invoiceId]) revert AlreadyPaid();

        entered = true;
        paid[msg.sender][invoiceId] = true;
        // Checks and state changes precede the external call. A failed transfer rolls back both flags.
        (bool success, bytes memory result) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, recipient, amount)
        );
        if (!success) revert TransferFailed();
        if (result.length != 0) {
            if (result.length != 32) revert TransferFailed();
            uint256 returned;
            assembly { returned := mload(add(result, 32)) }
            if (returned != 1) revert TransferFailed();
        }
        emit InvoicePaid(msg.sender, invoiceId, recipient, token, amount);
        entered = false;
    }
}
