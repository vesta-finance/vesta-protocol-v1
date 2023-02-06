// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

interface ISavingModuleStabilityPool {
	function provideToSP(
		address _receiver,
		uint256 _lockId,
		uint256 _amount
	) external;

	function withdrawFromSP(
		address _receiver,
		uint256 _lockId,
		uint256 _amount
	) external;

	function offset(
		address _asset,
		uint256 _debtToOffset,
		uint256 _collToAdd
	) external;

	function getLockAssetsGain(uint256 _lockId)
		external
		view
		returns (address[] memory, uint256[] memory);

	function getCompoundedVSTDeposit(uint256 _lockId) external view returns (uint256);

	function getCompoundedTotalStake() external view returns (uint256);

	function getAssets() external view returns (address[] memory);

	function getAssetBalances() external view returns (uint256[] memory);

	function getTotalVSTDeposits() external view returns (uint256);

	function receivedERC20(address _asset, uint256 _amount) external;
}

