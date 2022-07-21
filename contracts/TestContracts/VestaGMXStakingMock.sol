// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract VestaGMXStakingMock {
	using SafeERC20 for IERC20;

	function stake(address _behalfOf, uint256 _amount) external {}

	function unstake(address _behalfOf, uint256 _amount) external {}
}
