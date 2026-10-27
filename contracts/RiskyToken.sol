// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A deliberately risky token, for the Wallet Risk Checker (task 25) to find on Pharos Atlantic testnet. It is a working ERC-20 whose single owner key can mint without limit,
// freeze any holder, raise a transfer fee to 100%, pause everything, run arbitrary code in the contract's context and destroy it. Nothing here is hidden: it is what the checker
// should flag. It has no value and is not a model of any real token.
contract RiskyToken {
    string public constant name = "Risky Demo Token";
    string public constant symbol = "RISK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;
    bool public paused;
    uint256 public feeBps;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blacklisted;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() { require(msg.sender == owner, "owner only"); _; }

    constructor() { owner = msg.sender; }

    function mint(address to, uint256 amount) external onlyOwner { totalSupply += amount; balanceOf[to] += amount; emit Transfer(address(0), to, amount); }
    function blacklist(address who) external onlyOwner { blacklisted[who] = true; }
    function pause() external onlyOwner { paused = true; }
    function unpause() external onlyOwner { paused = false; }
    function setFee(uint256 bps) external onlyOwner { require(bps <= 10_000, "fee"); feeBps = bps; }
    function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory out) { (bool ok, bytes memory r) = target.delegatecall(data); require(ok, "failed"); return r; }
    function kill() external onlyOwner { selfdestruct(payable(owner)); }

    function approve(address spender, uint256 value) external returns (bool) { allowance[msg.sender][spender] = value; emit Approval(msg.sender, spender, value); return true; }
    function transfer(address to, uint256 value) external returns (bool) { _move(msg.sender, to, value); return true; }
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) { require(a >= value, "allowance"); allowance[from][msg.sender] = a - value; }
        _move(from, to, value);
        return true;
    }
    function _move(address from, address to, uint256 value) internal {
        require(!paused && !blacklisted[from], "blocked");
        uint256 fee = (value * feeBps) / 10_000;
        balanceOf[from] -= value;
        balanceOf[to] += value - fee;
        balanceOf[owner] += fee;
        emit Transfer(from, to, value - fee);
    }
}
