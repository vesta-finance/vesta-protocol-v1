pragma solidity >=0.8.0;

interface IRedemption {
	function redeemCollateral(
		address _asset,
		address _caller,
		uint256 _VSTamount,
		address _firstRedemptionHint,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint,
		uint256 _partialRedemptionHintNICR,
		uint256 _maxIterations,
		uint256 _maxFeePercentage
	) external;
}
