pragma solidity ^0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../Dependencies/CheckContract.sol";

import "./IActivePool.sol";
import "./IDefaultPool.sol";
import "./IPriceFeed.sol";
import "./IVestaBase.sol";
import "./IVestaParameters.sol";

abstract contract IVestaParameters is Ownable, CheckContract {
	string public constant NAME = "VestaParameters";

	uint256 public constant DECIMAL_PRECISION = 1 ether;

	uint256 public _100pct = 1000000000000000000; // 1e18 == 100%

	// Minimum collateral ratio for individual troves
	uint256 public constant MCR_DEFAULT = 1100000000000000000; // 110%
	mapping(address => uint256) public MCR;

	// Critical system collateral ratio. If the system's total collateral ratio (TCR) falls below the CCR, Recovery Mode is triggered.
	uint256 public constant CCR_DEFAULT = 1500000000000000000; // 150%
	mapping(address => uint256) public CCR;

	// Amount of VST to be locked in gas pool on opening troves
	uint256 public constant VST_GAS_COMPENSATION_DEFAULT = 200 ether;
	mapping(address => uint256) public VST_GAS_COMPENSATION;

	// Minimum amount of net VST debt a trove must have
	uint256 public constant MIN_NET_DEBT_DEFAULT = 1800 ether;
	mapping(address => uint256) public MIN_NET_DEBT;

	uint256 public constant PERCENT_DIVISOR_DEFAULT = 200; // dividing by 200 yields 0.5%
	mapping(address => uint256) public PERCENT_DIVISOR; // dividing by 200 yields 0.5%

	uint256 public constant BORROWING_FEE_FLOOR_DEFAULT =
		(DECIMAL_PRECISION / 1000) * 5; // 0.5%
	mapping(address => uint256) public BORROWING_FEE_FLOOR;

	uint256 public constant REDEMPTION_FEE_FLOOR_DEFAULT =
		(DECIMAL_PRECISION / 1000) * 5; // 0.5%

	mapping(address => uint256) public REDEMPTION_FEE_FLOOR;

	uint256 public constant MAX_BORROWING_FEE_DEFAULT =
		(DECIMAL_PRECISION / 100) * 5; // 5%
	mapping(address => uint256) public MAX_BORROWING_FEE;

	mapping(address => bool) internal hasCollateralConfigured;

	IActivePool public activePool;
	IDefaultPool public defaultPool;
	IPriceFeed public priceFeed;

	bool public isInitialized;

	event MCRChanged(uint256 oldMCR, uint256 newMCR);
	event CCRChanged(uint256 oldCCR, uint256 newCCR);
	event GasCompensationChanged(uint256 oldGasComp, uint256 newGasComp);
	event MinNetDebtChanged(uint256 oldMinNet, uint256 newMinNet);
	event PercentDivisorChanged(
		uint256 oldPercentDiv,
		uint256 newPercentDiv
	);
	event BorrowingFeeFloorChanged(
		uint256 oldBorrowingFloorFee,
		uint256 newBorrowingFloorFee
	);
	event MaxBorrowingFeeChanged(
		uint256 oldMaxBorrowingFee,
		uint256 newMaxBorrowingFee
	);
	event RedemptionFeeFloorChanged(
		uint256 oldRedemptionFeeFloor,
		uint256 newRedemptionFeeFloor
	);

	event PriceFeedChanged(address indexed addr);

	function setAddresses(
		address _activePool,
		address _defaultPool,
		address _priceFeed,
		address _multiSig
	) public onlyOwner {
		require(_multiSig != address(0), "Invalid Multisig address");
		require(!isInitialized, "Already initalized");
		checkContract(_activePool);
		checkContract(_defaultPool);
		checkContract(_priceFeed);

		isInitialized = true;
		activePool = IActivePool(_activePool);
		defaultPool = IDefaultPool(_defaultPool);
		priceFeed = IPriceFeed(_priceFeed);

		transferOwnership(_multiSig);
	}

	function setPriceFeed(address _priceFeed) public onlyOwner {
		checkContract(_priceFeed);
		priceFeed = IPriceFeed(_priceFeed);

		emit PriceFeedChanged(_priceFeed);
	}

	function sanitizeParameters(address _asset) public {
		if (!hasCollateralConfigured[_asset]) {
			_setAsDefault(_asset);
		}
	}

	function setAsDefault(address _asset) public onlyOwner {
		_setAsDefault(_asset);
	}

	function _setAsDefault(address _asset) private {
		hasCollateralConfigured[_asset] = true;

		MCR[_asset] = MCR_DEFAULT;
		CCR[_asset] = CCR_DEFAULT;
		VST_GAS_COMPENSATION[_asset] = VST_GAS_COMPENSATION_DEFAULT;
		MIN_NET_DEBT[_asset] = MIN_NET_DEBT_DEFAULT;
		PERCENT_DIVISOR[_asset] = PERCENT_DIVISOR_DEFAULT;
		BORROWING_FEE_FLOOR[_asset] = BORROWING_FEE_FLOOR_DEFAULT;
		MAX_BORROWING_FEE[_asset] = MAX_BORROWING_FEE_DEFAULT;
		REDEMPTION_FEE_FLOOR[_asset] = REDEMPTION_FEE_FLOOR_DEFAULT;
	}

	function setCollateralParameters(
		address _asset,
		uint256 newMCR,
		uint256 newCCR,
		uint256 gasCompensation,
		uint256 minNetDebt,
		uint256 precentDivisor,
		uint256 borrowingFeeFloor,
		uint256 maxBorrowingFee,
		uint256 redemptionFeeFloor
	) public onlyOwner {
		hasCollateralConfigured[_asset] = true;

		setMCR(_asset, newMCR);
		setCCR(_asset, newCCR);
		setVSTGasCompensation(_asset, gasCompensation);
		setMinNetDebt(_asset, minNetDebt);
		setPercentDivisor(_asset, precentDivisor);
		setBorrowingFeeFloor(_asset, borrowingFeeFloor);
		setMaxBorrowingFee(_asset, maxBorrowingFee);
		setRedemptionFeeFloor(_asset, redemptionFeeFloor);
	}

	function setMCR(address _asset, uint256 newMCR) public virtual;

	function setCCR(address _asset, uint256 newCCR) public virtual;

	function setVSTGasCompensation(address _asset, uint256 gasCompensation)
		public
		virtual;

	function setMinNetDebt(address _asset, uint256 minNetDebt)
		public
		virtual;

	function setPercentDivisor(address _asset, uint256 precentDivisor)
		public
		virtual;

	function setBorrowingFeeFloor(address _asset, uint256 borrowingFeeFloor)
		public
		virtual;

	function setMaxBorrowingFee(address _asset, uint256 maxBorrowingFee)
		public
		virtual;

	function setRedemptionFeeFloor(
		address _asset,
		uint256 redemptionFeeFloor
	) public virtual;
}
