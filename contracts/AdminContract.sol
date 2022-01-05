pragma solidity ^0.8.9;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";

import "./Dependencies/CheckContract.sol";

import "./Interfaces/IStabilityPoolManager.sol";
import "./Interfaces/IVestaParameters.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ICommunityIssuance.sol";

contract AdminContract is ProxyAdmin {
	string public constant STABILITY_POOL = "StabilityPool";
	bool private isInitialized;

	IVestaParameters private vestaParameters;
	IStabilityPoolManager private stabilityPoolManager;
	ICommunityIssuance private communityIssuance;

	address borrowerOperationsAddress;
	address troveManagerAddress;
	address vstTokenAddress;
	address sortedTrovesAddress;

	mapping(address => TransparentUpgradeableProxy)
		private assetsStabilityPoolProxy;

	function setAddresses(
		address _paramaters,
		address _stabilityPoolManager,
		address _borrowerOperationsAddress,
		address _troveManagerAddress,
		address _vstTokenAddress,
		address _sortedTrovesAddress,
		address _communityIssuanceAddress
	) external onlyOwner {
		require(!isInitialized);
		CheckContract(_paramaters);
		CheckContract(_stabilityPoolManager);
		CheckContract(_borrowerOperationsAddress);
		CheckContract(_troveManagerAddress);
		CheckContract(_vstTokenAddress);
		CheckContract(_sortedTrovesAddress);
		CheckContract(_communityIssuanceAddress);
		isInitialized = true;

		borrowerOperationsAddress = _borrowerOperationsAddress;
		troveManagerAddress = _troveManagerAddress;
		vstTokenAddress = _vstTokenAddress;
		sortedTrovesAddress = _sortedTrovesAddress;
		communityIssuance = ICommunityIssuance(_communityIssuanceAddress);

		vestaParameters = IVestaParameters(_paramaters);
		stabilityPoolManager = IStabilityPoolManager(_stabilityPoolManager);
	}

	function addNewCollateral(
		address _asset,
		address _stabilityPoolImplementation,
		address _chainlink,
		uint256 _tellorId,
		uint256 assignedToken,
		uint256 redemptionLockInDay
	) external onlyOwner {
		vestaParameters.priceFeed().addOracle(_asset, _chainlink, _tellorId);
		vestaParameters.setAsDefaultWithRemptionBlock(
			_asset,
			redemptionLockInDay
		);

		TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
			ClonesUpgradeable.clone(_stabilityPoolImplementation),
			address(this),
			abi.encodeWithSignature(
				"setAddresses(address,address,address,address,address,address,address)",
				_asset,
				borrowerOperationsAddress,
				troveManagerAddress,
				vstTokenAddress,
				sortedTrovesAddress,
				address(communityIssuance),
				address(vestaParameters)
			)
		);

		address proxyAddress = address(proxy);

		stabilityPoolManager.addStabilityPool(_asset, proxyAddress);

		communityIssuance.addFundToStabilityPoolFrom(
			proxyAddress,
			assignedToken,
			msg.sender
		);
	}
}
