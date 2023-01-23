// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./Interfaces/IBorrowerOperations.sol";
import "./Interfaces/ITroveManager.sol";
import "./Interfaces/IVSTToken.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ISortedTroves.sol";
import "./Interfaces/IVSTAStaking.sol";
import "./Interfaces/IStabilityPoolManager.sol";
import "./Dependencies/VestaBase.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/SafetyTransfer.sol";
import "./Interfaces/IInterestManager.sol";
import "./Interfaces/IVestaDexTrader.sol";
import "./Interfaces/IWETH.sol";

contract BorrowerOperations is VestaBase, CheckContract, IBorrowerOperations {
	using SafeMathUpgradeable for uint256;
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "BorrowerOperations";

	// --- Connected contract declarations ---

	ITroveManager public troveManager;

	IStabilityPoolManager stabilityPoolManager;

	address gasPoolAddress;

	ICollSurplusPool collSurplusPool;

	IVSTAStaking public VSTAStaking;
	address public VSTAStakingAddress;

	IVSTToken public VSTToken;

	// A doubly linked list of Troves, sorted by their collateral ratios
	ISortedTroves public sortedTroves;

	bool public isInitialized;

	mapping(address => bool) internal hasVSTAccess;

	IInterestManager public interestManager;

	IVestaDexTrader public dexTrader;

	address public constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;

	struct ContractsCache {
		ITroveManager troveManager;
		IActivePool activePool;
		IVSTToken VSTToken;
	}

	// --- Borrower Trove Operations ---

	function openTrove(
		address _asset,
		uint256 _tokenAmount,
		uint256 _maxFeePercentage,
		uint256 _VSTAmount,
		address _upperHint,
		address _lowerHint
	) external payable override {
		vestaParams.sanitizeParameters(_asset);

		ContractsCache memory contractsCache = ContractsCache(
			troveManager,
			vestaParams.activePool(),
			VSTToken
		);
		LocalVariables_openTrove memory vars;
		vars.asset = _asset;

		_tokenAmount = getMethodValue(vars.asset, _tokenAmount, false);
		vars.price = vestaParams.priceFeed().fetchPrice(vars.asset);

		_requireValidMaxFeePercentage(vars.asset, _maxFeePercentage);
		_requireTroveisNotActive(vars.asset, contractsCache.troveManager, msg.sender);

		vars.VSTFee;
		vars.netDebt = _VSTAmount;

		vars.VSTFee = _triggerBorrowingFee(
			vars.asset,
			contractsCache.troveManager,
			contractsCache.VSTToken,
			_VSTAmount,
			_maxFeePercentage
		);
		vars.netDebt = vars.netDebt.add(vars.VSTFee);
		_requireAtLeastMinNetDebt(vars.asset, vars.netDebt);

		// ICR is based on the composite debt, i.e. the requested VST amount + VST borrowing fee + VST gas comp.
		vars.compositeDebt = _getCompositeDebt(vars.asset, vars.netDebt);

		assert(vars.compositeDebt > 0);
		_requireLowerOrEqualsToVSTLimit(vars.asset, vars.compositeDebt);

		vars.ICR = VestaMath._computeCR(_tokenAmount, vars.compositeDebt, vars.price);
		vars.NICR = VestaMath._computeNominalCR(_tokenAmount, vars.compositeDebt);

		_requireICRisAboveMCR(vars.asset, vars.ICR);

		// Set the trove struct's properties
		contractsCache.troveManager.setTroveStatus(vars.asset, msg.sender, 1);
		contractsCache.troveManager.increaseTroveColl(vars.asset, msg.sender, _tokenAmount);
		contractsCache.troveManager.increaseTroveDebt(vars.asset, msg.sender, vars.compositeDebt);

		contractsCache.troveManager.updateTroveRewardSnapshots(vars.asset, msg.sender);
		vars.stake = contractsCache.troveManager.updateStakeAndTotalStakes(vars.asset, msg.sender);

		sortedTroves.insert(vars.asset, msg.sender, vars.NICR, _upperHint, _lowerHint);
		vars.arrayIndex = contractsCache.troveManager.addTroveOwnerToArray(vars.asset, msg.sender);
		emit TroveCreated(vars.asset, msg.sender, vars.arrayIndex);

		// Move the ether to the Active Pool, and mint the VSTAmount to the borrower
		_activePoolAddColl(vars.asset, contractsCache.activePool, _tokenAmount);
		_withdrawVST(
			vars.asset,
			contractsCache.activePool,
			contractsCache.VSTToken,
			msg.sender,
			_VSTAmount,
			vars.netDebt
		);
		// Move the VST gas compensation to the Gas Pool
		_withdrawVST(
			vars.asset,
			contractsCache.activePool,
			contractsCache.VSTToken,
			gasPoolAddress,
			vestaParams.VST_GAS_COMPENSATION(vars.asset),
			vestaParams.VST_GAS_COMPENSATION(vars.asset)
		);

		emit TroveUpdated(
			vars.asset,
			msg.sender,
			vars.compositeDebt,
			_tokenAmount,
			vars.stake,
			BorrowerOperation.openTrove
		);
		emit VSTBorrowingFeePaid(vars.asset, msg.sender, vars.VSTFee);
	}

	function setInterestManager(address _interestManager) external onlyOwner {
		interestManager = IInterestManager(_interestManager);
	}

	function setDexTrader(address _dexTrader) external onlyOwner {
		dexTrader = IVestaDexTrader(_dexTrader);
	}

	// Send ETH as collateral to a trove. Called by only the Stability Pool.
	function moveETHGainToTrove(
		address _asset,
		uint256 _amountMoved,
		address _borrower,
		address _upperHint,
		address _lowerHint
	) external payable override {
		require(
			stabilityPoolManager.isStabilityPool(msg.sender),
			"BorrowerOps: Caller is not Stability Pool"
		);

		_adjustTrove(
			_asset,
			getMethodValue(_asset, _amountMoved, false),
			_borrower,
			0,
			0,
			false,
			_upperHint,
			_lowerHint,
			0
		);
	}

	function adjustTrove(
		address _asset,
		uint256 _assetSent,
		uint256 _maxFeePercentage,
		uint256 _collWithdrawal,
		uint256 _VSTChange,
		bool _isDebtIncrease,
		address _upperHint,
		address _lowerHint
	) external payable override {
		_adjustTrove(
			_asset,
			getMethodValue(_asset, _assetSent, true),
			msg.sender,
			_collWithdrawal,
			_VSTChange,
			_isDebtIncrease,
			_upperHint,
			_lowerHint,
			_maxFeePercentage
		);
	}

	/*
	 * _adjustTrove(): Alongside a debt change, this function can perform either a collateral top-up or a collateral withdrawal.
	 *
	 * It therefore expects either a positive msg.value, or a positive _collWithdrawal argument.
	 *
	 * If both are positive, it will revert.
	 */
	function _adjustTrove(
		address _asset,
		uint256 _assetSent,
		address _borrower,
		uint256 _collWithdrawal,
		uint256 _VSTChange,
		bool _isDebtIncrease,
		address _upperHint,
		address _lowerHint,
		uint256 _maxFeePercentage
	) internal {
		ContractsCache memory contractsCache = ContractsCache(
			troveManager,
			vestaParams.activePool(),
			VSTToken
		);
		LocalVariables_adjustTrove memory vars;
		vars.asset = _asset;

		if (_isDebtIncrease) {
			_requireLowerOrEqualsToVSTLimit(vars.asset, _VSTChange);
		}

		require(
			msg.value == 0 || msg.value == _assetSent,
			"BorrowerOp: _AssetSent and Msg.value aren't the same!"
		);

		vars.price = vestaParams.priceFeed().fetchPrice(vars.asset);

		if (_isDebtIncrease) {
			_requireValidMaxFeePercentage(vars.asset, _maxFeePercentage);
			_requireNonZeroDebtChange(_VSTChange);
		}
		require(
			_collWithdrawal == 0 || _assetSent == 0,
			"BorrowerOperations: Cannot withdraw and add coll"
		);

		_requireNonZeroAdjustment(_collWithdrawal, _VSTChange, _assetSent);
		_requireTroveisActive(vars.asset, contractsCache.troveManager, _borrower);

		// Confirm the operation is either a borrower adjusting their own trove, or a pure ETH transfer from the Stability Pool to a trove
		assert(
			msg.sender == _borrower ||
				(stabilityPoolManager.isStabilityPool(msg.sender) && _assetSent > 0 && _VSTChange == 0)
		);

		contractsCache.troveManager.applyPendingRewards(vars.asset, _borrower);

		// Get the collChange based on whether or not ETH was sent in the transaction
		(vars.collChange, vars.isCollIncrease) = _getCollChange(_assetSent, _collWithdrawal);

		vars.netDebtChange = _VSTChange;

		// If the adjustment incorporates a debt increase and system is in Normal Mode, then trigger a borrowing fee
		if (_isDebtIncrease) {
			vars.VSTFee = _triggerBorrowingFee(
				vars.asset,
				contractsCache.troveManager,
				contractsCache.VSTToken,
				_VSTChange,
				_maxFeePercentage
			);
			vars.netDebtChange = vars.netDebtChange.add(vars.VSTFee); // The raw debt change includes the fee
		}

		vars.debt = contractsCache.troveManager.getTroveDebt(vars.asset, _borrower);
		vars.coll = contractsCache.troveManager.getTroveColl(vars.asset, _borrower);

		// Get the trove's old ICR before the adjustment, and what its new ICR will be after the adjustment
		vars.oldICR = VestaMath._computeCR(vars.coll, vars.debt, vars.price);
		vars.newICR = _getNewICRFromTroveChange(
			vars.coll,
			vars.debt,
			vars.collChange,
			vars.isCollIncrease,
			vars.netDebtChange,
			_isDebtIncrease,
			vars.price
		);
		require(
			_collWithdrawal <= vars.coll,
			"BorrowerOp: Trying to remove more than the trove holds"
		);

		// Check the adjustment satisfies all conditions for the current system mode
		_requireICRisAboveMCR(_asset, vars.newICR);

		// When the adjustment is a debt repayment, check it's a valid amount and that the caller has enough VST
		if (!_isDebtIncrease && _VSTChange > 0) {
			_requireAtLeastMinNetDebt(
				vars.asset,
				_getNetDebt(vars.asset, vars.debt).sub(vars.netDebtChange)
			);

			require(
				vars.netDebtChange <= vars.debt.sub(vestaParams.VST_GAS_COMPENSATION(vars.asset)),
				"BorrowerOps: Amount repaid must not be larger than the Trove's debt"
			);

			_requireSufficientVSTBalance(contractsCache.VSTToken, _borrower, vars.netDebtChange);
		}

		(vars.newColl, vars.newDebt) = _updateTroveFromAdjustment(
			vars.asset,
			contractsCache.troveManager,
			_borrower,
			vars.collChange,
			vars.isCollIncrease,
			vars.netDebtChange,
			_isDebtIncrease
		);
		vars.stake = contractsCache.troveManager.updateStakeAndTotalStakes(vars.asset, _borrower);

		// Re-insert trove in to the sorted list
		uint256 newNICR = _getNewNominalICRFromTroveChange(
			vars.coll,
			vars.debt,
			vars.collChange,
			vars.isCollIncrease,
			vars.netDebtChange,
			_isDebtIncrease
		);
		sortedTroves.reInsert(vars.asset, _borrower, newNICR, _upperHint, _lowerHint);

		emit TroveUpdated(
			vars.asset,
			_borrower,
			vars.newDebt != 0 ? vars.newDebt : vars.debt,
			vars.newColl != 0 ? vars.newColl : vars.coll,
			vars.stake,
			BorrowerOperation.adjustTrove
		);
		emit VSTBorrowingFeePaid(vars.asset, msg.sender, vars.VSTFee);

		// Use the unmodified _VSTChange here, as we don't send the fee to the user
		_moveTokensAndETHfromAdjustment(
			vars.asset,
			contractsCache.activePool,
			contractsCache.VSTToken,
			msg.sender,
			vars.collChange,
			vars.isCollIncrease,
			_VSTChange,
			_isDebtIncrease,
			vars.netDebtChange
		);
	}

	function closeTroveWithDexTrader(
		address _asset,
		uint256 _amountIn,
		IVestaDexTrader.ManualExchange[] calldata _manualExchange
	) external {
		_closeTrove(_asset, _amountIn, _manualExchange);
	}

	function closeTrove(address _asset) external override {
		_closeTrove(_asset, 0, new IVestaDexTrader.ManualExchange[](0));
	}

	function _closeTrove(
		address _asset,
		uint256 _amountIn,
		IVestaDexTrader.ManualExchange[] memory _manualExchange
	) internal {
		if (_asset == WETH) _asset = ETH_REF_ADDRESS;

		ITroveManager troveManagerCached = troveManager;
		IActivePool activePoolCached = vestaParams.activePool();
		IVSTToken VSTTokenCached = VSTToken;

		_requireTroveisActive(_asset, troveManagerCached, msg.sender);

		troveManagerCached.applyPendingRewards(_asset, msg.sender);
		uint256 coll = troveManagerCached.getTroveColl(_asset, msg.sender);
		uint256 debt = troveManagerCached.getTroveDebt(_asset, msg.sender);

		uint256 userVST = VSTTokenCached.balanceOf(msg.sender);

		if (debt > userVST) {
			uint256 amountNeeded = debt - userVST;
			address tokenIn = _asset;

			require(
				_manualExchange.length > 0,
				"BorrowerOps: Caller doesnt have enough VST to make repayment"
			);

			if (_amountIn == 0) {
				_amountIn = dexTrader.getAmountIn(amountNeeded, _manualExchange);
			}

			activePoolCached.unstake(_asset, msg.sender, _amountIn);
			activePoolCached.sendAsset(_asset, address(this), _amountIn);
			troveManagerCached.decreaseTroveColl(_asset, msg.sender, _amountIn);
			coll -= _amountIn;

			if (_asset == ETH_REF_ADDRESS) {
				tokenIn = WETH;
				IWETH(WETH).deposit{ value: _amountIn }();
			}

			IERC20Upgradeable(tokenIn).safeApprove(address(dexTrader), _amountIn);

			dexTrader.exchange(msg.sender, tokenIn, _amountIn, _manualExchange);

			require(
				VSTTokenCached.balanceOf(msg.sender) >= debt,
				"AutoSwapping Failed, Try increasing slippage inside ManualExchange"
			);
		}

		_requireSufficientVSTBalance(
			VSTTokenCached,
			msg.sender,
			debt.sub(vestaParams.VST_GAS_COMPENSATION(_asset))
		);

		troveManagerCached.removeStake(_asset, msg.sender);
		troveManagerCached.closeTrove(_asset, msg.sender);

		emit TroveUpdated(_asset, msg.sender, 0, 0, 0, BorrowerOperation.closeTrove);

		// Burn the repaid VST from the user's balance and the gas compensation from the Gas Pool
		_repayVST(_asset, activePoolCached, VSTTokenCached, msg.sender, debt);

		// Send the collateral back to the user
		activePoolCached.sendAsset(_asset, msg.sender, coll);
	}

	/**
	 * Claim remaining collateral from a redemption or from a liquidation with ICR > MCR in Recovery Mode
	 */
	function claimCollateral(address _asset) external override {
		// send ETH from CollSurplus Pool to owner
		collSurplusPool.claimColl(_asset, msg.sender);
	}

	function claimCollaterals(address[] calldata _assets) external override {
		uint256 length = _assets.length;

		for (uint256 i = 0; i < length; ++i) {
			collSurplusPool.claimColl(_assets[i], msg.sender);
		}
	}

	// --- Helper functions ---

	function _triggerBorrowingFee(
		address _asset,
		ITroveManager _troveManager,
		IVSTToken _VSTToken,
		uint256 _VSTAmount,
		uint256 _maxFeePercentage
	) internal returns (uint256) {
		_troveManager.decayBaseRateFromBorrowing(_asset); // decay the baseRate state variable
		uint256 VSTFee = _troveManager.getBorrowingFee(_asset, _VSTAmount);

		_requireUserAcceptsFee(VSTFee, _VSTAmount, _maxFeePercentage);

		// Send fee to VSTA staking contract
		_VSTToken.mint(_asset, VSTAStakingAddress, VSTFee);
		VSTAStaking.increaseF_VST(VSTFee);

		return VSTFee;
	}

	function _getUSDValue(uint256 _coll, uint256 _price) internal pure returns (uint256) {
		uint256 usdValue = _price.mul(_coll).div(DECIMAL_PRECISION);

		return usdValue;
	}

	function _getCollChange(uint256 _collReceived, uint256 _requestedCollWithdrawal)
		internal
		pure
		returns (uint256 collChange, bool isCollIncrease)
	{
		if (_collReceived != 0) {
			collChange = _collReceived;
			isCollIncrease = true;
		} else {
			collChange = _requestedCollWithdrawal;
		}
	}

	// Update trove's coll and debt based on whether they increase or decrease
	function _updateTroveFromAdjustment(
		address _asset,
		ITroveManager _troveManager,
		address _borrower,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease
	) internal returns (uint256 newColl, uint256 newDebt) {
		if (_collChange != 0) {
			newColl = (_isCollIncrease)
				? _troveManager.increaseTroveColl(_asset, _borrower, _collChange)
				: _troveManager.decreaseTroveColl(_asset, _borrower, _collChange);
		}

		if (_debtChange != 0) {
			newDebt = (_isDebtIncrease)
				? _troveManager.increaseTroveDebt(_asset, _borrower, _debtChange)
				: _troveManager.decreaseTroveDebt(_asset, _borrower, _debtChange);
		}

		return (newColl, newDebt);
	}

	function _moveTokensAndETHfromAdjustment(
		address _asset,
		IActivePool _activePool,
		IVSTToken _VSTToken,
		address _borrower,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _VSTChange,
		bool _isDebtIncrease,
		uint256 _netDebtChange
	) internal {
		if (_isDebtIncrease) {
			_withdrawVST(_asset, _activePool, _VSTToken, _borrower, _VSTChange, _netDebtChange);
		} else {
			_repayVST(_asset, _activePool, _VSTToken, _borrower, _VSTChange);
		}

		if (_isCollIncrease) {
			_activePoolAddColl(_asset, _activePool, _collChange);
		} else {
			_activePool.unstake(_asset, _borrower, _collChange);
			_activePool.sendAsset(_asset, _borrower, _collChange);
		}
	}

	// Send ETH to Active Pool and increase its recorded ETH balance
	function _activePoolAddColl(
		address _asset,
		IActivePool _activePool,
		uint256 _amount
	) internal {
		if (_asset == ETH_REF_ADDRESS) {
			(bool success, ) = address(_activePool).call{ value: _amount }("");
			require(success, "BorrowerOps: Sending ETH to ActivePool failed");
		} else {
			IERC20Upgradeable(_asset).safeTransferFrom(
				msg.sender,
				address(_activePool),
				SafetyTransfer.decimalsCorrection(_asset, _amount)
			);

			_activePool.receivedERC20(_asset, _amount);
			_activePool.stake(_asset, msg.sender, _amount);
		}
	}

	// Issue the specified amount of VST to _account and increases the total active debt (_netDebtIncrease potentially includes a VSTFee)
	function _withdrawVST(
		address _asset,
		IActivePool _activePool,
		IVSTToken _VSTToken,
		address _account,
		uint256 _VSTAmount,
		uint256 _netDebtIncrease
	) internal {
		_activePool.increaseVSTDebt(_asset, _netDebtIncrease);
		_VSTToken.mint(_asset, _account, _VSTAmount);
	}

	// Burn the specified amount of VST from _account and decreases the total active debt
	function _repayVST(
		address _asset,
		IActivePool _activePool,
		IVSTToken _VSTToken,
		address _account,
		uint256 _VST
	) internal {
		_activePool.decreaseVSTDebt(_asset, _VST);
		_VSTToken.burn(_account, _VST);
	}

	function setVSTAccess(address _of, bool _enable) external onlyOwner {
		require(_of.code.length > 0, "Only contracts");
		hasVSTAccess[_of] = _enable;
	}

	function mint(address _to, uint256 _amount) external {
		require(hasVSTAccess[msg.sender], "No Access");
		VSTToken.mint(address(0), _to, _amount);
	}

	function burn(address _from, uint256 _amount) external {
		require(hasVSTAccess[msg.sender], "No Access");
		VSTToken.burn(_from, _amount);
	}

	// --- 'Require' wrapper functions ---

	function _requireCallerIsBorrower(address _borrower) internal view {
		require(
			msg.sender == _borrower,
			"BorrowerOps: Caller must be the borrower for a withdrawal"
		);
	}

	function _requireNonZeroAdjustment(
		uint256 _collWithdrawal,
		uint256 _VSTChange,
		uint256 _assetSent
	) internal view {
		require(
			msg.value != 0 || _collWithdrawal != 0 || _VSTChange != 0 || _assetSent != 0,
			"BorrowerOps: There must be either a collateral change or a debt change"
		);
	}

	function _requireTroveisActive(
		address _asset,
		ITroveManager _troveManager,
		address _borrower
	) internal view {
		uint256 status = _troveManager.getTroveStatus(_asset, _borrower);
		require(status == 1, "BorrowerOps: Trove does not exist or is closed");
	}

	function _requireTroveisNotActive(
		address _asset,
		ITroveManager _troveManager,
		address _borrower
	) internal view {
		uint256 status = _troveManager.getTroveStatus(_asset, _borrower);
		require(status != 1, "BorrowerOps: Trove is active");
	}

	function _requireNonZeroDebtChange(uint256 _VSTChange) internal pure {
		require(_VSTChange > 0, "BorrowerOps: Debt increase requires non-zero debtChange");
	}

	function _requireNotInRecoveryMode(address _asset, uint256 _price) internal view {
		require(
			!_checkRecoveryMode(_asset, _price),
			"BorrowerOps: Operation not permitted during Recovery Mode"
		);
	}

	function _requireNoCollWithdrawal(uint256 _collWithdrawal) internal pure {
		require(
			_collWithdrawal == 0,
			"BorrowerOps: Collateral withdrawal not permitted Recovery Mode"
		);
	}

	function _requireICRisAboveMCR(address _asset, uint256 _newICR) internal view {
		require(
			_newICR >= vestaParams.MCR(_asset),
			"BorrowerOps: An operation that would result in ICR < MCR is not permitted"
		);
	}

	function _requireAtLeastMinNetDebt(address _asset, uint256 _netDebt) internal view {
		require(
			_netDebt >= vestaParams.MIN_NET_DEBT(_asset),
			"BorrowerOps: Trove's net debt must be greater than minimum"
		);
	}

	function _requireSufficientVSTBalance(
		IVSTToken _VSTToken,
		address _borrower,
		uint256 _debtRepayment
	) internal view {
		require(
			_VSTToken.balanceOf(_borrower) >= _debtRepayment,
			"BorrowerOps: Caller doesnt have enough VST to make repayment"
		);
	}

	function _requireValidMaxFeePercentage(address _asset, uint256 _maxFeePercentage)
		internal
		view
	{
		require(
			_maxFeePercentage >= vestaParams.BORROWING_FEE_FLOOR(_asset) &&
				_maxFeePercentage <= vestaParams.DECIMAL_PRECISION(),
			"Max fee percentage must be between 0.5% and 100%"
		);
	}

	function _requireLowerOrEqualsToVSTLimit(address _asset, uint256 _vstChange) internal view {
		uint256 vstLimit = vestaParams.vstMintCap(_asset);
		uint256 newDebt = getEntireSystemDebt(_asset) + _vstChange;
		uint256 unpaidInterest = troveManager.getSystemTotalUnpaidInterest(_asset);

		if (vstLimit != 0) {
			require(vstLimit >= (newDebt - unpaidInterest), "Reached the cap limit of vst.");
		}
	}

	// --- ICR and TCR getters ---

	// Compute the new collateral ratio, considering the change in coll and debt. Assumes 0 pending rewards.
	function _getNewNominalICRFromTroveChange(
		uint256 _coll,
		uint256 _debt,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease
	) internal pure returns (uint256) {
		(uint256 newColl, uint256 newDebt) = _getNewTroveAmounts(
			_coll,
			_debt,
			_collChange,
			_isCollIncrease,
			_debtChange,
			_isDebtIncrease
		);

		uint256 newNICR = VestaMath._computeNominalCR(newColl, newDebt);
		return newNICR;
	}

	// Compute the new collateral ratio, considering the change in coll and debt. Assumes 0 pending rewards.
	function _getNewICRFromTroveChange(
		uint256 _coll,
		uint256 _debt,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease,
		uint256 _price
	) internal pure returns (uint256) {
		(uint256 newColl, uint256 newDebt) = _getNewTroveAmounts(
			_coll,
			_debt,
			_collChange,
			_isCollIncrease,
			_debtChange,
			_isDebtIncrease
		);

		uint256 newICR = VestaMath._computeCR(newColl, newDebt, _price);
		return newICR;
	}

	function _getNewTroveAmounts(
		uint256 _coll,
		uint256 _debt,
		uint256 _collChange,
		bool _isCollIncrease,
		uint256 _debtChange,
		bool _isDebtIncrease
	) internal pure returns (uint256, uint256) {
		uint256 newColl = _coll;
		uint256 newDebt = _debt;

		newColl = _isCollIncrease ? _coll.add(_collChange) : _coll.sub(_collChange);
		newDebt = _isDebtIncrease ? _debt.add(_debtChange) : _debt.sub(_debtChange);

		return (newColl, newDebt);
	}

	function getCompositeDebt(address _asset, uint256 _debt)
		external
		view
		override
		returns (uint256)
	{
		return _getCompositeDebt(_asset, _debt);
	}

	function getMethodValue(
		address _asset,
		uint256 _amount,
		bool canBeZero
	) private view returns (uint256) {
		bool isEth = _asset == address(0);

		require(
			(canBeZero || (isEth && msg.value != 0)) || (!isEth && msg.value == 0),
			"BorrowerOp: Invalid Input. Override msg.value only if using ETH asset, otherwise use _tokenAmount"
		);

		if (_asset == address(0)) {
			_amount = msg.value;
		}

		return _amount;
	}

	receive() external payable {}
}

