// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

interface ICollStakingManager {

	// --- External Functions ---
	function getAssetDeposited(address _asset)
		external
		view
		returns (uint256);

	function getAssetStaked(address _asset) external view returns (uint256);

	function getAssetBalance(address _asset, address _staker)
		external
		view
		returns (uint256);

	function getClaimableDpxRewards() external view returns (uint256);

	function isSupportedAsset(address _asset) external view returns (bool);

	function stakeCollaterals(address _asset, uint256 _amount) external;

	function unstakeCollaterals(address _asset, uint256 _amount) external;
}
