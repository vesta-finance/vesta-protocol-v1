pragma solidity ^0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

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
	address public adminContact;

	modifier isController() {
		require(
			msg.sender == owner() || msg.sender == adminContact,
			"Invalid permissions"
		);
		_;
	}

	function setAddresses(address _adminContract) external onlyOwner {
		require(!isInitialized, "Already initialized");
		isInitialized = true;
		adminContact = _adminContract;
	}

	function isStabilityPool(address stabilityPool)
		external
		view
		override
		returns (bool)
	{
		return validStabilityPools[stabilityPool];
	}

	function addStabilityPool(address asset, address stabilityPool)
		external
		override
		isController
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
