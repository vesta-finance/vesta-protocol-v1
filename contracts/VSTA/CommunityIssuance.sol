// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../Interfaces/IStabilityPoolManager.sol";
import "../Interfaces/ICommunityIssuance.sol";
import "../Dependencies/BaseMath.sol";
import "../Dependencies/VestaMath.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/IVestaWrapper.sol";

contract CommunityIssuance is ICommunityIssuance, OwnableUpgradeable, CheckContract, BaseMath {
	using SafeMathUpgradeable for uint256;
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "CommunityIssuance";
	uint256 public constant DISTRIBUTION_DURATION = 7 days / 60;
	uint256 public constant SECONDS_IN_ONE_MINUTE = 60;

	IERC20Upgradeable public vstaToken;
	IStabilityPoolManager public stabilityPoolManager;

	mapping(address => uint256) public totalVSTAIssued;
	mapping(address => uint256) public lastUpdateTime;
	mapping(address => uint256) public VSTASupplyCaps;
	mapping(address => uint256) public vstaDistributionsByPool;

	address public adminContract;

	bool public isInitialized;

	//V2
	mapping(address => DistributionRewards) public stabilityPoolRewards;
	mapping(address => bool) public protocolFullAccess;
	mapping(address => mapping(address => bool)) public stabilityPoolAdmin;

	modifier activeStabilityPoolOnly(address _pool) {
		require(
			stabilityPoolRewards[_pool].lastUpdateTime != 0,
			"CommunityIssuance: Pool needs to be added first."
		);
		_;
	}

	modifier disabledStabilityPoolOnly(address _pool) {
		require(
			stabilityPoolRewards[_pool].lastUpdateTime == 0,
			"CommunityIssuance: Pool is already started."
		);
		_;
	}

	modifier isController() {
		require(msg.sender == owner() || msg.sender == adminContract, "Invalid Permission");
		_;
	}

	modifier onlyStabilityPoolAdmins(address _pool) {
		require(
			stabilityPoolAdmin[_pool][msg.sender] ||
				msg.sender == owner() ||
				protocolFullAccess[msg.sender] ||
				msg.sender == adminContract,
			"Not an admin"
		);
		_;
	}

	modifier isStabilityPool(address _pool) {
		require(
			stabilityPoolManager.isStabilityPool(_pool),
			"CommunityIssuance: caller is not SP"
		);
		_;
	}

	modifier onlyStabilityPool() {
		require(
			stabilityPoolManager.isStabilityPool(msg.sender),
			"CommunityIssuance: caller is not SP"
		);
		_;
	}

	// --- Functions ---
	function setAddresses(
		address _vstaTokenAddress,
		address _stabilityPoolManagerAddress,
		address _adminContract
	) external override initializer {
		require(!isInitialized, "Already initialized");
		checkContract(_vstaTokenAddress);
		checkContract(_stabilityPoolManagerAddress);
		checkContract(_adminContract);
		isInitialized = true;
		__Ownable_init();

		adminContract = _adminContract;

		vstaToken = IERC20Upgradeable(_vstaTokenAddress);
		stabilityPoolManager = IStabilityPoolManager(_stabilityPoolManagerAddress);

		emit VSTATokenAddressSet(_vstaTokenAddress);
		emit StabilityPoolAddressSet(_stabilityPoolManagerAddress);
	}

	function setProtocolAccessOf(address _address, bool _access) external onlyOwner {
		protocolFullAccess[_address] = _access;
	}

	function setStabilityPoolAdmin(
		address _pool,
		address _user,
		bool _access
	) external onlyOwner {
		stabilityPoolAdmin[_pool][_user] = _access;
	}

	function setAdminContract(address _admin) external onlyOwner {
		require(_admin != address(0));
		adminContract = _admin;
	}

	function convertPoolFundV1toV2(address[] memory _pools) external onlyOwner {
		for (uint256 i = 0; i < _pools.length; i++) {
			address pool = _pools[i];

			if (stabilityPoolRewards[pool].lastUpdateTime > 0) continue;

			stabilityPoolRewards[pool] = DistributionRewards(
				address(vstaToken),
				totalVSTAIssued[pool],
				lastUpdateTime[pool],
				VSTASupplyCaps[pool],
				vstaDistributionsByPool[pool]
			);
		}
	}

	function addFundToStabilityPool(address _pool, uint256 _assignedSupply)
		external
		override
		onlyStabilityPoolAdmins(_pool)
	{
		_addFundToStabilityPoolFrom(_pool, _assignedSupply, msg.sender);
	}

	function removeFundFromStabilityPool(address _pool, uint256 _fundToRemove)
		external
		onlyOwner
		activeStabilityPoolOnly(_pool)
	{
		DistributionRewards storage distributionRewards = stabilityPoolRewards[_pool];

		uint256 newCap = distributionRewards.totalRewardSupply.sub(_fundToRemove);
		require(
			distributionRewards.totalRewardIssued <= newCap,
			"CommunityIssuance: Stability Pool doesn't have enough supply."
		);

		distributionRewards.totalRewardSupply -= _fundToRemove;

		IERC20Upgradeable(distributionRewards.rewardToken).safeTransfer(msg.sender, _fundToRemove);

		if (distributionRewards.totalRewardIssued == distributionRewards.totalRewardSupply) {
			disableStabilityPool(_pool);
		}
	}

	function addFundToStabilityPoolFrom(
		address _pool,
		uint256 _assignedSupply,
		address _spender
	) external override onlyStabilityPoolAdmins(_pool) {
		// We are disabling this so we don't have issue while using the Admin contract to create
		// The new flow is to updateStabilityPoolRewardsToken() then addFund
		//_addFundToStabilityPoolFrom(_pool, _assignedSupply, _spender);
	}

	function _addFundToStabilityPoolFrom(
		address _pool,
		uint256 _assignedSupply,
		address _spender
	) internal {
		require(
			stabilityPoolManager.isStabilityPool(_pool),
			"CommunityIssuance: Invalid Stability Pool"
		);

		DistributionRewards storage distributionRewards = stabilityPoolRewards[_pool];

		if (distributionRewards.lastUpdateTime == 0) {
			distributionRewards.lastUpdateTime = block.timestamp;
		}

		distributionRewards.totalRewardSupply += _assignedSupply;
		IERC20Upgradeable(distributionRewards.rewardToken).safeTransferFrom(
			_spender,
			address(this),
			_assignedSupply
		);
	}

	function disableStabilityPool(address _pool) internal {
		delete stabilityPoolRewards[_pool];
	}

	// Alias Name: issueAsset() - We do not rename it due of dependencies
	function issueVSTA() external override onlyStabilityPool returns (uint256) {
		return _issueVSTA(msg.sender);
	}

	function _issueVSTA(address _pool) internal isStabilityPool(_pool) returns (uint256) {
		DistributionRewards storage distributionRewards = stabilityPoolRewards[_pool];

		uint256 maxPoolSupply = distributionRewards.totalRewardSupply;
		uint256 totalIssued = distributionRewards.totalRewardIssued;

		if (totalIssued >= maxPoolSupply) return 0;

		uint256 issuance = _getLastUpdateTokenDistribution(_pool);
		uint256 totalIssuance = issuance.add(totalIssued);

		if (totalIssuance > maxPoolSupply) {
			issuance = maxPoolSupply.sub(totalIssued);
			totalIssuance = maxPoolSupply;
		}

		distributionRewards.lastUpdateTime = block.timestamp;
		distributionRewards.totalRewardIssued = totalIssuance;
		emit TotalVSTAIssuedUpdated(_pool, totalIssuance);

		return issuance;
	}

	function _getLastUpdateTokenDistribution(address _pool)
		internal
		view
		activeStabilityPoolOnly(_pool)
		returns (uint256)
	{
		DistributionRewards memory distributionRewards = stabilityPoolRewards[_pool];

		uint256 timePassed = block.timestamp.sub(distributionRewards.lastUpdateTime).div(
			SECONDS_IN_ONE_MINUTE
		);
		uint256 totalDistribuedSinceBeginning = distributionRewards.rewardDistributionPerMin.mul(
			timePassed
		);

		return totalDistribuedSinceBeginning;
	}

	//Alias Name: sendAsset - We do not rename it due of dependencies
	function sendVSTA(address _account, uint256 _vstaAmount)
		external
		override
		onlyStabilityPool
		activeStabilityPoolOnly(msg.sender)
	{
		IERC20Upgradeable erc20Asset = IERC20Upgradeable(
			stabilityPoolRewards[msg.sender].rewardToken
		);

		uint256 balance = erc20Asset.balanceOf(address(this));
		uint256 safeAmount = balance >= _vstaAmount ? _vstaAmount : balance;

		if (safeAmount == 0) {
			return;
		}

		erc20Asset.transfer(_account, safeAmount);
	}

	//Alias Name: setWeeklyAssetDistribution - We do not rename it due of dependencies
	function setWeeklyVstaDistribution(address _stabilityPool, uint256 _weeklyReward)
		external
		isStabilityPool(_stabilityPool)
		onlyStabilityPoolAdmins(_stabilityPool)
	{
		stabilityPoolRewards[_stabilityPool].rewardDistributionPerMin = _weeklyReward.div(
			DISTRIBUTION_DURATION
		);
	}

	function configStabilityPool(
		address _pool,
		address _rewardToken,
		uint256 _weeklyReward
	) external onlyOwner disabledStabilityPoolOnly(_pool) {
		_config(_pool, _rewardToken, _weeklyReward);
	}

	function configStabilityPoolAndSend(
		address _pool,
		address _rewardToken,
		uint256 _weeklyReward,
		uint256 _totalSupply
	) external onlyOwner disabledStabilityPoolOnly(_pool) {
		_config(_pool, _rewardToken, _weeklyReward);
		_addFundToStabilityPoolFrom(_pool, _totalSupply, msg.sender);
	}

	function _config(
		address _pool,
		address _rewardToken,
		uint256 _weeklyReward
	) internal {
		stabilityPoolRewards[_pool] = DistributionRewards(
			_rewardToken,
			0,
			0,
			0,
			_weeklyReward.div(DISTRIBUTION_DURATION)
		);
	}

	function wrapRewardsToken(address _pool, IVestaWrapper _vestaWrappedToken)
		external
		onlyOwner
	{
		DistributionRewards storage distribution = stabilityPoolRewards[_pool];
		IERC20Upgradeable currentToken = IERC20Upgradeable(distribution.rewardToken);

		require(address(currentToken) != address(_vestaWrappedToken), "Already wrapped");

		currentToken.approve(address(_vestaWrappedToken), type(uint256).max);
		_vestaWrappedToken.wrap(currentToken.balanceOf(address(this)));

		distribution.rewardToken = address(_vestaWrappedToken);
	}

	function getRewardsLeftInStabilityPool(address _pool) external view returns (uint256) {
		DistributionRewards memory distributionRewards = stabilityPoolRewards[_pool];
		return distributionRewards.totalRewardSupply.sub(distributionRewards.totalRewardIssued);
	}

	function getTotalAssetIssued(address _pool) external view returns (uint256) {
		return stabilityPoolRewards[_pool].totalRewardIssued;
	}

	function isWalletAdminOfPool(address _pool, address _user) external view returns (bool) {
		return stabilityPoolAdmin[_pool][_user];
	}
}
