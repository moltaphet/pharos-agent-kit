// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Freely minted demonstration currency. It is not USDC and has no monetary value.
contract TreasuryDemoToken {
    string public constant name = "Pharos Treasury Demo USD";
    string public constant symbol = "tUSDC";
    uint8 public constant decimals = 6;
    uint256 public constant faucetAmount = 100 * 10 ** 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    /// @notice Anyone can mint 100 test tokens to their own wallet for the product demo.
    function faucet() external {
        totalSupply += faucetAmount;
        balanceOf[msg.sender] += faucetAmount;
        emit Transfer(address(0), msg.sender, faucetAmount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address payer, address recipient, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[payer][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (allowed != type(uint256).max) {
            allowance[payer][msg.sender] = allowed - amount;
            emit Approval(payer, msg.sender, allowed - amount);
        }
        _transfer(payer, recipient, amount);
        return true;
    }

    function _transfer(address payer, address recipient, uint256 amount) private {
        if (recipient == address(0)) revert ZeroAddress();
        if (balanceOf[payer] < amount) revert InsufficientBalance();
        balanceOf[payer] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(payer, recipient, amount);
    }
}
