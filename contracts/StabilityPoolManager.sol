pragma solidity ^0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./Dependencies/CheckContract.sol";
import "./Interfaces/IStabilityPoolManager.sol";

contract StabilityPoolManager is
	Ownable,
	CheckContract,
	IStabilityPoolManager
{
	mapping(address => address) stabilityPools;
	mapping(address => bool) validStabilityPools;

	string public constant NAME = "StabilityPoolManager";

	bool public isInitialized = false;

	function isStabilityPool(address stabilityPool)
		external
		view
		override
		returns (bool)
	{
		return validStabilityPools[stabilityPool];
	}

	function setAddresses(
		address stabilityPoolETH,
		address stabilityPoolBTC,
		address btcAddress
	) public onlyOwner {
		require(!isInitialized);
		checkContract(stabilityPoolETH);
		checkContract(stabilityPoolBTC);

		stabilityPools[address(0)] = stabilityPoolETH;
		validStabilityPools[stabilityPoolETH] = true;

		stabilityPools[btcAddress] = stabilityPoolBTC;
		validStabilityPools[stabilityPoolBTC] = true;

		isInitialized = true;
	}

	function addStabilityPool(address asset, address stabilityPool)
		external
		override
		onlyOwner
	{
		CheckContract(asset);
		CheckContract(stabilityPool);

		stabilityPools[asset] = stabilityPool;
		validStabilityPools[stabilityPool] = true;
	}

	function getAssetStabilityPool(address asset)
		external
		view
		override
		returns (IStabilityPool)
	{
		require(
			address(stabilityPools[asset]) != address(0),
			"Invalid asset StabilityPool"
		);
		return IStabilityPool(stabilityPools[asset]);
	}
}
