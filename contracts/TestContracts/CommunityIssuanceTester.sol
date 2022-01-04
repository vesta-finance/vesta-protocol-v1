// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../VSTA/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {
	using SafeMath for uint256;

	function obtainVSTA(uint256 _amount) external {
		vstaToken.transfer(msg.sender, _amount);
	}

	function getCumulativeIssuanceFraction(address stabilityPool)
		external
		view
		returns (uint256)
	{
		return _getCumulativeIssuanceFraction(stabilityPool);
	}

	function unprotectedIssueVSTA(address stabilityPool)
		external
		returns (uint256)
	{
		// No checks on caller address

		uint256 latestTotalVSTAIssued = VSTASupplyCaps[stabilityPool]
			.mul(_getCumulativeIssuanceFraction(stabilityPool))
			.div(DECIMAL_PRECISION);
		uint256 issuance = latestTotalVSTAIssued.sub(
			totalVSTAIssued[stabilityPool]
		);

		totalVSTAIssued[stabilityPool] = latestTotalVSTAIssued;
		return issuance;
	}
}
