// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A minimal test vault for the Saga Executor's real-network proof
// (scripts/testnet-vault-saga.mjs) on Pharos Atlantic testnet.
//
// Why it exists: the vault used on the mainnet fork (RockawayX USDC, a Morpho
// Vault V2) does not exist on Atlantic, and a mainnet address cannot be reused
// there. This contract is the Atlantic stand-in with exactly the interface the
// saga in lib/saga-scenario.js needs, and nothing more:
//
//   deposit(uint256 assets, address receiver) -> shares
//   redeem(uint256 shares, address receiver, address owner) -> assets
//   transfer(address to, uint256 value) -> bool   (the ERC-20 share token)
//
// Shares are 1:1 with the asset, so a reviewer can check the final balances
// without a share price: depositing 100 USDC mints 100 shares, redeeming 100
// shares returns 100 USDC. It is NOT a real yield vault, it has no value, and
// it must never be used with real funds: anyone can deposit any asset it is
// pointed at, and the asset is the TestUSDC deployed alongside it in the run.
//
// The forced failure in the saga is a real revert, not an injected fault:
// transfer() refuses the zero address, exactly like a standard ERC-20, so
// sending the shares to address(0) reverts on chain and the saga compensates.
interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

contract TestVault {
    string public constant name = "TestVault";
    string public constant symbol = "vTEST";
    uint8 public constant decimals = 6;

    address public immutable asset;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);
    event Redeem(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    constructor(address asset_) {
        require(asset_ != address(0), "asset is the zero address");
        asset = asset_;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(receiver != address(0), "receiver is the zero address");
        require(assets > 0, "deposit is zero");
        require(IERC20(asset).transferFrom(msg.sender, address(this), assets), "asset transfer failed");
        shares = assets; // 1:1, by design: no yield, no share price to dispute
        totalSupply += shares;
        balanceOf[receiver] += shares;
        emit Deposit(msg.sender, receiver, assets, shares);
        emit Transfer(address(0), receiver, shares);
        return shares;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        require(receiver != address(0), "receiver is the zero address");
        require(shares > 0, "redeem is zero");
        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            require(allowed >= shares, "insufficient allowance");
            if (allowed != type(uint256).max) allowance[owner][msg.sender] = allowed - shares;
        }
        require(balanceOf[owner] >= shares, "insufficient shares");
        balanceOf[owner] -= shares;
        totalSupply -= shares;
        assets = shares; // 1:1
        require(IERC20(asset).transfer(receiver, assets), "asset transfer failed");
        emit Redeem(msg.sender, receiver, owner, assets, shares);
        emit Transfer(owner, address(0), shares);
        return assets;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(to != address(0), "transfer to the zero address");
        require(balanceOf[msg.sender] >= value, "transfer amount exceeds balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(to != address(0), "transfer to the zero address");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "insufficient allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        require(balanceOf[from] >= value, "transfer amount exceeds balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }
}
