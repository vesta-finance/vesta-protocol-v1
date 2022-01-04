pragma solidity ^0.8.10;

import "./Interfaces/IVestaParameters.sol";

contract VestaParameters is IVestaParameters {
	error SafeCheckError(
		string parameter,
		uint256 valueEntered,
		uint256 minValue,
		uint256 maxValue
	);

	function setMCR(address _asset, uint256 newMCR)
		public
		override
		safeCheck(
			"MCR",
			_asset,
			newMCR,
			1010000000000000000,
			100000000000000000000
		)
		onlyOwner
	{
		uint256 oldMCR = MCR[_asset];
		MCR[_asset] = newMCR;

		emit MCRChanged(oldMCR, newMCR);
	}

	function setCCR(address _asset, uint256 newCCR)
		public
		override
		safeCheck(
			"CCR",
			_asset,
			newCCR,
			1200000000000000000,
			100000000000000000000
		)
		onlyOwner
	{
		uint256 oldCCR = CCR[_asset];
		CCR[_asset] = newCCR;

		emit CCRChanged(oldCCR, newCCR);
	}

	function setVSTGasCompensation(address _asset, uint256 gasCompensation)
		public
		override
		safeCheck(
			"Gas Compensation",
			_asset,
			gasCompensation,
			1 ether,
			200 ether
		)
		onlyOwner
	{
		uint256 oldGasComp = VST_GAS_COMPENSATION[_asset];
		VST_GAS_COMPENSATION[_asset] = gasCompensation;

		emit GasCompensationChanged(oldGasComp, gasCompensation);
	}

	function setMinNetDebt(address _asset, uint256 minNetDebt)
		public
		override
		safeCheck("Min Net Debt", _asset, minNetDebt, 0, 1800 ether)
		onlyOwner
	{
		uint256 oldMinNet = MIN_NET_DEBT[_asset];
		MIN_NET_DEBT[_asset] = minNetDebt;

		emit MinNetDebtChanged(oldMinNet, minNetDebt);
	}

	function setPercentDivisor(address _asset, uint256 precentDivisor)
		public
		override
		safeCheck("Percent Divisor", _asset, precentDivisor, 2, 200)
		onlyOwner
	{
		uint256 oldPercent = PERCENT_DIVISOR[_asset];
		PERCENT_DIVISOR[_asset] = precentDivisor;

		emit PercentDivisorChanged(oldPercent, precentDivisor);
	}

	function setBorrowingFeeFloor(address _asset, uint256 borrowingFeeFloor)
		public
		override
		safeCheck("Borrowing Fee Floor", _asset, borrowingFeeFloor, 0, 50)
		onlyOwner
	{
		uint256 oldBorrowing = BORROWING_FEE_FLOOR[_asset];
		uint256 newBorrowingFee = (DECIMAL_PRECISION / 1000) *
			borrowingFeeFloor;

		BORROWING_FEE_FLOOR[_asset] = newBorrowingFee;

		emit BorrowingFeeFloorChanged(oldBorrowing, newBorrowingFee);
	}

	function setMaxBorrowingFee(address _asset, uint256 maxBorrowingFee)
		public
		override
		safeCheck("Max Borrowing Fee", _asset, maxBorrowingFee, 0, 200)
		onlyOwner
	{
		uint256 oldMaxBorrowingFee = MAX_BORROWING_FEE[_asset];
		uint256 newMaxBorrowingFee = (DECIMAL_PRECISION / 1000) *
			maxBorrowingFee;

		MAX_BORROWING_FEE[_asset] = newMaxBorrowingFee;
		emit MaxBorrowingFeeChanged(oldMaxBorrowingFee, newMaxBorrowingFee);
	}

	function setRedemptionFeeFloor(
		address _asset,
		uint256 redemptionFeeFloor
	)
		public
		override
		safeCheck("Redemption Fee Floor", _asset, redemptionFeeFloor, 3, 100)
		onlyOwner
	{
		uint256 oldRedemptionFeeFloor = REDEMPTION_FEE_FLOOR[_asset];
		uint256 newRedemptionFeeFloor = (DECIMAL_PRECISION / 1000) *
			redemptionFeeFloor;

		REDEMPTION_FEE_FLOOR[_asset] = newRedemptionFeeFloor;
		emit RedemptionFeeFloorChanged(
			oldRedemptionFeeFloor,
			newRedemptionFeeFloor
		);
	}

	modifier safeCheck(
		string memory parameter,
		address _asset,
		uint256 enteredValue,
		uint256 min,
		uint256 max
	) {
		require(
			hasCollateralConfigured[_asset],
			"Collateral is not configured, use setAsDefault or setCollateralParameters"
		);

		if (enteredValue < min || enteredValue > max) {
			revert SafeCheckError(parameter, enteredValue, min, max);
		}
		_;
	}
}
