pragma solidity ^0.8.10;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

import "./Dependencies/CheckContract.sol";
import "./Interfaces/IStabilityPoolManager.sol";

contract StabilityPoolManager is
	OwnableUpgradeable,
	CheckContract,
	IStabilityPoolManager
{
	mapping(address => address) stabilityPools;
	mapping(address => bool) validStabilityPools;

	string public constant NAME = "StabilityPoolManager";

	bool public isInitialized;
	address public adminContact;

	modifier isController() {
		require(
			msg.sender == owner() || msg.sender == adminContact,
			"Invalid permissions"
		);
		_;
	}

	function setAddresses(address _adminContract) external initializer {
		require(!isInitialized, "Already initialized");
		isInitialized = true;

		__Ownable_init();

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
			stabilityPools[asset] != address(0),
			"Invalid asset StabilityPool"
		);
		return IStabilityPool(stabilityPools[asset]);
	}

	function unsafeGetAssetStabilityPool(address _asset)
		external
		view
		override
		returns (address)
	{
		return stabilityPools[_asset];
	}
}
