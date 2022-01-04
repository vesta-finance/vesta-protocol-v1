// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../TroveManager.sol";
import "../BorrowerOperations.sol";
import "../ActivePool.sol";
import "../DefaultPool.sol";
import "../StabilityPool.sol";
import "../VestaParameters.sol";
import "../StabilityPoolManager.sol";
import "../GasPool.sol";
import "../CollSurplusPool.sol";
import "../VSTToken.sol";
import "./PriceFeedTestnet.sol";
import "../SortedTroves.sol";
import "./EchidnaProxy.sol";

// Run with:
// rm -f fuzzTests/corpus/* # (optional)
// ~/.local/bin/echidna-test contracts/TestContracts/EchidnaTester.sol --contract EchidnaTester --config fuzzTests/echidna_config.yaml

contract EchidnaTester {
	using SafeMath for uint256;

	uint256 private constant NUMBER_OF_ACTORS = 100;
	uint256 private constant INITIAL_BALANCE = 1e24;
	uint256 private MCR;
	uint256 private CCR;
	uint256 private VST_GAS_COMPENSATION;

	TroveManager public troveManager;
	BorrowerOperations public borrowerOperations;
	ActivePool public activePool;
	DefaultPool public defaultPool;
	StabilityPool public stabilityPool;
	StabilityPool public stabilityPoolERC;
	StabilityPoolManager public stabilityPoolManager;
	GasPool public gasPool;
	CollSurplusPool public collSurplusPool;
	VSTToken public vstToken;
	PriceFeedTestnet priceFeedTestnet;
	SortedTroves sortedTroves;
	VestaParameters vestaParameters;

	EchidnaProxy[NUMBER_OF_ACTORS] public echidnaProxies;

	uint256 private numberOfTroves;

	constructor() payable {
		troveManager = new TroveManager();
		borrowerOperations = new BorrowerOperations();
		activePool = new ActivePool();
		defaultPool = new DefaultPool();
		stabilityPool = new StabilityPool();
		stabilityPoolERC = new StabilityPool();
		stabilityPoolManager = new StabilityPoolManager();
		vestaParameters = new VestaParameters();
		gasPool = new GasPool();
		vstToken = new VSTToken(
			address(troveManager),
			address(stabilityPoolManager),
			address(borrowerOperations),
			msg.sender
		);

		collSurplusPool = new CollSurplusPool();
		priceFeedTestnet = new PriceFeedTestnet();

		sortedTroves = new SortedTroves();

		stabilityPoolManager.setAddresses(
			address(stabilityPool),
			address(stabilityPoolERC),
			address(gasPool)
		);

		vestaParameters.setAddresses(
			address(activePool),
			address(defaultPool),
			address(priceFeedTestnet),
			msg.sender
		);

		troveManager.setAddresses(
			address(borrowerOperations),
			address(stabilityPoolManager),
			address(gasPool),
			address(collSurplusPool),
			address(vstToken),
			address(sortedTroves),
			address(0),
			address(vestaParameters)
		);

		borrowerOperations.setAddresses(
			address(troveManager),
			address(stabilityPoolManager),
			address(gasPool),
			address(collSurplusPool),
			address(sortedTroves),
			address(vstToken),
			address(0),
			address(vestaParameters)
		);

		activePool.setAddresses(
			address(borrowerOperations),
			address(troveManager),
			address(stabilityPoolManager),
			address(defaultPool),
			address(collSurplusPool)
		);

		defaultPool.setAddresses(address(troveManager), address(activePool));

		stabilityPool.setAddresses(
			address(0),
			address(borrowerOperations),
			address(troveManager),
			address(vstToken),
			address(sortedTroves),
			address(0),
			address(vestaParameters)
		);

		collSurplusPool.setAddresses(
			address(borrowerOperations),
			address(troveManager),
			address(activePool)
		);

		sortedTroves.setParams(
			address(troveManager),
			address(borrowerOperations)
		);

		for (uint256 i = 0; i < NUMBER_OF_ACTORS; i++) {
			echidnaProxies[i] = new EchidnaProxy(
				troveManager,
				borrowerOperations,
				stabilityPool,
				vstToken
			);
			(bool success, ) = address(echidnaProxies[i]).call{
				value: INITIAL_BALANCE
			}("");
			require(success);
		}

		MCR = borrowerOperations.vestaParams().MCR(address(0));
		CCR = borrowerOperations.vestaParams().CCR(address(0));
		VST_GAS_COMPENSATION = borrowerOperations
			.vestaParams()
			.VST_GAS_COMPENSATION(address(0));
		require(MCR > 0);
		require(CCR > 0);

		// TODO:
		priceFeedTestnet.setPrice(1e22);
	}

	// TroveManager

	function liquidateExt(
		address _asset,
		uint256 _i,
		address _user
	) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].liquidatePrx(_asset, _user);
	}

	function liquidateTrovesExt(
		address _asset,
		uint256 _i,
		uint256 _n
	) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].liquidateTrovesPrx(_asset, _n);
	}

	function batchLiquidateTrovesExt(
		address _asset,
		uint256 _i,
		address[] calldata _troveArray
	) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].batchLiquidateTrovesPrx(_asset, _troveArray);
	}

	function redeemCollateralExt(
		address _asset,
		uint256 _i,
		uint256 _VSTAmount,
		address _firstRedemptionHint,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint,
		uint256 _partialRedemptionHintNICR
	) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].redeemCollateralPrx(
			_asset,
			_VSTAmount,
			_firstRedemptionHint,
			_upperPartialRedemptionHint,
			_lowerPartialRedemptionHint,
			_partialRedemptionHintNICR,
			0,
			0
		);
	}

	// Borrower Operations

	function getAdjustedETH(
		uint256 actorBalance,
		uint256 _ETH,
		uint256 ratio
	) internal view returns (uint256) {
		uint256 price = priceFeedTestnet.getPrice();
		require(price > 0);
		uint256 minETH = ratio.mul(VST_GAS_COMPENSATION).div(price);
		require(actorBalance > minETH);
		uint256 ETH = minETH + (_ETH % (actorBalance - minETH));
		return ETH;
	}

	function getAdjustedVST(
		uint256 ETH,
		uint256 _VSTAmount,
		uint256 ratio
	) internal view returns (uint256) {
		uint256 price = priceFeedTestnet.getPrice();
		uint256 VSTAmount = _VSTAmount;
		uint256 compositeDebt = VSTAmount.add(VST_GAS_COMPENSATION);
		uint256 ICR = LiquityMath._computeCR(ETH, compositeDebt, price);
		if (ICR < ratio) {
			compositeDebt = ETH.mul(price).div(ratio);
			VSTAmount = compositeDebt.sub(VST_GAS_COMPENSATION);
		}
		return VSTAmount;
	}

	function openTroveExt(
		address _asset,
		uint256 _i,
		uint256 _ETH,
		uint256 _VSTAmount
	) public payable {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		EchidnaProxy echidnaProxy = echidnaProxies[actor];
		uint256 actorBalance = address(echidnaProxy).balance;

		// we pass in CCR instead of MCR in case it’s the first one
		uint256 ETH = getAdjustedETH(actorBalance, _ETH, CCR);
		uint256 VSTAmount = getAdjustedVST(ETH, _VSTAmount, CCR);

		echidnaProxy.openTrovePrx(
			_asset,
			ETH,
			VSTAmount,
			address(0),
			address(0),
			0
		);

		numberOfTroves = troveManager.getTroveOwnersCount(_asset);
		assert(numberOfTroves > 0);
		// canary
		//assert(numberOfTroves == 0);
	}

	function openTroveRawExt(
		address _asset,
		uint256 _i,
		uint256 _ETH,
		uint256 _VSTAmount,
		address _upperHint,
		address _lowerHint,
		uint256 _maxFee
	) public payable {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].openTrovePrx(
			_asset,
			_ETH,
			_VSTAmount,
			_upperHint,
			_lowerHint,
			_maxFee
		);
	}

	function addCollExt(
		address _asset,
		uint256 _i,
		uint256 _ETH
	) external payable {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		EchidnaProxy echidnaProxy = echidnaProxies[actor];
		uint256 actorBalance = address(echidnaProxy).balance;

		uint256 ETH = getAdjustedETH(actorBalance, _ETH, MCR);

		echidnaProxy.addCollPrx(_asset, ETH, address(0), address(0));
	}

	function addCollRawExt(
		address _asset,
		uint256 _i,
		uint256 _ETH,
		address _upperHint,
		address _lowerHint
	) external payable {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].addCollPrx(_asset, _ETH, _upperHint, _lowerHint);
	}

	function withdrawCollExt(
		address _asset,
		uint256 _i,
		uint256 _amount,
		address _upperHint,
		address _lowerHint
	) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].withdrawCollPrx(
			_asset,
			_amount,
			_upperHint,
			_lowerHint
		);
	}

	function withdrawVSTExt(
		address _asset,
		uint256 _i,
		uint256 _amount,
		address _upperHint,
		address _lowerHint,
		uint256 _maxFee
	) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].withdrawVSTPrx(
			_asset,
			_amount,
			_upperHint,
			_lowerHint,
			_maxFee
		);
	}

	function repayVSTExt(
		address _asset,
		uint256 _i,
		uint256 _amount,
		address _upperHint,
		address _lowerHint
	) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].repayVSTPrx(
			_asset,
			_amount,
			_upperHint,
			_lowerHint
		);
	}

	function closeTroveExt(address _asset, uint256 _i) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].closeTrovePrx(_asset);
	}

	function adjustTroveExt(
		address _asset,
		uint256 _i,
		uint256 _ETH,
		uint256 _collWithdrawal,
		uint256 _debtChange,
		bool _isDebtIncrease
	) external payable {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		EchidnaProxy echidnaProxy = echidnaProxies[actor];
		uint256 actorBalance = address(echidnaProxy).balance;

		uint256 ETH = getAdjustedETH(actorBalance, _ETH, MCR);
		uint256 debtChange = _debtChange;
		if (_isDebtIncrease) {
			// TODO: add current amount already withdrawn:
			debtChange = getAdjustedVST(ETH, uint256(_debtChange), MCR);
		}
		// TODO: collWithdrawal, debtChange
		echidnaProxy.adjustTrovePrx(
			_asset,
			ETH,
			_collWithdrawal,
			debtChange,
			_isDebtIncrease,
			address(0),
			address(0),
			0
		);
	}

	function adjustTroveRawExt(
		address _asset,
		uint256 _i,
		uint256 _ETH,
		uint256 _collWithdrawal,
		uint256 _debtChange,
		bool _isDebtIncrease,
		address _upperHint,
		address _lowerHint,
		uint256 _maxFee
	) external payable {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].adjustTrovePrx(
			_asset,
			_ETH,
			_collWithdrawal,
			_debtChange,
			_isDebtIncrease,
			_upperHint,
			_lowerHint,
			_maxFee
		);
	}

	// Pool Manager

	function provideToSPExt(
		uint256 _i,
		uint256 _amount,
		address _frontEndTag
	) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].provideToSPPrx(_amount);
	}

	function withdrawFromSPExt(uint256 _i, uint256 _amount) external {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		echidnaProxies[actor].withdrawFromSPPrx(_amount);
	}

	// VST Token

	function transferExt(
		uint256 _i,
		address recipient,
		uint256 amount
	) external returns (bool) {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		return echidnaProxies[actor].transferPrx(recipient, amount);
	}

	function approveExt(
		uint256 _i,
		address spender,
		uint256 amount
	) external returns (bool) {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		return echidnaProxies[actor].approvePrx(spender, amount);
	}

	function transferFromExt(
		uint256 _i,
		address sender,
		address recipient,
		uint256 amount
	) external returns (bool) {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		return
			echidnaProxies[actor].transferFromPrx(sender, recipient, amount);
	}

	function increaseAllowanceExt(
		uint256 _i,
		address spender,
		uint256 addedValue
	) external returns (bool) {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		return echidnaProxies[actor].increaseAllowancePrx(spender, addedValue);
	}

	function decreaseAllowanceExt(
		uint256 _i,
		address spender,
		uint256 subtractedValue
	) external returns (bool) {
		uint256 actor = _i % NUMBER_OF_ACTORS;
		return
			echidnaProxies[actor].decreaseAllowancePrx(spender, subtractedValue);
	}

	// PriceFeed

	function setPriceExt(uint256 _price) external {
		bool result = priceFeedTestnet.setPrice(_price);
		assert(result);
	}

	// --------------------------
	// Invariants and properties
	// --------------------------

	function echidna_canary_number_of_troves() public view returns (bool) {
		if (numberOfTroves > 20) {
			return false;
		}

		return true;
	}

	function echidna_canary_active_pool_balance()
		public
		view
		returns (bool)
	{
		if (address(activePool).balance > 0) {
			return false;
		}
		return true;
	}

	function echidna_troves_order(address _asset)
		external
		view
		returns (bool)
	{
		address currentTrove = sortedTroves.getFirst(_asset);
		address nextTrove = sortedTroves.getNext(_asset, currentTrove);

		while (currentTrove != address(0) && nextTrove != address(0)) {
			if (
				troveManager.getNominalICR(_asset, nextTrove) >
				troveManager.getNominalICR(_asset, currentTrove)
			) {
				return false;
			}
			// Uncomment to check that the condition is meaningful
			//else return false;

			currentTrove = nextTrove;
			nextTrove = sortedTroves.getNext(_asset, currentTrove);
		}

		return true;
	}

	/**
	 * Status
	 * Minimum debt (gas compensation)
	 * Stake > 0
	 */
	function echidna_trove_properties(address _asset)
		public
		view
		returns (bool)
	{
		address currentTrove = sortedTroves.getFirst(_asset);
		while (currentTrove != address(0)) {
			// Status
			if (
				ITroveManager.Status(
					troveManager.getTroveStatus(_asset, currentTrove)
				) != ITroveManager.Status.active
			) {
				return false;
			}
			// Uncomment to check that the condition is meaningful
			//else return false;

			// Minimum debt (gas compensation)
			if (
				troveManager.getTroveDebt(_asset, currentTrove) <
				VST_GAS_COMPENSATION
			) {
				return false;
			}
			// Uncomment to check that the condition is meaningful
			//else return false;

			// Stake > 0
			if (troveManager.getTroveStake(_asset, currentTrove) == 0) {
				return false;
			}
			// Uncomment to check that the condition is meaningful
			//else return false;

			currentTrove = sortedTroves.getNext(_asset, currentTrove);
		}
		return true;
	}

	function echidna_ETH_balances(address _asset)
		public
		view
		returns (bool)
	{
		if (address(troveManager).balance > 0) {
			return false;
		}

		if (address(borrowerOperations).balance > 0) {
			return false;
		}

		if (
			address(activePool).balance != activePool.getAssetBalance(_asset)
		) {
			return false;
		}

		if (
			address(defaultPool).balance != defaultPool.getAssetBalance(_asset)
		) {
			return false;
		}

		if (
			address(stabilityPool).balance != stabilityPool.getAssetBalance()
		) {
			return false;
		}

		if (address(vstToken).balance > 0) {
			return false;
		}

		if (address(priceFeedTestnet).balance > 0) {
			return false;
		}

		if (address(sortedTroves).balance > 0) {
			return false;
		}

		return true;
	}

	// TODO: What should we do with this? Should it be allowed? Should it be a canary?
	function echidna_price() public view returns (bool) {
		uint256 price = priceFeedTestnet.getPrice();

		if (price == 0) {
			return false;
		}
		// Uncomment to check that the condition is meaningful
		//else return false;

		return true;
	}

	// Total VST matches
	function echidna_VST_global_balances(address _asset)
		public
		view
		returns (bool)
	{
		uint256 totalSupply = vstToken.totalSupply();
		uint256 gasPoolBalance = vstToken.balanceOf(address(gasPool));

		uint256 activePoolBalance = activePool.getVSTDebt(_asset);
		uint256 defaultPoolBalance = defaultPool.getVSTDebt(_asset);
		if (totalSupply != activePoolBalance + defaultPoolBalance) {
			return false;
		}

		uint256 stabilityPoolBalance = stabilityPool.getTotalVSTDeposits();
		address currentTrove = sortedTroves.getFirst(_asset);
		uint256 trovesBalance;
		while (currentTrove != address(0)) {
			trovesBalance += vstToken.balanceOf(address(currentTrove));
			currentTrove = sortedTroves.getNext(_asset, currentTrove);
		}
		// we cannot state equality because tranfers are made to external addresses too
		if (
			totalSupply <= stabilityPoolBalance + trovesBalance + gasPoolBalance
		) {
			return false;
		}

		return true;
	}

	/*
    function echidna_test() public view returns(bool) {
        return true;
    }
    */
}
