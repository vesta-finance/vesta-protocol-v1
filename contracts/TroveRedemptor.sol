// // SPDX-License-Identifier: MIT

// pragma solidity ^0.8.10;

// import "./Interfaces/IVSTToken.sol";
// import "./Dependencies/VestaBase.sol";
// import "./TroveManager.sol";
// import "./TroveManagerModel.sol";
// import "./Interfaces/ISortedTroves.sol";
// import "./Interfaces/IRedemption.sol";

// contract TroveRedemptor is VestaBase, IRedemption {
// 	using SafeMathUpgradeable for uint256;

// 	TroveManager private troveManager;
// 	ISortedTroves private sortedTroves;
// 	IVSTToken private vstToken;

// 	modifier onlyTroveManager() {
// 		require(msg.sender == address(troveManager), "Only trove manager");
// 		_;
// 	}

// 	function setUp(
// 		address _troveManager,
// 		address _sortedTroves,
// 		address _vstToken,
// 		address _vestaParameters
// 	) external initializer {
// 		troveManager = TroveManager(_troveManager);
// 		vestaParams = IVestaParameters(_vestaParameters);
// 		vstToken = IVSTToken(_vstToken);
// 		sortedTroves = ISortedTroves(_sortedTroves);
// 	}

// 	function redeemCollateral(
// 		address _asset,
// 		address _caller,
// 		uint256 _VSTamount,
// 		address _firstRedemptionHint,
// 		address _upperPartialRedemptionHint,
// 		address _lowerPartialRedemptionHint,
// 		uint256 _partialRedemptionHintNICR,
// 		uint256 _maxIterations,
// 		uint256 _maxFeePercentage
// 	) external override onlyTroveManager {
// 		RedemptionTotals memory totals;
// 		require(
// 			_maxFeePercentage >= vestaParams.REDEMPTION_FEE_FLOOR(_asset) &&
// 				_maxFeePercentage <= DECIMAL_PRECISION,
// 			"Max fee percentage must be between minimum and 100%"
// 		);

// 		totals.price = vestaParams.priceFeed().fetchPrice(_asset);
// 		require(
// 			_getTCR(_asset, totals.price) >= vestaParams.MCR(_asset),
// 			"TroveManager: Cannot redeem when TCR < MCR"
// 		);

// 		require(_VSTamount > 0, "TroveManager: Amount must be greater than zero");
// 		_requireVSTBalanceCoversRedemption(_caller, _VSTamount);

// 		totals.totalVSTSupplyAtStart = getEntireSystemDebt(_asset);
// 		totals.remainingVST = _VSTamount;
// 		address currentBorrower;

// 		if (troveManager.isValidFirstRedemptionHint(_asset, _firstRedemptionHint, totals.price)) {
// 			currentBorrower = _firstRedemptionHint;
// 		} else {
// 			currentBorrower = sortedTroves.getLast(_asset);
// 			// Find the first trove with ICR >= MCR
// 			while (
// 				currentBorrower != address(0) &&
// 				troveManager.getCurrentICR(_asset, currentBorrower, totals.price) <
// 				vestaParams.MCR(_asset)
// 			) {
// 				currentBorrower = sortedTroves.getPrev(_asset, currentBorrower);
// 			}
// 		}

// 		// Loop through the Troves starting from the one with lowest collateral ratio until _amount of VST is exchanged for collateral
// 		if (_maxIterations == 0) {
// 			_maxIterations = type(uint256).max;
// 		}
// 		while (currentBorrower != address(0) && totals.remainingVST > 0 && _maxIterations > 0) {
// 			_maxIterations--;
// 			// Save the address of the Trove preceding the current one, before potentially modifying the list
// 			address nextUserToCheck = sortedTroves.getPrev(_asset, currentBorrower);

// 			troveManager.applyPendingRewards(_asset, currentBorrower);

// 			SingleRedemptionValues memory singleRedemption = _redeemCollateralFromTrove(
// 				_asset,
// 				currentBorrower,
// 				totals.remainingVST,
// 				totals.price,
// 				_upperPartialRedemptionHint,
// 				_lowerPartialRedemptionHint,
// 				_partialRedemptionHintNICR
// 			);

// 			if (singleRedemption.cancelledPartial) break; // Partial redemption was cancelled (out-of-date hint, or new net debt < minimum), therefore we could not redeem from the last Trove

// 			totals.totalVSTToRedeem = totals.totalVSTToRedeem.add(singleRedemption.VSTLot);
// 			totals.totalAssetDrawn = totals.totalAssetDrawn.add(singleRedemption.ETHLot);

