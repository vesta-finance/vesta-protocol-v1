pragma solidity >=0.8.0;

interface IRedemption {
	function redeemCollateral(
		address _asset,
		address _caller,
		uint256 _VSTamount,
		uint256 _maxIterations
	) external;
}

