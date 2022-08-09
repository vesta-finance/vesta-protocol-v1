// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./Interfaces/IActivePool.sol";
import "./Interfaces/IDefaultPool.sol";
import "./Interfaces/IStabilityPoolManager.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/IDeposit.sol";
import "./Interfaces/IVestaGMXStaking.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/SafetyTransfer.sol";

/*
 * The Active Pool holds the collaterals and VST debt (but not VST tokens) for all active troves.
 *
 * When a trove is liquidated, it's collateral and VST debt are transferred from the Active Pool, to either the
 * Stability Pool, the Default Pool, or both, depending on the liquidation conditions.
 *
 */
contract ActivePool is
	OwnableUpgradeable,
	ReentrancyGuardUpgradeable,
	CheckContract,
	IActivePool
{
	using SafeERC20Upgradeable for IERC20Upgradeable;
	using SafeMathUpgradeable for uint256;

	string public constant NAME = "ActivePool";
	address constant ETH_REF_ADDRESS = address(0);

	address public borrowerOperationsAddress;
	address public troveManagerAddress;
	IDefaultPool public defaultPool;
	ICollSurplusPool public collSurplusPool;

	IStabilityPoolManager public stabilityPoolManager;

	bool public isInitialized;

	mapping(address => uint256) internal assetsBalance;
	mapping(address => uint256) internal VSTDebts;

	address public constant VESTA_ADMIN = 0x4A4651B31d747D1DdbDDADCF1b1E24a5f6dcc7b0;
	address public constant GMX_TOKEN = 0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a;
	IVestaGMXStaking public vestaGMXStaking;

	address public constant SGLP = 0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258;
	IVestaGMXStaking public vestaGLPStaking;

	modifier callerIsBorrowerOperationOrDefaultPool() {
		require(
			msg.sender == borrowerOperationsAddress || msg.sender == address(defaultPool),
			"ActivePool: Caller is neither BO nor Default Pool"
		);

		_;
	}

	modifier callerIsBOorTroveMorSP() {
		require(
			msg.sender == borrowerOperationsAddress ||
				msg.sender == troveManagerAddress ||
				stabilityPoolManager.isStabilityPool(msg.sender),
			"ActivePool: Caller is neither BorrowerOperations nor TroveManager nor StabilityPool"
		);
		_;
	}

	modifier callerIsBOorTroveM() {
		require(
			msg.sender == borrowerOperationsAddress || msg.sender == troveManagerAddress,
			"ActivePool: Caller is neither BorrowerOperations nor TroveManager"
		);

		_;
	}

	function setAddresses(
		address _borrowerOperationsAddress,
		address _troveManagerAddress,
		address _stabilityManagerAddress,
		address _defaultPoolAddress,
		address _collSurplusPoolAddress
	) external initializer {
		require(!isInitialized, "Already initialized");
		checkContract(_borrowerOperationsAddress);
		checkContract(_troveManagerAddress);
		checkContract(_stabilityManagerAddress);
		checkContract(_defaultPoolAddress);
		checkContract(_collSurplusPoolAddress);
		isInitialized = true;

		__Ownable_init();
		__ReentrancyGuard_init();

		borrowerOperationsAddress = _borrowerOperationsAddress;
		troveManagerAddress = _troveManagerAddress;
		stabilityPoolManager = IStabilityPoolManager(_stabilityManagerAddress);
		defaultPool = IDefaultPool(_defaultPoolAddress);
		collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);

		emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
		emit TroveManagerAddressChanged(_troveManagerAddress);
		emit StabilityPoolAddressChanged(_stabilityManagerAddress);
		emit DefaultPoolAddressChanged(_defaultPoolAddress);

		renounceOwnership();
	}

	function restorAdminToVesta() external {
		require(owner() == address(0), "Owership already restored");

		_transferOwnership(VESTA_ADMIN);
	}

	function setVestaGMXStaking(address _vestaGMXStaking) external onlyOwner {
		checkContract(_vestaGMXStaking);

		if (address(vestaGMXStaking) != address(0)) {
			IERC20Upgradeable(GMX_TOKEN).safeApprove(address(vestaGMXStaking), 0);
		}

		vestaGMXStaking = IVestaGMXStaking(_vestaGMXStaking);
		IERC20Upgradeable(GMX_TOKEN).safeApprove(_vestaGMXStaking, type(uint256).max);
	}

	function setVestaGLPStaking(address _vestaGLPStaking) external onlyOwner {
		checkContract(_vestaGLPStaking);

		if (address(vestaGLPStaking) != address(0)) {
			IERC20Upgradeable(SGLP).safeApprove(address(vestaGLPStaking), 0);
		}

		vestaGLPStaking = IVestaGMXStaking(_vestaGLPStaking);
		IERC20Upgradeable(SGLP).safeApprove(_vestaGLPStaking, type(uint256).max);
	}

	function getAssetBalance(address _asset) external view override returns (uint256) {
		return assetsBalance[_asset];
	}

	function getVSTDebt(address _asset) external view override returns (uint256) {
		return VSTDebts[_asset];
	}

	function sendAsset(
		address _asset,
		address _account,
		uint256 _amount
	) external override nonReentrant callerIsBOorTroveMorSP {
		if (stabilityPoolManager.isStabilityPool(msg.sender)) {
			assert(address(stabilityPoolManager.getAssetStabilityPool(_asset)) == msg.sender);
		}

		uint256 safetyTransferAmount = SafetyTransfer.decimalsCorrection(_asset, _amount);
		if (safetyTransferAmount == 0) return;

		assetsBalance[_asset] -= _amount;

		_unstake(_asset, _account, _amount);

		if (_asset != ETH_REF_ADDRESS) {
			IERC20Upgradeable(_asset).safeTransfer(_account, safetyTransferAmount);

			if (isERC20DepositContract(_account)) {
				IDeposit(_account).receivedERC20(_asset, _amount);
			}
		} else {
			(bool success, ) = _account.call{ value: _amount }("");
			require(success, "ActivePool: sending ETH failed");
		}

		emit ActivePoolAssetBalanceUpdated(_asset, assetsBalance[_asset]);
		emit AssetSent(_account, _asset, safetyTransferAmount);
	}

	function isERC20DepositContract(address _account) private view returns (bool) {
		return (_account == address(defaultPool) ||
			_account == address(collSurplusPool) ||
			stabilityPoolManager.isStabilityPool(_account));
	}

	function increaseVSTDebt(address _asset, uint256 _amount)
		external
		override
		callerIsBOorTroveM
	{
		VSTDebts[_asset] = VSTDebts[_asset].add(_amount);
		emit ActivePoolVSTDebtUpdated(_asset, VSTDebts[_asset]);
	}

	function decreaseVSTDebt(address _asset, uint256 _amount)
		external
		override
		callerIsBOorTroveMorSP
	{
		VSTDebts[_asset] = VSTDebts[_asset].sub(_amount);
		emit ActivePoolVSTDebtUpdated(_asset, VSTDebts[_asset]);
	}

	function receivedERC20(address _asset, uint256 _amount)
		external
		override
		callerIsBorrowerOperationOrDefaultPool
	{
		assetsBalance[_asset] += _amount;
		emit ActivePoolAssetBalanceUpdated(_asset, assetsBalance[_asset]);
	}

	function manuallyEnterVaultsToGMXStaking(
		address[] calldata _vaults,
		uint256[] calldata _collaterals
	) external onlyOwner {
		address[] memory cachedVaults = _vaults;
		uint256[] memory cachedCollaterals = _collaterals;
		uint256 length = cachedVaults.length;

		require(length == cachedCollaterals.length, "Invalid payload");

		for (uint256 i = 0; i < length; ++i) {
			address vaultOwner = cachedVaults[i];

			require(
				vestaGMXStaking.getVaultStake(vaultOwner) == 0,
				"A vault is already staked inside the contract"
			);

			vestaGMXStaking.stake(cachedVaults[i], cachedCollaterals[i]);
		}
	}

	function stake(
		address _asset,
		address _behalfOf,
		uint256 _amount
	) external callerIsBorrowerOperationOrDefaultPool {
		(bool isGMX, bool isGLP) = _isYieldSupported(_asset);
		IERC20Upgradeable erc20Asset = IERC20Upgradeable(_asset);

		if (!isGMX && !isGLP) {
			return;
		}

		_yieldWithGMXProtocol(isGMX ? vestaGMXStaking : vestaGLPStaking, _behalfOf, _amount, true);
	}

	function _unstake(
		address _asset,
		address _behalfOf,
		uint256 _amount
	) internal {
		(bool isGMX, bool isGLP) = _isYieldSupported(_asset);
		uint256 totalStaked = 0;

		if (!isGMX && !isGLP) {
			return;
		}

		_yieldWithGMXProtocol(
			isGMX ? vestaGMXStaking : vestaGLPStaking,
			_behalfOf,
			_amount,
			false
		);
	}

	function _isYieldSupported(address _asset) internal view returns (bool isGMX_, bool isGLP_) {
		isGMX_ = address(vestaGMXStaking) != address(0) && _asset == GMX_TOKEN;
		isGLP_ = address(vestaGLPStaking) != address(0) && _asset == SGLP;

		return (isGMX_, isGLP_);
	}

	function _yieldWithGMXProtocol(
		IVestaGMXStaking _stakingModule,
		address _behalfOf,
		uint256 _amount,
		bool _staking
	) internal {
		if (_staking) {
			try _stakingModule.stake(_behalfOf, _amount) {} catch {}
			return;
		}

		uint256 totalStaked = _stakingModule.getVaultStake(_behalfOf);

		if (totalStaked == 0) return;

		if (_amount > totalStaked) {
			_amount = totalStaked;
		}

		_stakingModule.unstake(_behalfOf, _amount);
	}

	receive() external payable callerIsBorrowerOperationOrDefaultPool {
		assetsBalance[ETH_REF_ADDRESS] = assetsBalance[ETH_REF_ADDRESS].add(msg.value);
		emit ActivePoolAssetBalanceUpdated(ETH_REF_ADDRESS, assetsBalance[ETH_REF_ADDRESS]);
	}
}
