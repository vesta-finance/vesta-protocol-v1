// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./Interfaces/IVSTToken.sol";
import "./TroveManager.sol";
import "./TroveManagerModel.sol";
import "./Interfaces/ISortedTroves.sol";
import "./Interfaces/IRedemption.sol";
import "./Interfaces/IPriceFeedV2.sol";

contract TroveRedemptorV2 is IRedemption {
	using SafeMathUpgradeable for uint256;

	uint256 public constant BPS = 10_000;
	uint256 public constant SNAPSHOT_UNIX_TIME = 1696981940;

	uint256[] public PENALITY_FEES = [200, 500, 1000];
	uint256[] public PENALITY_TIME;

	uint256 public ACTIVATE_SYSTEM;

	TroveManager public constant troveManager =
		TroveManager(0x100EC08129e0FD59959df93a8b914944A3BbD5df);
	ISortedTroves public constant sortedTroves =
		ISortedTroves(0x62842ceDFe0F7D203FC4cFD086a6649412d904B5);
	IVSTToken public constant vstToken = IVSTToken(0x64343594Ab9b56e99087BfA6F2335Db24c2d1F17);
	IPriceFeedV2 public constant priceFeed =
		IPriceFeedV2(0xd218Ba424A6166e37A454F8eCe2bf8eB2264eCcA);
	IVestaParameters public constant params =
		IVestaParameters(0x5F51B0A5E940A3a20502B5F59511B13788Ec6DDB);

	modifier onlyTroveManager() {
		require(msg.sender == address(troveManager), "Only trove manager");
		_;
	}

	constructor() {
		PENALITY_TIME.push(SNAPSHOT_UNIX_TIME + 15778800); // 6 months from now
		PENALITY_TIME.push(SNAPSHOT_UNIX_TIME + 21038400); // 8 months from now
		PENALITY_TIME.push(SNAPSHOT_UNIX_TIME + 28927800); // 11 months from now
		ACTIVATE_SYSTEM = PENALITY_TIME[0];

		require(PENALITY_TIME.length == PENALITY_FEES.length, "TIME != FEES length");
	}

	function redeemCollateral(
		address _asset,
		address _caller,
		uint256 _VSTamount,
		uint256 _maxIterations
	) external override onlyTroveManager {
		require(block.timestamp >= ACTIVATE_SYSTEM, "Redemption is not active yet");
		require(_VSTamount > 0, "Redemption: Amount must be greater than zero");
		_requireVSTBalanceCoversRedemption(_caller, _VSTamount);

		RedemptionTotals memory totals;
		totals.price = priceFeed.fetchPrice(_asset);
		totals.penaltyFee = _getPenaltyFee();

		totals.remainingVST = _VSTamount;
		address currentBorrower = sortedTroves.getLast(_asset);
		address nextUserToCheck;

		// Loop through the Troves starting from the one with lowest collateral ratio until _amount of VST is exchanged for collateral
		if (_maxIterations == 0) {
			_maxIterations = type(uint256).max;
		}
		while (currentBorrower != address(0) && totals.remainingVST > 0 && _maxIterations > 0) {
			_maxIterations--;
			// Save the address of the Trove preceding the current one, before potentially modifying the list
			nextUserToCheck = sortedTroves.getPrev(_asset, currentBorrower);

			troveManager.applyPendingRewards(_asset, currentBorrower);

			SingleRedemptionValues memory singleRedemption = _redeemCollateralFromTrove(
				_asset,
				currentBorrower,
				totals.remainingVST,
				totals.penaltyFee,
				totals.price
			);

			if (singleRedemption.cancelledPartial) break; // Partial redemption was cancelled (out-of-date hint, or new net debt < minimum), therefore we could not redeem from the last Trove

			totals.totalVSTToRedeem = totals.totalVSTToRedeem.add(singleRedemption.VSTLot);
			totals.totalAssetDrawn = totals.totalAssetDrawn.add(singleRedemption.ETHLot);

			totals.remainingVST = totals.remainingVST.sub(singleRedemption.VSTLot);
			currentBorrower = nextUserToCheck;
		}
		require(totals.totalAssetDrawn > 0, "TroveManager: Unable to redeem any amount");

		troveManager.finalizeRedemption(
			_asset,
			_caller,
			_VSTamount,
			totals.totalVSTToRedeem,
			totals.penaltyFee,
			totals.totalAssetDrawn
		);
	}

	// Redeem as much collateral as possible from _borrower's Trove in exchange for VST up to _maxVSTamount
	function _redeemCollateralFromTrove(
		address _asset,
		address _borrower,
		uint256 _maxVSTamount,
		uint256 _penaltyFee,
		uint256 _price
	) internal returns (SingleRedemptionValues memory singleRedemption) {
		LocalVariables_AssetBorrowerPrice memory vars = LocalVariables_AssetBorrowerPrice(
			_asset,
			_borrower,
			_price
		);

		uint256 vaultDebt = troveManager.getTroveDebt(vars._asset, vars._borrower);
		uint256 vaultColl = troveManager.getTroveColl(vars._asset, vars._borrower);

		// Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the Trove minus the liquidation reserve
		singleRedemption.VSTLot = VestaMath._min(_maxVSTamount, vaultDebt);

		// Get the ETHLot of equivalent value in USD
		singleRedemption.ETHLot = singleRedemption.VSTLot.mul(1e18).div(_price);

		// Decrease the debt and collateral of the current Trove according to the VST lot and corresponding ETH to send

		uint256 newDebt = (vaultDebt).sub(singleRedemption.VSTLot);
		uint256 newColl = (vaultColl).sub(singleRedemption.ETHLot);

		if (newDebt == 0) {
			uint256 penalty = newColl.mul(_penaltyFee).div(BPS);
			newColl -= penalty;
			singleRedemption.ETHLot += penalty;

			troveManager.executeFullRedemption(vars._asset, vars._borrower, newColl);
		} else {
			if (newDebt < params.MIN_NET_DEBT(vars._asset)) {
				singleRedemption.cancelledPartial = true;
				return singleRedemption;
			}

			troveManager.executePartialRedemption(
				vars._asset,
				vars._borrower,
				singleRedemption.ETHLot,
				newDebt,
				newColl,
				VestaMath._computeNominalCR(newColl, newDebt)
			);
		}

		return singleRedemption;
	}

	function _requireVSTBalanceCoversRedemption(address _redeemer, uint256 _amount)
		internal
		view
	{
		require(
			vstToken.balanceOf(_redeemer) >= _amount,
			"TroveManager: Requested redemption amount must be <= user's VST token balance"
		);
	}

	function _getPenaltyFee() private view returns (uint256) {
		if (PENALITY_TIME[2] <= block.timestamp) return PENALITY_FEES[2];
		if (PENALITY_TIME[1] <= block.timestamp) return PENALITY_FEES[1];
		return PENALITY_FEES[0];
	}

	function getRedeemReturns(
		address _asset,
		uint256 _VSTamount,
		uint256 _penaltyFee
	) external view returns (uint256 netReturn_, uint256 feeBonus_) {
		uint256 _maxIterations = type(uint256).max;
		RedemptionTotals memory totals;
		totals.price = priceFeed.getExternalPrice(_asset);
		totals.penaltyFee = _penaltyFee;

		totals.remainingVST = _VSTamount;
		address currentBorrower = sortedTroves.getLast(_asset);
		address nextUserToCheck;

		while (currentBorrower != address(0) && totals.remainingVST > 0 && _maxIterations > 0) {
			_maxIterations--;
			// Save the address of the Trove preceding the current one, before potentially modifying the list
			nextUserToCheck = sortedTroves.getPrev(_asset, currentBorrower);

			(
				SingleRedemptionValues memory singleRedemption,
				uint256 penaltyBonus
			) = _estimateRedemptionValues(
					_asset,
					currentBorrower,
					totals.remainingVST,
					totals.penaltyFee,
					totals.price
				);

			if (singleRedemption.cancelledPartial) break; // Partial redemption was cancelled (out-of-date hint, or new net debt < minimum), therefore we could not redeem from the last Trove

			feeBonus_ += penaltyBonus;
			totals.totalVSTToRedeem = totals.totalVSTToRedeem.add(singleRedemption.VSTLot);
			totals.totalAssetDrawn = totals.totalAssetDrawn.add(singleRedemption.ETHLot);

			totals.remainingVST = totals.remainingVST.sub(singleRedemption.VSTLot);
			currentBorrower = nextUserToCheck;
		}

		return (totals.totalAssetDrawn, feeBonus_);
	}

	function _estimateRedemptionValues(
		address _asset,
		address _borrower,
		uint256 _maxVSTamount,
		uint256 _penaltyFee,
		uint256 _price
	)
		internal
		view
		returns (SingleRedemptionValues memory singleRedemption, uint256 penaltyBonus_)
	{
		LocalVariables_AssetBorrowerPrice memory vars = LocalVariables_AssetBorrowerPrice(
			_asset,
			_borrower,
			_price
		);

		(uint256 vaultDebt, uint256 vaultColl, , ) = troveManager.getEntireDebtAndColl(
			vars._asset,
			vars._borrower
		);

		// Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the Trove minus the liquidation reserve
		singleRedemption.VSTLot = VestaMath._min(_maxVSTamount, vaultDebt);

		// Get the ETHLot of equivalent value in USD
		singleRedemption.ETHLot = singleRedemption.VSTLot.mul(1e18).div(_price);

		// Decrease the debt and collateral of the current Trove according to the VST lot and corresponding ETH to send

		uint256 newDebt = (vaultDebt).sub(singleRedemption.VSTLot);
		uint256 newColl = (vaultColl).sub(singleRedemption.ETHLot);

		if (newDebt == 0) {
			uint256 penalty = newColl.mul(_penaltyFee).div(BPS);
			singleRedemption.ETHLot += penalty;
			penaltyBonus_ += penalty;
		} else {
			if (newDebt < params.MIN_NET_DEBT(vars._asset)) {
				singleRedemption.cancelledPartial = true;
				return (singleRedemption, penaltyBonus_);
			}
		}

		return (singleRedemption, penaltyBonus_);
	}
}

