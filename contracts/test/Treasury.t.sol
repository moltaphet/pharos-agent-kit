// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InvoicePaymentRouter} from "../InvoicePaymentRouter.sol";
import {TreasuryDemoToken} from "../TreasuryDemoToken.sol";

interface TreasuryVm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool, address) external;
}

contract TreasuryTest {
    TreasuryVm private constant vm = TreasuryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TreasuryDemoToken private token;
    InvoicePaymentRouter private router;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant RECIPIENT = address(0xC0FFEE);
    bytes32 private constant INVOICE = keccak256("pharos-treasury:v1:INV-100");
    uint256 private constant AMOUNT = 25 * 10 ** 6;

    event InvoicePaid(address indexed payer, bytes32 indexed invoiceId, address indexed recipient, address token, uint256 amount);

    function setUp() public {
        token = new TreasuryDemoToken();
        router = new InvoicePaymentRouter(address(token));
        _fundAndApprove(ALICE, AMOUNT);
        _fundAndApprove(BOB, AMOUNT);
    }

    function _fundAndApprove(address payer, uint256 amount) private {
        vm.startPrank(payer);
        token.faucet();
        token.approve(address(router), amount);
        vm.stopPrank();
    }

    function testPaymentMovesExactAmountAndRecordsAllFields() public {
        vm.expectEmit(true, true, true, true, address(router));
        emit InvoicePaid(ALICE, INVOICE, RECIPIENT, address(token), AMOUNT);
        vm.prank(ALICE);
        router.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        require(router.paid(ALICE, INVOICE), "invoice not recorded");
        require(token.balanceOf(RECIPIENT) == AMOUNT, "recipient did not receive exact amount");
        require(token.balanceOf(ALICE) == 75 * 10 ** 6, "payer was not debited exactly");
        require(token.balanceOf(address(router)) == 0, "router retained funds");
        require(token.allowance(ALICE, address(router)) == 0, "exact allowance was not consumed");
    }

    function testDuplicateCannotChangeRecipientOrAmount() public {
        vm.startPrank(ALICE);
        router.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        token.approve(address(router), AMOUNT);
        vm.expectRevert(InvoicePaymentRouter.AlreadyPaid.selector);
        router.payInvoice(INVOICE, BOB, 1);
        vm.stopPrank();
        require(token.balanceOf(RECIPIENT) == AMOUNT, "second transfer occurred");
        require(token.balanceOf(BOB) == 100 * 10 ** 6, "changed recipient was paid");
    }

    function testSameInvoiceReferenceCanBePaidByDifferentPayers() public {
        vm.prank(ALICE);
        router.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        vm.prank(BOB);
        router.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        require(router.paid(ALICE, INVOICE) && router.paid(BOB, INVOICE), "not payer scoped");
        require(token.balanceOf(RECIPIENT) == 2 * AMOUNT, "one payer prevented another payment");
    }

    function testNoAllowanceRollsBackAndCanBeRetried() public {
        vm.startPrank(ALICE);
        token.approve(address(router), 0);
        vm.expectRevert(InvoicePaymentRouter.TransferFailed.selector);
        router.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        require(!router.paid(ALICE, INVOICE), "failed invoice recorded");
        token.approve(address(router), AMOUNT);
        router.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        vm.stopPrank();
        require(token.balanceOf(RECIPIENT) == AMOUNT, "retry not paid");
    }

    function testInsufficientBalanceRollsBackAllowanceAndInvoice() public {
        vm.startPrank(ALICE);
        token.approve(address(router), 101 * 10 ** 6);
        vm.expectRevert(InvoicePaymentRouter.TransferFailed.selector);
        router.payInvoice(INVOICE, RECIPIENT, 101 * 10 ** 6);
        vm.stopPrank();
        require(!router.paid(ALICE, INVOICE), "failed invoice recorded");
        require(token.allowance(ALICE, address(router)) == 101 * 10 ** 6, "allowance not rolled back");
        require(token.balanceOf(RECIPIENT) == 0, "partial transfer occurred");
    }

    function testRejectsZeroInvoiceAmountAndUnsafeRecipients() public {
        vm.startPrank(ALICE);
        vm.expectRevert(InvoicePaymentRouter.InvalidInvoice.selector);
        router.payInvoice(bytes32(0), RECIPIENT, AMOUNT);
        vm.expectRevert(InvoicePaymentRouter.InvalidAmount.selector);
        router.payInvoice(INVOICE, RECIPIENT, 0);
        vm.expectRevert(InvoicePaymentRouter.InvalidRecipient.selector);
        router.payInvoice(INVOICE, address(0), AMOUNT);
        vm.expectRevert(InvoicePaymentRouter.InvalidRecipient.selector);
        router.payInvoice(INVOICE, address(router), AMOUNT);
        vm.expectRevert(InvoicePaymentRouter.InvalidRecipient.selector);
        router.payInvoice(INVOICE, address(token), AMOUNT);
        vm.stopPrank();
        require(!router.paid(ALICE, INVOICE), "invalid payment marked paid");
    }

    function testRejectsAddressWithoutTokenCode() public {
        vm.expectRevert(InvoicePaymentRouter.InvalidToken.selector);
        new InvoicePaymentRouter(address(0));
        vm.expectRevert(InvoicePaymentRouter.InvalidToken.selector);
        new InvoicePaymentRouter(ALICE);
    }

    function testFaucetOnlyMintsToCallerAndLabelsTestCurrency() public {
        vm.prank(RECIPIENT);
        token.faucet();
        require(token.balanceOf(RECIPIENT) == 100 * 10 ** 6, "incorrect faucet amount");
        require(token.decimals() == 6, "incorrect decimals");
        require(keccak256(bytes(token.symbol())) == keccak256("tUSDC"), "not labelled test currency");
        require(token.totalSupply() == 300 * 10 ** 6, "supply does not match mints");
    }

    function testMaximumApprovalIsNotReduced() public {
        vm.startPrank(ALICE);
        token.approve(address(router), type(uint256).max);
        router.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        vm.stopPrank();
        require(token.allowance(ALICE, address(router)) == type(uint256).max, "max allowance changed");
    }

    function testFalseReturningTokenCannotRecordPayment() public {
        TreasuryFalseToken falseToken = new TreasuryFalseToken();
        InvoicePaymentRouter falseRouter = new InvoicePaymentRouter(address(falseToken));
        vm.prank(ALICE);
        vm.expectRevert(InvoicePaymentRouter.TransferFailed.selector);
        falseRouter.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        require(!falseRouter.paid(ALICE, INVOICE), "false transfer recorded");
    }

    function testTokenCallbackCannotReenterRouter() public {
        TreasuryReentrantToken callbackToken = new TreasuryReentrantToken();
        InvoicePaymentRouter callbackRouter = new InvoicePaymentRouter(address(callbackToken));
        callbackToken.configure(callbackRouter);
        vm.prank(ALICE);
        callbackRouter.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        require(callbackToken.blocked(), "callback reentered");
        require(!callbackRouter.paid(address(callbackToken), bytes32(uint256(1))), "callback payment recorded");
    }

    function testMalformedReturningTokenCannotRecordPayment() public {
        TreasuryMalformedToken malformedToken = new TreasuryMalformedToken();
        InvoicePaymentRouter malformedRouter = new InvoicePaymentRouter(address(malformedToken));
        vm.prank(ALICE);
        vm.expectRevert(InvoicePaymentRouter.TransferFailed.selector);
        malformedRouter.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        require(!malformedRouter.paid(ALICE, INVOICE), "malformed transfer recorded");
    }

    function testNoReturnTokenIsSupported() public {
        TreasuryNoReturnToken legacyToken = new TreasuryNoReturnToken();
        InvoicePaymentRouter legacyRouter = new InvoicePaymentRouter(address(legacyToken));
        vm.prank(ALICE);
        legacyRouter.payInvoice(INVOICE, RECIPIENT, AMOUNT);
        require(legacyRouter.paid(ALICE, INVOICE), "no-return token rejected");
        require(legacyToken.from() == ALICE && legacyToken.recipient() == RECIPIENT && legacyToken.amount() == AMOUNT, "incorrect transfer call");
    }

    function testFuzzExactTransfer(uint64 rawAmount) public {
        uint256 amount = uint256(rawAmount) % (100 * 10 ** 6) + 1;
        vm.startPrank(ALICE);
        token.approve(address(router), amount);
        router.payInvoice(INVOICE, RECIPIENT, amount);
        vm.stopPrank();
        require(token.balanceOf(RECIPIENT) == amount, "transfer changed integer amount");
        require(token.balanceOf(ALICE) + amount == 100 * 10 ** 6, "unexpected debit");
    }
}

contract TreasuryFalseToken {
    function transferFrom(address, address, uint256) external pure returns (bool) { return false; }
}

contract TreasuryMalformedToken {
    function transferFrom(address, address, uint256) external pure returns (uint256) { return 2; }
}

contract TreasuryNoReturnToken {
    address public from;
    address public recipient;
    uint256 public amount;
    function transferFrom(address payer, address payee, uint256 value) external {
        from = payer;
        recipient = payee;
        amount = value;
    }
}

contract TreasuryReentrantToken {
    InvoicePaymentRouter private router;
    bool public blocked;

    function configure(InvoicePaymentRouter target) external { router = target; }
    function transferFrom(address, address recipient, uint256 amount) external returns (bool) {
        (bool success, bytes memory result) = address(router).call(
            abi.encodeCall(router.payInvoice, (bytes32(uint256(1)), recipient, amount))
        );
        blocked = !success && result.length >= 4 && bytes4(result) == InvoicePaymentRouter.ReentrantCall.selector;
        return true;
    }
}