// 			totals.remainingVST = totals.remainingVST.sub(singleRedemption.VSTLot);
// 			currentBorrower = nextUserToCheck;
// 		}
// 		require(totals.totalAssetDrawn > 0, "TroveManager: Unable to redeem any amount");

// 		// Decay the baseRate due to time passed, and then increase it according to the size of this redemption.
// 		// Use the saved total VST supply value, from before it was reduced by the redemption.
// 		troveManager.updateBaseRateFromRedemption(
// 			_asset,
// 			totals.totalAssetDrawn,
// 			totals.price,
// 			totals.totalVSTSupplyAtStart
// 		);

// 		// Calculate the ETH fee
// 		totals.ETHFee = troveManager.getRedemptionFee(_asset, totals.totalAssetDrawn);

// 		_requireUserAcceptsFee(totals.ETHFee, totals.totalAssetDrawn, _maxFeePercentage);

// 		troveManager.finalizeRedemption(
// 			_asset,
// 			_caller,
// 			_VSTamount,
// 			totals.totalVSTToRedeem,
// 			totals.ETHFee,
// 			totals.totalAssetDrawn
// 		);
// 	}

// 	// Redeem as much collateral as possible from _borrower's Trove in exchange for VST up to _maxVSTamount
// 	function _redeemCollateralFromTrove(
// 		address _asset,
// 		address _borrower,
// 		uint256 _maxVSTamount,
// 		uint256 _price,
// 		address _upperPartialRedemptionHint,
// 		address _lowerPartialRedemptionHint,
// 		uint256 _partialRedemptionHintNICR
// 	) internal returns (SingleRedemptionValues memory singleRedemption) {
// 		LocalVariables_AssetBorrowerPrice memory vars = LocalVariables_AssetBorrowerPrice(
// 			_asset,
// 			_borrower,
// 			_price,
// 			_upperPartialRedemptionHint,
// 			_lowerPartialRedemptionHint
// 		);

// 		uint256 vaultDebt = troveManager.getTroveDebt(vars._asset, vars._borrower);
// 		uint256 vaultColl = troveManager.getTroveColl(vars._asset, vars._borrower);

// 		// Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the Trove minus the liquidation reserve
// 		singleRedemption.VSTLot = VestaMath._min(
// 			_maxVSTamount,
// 			vaultDebt.sub(vestaParams.VST_GAS_COMPENSATION(_asset))
// 		);

// 		// Get the ETHLot of equivalent value in USD
// 		singleRedemption.ETHLot = singleRedemption.VSTLot.mul(DECIMAL_PRECISION).div(_price);

// 		// Decrease the debt and collateral of the current Trove according to the VST lot and corresponding ETH to send

// 		uint256 newDebt = (vaultDebt).sub(singleRedemption.VSTLot);
// 		uint256 newColl = (vaultColl).sub(singleRedemption.ETHLot);

// 		if (newDebt == vestaParams.VST_GAS_COMPENSATION(_asset)) {
// 			troveManager.executeFullRedemption(vars._asset, vars._borrower, newColl);
// 		} else {
// 			uint256 newNICR = VestaMath._computeNominalCR(newColl, newDebt);

// 			/*
// 			 * If the provided hint is out of date, we bail since trying to reinsert without a good hint will almost
// 			 * certainly result in running out of gas.
// 			 *
// 			 * If the resultant net debt of the partial is less than the minimum, net debt we bail.
// 			 */
// 			if (
// 				newNICR != _partialRedemptionHintNICR ||
// 				_getNetDebt(vars._asset, newDebt) < vestaParams.MIN_NET_DEBT(vars._asset)
// 			) {
// 				singleRedemption.cancelledPartial = true;
// 				return singleRedemption;
// 			}

// 			troveManager.executePartialRedemption(
// 				vars._asset,
// 				vars._borrower,
// 				singleRedemption.ETHLot,
// 				newDebt,
// 				newColl,
// 				newNICR,
// 				vars._upper,
// 				vars._lower
// 			);
// 		}

// 		return singleRedemption;
// 	}

// 	function _requireVSTBalanceCoversRedemption(address _redeemer, uint256 _amount)
// 		internal
// 		view
// 	{
// 		require(
// 			vstToken.balanceOf(_redeemer) >= _amount,
// 			"TroveManager: Requested redemption amount must be <= user's VST token balance"
// 		);
// 	}
// }
