// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./Interfaces/ITroveManager.sol";
import "./Dependencies/VestaBase.sol";
import "./Dependencies/CheckContract.sol";
import "./Interfaces/IRedemption.sol";
import "./Interfaces/IInterestManager.sol";
import "./Interfaces/ISavingModuleStabilityPool.sol";

contract TroveManager is VestaBase, CheckContract, ITroveManager {
	using SafeMathUpgradeable for uint256;
	string public constant NAME = "TroveManager";

	// --- Connected contract declarations ---

	address public borrowerOperationsAddress;

	IStabilityPoolManager public stabilityPoolManager;

	address gasPoolAddress;

	ICollSurplusPool collSurplusPool;

	IVSTToken public override vstToken;

	IVSTAStaking public override vstaStaking;

	// A doubly linked list of Troves, sorted by their sorted by their collateral ratios
	ISortedTroves public sortedTroves;

	// --- Data structures ---

	uint256 public constant SECONDS_IN_ONE_MINUTE = 60;
	/*
	 * Half-life of 12h. 12h = 720 min
	 * (1/2) = d^720 => d = (1/2)^(1/720)
	 */
	uint256 public constant MINUTE_DECAY_FACTOR = 999037758833783000;

	/*
	 * BETA: 18 digit decimal. Parameter by which to divide the redeemed fraction, in order to calc the new base rate from a redemption.
	 * Corresponds to (1 / ALPHA) in the white paper.
	 */
	uint256 public constant BETA = 2;

	mapping(address => uint256) public baseRate;

	// The timestamp of the latest fee operation (redemption or new VST issuance)
	mapping(address => uint256) public lastFeeOperationTime;

	mapping(address => mapping(address => Trove)) public Troves;

	mapping(address => uint256) public totalStakes;

	// Snapshot of the value of totalStakes, taken immediately after the latest liquidation
	mapping(address => uint256) public totalStakesSnapshot;

	// Snapshot of the total collateral across the ActivePool and DefaultPool, immediately after the latest liquidation.
	mapping(address => uint256) public totalCollateralSnapshot;

	/*
	 * L_ETH and L_VSTDebt track the sums of accumulated liquidation rewards per unit staked. During its lifetime, each stake earns:
	 *
	 * An ETH gain of ( stake * [L_ETH - L_ETH(0)] )
	 * A VSTDebt increase  of ( stake * [L_VSTDebt - L_VSTDebt(0)] )
	 *
	 * Where L_ETH(0) and L_VSTDebt(0) are snapshots of L_ETH and L_VSTDebt for the active Trove taken at the instant the stake was made
	 */
	mapping(address => uint256) public L_ASSETS;
	mapping(address => uint256) public L_VSTDebts;

	// Map addresses with active troves to their RewardSnapshot
	mapping(address => mapping(address => RewardSnapshot)) public rewardSnapshots;

	// Object containing the ETH and VST snapshots for a given active trove
	struct RewardSnapshot {
		uint256 asset;
		uint256 VSTDebt;
	}

	// Array of all active trove addresses - used to to compute an approximate hint off-chain, for the sorted list insertion
	mapping(address => address[]) public TroveOwners;

	// Error trackers for the trove redistribution calculation
	mapping(address => uint256) public lastETHError_Redistribution;
	mapping(address => uint256) public lastVSTDebtError_Redistribution;

	bool public isInitialized;

	mapping(address => bool) public redemptionDisabled;
	bool public isRedemptionWhitelisted;

	string private constant NITRO_REVERT_MSG = "Safeguard: Nitro Upgrade";
	bool public nitroSafeguard;

	IRedemption public redemptor;

	IInterestManager public interestManager;

	bool private gasIndicatorFixed;

	//user => asset => uint256
	mapping(address => mapping(address => uint256)) private userUnpaidInterest;

	//asset => uint256;
	mapping(address => uint256) private unpaidInterest;

	ISavingModuleStabilityPool public savingModuleStabilityPool;

	modifier onlyBorrowerOperations() {
		require(
			msg.sender == borrowerOperationsAddress,
			"TroveManager: Caller is not the BorrowerOperations contract"
		);
		_;
	}

	modifier onlyBorrowerOrRedemption() {
		require(
			msg.sender == address(redemptor) || msg.sender == borrowerOperationsAddress,
			"TroveManager: Caller is not the BorrowerOperations or Redemptor contract"
		);
		_;
	}

	modifier onlyRedemption() {
		require(
			msg.sender == address(redemptor),
			"TroveManager: Caller is not the BorrowerOperations or Redemptor contract"
		);
		_;
	}

	modifier troveIsActive(address _asset, address _borrower) {
		require(
			isTroveActive(_asset, _borrower),
			"TroveManager: Trove does not exist or is closed"
		);
		_;
	}

	function getTroveOwnersCount(address _asset) external view override returns (uint256) {
		return TroveOwners[_asset].length;
	}

	function getTroveFromTroveOwnersArray(address _asset, uint256 _index)
		external
		view
		override
		returns (address)
	{
		return TroveOwners[_asset][_index];
	}

	function setInterestManager(address _interestManager) external onlyOwner {
		interestManager = IInterestManager(_interestManager);
	}

	function setSavingModuleStabilityPool(address _savingModuleStabilityPool)
		external
		onlyOwner
	{
		savingModuleStabilityPool = ISavingModuleStabilityPool(_savingModuleStabilityPool);
	}

	// --- Trove Liquidation functions ---

	// Single liquidation function. Closes the trove if its ICR is lower than the minimum collateral ratio.
	function liquidate(address _asset, address _borrower)
		external
		override
		troveIsActive(_asset, _borrower)
	{
		require(!nitroSafeguard, NITRO_REVERT_MSG);

		address[] memory borrowers = new address[](1);
		borrowers[0] = _borrower;
		batchLiquidateTroves(_asset, borrowers);
	}

	// --- Inner single liquidation functions ---

	// Liquidate one trove, in Normal Mode.
	function _liquidateNormalMode(
		address _asset,
		IActivePool _activePool,
		IDefaultPool _defaultPool,
		address _borrower,
		uint256 _VSTInStabPool,
		uint256 _ICR
	) internal returns (LiquidationValues memory singleLiquidation) {
		LocalVariables_InnerSingleLiquidateFunction memory vars;

		(
			singleLiquidation.entireTroveDebt,
			singleLiquidation.entireTroveColl,
			vars.pendingDebtReward,
			vars.pendingCollReward
		) = getEntireDebtAndColl(_asset, _borrower);

		_movePendingTroveRewardsToActivePool(
			_asset,
			_activePool,
			_defaultPool,
			vars.pendingDebtReward,
			vars.pendingCollReward
		);
		_removeStake(_asset, _borrower);

		singleLiquidation.collGasCompensation = _getCollGasCompensation(
			_asset,
			singleLiquidation.entireTroveColl
		);
		singleLiquidation.VSTGasCompensation = vestaParams.VST_GAS_COMPENSATION(_asset);
		uint256 collToLiquidate = singleLiquidation.entireTroveColl.sub(
			singleLiquidation.collGasCompensation
		);

		uint256 collPercToSP = 1e18 + vestaParams.BonusToSP(_asset);

		if (_ICR > collPercToSP) {
			uint256 collToBorrower = collToLiquidate.mul(_ICR - collPercToSP).div(_ICR);

			collSurplusPool.accountSurplus(_asset, _borrower, collToBorrower);
			singleLiquidation.collSurplus = collToBorrower;

			collToLiquidate = collToLiquidate.sub(collToBorrower);
		}

		(
			singleLiquidation.debtToOffset,
			singleLiquidation.collToSendToSP,
			singleLiquidation.debtToRedistribute,
			singleLiquidation.collToRedistribute
		) = _getOffsetAndRedistributionVals(
			singleLiquidation.entireTroveDebt,
			collToLiquidate,
			_VSTInStabPool
		);

		_closeTrove(_asset, _borrower, Status.closedByLiquidation);
		emit TroveLiquidated(
			_asset,
			_borrower,
			singleLiquidation.entireTroveDebt,
			singleLiquidation.entireTroveColl,
			TroveManagerOperation.liquidateInNormalMode
		);
		emit TroveUpdated(_asset, _borrower, 0, 0, 0, TroveManagerOperation.liquidateInNormalMode);
		return singleLiquidation;
	}

	/* In a full liquidation, returns the values for a trove's coll and debt to be offset, and coll and debt to be
	 * redistributed to active troves.
	 */
	function _getOffsetAndRedistributionVals(
		uint256 _debt,
		uint256 _coll,
		uint256 _VSTInStabPool
	)
		internal
		pure
		returns (
			uint256 debtToOffset,
			uint256 collToSendToSP,
			uint256 debtToRedistribute,
			uint256 collToRedistribute
		)
	{
		if (_VSTInStabPool > 0) {
			/*
			 * Offset as much debt & collateral as possible against the Stability Pool, and redistribute the remainder
			 * between all active troves.
			 *
			 *  If the trove's debt is larger than the deposited VST in the Stability Pool:
			 *
			 *  - Offset an amount of the trove's debt equal to the VST in the Stability Pool
			 *  - Send a fraction of the trove's collateral to the Stability Pool, equal to the fraction of its offset debt
			 *
			 */
			debtToOffset = VestaMath._min(_debt, _VSTInStabPool);
			collToSendToSP = _coll.mul(debtToOffset).div(_debt);
			debtToRedistribute = _debt.sub(debtToOffset);
			collToRedistribute = _coll.sub(collToSendToSP);
		} else {
			debtToOffset = 0;
			collToSendToSP = 0;
			debtToRedistribute = _debt;
			collToRedistribute = _coll;
		}
	}

	/*
	 *  Get its offset coll/debt and ETH gas comp, and close the trove.
	 */
	function _getCappedOffsetVals(
		address _asset,
		uint256 _entireTroveDebt,
		uint256 _entireTroveColl,
		uint256 _price
	) internal view returns (LiquidationValues memory singleLiquidation) {
		singleLiquidation.entireTroveDebt = _entireTroveDebt;
		singleLiquidation.entireTroveColl = _entireTroveColl;
		uint256 cappedCollPortion = _entireTroveDebt.mul(vestaParams.MCR(_asset)).div(_price);

		singleLiquidation.collGasCompensation = _getCollGasCompensation(_asset, cappedCollPortion);
		singleLiquidation.VSTGasCompensation = vestaParams.VST_GAS_COMPENSATION(_asset);

		singleLiquidation.debtToOffset = _entireTroveDebt;
		singleLiquidation.collToSendToSP = cappedCollPortion.sub(
			singleLiquidation.collGasCompensation
		);
		singleLiquidation.collSurplus = _entireTroveColl.sub(cappedCollPortion);
		singleLiquidation.debtToRedistribute = 0;
		singleLiquidation.collToRedistribute = 0;
	}

	/*
	 * Liquidate a sequence of troves. Closes a maximum number of n under-collateralized Troves,
	 * starting from the one with the lowest collateral ratio in the system, and moving upwards
	 */
	function liquidateTroves(address _asset, uint256 _n) external override {
		require(!nitroSafeguard, NITRO_REVERT_MSG);

		ContractsCache memory contractsCache = ContractsCache(
			vestaParams.activePool(),
			vestaParams.defaultPool(),
			IVSTToken(address(0)),
			IVSTAStaking(address(0)),
			sortedTroves,
			ICollSurplusPool(address(0)),
			address(0)
		);
		IStabilityPool stabilityPoolCached = stabilityPoolManager.getAssetStabilityPool(_asset);

		LocalVariables_OuterLiquidationFunction memory vars;

		LiquidationTotals memory totals;

		vars.price = vestaParams.priceFeed().fetchPrice(_asset);
		vars.VSTInStabPool = stabilityPoolCached.getTotalVSTDeposits();

		totals = _getTotalsFromLiquidateTrovesSequence_NormalMode(
			_asset,
			contractsCache.activePool,
			contractsCache.defaultPool,
			vars.price,
			vars.VSTInStabPool,
			_n
		);

		require(totals.totalDebtInSequence > 0, "TroveManager: nothing to liquidate");

		// Move liquidated ETH and VST to the appropriate pools
		stabilityPoolCached.offset(totals.totalDebtToOffset, totals.totalCollToSendToSP);
		_redistributeDebtAndColl(
			_asset,
			contractsCache.activePool,
			contractsCache.defaultPool,
			totals.totalDebtToRedistribute,
			totals.totalCollToRedistribute
		);
		if (totals.totalCollSurplus > 0) {
			contractsCache.activePool.sendAsset(
				_asset,
				address(collSurplusPool),
				totals.totalCollSurplus
			);
		}

		// Update system snapshots
		_updateSystemSnapshots_excludeCollRemainder(
			_asset,
			contractsCache.activePool,
			totals.totalCollGasCompensation
		);

		vars.liquidatedDebt = totals.totalDebtInSequence;
		vars.liquidatedColl = totals.totalCollInSequence.sub(totals.totalCollGasCompensation).sub(
			totals.totalCollSurplus
		);
		emit Liquidation(
			_asset,
			vars.liquidatedDebt,
			vars.liquidatedColl,
			totals.totalCollGasCompensation,
			totals.totalVSTGasCompensation
		);

		// Send gas compensation to caller
		_sendGasCompensation(
			_asset,
			contractsCache.activePool,
			msg.sender,
			totals.totalVSTGasCompensation,
			totals.totalCollGasCompensation
		);
	}

	function _getTotalsFromLiquidateTrovesSequence_NormalMode(
		address _asset,
		IActivePool _activePool,
		IDefaultPool _defaultPool,
		uint256 _price,
		uint256 _VSTInStabPool,
		uint256 _n
	) internal returns (LiquidationTotals memory totals) {
		LocalVariables_LiquidationSequence memory vars;
		LiquidationValues memory singleLiquidation;
		ISortedTroves sortedTrovesCached = sortedTroves;

		vars.remainingVSTInStabPool = _VSTInStabPool;

		for (vars.i = 0; vars.i < _n; vars.i++) {
			vars.user = sortedTrovesCached.getLast(_asset);
			vars.ICR = getCurrentICR(_asset, vars.user, _price);

			if (vars.ICR < vestaParams.MCR(_asset)) {
				singleLiquidation = _liquidateNormalMode(
					_asset,
					_activePool,
					_defaultPool,
					vars.user,
					vars.remainingVSTInStabPool,
					vars.ICR
				);

				vars.remainingVSTInStabPool = vars.remainingVSTInStabPool.sub(
					singleLiquidation.debtToOffset
				);

				// Add liquidation values to their respective running totals
				totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
			} else break; // break if the loop reaches a Trove with ICR >= MCR
		}
	}

	/*
	 * Attempt to liquidate a custom list of troves provided by the caller.
	 */
	function batchLiquidateTroves(address _asset, address[] memory _troveArray) public override {
		require(!nitroSafeguard, NITRO_REVERT_MSG);
		require(_troveArray.length != 0, "TroveManager: Calldata address array must not be empty");

		IActivePool activePoolCached = vestaParams.activePool();
		IDefaultPool defaultPoolCached = vestaParams.defaultPool();
		IStabilityPool stabilityPoolCached = stabilityPoolManager.getAssetStabilityPool(_asset);

		LocalVariables_OuterLiquidationFunction memory vars;
		LiquidationTotals memory totals;

		vars.VSTInStabPool = stabilityPoolCached.getTotalVSTDeposits();
		vars.price = vestaParams.priceFeed().fetchPrice(_asset);

		totals = _getTotalsFromBatchLiquidate_NormalMode(
			_asset,
			activePoolCached,
			defaultPoolCached,
			vars.price,
			vars.VSTInStabPool,
			_troveArray
		);

		require(totals.totalDebtInSequence > 0, "TroveManager: nothing to liquidate");

		// Move liquidated ETH and VST to the appropriate pools
		stabilityPoolCached.offset(totals.totalDebtToOffset, totals.totalCollToSendToSP);

		if (totals.totalDebtToRedistribute + totals.totalCollToRedistribute > 0) {
			(
				totals.totalDebtToOffset,
				totals.totalCollToSendToSP,
				totals.totalDebtToRedistribute,
				totals.totalCollToRedistribute
			) = _getOffsetAndRedistributionVals(
				totals.totalDebtToRedistribute,
				totals.totalCollToRedistribute,
				savingModuleStabilityPool.getTotalVSTDeposits()
			);

			savingModuleStabilityPool.offset(
				_asset,
				totals.totalDebtToOffset,
				totals.totalCollToSendToSP
			);
		}

		_redistributeDebtAndColl(
			_asset,
			activePoolCached,
			defaultPoolCached,
			totals.totalDebtToRedistribute,
			totals.totalCollToRedistribute
		);
		if (totals.totalCollSurplus > 0) {
			activePoolCached.sendAsset(_asset, address(collSurplusPool), totals.totalCollSurplus);
		}

		// Update system snapshots
		_updateSystemSnapshots_excludeCollRemainder(
			_asset,
			activePoolCached,
			totals.totalCollGasCompensation
		);

		vars.liquidatedDebt = totals.totalDebtInSequence;
		vars.liquidatedColl = totals.totalCollInSequence.sub(totals.totalCollGasCompensation).sub(
			totals.totalCollSurplus
		);
		emit Liquidation(
			_asset,
			vars.liquidatedDebt,
			vars.liquidatedColl,
			totals.totalCollGasCompensation,
			totals.totalVSTGasCompensation
		);

		// Send gas compensation to caller
		_sendGasCompensation(
			_asset,
			activePoolCached,
			msg.sender,
			totals.totalVSTGasCompensation,
			totals.totalCollGasCompensation
		);
	}

	function _getTotalsFromBatchLiquidate_NormalMode(
		address _asset,
		IActivePool _activePool,
		IDefaultPool _defaultPool,
		uint256 _price,
		uint256 _VSTInStabPool,
		address[] memory _troveArray
	) internal returns (LiquidationTotals memory totals) {
		LocalVariables_LiquidationSequence memory vars;
		LiquidationValues memory singleLiquidation;

		vars.remainingVSTInStabPool = _VSTInStabPool;

		for (vars.i = 0; vars.i < _troveArray.length; vars.i++) {
			vars.user = _troveArray[vars.i];
			vars.ICR = getCurrentICR(_asset, vars.user, _price);

			if (vars.ICR < vestaParams.MCR(_asset)) {
				singleLiquidation = _liquidateNormalMode(
					_asset,
					_activePool,
					_defaultPool,
					vars.user,
					vars.remainingVSTInStabPool,
					vars.ICR
				);
				vars.remainingVSTInStabPool = vars.remainingVSTInStabPool.sub(
					singleLiquidation.debtToOffset
				);

				// Add liquidation values to their respective running totals
				totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
			}
		}
	}

	// --- Liquidation helper functions ---

	function _addLiquidationValuesToTotals(
		LiquidationTotals memory oldTotals,
		LiquidationValues memory singleLiquidation
	) internal pure returns (LiquidationTotals memory newTotals) {
		// Tally all the values with their respective running totals
		newTotals.totalCollGasCompensation = oldTotals.totalCollGasCompensation.add(
			singleLiquidation.collGasCompensation
		);
		newTotals.totalVSTGasCompensation = oldTotals.totalVSTGasCompensation.add(
			singleLiquidation.VSTGasCompensation
		);
		newTotals.totalDebtInSequence = oldTotals.totalDebtInSequence.add(
			singleLiquidation.entireTroveDebt
		);
		newTotals.totalCollInSequence = oldTotals.totalCollInSequence.add(
			singleLiquidation.entireTroveColl
		);
		newTotals.totalDebtToOffset = oldTotals.totalDebtToOffset.add(
			singleLiquidation.debtToOffset
		);
		newTotals.totalCollToSendToSP = oldTotals.totalCollToSendToSP.add(
			singleLiquidation.collToSendToSP
		);
		newTotals.totalDebtToRedistribute = oldTotals.totalDebtToRedistribute.add(
			singleLiquidation.debtToRedistribute
		);
		newTotals.totalCollToRedistribute = oldTotals.totalCollToRedistribute.add(
			singleLiquidation.collToRedistribute
		);
		newTotals.totalCollSurplus = oldTotals.totalCollSurplus.add(singleLiquidation.collSurplus);

		return newTotals;
	}

	function _sendGasCompensation(
		address _asset,
		IActivePool _activePool,
		address _liquidator,
		uint256 _VST,
		uint256 _ETH
	) internal {
		// removed since arbitrum is cheap enough.
		// vstToken.burn(gasPoolAddress, _VST);
		// if (_VST > 0) {
		// 	vstToken.returnFromPool(gasPoolAddress, _liquidator, _VST);
		// }

		if (_ETH > 0) {
			_activePool.sendAsset(_asset, _liquidator, _ETH);
		}
	}

	// Move a Trove's pending debt and collateral rewards from distributions, from the Default Pool to the Active Pool
	function _movePendingTroveRewardsToActivePool(
		address _asset,
		IActivePool _activePool,
		IDefaultPool _defaultPool,
		uint256 _VST,
		uint256 _amount
	) internal {
		_defaultPool.decreaseVSTDebt(_asset, _VST);
		_activePool.increaseVSTDebt(_asset, _VST);
		_defaultPool.sendAssetToActivePool(_asset, _amount);
	}

	// --- Helper functions ---

	// Return the nominal collateral ratio (ICR) of a given Trove, without the price. Takes a trove's pending coll and debt rewards from redistributions into account.
	function getNominalICR(address _asset, address _borrower)
		public
		view
		override
		returns (uint256)
	{
		(uint256 currentAsset, uint256 currentVSTDebt) = _getCurrentTroveAmounts(
			_asset,
			_borrower
		);

		uint256 NICR = VestaMath._computeNominalCR(currentAsset, currentVSTDebt);
		return NICR;
	}

	// Return the current collateral ratio (ICR) of a given Trove. Takes a trove's pending coll and debt rewards from redistributions into account.
	function getCurrentICR(
		address _asset,
		address _borrower,
		uint256 _price
	) public view override returns (uint256) {
		(uint256 currentAsset, uint256 currentVSTDebt) = _getCurrentTroveAmounts(
			_asset,
			_borrower
		);

		uint256 ICR = VestaMath._computeCR(currentAsset, currentVSTDebt, _price);
		return ICR;
	}

	function _getCurrentTroveAmounts(address _asset, address _borrower)
		internal
		view
		returns (uint256, uint256)
	{
		Trove memory troveData = Troves[_borrower][_asset];
		uint256 pendingAssetReward = getPendingAssetReward(_asset, _borrower);
		uint256 pendingVSTDebtReward = getPendingVSTDebtReward(_asset, _borrower);

		(, uint256 interestRate) = interestManager.getUserDebt(_asset, _borrower);

		uint256 currentAsset = troveData.coll.add(pendingAssetReward);
		uint256 currentVSTDebt = troveData.debt.add(pendingVSTDebtReward) + interestRate;

		return (currentAsset, currentVSTDebt);
	}

	function applyPendingRewards(address _asset, address _borrower)
		external
		override
		onlyBorrowerOrRedemption
	{
		return
			_applyPendingRewards(
				_asset,
				vestaParams.activePool(),
				vestaParams.defaultPool(),
				_borrower
			);
	}

	// Add the borrowers's coll and debt rewards earned from redistributions, to their Trove
	function _applyPendingRewards(
		address _asset,
		IActivePool _activePool,
		IDefaultPool _defaultPool,
		address _borrower
	) internal {
		if (!hasPendingRewards(_asset, _borrower)) {
			return;
		}

		assert(isTroveActive(_asset, _borrower));

		Trove storage troveData = Troves[_borrower][_asset];

		// Compute pending rewards
		uint256 pendingAssetReward = getPendingAssetReward(_asset, _borrower);
		uint256 pendingVSTDebtReward = getPendingVSTDebtReward(_asset, _borrower);

		uint256 interest = interestManager.increaseDebt(_asset, _borrower, pendingVSTDebtReward);
		emit VaultUnpaidInterestUpdated(
			_asset,
			_borrower,
			userUnpaidInterest[_borrower][_asset] += interest
		);

		emit SystemUnpaidInterestUpdated(_asset, unpaidInterest[_asset] += interest);

		// Apply pending rewards to trove's state
		troveData.coll += pendingAssetReward;
		troveData.debt += pendingVSTDebtReward + interest;

		vestaParams.activePool().increaseVSTDebt(_asset, interest);

		_updateTroveRewardSnapshots(_asset, _borrower);

		// Transfer from DefaultPool to ActivePool
		_movePendingTroveRewardsToActivePool(
			_asset,
			_activePool,
			_defaultPool,
			pendingVSTDebtReward,
			pendingAssetReward
		);

		emit TroveUpdated(
			_asset,
			_borrower,
			troveData.debt,
			troveData.coll,
			troveData.stake,
			TroveManagerOperation.applyPendingRewards
		);
	}

	// Update borrower's snapshots of L_ETH and L_VSTDebt to reflect the current values
	function updateTroveRewardSnapshots(address _asset, address _borrower)
		external
		override
		onlyBorrowerOperations
	{
		return _updateTroveRewardSnapshots(_asset, _borrower);
	}

	function _updateTroveRewardSnapshots(address _asset, address _borrower) internal {
		rewardSnapshots[_borrower][_asset].asset = L_ASSETS[_asset];
		rewardSnapshots[_borrower][_asset].VSTDebt = L_VSTDebts[_asset];
		emit TroveSnapshotsUpdated(_asset, L_ASSETS[_asset], L_VSTDebts[_asset]);
	}

	// Get the borrower's pending accumulated ETH reward, earned by their stake
	function getPendingAssetReward(address _asset, address _borrower)
		public
		view
		override
		returns (uint256)
	{
		uint256 snapshotAsset = rewardSnapshots[_borrower][_asset].asset;
		uint256 rewardPerUnitStaked = L_ASSETS[_asset].sub(snapshotAsset);

		if (rewardPerUnitStaked == 0 || !isTroveActive(_asset, _borrower)) {
			return 0;
		}

		uint256 stake = Troves[_borrower][_asset].stake;

		uint256 pendingAssetReward = stake.mul(rewardPerUnitStaked).div(DECIMAL_PRECISION);

		return pendingAssetReward;
	}

	// Get the borrower's pending accumulated VST reward, earned by their stake
	function getPendingVSTDebtReward(address _asset, address _borrower)
		public
		view
		override
		returns (uint256)
	{
		uint256 snapshotVSTDebt = rewardSnapshots[_borrower][_asset].VSTDebt;
		uint256 rewardPerUnitStaked = L_VSTDebts[_asset].sub(snapshotVSTDebt);

		if (rewardPerUnitStaked == 0 || !isTroveActive(_asset, _borrower)) {
			return 0;
		}

		uint256 stake = Troves[_borrower][_asset].stake;

		uint256 pendingVSTDebtReward = stake.mul(rewardPerUnitStaked).div(DECIMAL_PRECISION);

		return pendingVSTDebtReward;
	}

	function hasPendingRewards(address _asset, address _borrower)
		public
		view
		override
		returns (bool)
	{
		if (!isTroveActive(_asset, _borrower)) {
			return false;
		}

		return (rewardSnapshots[_borrower][_asset].asset < L_ASSETS[_asset]);
	}

	function getEntireDebtAndColl(address _asset, address _borrower)
		public
		view
		override
		returns (
			uint256 debt,
			uint256 coll,
			uint256 pendingVSTDebtReward,
			uint256 pendingAssetReward
		)
	{
		Trove memory troveData = Troves[_borrower][_asset];

		pendingVSTDebtReward = getPendingVSTDebtReward(_asset, _borrower);
		pendingAssetReward = getPendingAssetReward(_asset, _borrower);

		(, uint256 interest) = interestManager.getUserDebt(_asset, _borrower);

		debt = troveData.debt + pendingVSTDebtReward + interest;
		coll = troveData.coll + pendingAssetReward;
	}

	function removeStake(address _asset, address _borrower)
		external
		override
		onlyBorrowerOperations
	{
		return _removeStake(_asset, _borrower);
	}

	function _removeStake(address _asset, address _borrower) internal {
		uint256 stake = Troves[_borrower][_asset].stake;
		totalStakes[_asset] = totalStakes[_asset].sub(stake);
		Troves[_borrower][_asset].stake = 0;
	}

	function updateStakeAndTotalStakes(address _asset, address _borrower)
		external
		override
		onlyBorrowerOperations
		returns (uint256)
	{
		return _updateStakeAndTotalStakes(_asset, _borrower);
	}

	// Update borrower's stake based on their latest collateral value
	function _updateStakeAndTotalStakes(address _asset, address _borrower)
		internal
		returns (uint256)
	{
		uint256 newStake = _computeNewStake(_asset, Troves[_borrower][_asset].coll);
		uint256 oldStake = Troves[_borrower][_asset].stake;
		Troves[_borrower][_asset].stake = newStake;

		totalStakes[_asset] = totalStakes[_asset].sub(oldStake).add(newStake);
		emit TotalStakesUpdated(_asset, totalStakes[_asset]);

		return newStake;
	}

	// Calculate a new stake based on the snapshots of the totalStakes and totalCollateral taken at the last liquidation
	function _computeNewStake(address _asset, uint256 _coll) internal view returns (uint256) {
		uint256 stake;
		if (totalCollateralSnapshot[_asset] == 0) {
			stake = _coll;
		} else {
			/*
			 * The following assert() holds true because:
			 * - The system always contains >= 1 trove
			 * - When we close or liquidate a trove, we redistribute the pending rewards, so if all troves were closed/liquidated,
			 * rewards would’ve been emptied and totalCollateralSnapshot would be zero too.
			 */
			assert(totalStakesSnapshot[_asset] > 0);
			stake = _coll.mul(totalStakesSnapshot[_asset]).div(totalCollateralSnapshot[_asset]);
		}
		return stake;
	}

	function _redistributeDebtAndColl(
		address _asset,
		IActivePool _activePool,
		IDefaultPool _defaultPool,
		uint256 _debt,
		uint256 _coll
	) internal {
		if (_debt == 0) {
			return;
		}

		/*
		 * Add distributed coll and debt rewards-per-unit-staked to the running totals. Division uses a "feedback"
		 * error correction, to keep the cumulative error low in the running totals L_ETH and L_VSTDebt:
		 *
		 * 1) Form numerators which compensate for the floor division errors that occurred the last time this
		 * function was called.
		 * 2) Calculate "per-unit-staked" ratios.
		 * 3) Multiply each ratio back by its denominator, to reveal the current floor division error.
		 * 4) Store these errors for use in the next correction when this function is called.
		 * 5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
		 */
		uint256 ETHNumerator = _coll.mul(DECIMAL_PRECISION).add(
			lastETHError_Redistribution[_asset]
		);
		uint256 VSTDebtNumerator = _debt.mul(DECIMAL_PRECISION).add(
			lastVSTDebtError_Redistribution[_asset]
		);

		// Get the per-unit-staked terms
		uint256 ETHRewardPerUnitStaked = ETHNumerator.div(totalStakes[_asset]);
		uint256 VSTDebtRewardPerUnitStaked = VSTDebtNumerator.div(totalStakes[_asset]);

		lastETHError_Redistribution[_asset] = ETHNumerator.sub(
			ETHRewardPerUnitStaked.mul(totalStakes[_asset])
		);
		lastVSTDebtError_Redistribution[_asset] = VSTDebtNumerator.sub(
			VSTDebtRewardPerUnitStaked.mul(totalStakes[_asset])
		);

		// Add per-unit-staked terms to the running totals
		L_ASSETS[_asset] = L_ASSETS[_asset].add(ETHRewardPerUnitStaked);
		L_VSTDebts[_asset] = L_VSTDebts[_asset].add(VSTDebtRewardPerUnitStaked);

		emit LTermsUpdated(_asset, L_ASSETS[_asset], L_VSTDebts[_asset]);

		_activePool.decreaseVSTDebt(_asset, _debt);
		_defaultPool.increaseVSTDebt(_asset, _debt);
		_activePool.sendAsset(_asset, address(_defaultPool), _coll);
	}

	function closeTrove(address _asset, address _borrower)
		external
		override
		onlyBorrowerOperations
	{
		return _closeTrove(_asset, _borrower, Status.closedByOwner);
	}

	function _closeTrove(
		address _asset,
		address _borrower,
		Status closedStatus
	) internal {
		assert(closedStatus != Status.nonExistent && closedStatus != Status.active);

		uint256 TroveOwnersArrayLength = TroveOwners[_asset].length;

		interestManager.exit(_asset, _borrower);

		uint256 totalInterest = userUnpaidInterest[_borrower][_asset];

		emit VaultUnpaidInterestUpdated(_asset, _borrower, 0);
		emit SystemUnpaidInterestUpdated(_asset, unpaidInterest[_asset] -= totalInterest);

		delete userUnpaidInterest[_borrower][_asset];

		vestaParams.activePool().unstake(_asset, _borrower, Troves[_borrower][_asset].coll);

		Troves[_borrower][_asset].status = closedStatus;
		Troves[_borrower][_asset].coll = 0;
		Troves[_borrower][_asset].debt = 0;

		rewardSnapshots[_borrower][_asset].asset = 0;
		rewardSnapshots[_borrower][_asset].VSTDebt = 0;

		_removeTroveOwner(_asset, _borrower, TroveOwnersArrayLength);
		sortedTroves.remove(_asset, _borrower);
	}

	function _updateSystemSnapshots_excludeCollRemainder(
		address _asset,
		IActivePool _activePool,
		uint256 _collRemainder
	) internal {
		totalStakesSnapshot[_asset] = totalStakes[_asset];

		uint256 activeColl = _activePool.getAssetBalance(_asset);
		uint256 liquidatedColl = vestaParams.defaultPool().getAssetBalance(_asset);
		totalCollateralSnapshot[_asset] = activeColl.sub(_collRemainder).add(liquidatedColl);

		emit SystemSnapshotsUpdated(
			_asset,
			totalStakesSnapshot[_asset],
			totalCollateralSnapshot[_asset]
		);
	}

	function addTroveOwnerToArray(address _asset, address _borrower)
		external
		override
		onlyBorrowerOperations
		returns (uint256 index)
	{
		return _addTroveOwnerToArray(_asset, _borrower);
	}

	function _addTroveOwnerToArray(address _asset, address _borrower)
		internal
		returns (uint128 index)
	{
		TroveOwners[_asset].push(_borrower);

		index = uint128(TroveOwners[_asset].length.sub(1));
		Troves[_borrower][_asset].arrayIndex = index;

		return index;
	}

	function _removeTroveOwner(
		address _asset,
		address _borrower,
		uint256 TroveOwnersArrayLength
	) internal {
		Status troveStatus = Troves[_borrower][_asset].status;
		assert(troveStatus != Status.nonExistent && troveStatus != Status.active);

		uint128 index = Troves[_borrower][_asset].arrayIndex;
		uint256 length = TroveOwnersArrayLength;
		uint256 idxLast = length.sub(1);

		assert(index <= idxLast);

		address addressToMove = TroveOwners[_asset][idxLast];

		TroveOwners[_asset][index] = addressToMove;
		Troves[addressToMove][_asset].arrayIndex = index;
		emit TroveIndexUpdated(_asset, addressToMove, index);

		TroveOwners[_asset].pop();
	}

	function getTCR(address _asset, uint256 _price) external view override returns (uint256) {
		return _getTCR(_asset, _price);
	}

	function checkRecoveryMode(address, uint256) external pure override returns (bool) {
		return false;
	}

	function updateBaseRateFromRedemption(
		address _asset,
		uint256 _ETHDrawn,
		uint256 _price,
		uint256 _totalVSTSupply
	) external onlyRedemption returns (uint256) {
		uint256 decayedBaseRate = _calcDecayedBaseRate(_asset);

		uint256 redeemedVSTFraction = _ETHDrawn.mul(_price).div(_totalVSTSupply);

		uint256 newBaseRate = decayedBaseRate.add(redeemedVSTFraction.div(BETA));
		newBaseRate = VestaMath._min(newBaseRate, DECIMAL_PRECISION);
		assert(newBaseRate > 0);

		baseRate[_asset] = newBaseRate;
		emit BaseRateUpdated(_asset, newBaseRate);

		_updateLastFeeOpTime(_asset);

		return newBaseRate;
	}

	function getRedemptionRate(address _asset) public view override returns (uint256) {
		return _calcRedemptionRate(_asset, baseRate[_asset]);
	}

	function getRedemptionRateWithDecay(address _asset) public view override returns (uint256) {
		return _calcRedemptionRate(_asset, _calcDecayedBaseRate(_asset));
	}

	function _calcRedemptionRate(address _asset, uint256 _baseRate)
		internal
		view
		returns (uint256)
	{
		return
			VestaMath._min(
				vestaParams.REDEMPTION_FEE_FLOOR(_asset).add(_baseRate),
				vestaParams.REDEMPTION_MAX_FEE(_asset)
			);
	}

	function getRedemptionFee(address _asset, uint256 _assetDraw)
		external
		view
		returns (uint256)
	{
		return _calcRedemptionFee(getRedemptionRate(_asset), _assetDraw);
	}

	function getRedemptionFeeWithDecay(address _asset, uint256 _assetDraw)
		external
		view
		override
		returns (uint256)
	{
		return _calcRedemptionFee(getRedemptionRateWithDecay(_asset), _assetDraw);
	}

	function _calcRedemptionFee(uint256 _redemptionRate, uint256 _assetDraw)
		internal
		pure
		returns (uint256)
	{
		uint256 redemptionFee = _redemptionRate.mul(_assetDraw).div(DECIMAL_PRECISION);
		require(
			redemptionFee < _assetDraw,
			"TroveManager: Fee would eat up all returned collateral"
		);
		return redemptionFee;
	}

	function getBorrowingRate(address _asset) public view override returns (uint256) {
		return _calcBorrowingRate(_asset, baseRate[_asset]);
	}

	function getBorrowingRateWithDecay(address _asset) public view override returns (uint256) {
		return _calcBorrowingRate(_asset, _calcDecayedBaseRate(_asset));
	}

	function _calcBorrowingRate(address _asset, uint256 _baseRate)
		internal
		view
		returns (uint256)
	{
		return
			VestaMath._min(
				vestaParams.BORROWING_FEE_FLOOR(_asset).add(_baseRate),
				vestaParams.MAX_BORROWING_FEE(_asset)
			);
	}

	function getBorrowingFee(address _asset, uint256 _VSTDebt)
		external
		view
		override
		returns (uint256)
	{
		return _calcBorrowingFee(getBorrowingRate(_asset), _VSTDebt);
	}

	function getBorrowingFeeWithDecay(address _asset, uint256 _VSTDebt)
		external
		view
		override
		returns (uint256)
	{
		return _calcBorrowingFee(getBorrowingRateWithDecay(_asset), _VSTDebt);
	}

	function _calcBorrowingFee(uint256 _borrowingRate, uint256 _VSTDebt)
		internal
		pure
		returns (uint256)
	{
		return _borrowingRate.mul(_VSTDebt).div(DECIMAL_PRECISION);
	}

	function decayBaseRateFromBorrowing(address _asset)
		external
		override
		onlyBorrowerOperations
	{
		uint256 decayedBaseRate = _calcDecayedBaseRate(_asset);
		assert(decayedBaseRate <= DECIMAL_PRECISION);

		baseRate[_asset] = decayedBaseRate;
		emit BaseRateUpdated(_asset, decayedBaseRate);

		_updateLastFeeOpTime(_asset);
	}

	// Update the last fee operation time only if time passed >= decay interval. This prevents base rate griefing.
	function _updateLastFeeOpTime(address _asset) internal {
		uint256 timePassed = block.timestamp.sub(lastFeeOperationTime[_asset]);

		if (timePassed >= SECONDS_IN_ONE_MINUTE) {
			lastFeeOperationTime[_asset] = block.timestamp;
			emit LastFeeOpTimeUpdated(_asset, block.timestamp);
		}
	}

	function _calcDecayedBaseRate(address _asset) internal view returns (uint256) {
		uint256 minutesPassed = _minutesPassedSinceLastFeeOp(_asset);
		uint256 decayFactor = VestaMath._decPow(MINUTE_DECAY_FACTOR, minutesPassed);

		return baseRate[_asset].mul(decayFactor).div(DECIMAL_PRECISION);
	}

	function _minutesPassedSinceLastFeeOp(address _asset) internal view returns (uint256) {
		return (block.timestamp.sub(lastFeeOperationTime[_asset])).div(SECONDS_IN_ONE_MINUTE);
	}

	function isTroveActive(address _asset, address _borrower) internal view returns (bool) {
		return this.getTroveStatus(_asset, _borrower) == uint256(Status.active);
	}

	// --- Trove property getters ---

	function getTroveStatus(address _asset, address _borrower)
		external
		view
		override
		returns (uint256)
	{
		return uint256(Troves[_borrower][_asset].status);
	}

	function getTroveStake(address _asset, address _borrower)
		external
		view
		override
		returns (uint256)
	{
		return Troves[_borrower][_asset].stake;
	}

	function getTroveDebt(address _asset, address _borrower)
		external
		view
		override
		returns (uint256)
	{
		(, uint256 interest) = interestManager.getUserDebt(_asset, _borrower);

		return Troves[_borrower][_asset].debt + interest;
	}

	function getTroveColl(address _asset, address _borrower)
		external
		view
		override
		returns (uint256)
	{
		return Troves[_borrower][_asset].coll;
	}

	// --- Trove property setters, called by BorrowerOperations ---

	function setTroveStatus(
		address _asset,
		address _borrower,
		uint256 _num
	) external override onlyBorrowerOperations {
		Troves[_borrower][_asset].asset = _asset;
		Troves[_borrower][_asset].status = Status(_num);
	}

	function increaseTroveColl(
		address _asset,
		address _borrower,
		uint256 _collIncrease
	) external override onlyBorrowerOperations returns (uint256) {
		uint256 newColl = Troves[_borrower][_asset].coll.add(_collIncrease);
		Troves[_borrower][_asset].coll = newColl;
		return newColl;
	}

	function decreaseTroveColl(
		address _asset,
		address _borrower,
		uint256 _collDecrease
	) external override onlyBorrowerOperations returns (uint256) {
		uint256 newColl = Troves[_borrower][_asset].coll.sub(_collDecrease);
		Troves[_borrower][_asset].coll = newColl;
		return newColl;
	}

	function increaseTroveDebt(
		address _asset,
		address _borrower,
		uint256 _debtIncrease
	) external override onlyBorrowerOperations returns (uint256) {
		require(!nitroSafeguard, NITRO_REVERT_MSG);

		uint256 interest = interestManager.increaseDebt(_asset, _borrower, _debtIncrease);
		vestaParams.activePool().increaseVSTDebt(_asset, interest);

		emit VaultUnpaidInterestUpdated(
			_asset,
			_borrower,
			userUnpaidInterest[_borrower][_asset] += interest
		);

		emit SystemUnpaidInterestUpdated(_asset, unpaidInterest[_asset] += interest);

		return Troves[_borrower][_asset].debt += _debtIncrease + interest;
	}

	function decreaseTroveDebt(
		address _asset,
		address _borrower,
		uint256 _debtDecrease
	) external override onlyBorrowerOperations returns (uint256) {
		Trove storage troveData = Troves[_borrower][_asset];

		uint256 interest = interestManager.decreaseDebt(_asset, _borrower, _debtDecrease);
		vestaParams.activePool().increaseVSTDebt(_asset, interest);

		uint256 totalInterest = userUnpaidInterest[_borrower][_asset] += interest;
		unpaidInterest[_asset] += interest;

		uint256 newUnpaidUser;
		uint256 newUnpaidSystem;

		if (totalInterest > _debtDecrease) {
			newUnpaidUser = userUnpaidInterest[_borrower][_asset] -= _debtDecrease;
			newUnpaidSystem = unpaidInterest[_asset] -= _debtDecrease;
		} else {
			newUnpaidUser = userUnpaidInterest[_borrower][_asset] -= totalInterest;
			newUnpaidSystem = unpaidInterest[_asset] -= totalInterest;
		}

		emit VaultUnpaidInterestUpdated(_asset, _borrower, newUnpaidUser);
		emit SystemUnpaidInterestUpdated(_asset, newUnpaidSystem);

		troveData.debt += interest;
		troveData.debt -= _debtDecrease;
		return troveData.debt;
	}

	//We use our Aribtrum Nitro Migration Flag
	//Since it will do exactly what the lock system would be doing
	function setLockSystem(bool _enabled) external onlyOwner {
		nitroSafeguard = _enabled;
	}

	function getSystemTotalUnpaidInterest(address _asset)
		external
		view
		override
		returns (uint256)
	{
		return unpaidInterest[_asset];
	}

	function getUnpaidInterestOfUser(address _asset, address _user)
		external
		view
		override
		returns (uint256)
	{
		return userUnpaidInterest[_user][_asset];
	}
}

