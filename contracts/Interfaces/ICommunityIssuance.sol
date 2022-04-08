// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

interface ICommunityIssuance {
	// --- Events ---

	event VSTATokenAddressSet(address _VSTATokenAddress);
	event StabilityPoolAddressSet(address _stabilityPoolAddress);
	event TotalVSTAIssuedUpdated(address indexed stabilityPool, uint256 _totalVSTAIssued);

	struct DistributionRewards {
		address rewardToken;
		uint256 totalRewardIssued;
		uint256 lastUpdateTime;
		uint256 totalRewardSupply;
		uint256 rewardDistributionPerMin;
	}

	// --- Functions ---

	function setAddresses(
		address _VSTATokenAddress,
		address _stabilityPoolAddress,
		address _adminContract
	) external;

	function issueVSTA() external returns (uint256);

	function sendVSTA(address _account, uint256 _vstaAmount) external;

	function addFundToStabilityPool(address _pool, uint256 _assignedSupply) external;

	function addFundToStabilityPoolFrom(
		address _pool,
		uint256 _assignedSupply,
		address _spender
	) external;

	function setWeeklyVstaDistribution(address _stabilityPool, uint256 _weeklyReward) external;
}
