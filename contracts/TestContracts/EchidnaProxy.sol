// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../TroveManager.sol";
import "../BorrowerOperations.sol";
import "../StabilityPool.sol";
import "../VSTToken.sol";

contract EchidnaProxy {
	TroveManager troveManager;
	BorrowerOperations borrowerOperations;
	StabilityPool stabilityPool;
	VSTToken vstToken;

	constructor(
		TroveManager _troveManager,
		BorrowerOperations _borrowerOperations,
		StabilityPool _stabilityPool,
		VSTToken _VSTToken
	) {
		troveManager = _troveManager;
		borrowerOperations = _borrowerOperations;
		stabilityPool = _stabilityPool;
		vstToken = _VSTToken;
	}

	receive() external payable {
		// do nothing
	}

	// TroveManager

	function liquidatePrx(address _asset, address _user) external {
		troveManager.liquidate(_asset, _user);
	}

	function liquidateTrovesPrx(address _asset, uint256 _n) external {
		troveManager.liquidateTroves(_asset, _n);
	}

	function batchLiquidateTrovesPrx(
		address _asset,
		address[] calldata _troveArray
	) external {
		troveManager.batchLiquidateTroves(_asset, _troveArray);
	}

	function redeemCollateralPrx(
		address _asset,
		uint256 _VSTAmount,
		address _firstRedemptionHint,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint,
		uint256 _partialRedemptionHintNICR,
		uint256 _maxIterations,
		uint256 _maxFee
	) external {
		troveManager.redeemCollateral(
			_asset,
			_VSTAmount,
			_firstRedemptionHint,
			_upperPartialRedemptionHint,
			_lowerPartialRedemptionHint,
			_partialRedemptionHintNICR,
			_maxIterations,
			_maxFee
		);
	}

	// Borrower Operations
	function openTrovePrx(
		address _asset,
		uint256 _ETH,
		uint256 _VSTAmount,
		address _upperHint,
		address _lowerHint,
		uint256 _maxFee
	) external payable {
		borrowerOperations.openTrove{ value: _asset == address(0) ? _ETH : 0 }(
			_asset,
			_ETH,
			_maxFee,
			_VSTAmount,
			_upperHint,
			_lowerHint
		);
	}

	function addCollPrx(
		address _asset,
		uint256 _ETH,
		address _upperHint,
		address _lowerHint
	) external payable {
		borrowerOperations.addColl{ value: _asset == address(0) ? _ETH : 0 }(
			_asset,
			_ETH,
			_upperHint,
			_lowerHint
		);
	}

	function withdrawCollPrx(
		address _asset,
		uint256 _amount,
		address _upperHint,
		address _lowerHint
	) external {
		borrowerOperations.withdrawColl(
			_asset,
			_amount,
			_upperHint,
			_lowerHint
		);
	}

	function withdrawVSTPrx(
		address _asset,
		uint256 _amount,
		address _upperHint,
		address _lowerHint,
		uint256 _maxFee
	) external {
		borrowerOperations.withdrawVST(
			_asset,
			_maxFee,
			_amount,
			_upperHint,
			_lowerHint
		);
	}

	function repayVSTPrx(
		address _asset,
		uint256 _amount,
		address _upperHint,
		address _lowerHint
	) external {
		borrowerOperations.repayVST(_asset, _amount, _upperHint, _lowerHint);
	}

	function closeTrovePrx(address _asset) external {
		borrowerOperations.closeTrove(_asset);
	}

	function adjustTrovePrx(
		address _asset,
		uint256 _ETH,
		uint256 _collWithdrawal,
		uint256 _debtChange,
		bool _isDebtIncrease,
		address _upperHint,
		address _lowerHint,
		uint256 _maxFee
	) external payable {
		borrowerOperations.adjustTrove{
			value: _asset == address(0) ? _ETH : 0
		}(
			_asset,
			_ETH,
			_maxFee,
			_collWithdrawal,
			_debtChange,
			_isDebtIncrease,
			_upperHint,
			_lowerHint
		);
	}

	// Pool Manager
	function provideToSPPrx(uint256 _amount) external {
		stabilityPool.provideToSP(_amount);
	}

	function withdrawFromSPPrx(uint256 _amount) external {
		stabilityPool.withdrawFromSP(_amount);
	}

	// VST Token

	function transferPrx(address recipient, uint256 amount)
		external
		returns (bool)
	{
		return vstToken.transfer(recipient, amount);
	}

	function approvePrx(address spender, uint256 amount)
		external
		returns (bool)
	{
		return vstToken.approve(spender, amount);
	}

	function transferFromPrx(
		address sender,
		address recipient,
		uint256 amount
	) external returns (bool) {
		return vstToken.transferFrom(sender, recipient, amount);
	}

	function increaseAllowancePrx(address spender, uint256 addedValue)
		external
		returns (bool)
	{
		return vstToken.increaseAllowance(spender, addedValue);
	}

	function decreaseAllowancePrx(address spender, uint256 subtractedValue)
		external
		returns (bool)
	{
		return vstToken.decreaseAllowance(spender, subtractedValue);
	}
}
