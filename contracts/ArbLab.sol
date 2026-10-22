// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Test helper for the Arbitrage Scanner's fork run. It exists ONLY to run on a local anvil fork
// of Pharos mainnet; it is never deployed to a real network and holds no real funds.
// It can: add liquidity to a Uniswap-V2-style pair and a Uniswap-V3-style pool, swap on either,
// and run the arbitrage (buy on one venue, sell on the other) atomically, reverting unless
// the quote token balance grows by at least `minProfit`.

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
}

interface IV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function mint(address) external returns (uint256);
    function swap(uint256, uint256, address, bytes calldata) external;
}

interface IV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function mint(address, int24, int24, uint128, bytes calldata) external returns (uint256, uint256);
    function swap(address, bool, int256, uint160, bytes calldata) external returns (int256, int256);
}

contract ArbLab {
    uint160 private constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 private constant MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    address private activePool;

    receive() external payable {}

    function wrap(address weth, uint256 amount) external {
        IWETH(weth).deposit{value: amount}();
    }

    // ---- Uniswap V2 -------------------------------------------------------------
    function v2AddLiquidity(address pair, uint256 amount0, uint256 amount1) external {
        IERC20(IV2Pair(pair).token0()).transfer(pair, amount0);
        IERC20(IV2Pair(pair).token1()).transfer(pair, amount1);
        IV2Pair(pair).mint(address(this));
    }

    // Constant-product swap with the standard 0.3% fee; the pair itself enforces the invariant,
    // so a wrong fee assumption would revert here instead of silently mis-pricing.
    function v2Swap(address pair, address tokenIn, uint256 amountIn) public returns (uint256 out) {
        (uint112 r0, uint112 r1,) = IV2Pair(pair).getReserves();
        bool in0 = IV2Pair(pair).token0() == tokenIn;
        (uint256 rIn, uint256 rOut) = in0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        out = (amountIn * 997 * rOut) / (rIn * 1000 + amountIn * 997);
        IERC20(tokenIn).transfer(pair, amountIn);
        IV2Pair(pair).swap(in0 ? 0 : out, in0 ? out : 0, address(this), "");
    }

    // ---- Uniswap V3 -------------------------------------------------------------
    function v3AddLiquidity(address pool, int24 tickLower, int24 tickUpper, uint128 liquidity) external returns (uint256 a0, uint256 a1) {
        activePool = pool;
        (a0, a1) = IV3Pool(pool).mint(address(this), tickLower, tickUpper, liquidity, "");
        activePool = address(0);
    }

    function v3Swap(address pool, address tokenIn, uint256 amountIn) public returns (uint256 out) {
        bool zeroForOne = IV3Pool(pool).token0() == tokenIn;
        activePool = pool;
        (int256 d0, int256 d1) = IV3Pool(pool).swap(address(this), zeroForOne, int256(amountIn), zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE, "");
        activePool = address(0);
        out = uint256(-(zeroForOne ? d1 : d0));
    }

    function uniswapV3MintCallback(uint256 a0, uint256 a1, bytes calldata) external {
        require(msg.sender == activePool, "unexpected caller");
        if (a0 > 0) IERC20(IV3Pool(msg.sender).token0()).transfer(msg.sender, a0);
        if (a1 > 0) IERC20(IV3Pool(msg.sender).token1()).transfer(msg.sender, a1);
    }

    function uniswapV3SwapCallback(int256 d0, int256 d1, bytes calldata) external {
        require(msg.sender == activePool, "unexpected caller");
        if (d0 > 0) IERC20(IV3Pool(msg.sender).token0()).transfer(msg.sender, uint256(d0));
        if (d1 > 0) IERC20(IV3Pool(msg.sender).token1()).transfer(msg.sender, uint256(d1));
    }

    // ---- the arbitrage ------------------------------------------------------------
    // Spend `quoteIn` of the quote token buying the base token on one venue and sell all of it on
    // the other. Returns the signed change in the quote balance. With `requireProfit` the call
    // reverts unless that change is positive; without it a losing trade is executed and measured.
    function arb(address v2, address v3, address quote, uint256 quoteIn, bool buyOnV3, bool requireProfit) external returns (int256 profit) {
        uint256 before = IERC20(quote).balanceOf(address(this));
        address t0 = IV2Pair(v2).token0();
        address base = t0 == quote ? IV2Pair(v2).token1() : t0;
        uint256 baseOut = buyOnV3 ? v3Swap(v3, quote, quoteIn) : v2Swap(v2, quote, quoteIn);
        if (buyOnV3) v2Swap(v2, base, baseOut);
        else v3Swap(v3, base, baseOut);
        uint256 afterBal = IERC20(quote).balanceOf(address(this));
        profit = int256(afterBal) - int256(before);
        if (requireProfit) require(profit > 0, "no profit");
    }
}
