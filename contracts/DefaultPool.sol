// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Interfaces/IDefaultPool.sol";
import "./Dependencies/CheckContract.sol";

/*
 * The Default Pool holds the ETH and VST debt (but not VST tokens) from liquidations that have been redistributed
 * to active troves but not yet "applied", i.e. not yet recorded on a recipient active trove's struct.
 *
 * When a trove makes an operation that applies its pending ETH and VST debt, its pending ETH and VST debt is moved
 * from the Default Pool to the Active Pool.
 */
contract DefaultPool is Ownable, CheckContract, IDefaultPool {
	using SafeMath for uint256;
	using SafeERC20 for IERC20;

	string public constant NAME = "DefaultPool";

	address constant ETH_REF_ADDRESS = address(0);

	address public troveManagerAddress;
	address public activePoolAddress;
	mapping(address => uint256) internal assetsBalance;
	mapping(address => uint256) internal VSTDebts; // debt

	// --- Dependency setters ---

	function setAddresses(
		address _troveManagerAddress,
		address _activePoolAddress
	) external onlyOwner {
		checkContract(_troveManagerAddress);
		checkContract(_activePoolAddress);

		troveManagerAddress = _troveManagerAddress;
		activePoolAddress = _activePoolAddress;

		emit TroveManagerAddressChanged(_troveManagerAddress);
		emit ActivePoolAddressChanged(_activePoolAddress);

		renounceOwnership();
	}

	// --- Getters for public variables. Required by IPool interface ---

	/*
	 * Returns the ETH state variable.
	 *
	 * Not necessarily equal to the the contract's raw ETH balance - ether can be forcibly sent to contracts.
	 */
	function getAssetBalance(address _asset)
		external
		view
		override
		returns (uint256)
	{
		return assetsBalance[_asset];
	}

	function getVSTDebt(address _asset)
		external
		view
		override
		returns (uint256)
	{
		return VSTDebts[_asset];
	}

	// --- Pool functionality ---

	function sendAssetToActivePool(address _asset, uint256 _amount)
		external
		override
		callerIsTroveManager
	{
		address activePool = activePoolAddress; // cache to save an SLOAD
		assetsBalance[_asset] = assetsBalance[_asset].sub(_amount);

		if (_asset != ETH_REF_ADDRESS) {
			IERC20(_asset).safeTransfer(activePool, _amount);
			IDeposit(activePool).receivedERC20(_asset, _amount);
		} else {
			(bool success, ) = activePool.call{ value: _amount }("");
			require(success, "DefaultPool: sending ETH failed");
		}

		emit DefaultPoolAssetBalanceUpdated(_asset, assetsBalance[_asset]);
		emit AssetSent(activePool, _asset, _amount);
	}

	function increaseVSTDebt(address _asset, uint256 _amount)
		external
		override
		callerIsTroveManager
	{
		VSTDebts[_asset] = VSTDebts[_asset].add(_amount);
		emit DefaultPoolVSTDebtUpdated(_asset, VSTDebts[_asset]);
	}

	function decreaseVSTDebt(address _asset, uint256 _amount)
		external
		override
		callerIsTroveManager
	{
		VSTDebts[_asset] = VSTDebts[_asset].sub(_amount);
		emit DefaultPoolVSTDebtUpdated(_asset, VSTDebts[_asset]);
	}

	// --- 'require' functions ---

	modifier callerIsActivePool() {
		require(
			msg.sender == activePoolAddress,
			"DefaultPool: Caller is not the ActivePool"
		);
		_;
	}

	modifier callerIsTroveManager() {
		require(
			msg.sender == troveManagerAddress,
			"DefaultPool: Caller is not the TroveManager"
		);
		_;
	}

	function receivedERC20(address _asset, uint256 _amount)
		external
		override
		callerIsActivePool
	{
		assetsBalance[_asset] = assetsBalance[_asset].add(_amount);
		emit DefaultPoolAssetBalanceUpdated(
			_asset,
			assetsBalance[ETH_REF_ADDRESS]
		);
	}

	// --- Fallback function ---

	receive() external payable callerIsActivePool {
		assetsBalance[ETH_REF_ADDRESS] = assetsBalance[ETH_REF_ADDRESS].add(
			msg.value
		);
		emit DefaultPoolAssetBalanceUpdated(
			ETH_REF_ADDRESS,
			assetsBalance[ETH_REF_ADDRESS]
		);
	}
}
