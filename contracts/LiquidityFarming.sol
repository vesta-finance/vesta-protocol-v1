pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract LiquidityFarming is Ownable {
	using SafeERC20 for IERC20;
	struct UserInfo {
		uint256 amount;
		uint256 rewardDebt;
		uint256 remainingVSTATokenReward; // VSTA Tokens that weren't distributed for user per pool.
	}

	struct PoolInfo {
		IERC20 stakingToken;
		uint256 stakingTokenTotalAmount;
		uint256 accVSTAPerShare; // Accumulated VSTA per share, times 1e12. See below.
		uint32 lastRewardTime;
		uint16 allocPoint; // How many allocation points assigned to this pool. VSTA to distribute per second.
	}

	IERC20 public immutable vsta;
	uint256 public vstaPerSecond; // VSTA tokens vested per second.

	PoolInfo[] public poolInfo;

	mapping(uint256 => mapping(address => UserInfo)) public userInfo;

	uint256 public totalAllocPoint = 0; // Total allocation poitns. Must be the sum of all allocation points in all pools.

	uint32 public immutable startTime;

	uint32 public endTime;

	event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
	event Withdraw(
		address indexed user,
		uint256 indexed pid,
		uint256 amount
	);
	event EmergencyWithdraw(
		address indexed user,
		uint256 indexed pid,
		uint256 amount
	);

	constructor(
		IERC20 _vsta,
		uint256 _vstaPerSecond,
		uint32 _startTime
	) {
		vsta = _vsta;

		vstaPerSecond = _vstaPerSecond;
		startTime = _startTime;
		endTime = _startTime + 7 days;
	}

	function changeEndTime(uint32 addSeconds) external onlyOwner {
		endTime += addSeconds;
	}

	// Changes VSTA token reward per second. Use this function to moderate the `lockup amount`. Essentially this function changes the amount of the reward
	// which is entitled to the user for his token staking by the time the `endTime` is passed.
	//Good practice to update pools without messing up the contract
	function setVSTAPerSecond(uint256 _vstaPerSecond, bool _withUpdate)
		external
		onlyOwner
	{
		if (_withUpdate) {
			massUpdatePools();
		}
		vstaPerSecond = _vstaPerSecond;
	}

	// How many pools are in the contract
	function poolLength() external view returns (uint256) {
		return poolInfo.length;
	}

	// Add a new staking token to the pool. Can only be called by the owner.
	// VERY IMPORTANT NOTVSTA
	// ----------- DO NOT add the same staking token more than once. Rewards will be messed up if you do. -------------
	// Good practice to update pools without messing up the contract
	function add(
		uint16 _allocPoint,
		IERC20 _stakingToken,
		bool _withUpdate
	) external onlyOwner {
		if (_withUpdate) {
			massUpdatePools();
		}
		uint256 lastRewardTime = block.timestamp > startTime
			? block.timestamp
			: startTime;
		totalAllocPoint += _allocPoint;
		poolInfo.push(
			PoolInfo({
				stakingToken: _stakingToken,
				stakingTokenTotalAmount: 0,
				allocPoint: _allocPoint,
				lastRewardTime: uint32(lastRewardTime),
				accVSTAPerShare: 0
			})
		);
	}

	// Update the given pool's VSTA allocation point. Can only be called by the owner.
	// Good practice to update pools without messing up the contract
	function set(
		uint256 _pid,
		uint16 _allocPoint,
		bool _withUpdate
	) external onlyOwner {
		if (_withUpdate) {
			massUpdatePools();
		}
		totalAllocPoint =
			totalAllocPoint -
			poolInfo[_pid].allocPoint +
			_allocPoint;
		poolInfo[_pid].allocPoint = _allocPoint;
	}

	// Return reward multiplier over the given _from to _to time.
	function getMultiplier(uint256 _from, uint256 _to)
		public
		view
		returns (uint256)
	{
		_from = _from > startTime ? _from : startTime;
		if (_from > endTime || _to < startTime) {
			return 0;
		}
		if (_to > endTime) {
			return endTime - _from;
		}
		return _to - _from;
	}

	// View function to see pending VSTA on frontend.
	function pendingVSTA(uint256 _pid, address _user)
		external
		view
		returns (uint256)
	{
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][_user];
		uint256 accVSTAPerShare = pool.accVSTAPerShare;

		if (
			block.timestamp > pool.lastRewardTime &&
			pool.stakingTokenTotalAmount != 0
		) {
			uint256 multiplier = getMultiplier(
				pool.lastRewardTime,
				block.timestamp
			);
			uint256 vstaReward = (multiplier * vstaPerSecond * pool.allocPoint) /
				totalAllocPoint;
			accVSTAPerShare +=
				(vstaReward * 1e12) /
				pool.stakingTokenTotalAmount;
		}
		return
			(user.amount * accVSTAPerShare) /
			1e12 -
			user.rewardDebt +
			user.remainingVSTATokenReward;
	}

	// Update reward vairables for all pools. Be careful of gas spending!
	function massUpdatePools() public {
		uint256 length = poolInfo.length;
		for (uint256 pid = 0; pid < length; ++pid) {
			updatePool(pid);
		}
	}

	// Update reward variables of the given pool to be up-to-date.
	function updatePool(uint256 _pid) public {
		PoolInfo storage pool = poolInfo[_pid];
		if (block.timestamp <= pool.lastRewardTime) {
			return;
		}

		if (pool.stakingTokenTotalAmount == 0) {
			pool.lastRewardTime = uint32(block.timestamp);
			return;
		}
		uint256 multiplier = getMultiplier(
			pool.lastRewardTime,
			block.timestamp
		);
		uint256 vstaReward = (multiplier * vstaPerSecond * pool.allocPoint) /
			totalAllocPoint;
		pool.accVSTAPerShare +=
			(vstaReward * 1e12) /
			pool.stakingTokenTotalAmount;
		pool.lastRewardTime = uint32(block.timestamp);
	}

	// Deposit staking tokens to Sorbettiere for VSTA allocation.
	function deposit(uint256 _pid, uint256 _amount) public {
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][msg.sender];
		updatePool(_pid);
		if (user.amount > 0) {
			uint256 pending = (user.amount * pool.accVSTAPerShare) /
				1e12 -
				user.rewardDebt +
				user.remainingVSTATokenReward;
			user.remainingVSTATokenReward = safeRewardTransfer(
				msg.sender,
				pending
			);
		}
		pool.stakingToken.safeTransferFrom(
			address(msg.sender),
			address(this),
			_amount
		);
		user.amount += _amount;
		pool.stakingTokenTotalAmount += _amount;
		user.rewardDebt = (user.amount * pool.accVSTAPerShare) / 1e12;
		emit Deposit(msg.sender, _pid, _amount);
	}

	// Withdraw staked tokens from Sorbettiere.
	function withdraw(uint256 _pid, uint256 _amount) public {
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][msg.sender];
		require(user.amount >= _amount, "Farming: Invalid withdraw amount.");
		updatePool(_pid);
		uint256 pending = (user.amount * pool.accVSTAPerShare) /
			1e12 -
			user.rewardDebt +
			user.remainingVSTATokenReward;
		user.remainingVSTATokenReward = safeRewardTransfer(
			msg.sender,
			pending
		);
		user.amount -= _amount;
		pool.stakingTokenTotalAmount -= _amount;
		user.rewardDebt = (user.amount * pool.accVSTAPerShare) / 1e12;
		pool.stakingToken.safeTransfer(address(msg.sender), _amount);
		emit Withdraw(msg.sender, _pid, _amount);
	}

	// Withdraw without caring about rewards. EMERGENCY ONLY.
	function emergencyWithdraw(uint256 _pid) public {
		PoolInfo storage pool = poolInfo[_pid];
		UserInfo storage user = userInfo[_pid][msg.sender];
		uint256 userAmount = user.amount;
		pool.stakingTokenTotalAmount -= userAmount;
		delete userInfo[_pid][msg.sender];
		pool.stakingToken.safeTransfer(address(msg.sender), userAmount);
		emit EmergencyWithdraw(msg.sender, _pid, userAmount);
	}

	function safeRewardTransfer(address _to, uint256 _amount)
		internal
		returns (uint256)
	{
		uint256 vstaTokenBalance = vsta.balanceOf(address(this));
		if (vstaTokenBalance == 0) {
			//save some gas fee
			return _amount;
		}
		if (_amount > vstaTokenBalance) {
			//save some gas fee
			vsta.safeTransfer(_to, vstaTokenBalance);
			return _amount - vstaTokenBalance;
		}
		vsta.safeTransfer(_to, _amount);
		return 0;
	}
}
