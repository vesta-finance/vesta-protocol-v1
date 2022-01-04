const SortedTroves = artifacts.require("./SortedTroves.sol")
const TroveManager = artifacts.require("./TroveManager.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
const VSTToken = artifacts.require("./VSTToken.sol")
const ActivePool = artifacts.require("./ActivePool.sol");
const DefaultPool = artifacts.require("./DefaultPool.sol");
const StabilityPool = artifacts.require("./StabilityPool.sol")
const StabilityPoolManager = artifacts.require("./StabilityPoolManager.sol")
const GasPool = artifacts.require("./GasPool.sol")
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol")
const FunctionCaller = artifacts.require("./TestContracts/FunctionCaller.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")
const HintHelpers = artifacts.require("./HintHelpers.sol")
const VestaParameters = artifacts.require("./VestaParameters.sol")
const LockedVSTA = artifacts.require("./LockedVSTA.sol")

const VSTAStaking = artifacts.require("./VSTAStaking.sol")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")

const Unipool = artifacts.require("./Unipool.sol")

const VSTATokenTester = artifacts.require("./VSTATokenTester.sol")
const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol")
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol")
const ActivePoolTester = artifacts.require("./ActivePoolTester.sol")
const DefaultPoolTester = artifacts.require("./DefaultPoolTester.sol")
const LiquityMathTester = artifacts.require("./LiquityMathTester.sol")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const VSTTokenTester = artifacts.require("./VSTTokenTester.sol")
const ERC20Test = artifacts.require("./ERC20Test.sol")

// Proxy scripts
const BorrowerOperationsScript = artifacts.require('BorrowerOperationsScript')
const BorrowerWrappersScript = artifacts.require('BorrowerWrappersScript')
const TroveManagerScript = artifacts.require('TroveManagerScript')
const StabilityPoolScript = artifacts.require('StabilityPoolScript')
const TokenScript = artifacts.require('TokenScript')
const VSTAStakingScript = artifacts.require('VSTAStakingScript')
const { messagePrefix } = require('@ethersproject/hash');
const {
  buildUserProxies,
  BorrowerOperationsProxy,
  BorrowerWrappersProxy,
  TroveManagerProxy,
  StabilityPoolProxy,
  SortedTrovesProxy,
  TokenProxy,
  VSTAStakingProxy
} = require('../utils/proxyHelpers.js')

/* "Liquity core" consists of all contracts in the core Liquity system.

VSTA contracts consist of only those contracts related to the VSTA Token:

-the VSTA token
-the Lockup factory and lockup contracts
-the VSTAStaking contract
-the CommunityIssuance contract 
*/

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const maxBytes32 = '0x' + 'f'.repeat(64)

class DeploymentHelper {

  static async deployLiquityCore() {
    return this.deployLiquityCoreHardhat()
  }

  static async deployLiquityCoreHardhat() {
    const priceFeedTestnet = await PriceFeedTestnet.new()
    const sortedTroves = await SortedTroves.new()
    const troveManager = await TroveManager.new()
    const activePool = await ActivePool.new()
    const stabilityPool = await StabilityPool.new()
    const stabilityPoolERC20 = await StabilityPool.new()
    const stabilityPoolManager = await StabilityPoolManager.new()
    const vestaParameters = await VestaParameters.new()
    const gasPool = await GasPool.new()
    const defaultPool = await DefaultPool.new()
    const collSurplusPool = await CollSurplusPool.new()
    const functionCaller = await FunctionCaller.new()
    const borrowerOperations = await BorrowerOperations.new()
    const hintHelpers = await HintHelpers.new()
    const vstToken = await VSTToken.new(
      troveManager.address,
      stabilityPoolManager.address,
      borrowerOperations.address,
      await troveManager.owner()
    )
    const erc20 = await ERC20Test.new()


    VSTToken.setAsDeployed(vstToken)
    DefaultPool.setAsDeployed(defaultPool)
    PriceFeedTestnet.setAsDeployed(priceFeedTestnet)
    SortedTroves.setAsDeployed(sortedTroves)
    TroveManager.setAsDeployed(troveManager)
    ActivePool.setAsDeployed(activePool)
    StabilityPool.setAsDeployed(stabilityPool)
    StabilityPool.setAsDeployed(stabilityPoolERC20)
    GasPool.setAsDeployed(gasPool)
    CollSurplusPool.setAsDeployed(collSurplusPool)
    FunctionCaller.setAsDeployed(functionCaller)
    BorrowerOperations.setAsDeployed(borrowerOperations)
    HintHelpers.setAsDeployed(hintHelpers)
    VestaParameters.setAsDeployed(vestaParameters);
    ERC20Test.setAsDeployed(erc20);

    const coreContracts = {
      priceFeedTestnet,
      vstToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPool,
      stabilityPoolERC20,
      stabilityPoolManager,
      vestaParameters,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers,
      erc20
    }
    return coreContracts
  }

  static async deployTesterContractsHardhat() {
    const testerContracts = {}

    // Contract without testers (yet)
    testerContracts.erc20 = await ERC20Test.new();
    testerContracts.priceFeedTestnet = await PriceFeedTestnet.new()
    testerContracts.sortedTroves = await SortedTroves.new()
    // Actual tester contracts
    testerContracts.communityIssuance = await CommunityIssuanceTester.new()
    testerContracts.activePool = await ActivePoolTester.new()
    testerContracts.defaultPool = await DefaultPoolTester.new()
    testerContracts.stabilityPool = await StabilityPoolTester.new()
    testerContracts.stabilityPoolERC20 = await StabilityPoolTester.new()
    testerContracts.stabilityPoolManager = await StabilityPoolManager.new()
    testerContracts.vestaParameters = await VestaParameters.new()
    testerContracts.gasPool = await GasPool.new()
    testerContracts.collSurplusPool = await CollSurplusPool.new()
    testerContracts.math = await LiquityMathTester.new()
    testerContracts.borrowerOperations = await BorrowerOperationsTester.new()
    testerContracts.troveManager = await TroveManagerTester.new()
    testerContracts.functionCaller = await FunctionCaller.new()
    testerContracts.hintHelpers = await HintHelpers.new()
    testerContracts.vstToken = await VSTTokenTester.new(
      testerContracts.troveManager.address,
      testerContracts.stabilityPoolManager.address,
      testerContracts.borrowerOperations.address
    )

    return testerContracts
  }

  static async deployVSTAContractsHardhat(treasury) {
    const vstaStaking = await VSTAStaking.new()
    const communityIssuance = await CommunityIssuanceTester.new()
    const lockedVSTA = await LockedVSTA.new();

    VSTAStaking.setAsDeployed(vstaStaking)
    CommunityIssuanceTester.setAsDeployed(communityIssuance)
    LockedVSTA.setAsDeployed(lockedVSTA)

    if (!treasury) {
      treasury = await communityIssuance.owner()
    }

    // Deploy VSTA Token, passing Community Issuance and Factory addresses to the constructor 
    const vstaToken = await VSTATokenTester.new(treasury)
    VSTATokenTester.setAsDeployed(vstaToken)

    const VSTAContracts = {
      vstaStaking,
      communityIssuance,
      vstaToken,
      lockedVSTA
    }
    return VSTAContracts
  }

  static async deployVSTToken(contracts) {
    contracts.vstToken = await VSTTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPoolManager.address,
      contracts.borrowerOperations.address,
    )
    return contracts
  }

  static async deployProxyScripts(contracts, VSTAContracts, owner, users) {
    const proxies = await buildUserProxies(users)

    const borrowerWrappersScript = await BorrowerWrappersScript.new(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      VSTAContracts.vstaStaking.address
    )
    contracts.borrowerWrappers = new BorrowerWrappersProxy(owner, proxies, borrowerWrappersScript.address)

    const borrowerOperationsScript = await BorrowerOperationsScript.new(contracts.borrowerOperations.address)
    contracts.borrowerOperations = new BorrowerOperationsProxy(owner, proxies, borrowerOperationsScript.address, contracts.borrowerOperations)

    const troveManagerScript = await TroveManagerScript.new(contracts.troveManager.address)
    contracts.troveManager = new TroveManagerProxy(owner, proxies, troveManagerScript.address, contracts.troveManager)

    const stabilityPoolScript = await StabilityPoolScript.new(contracts.stabilityPool.address)
    contracts.stabilityPool = new StabilityPoolProxy(owner, proxies, stabilityPoolScript.address, contracts.stabilityPool)

    contracts.sortedTroves = new SortedTrovesProxy(owner, proxies, contracts.sortedTroves)

    const vstTokenScript = await TokenScript.new(contracts.vstToken.address)
    contracts.vstToken = new TokenProxy(owner, proxies, vstTokenScript.address, contracts.vstToken)

    const vstaTokenScript = await TokenScript.new(VSTAContracts.vstaToken.address)
    VSTAContracts.vstaToken = new TokenProxy(owner, proxies, vstaTokenScript.address, VSTAContracts.vstaToken)

    const vstaStakingScript = await VSTAStakingScript.new(VSTAContracts.vstaStaking.address)
    VSTAContracts.vstaStaking = new VSTAStakingProxy(owner, proxies, vstaStakingScript.address, VSTAContracts.vstaStaking)
  }

  // Connect contracts to their dependencies
  static async connectCoreContracts(contracts, VSTAContracts) {

    // set TroveManager addr in SortedTroves
    await contracts.sortedTroves.setParams(
      contracts.troveManager.address,
      contracts.borrowerOperations.address
    )

    // set contract addresses in the FunctionCaller 
    await contracts.functionCaller.setTroveManagerAddress(contracts.troveManager.address)
    await contracts.functionCaller.setSortedTrovesAddress(contracts.sortedTroves.address)

    await contracts.vestaParameters.setAddresses(
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.priceFeedTestnet.address,
      await contracts.vestaParameters.owner(),
    )

    // set contracts in the Trove Manager
    await contracts.troveManager.setAddresses(
      contracts.borrowerOperations.address,
      contracts.stabilityPoolManager.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.vstToken.address,
      contracts.sortedTroves.address,
      VSTAContracts.vstaStaking.address,
      contracts.vestaParameters.address
    )

    // set contracts in BorrowerOperations 
    await contracts.borrowerOperations.setAddresses(
      contracts.troveManager.address,
      contracts.stabilityPoolManager.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.sortedTroves.address,
      contracts.vstToken.address,
      VSTAContracts.vstaStaking.address,
      contracts.vestaParameters.address
    )


    await contracts.stabilityPoolManager.setAddresses(
      contracts.stabilityPool.address,
      contracts.stabilityPoolERC20.address,
      contracts.erc20.address,
    )

    await contracts.stabilityPoolManager.addStabilityPool(contracts.erc20.address, contracts.stabilityPoolERC20.address)


    // set contracts in the Pools
    await contracts.stabilityPool.setAddresses(
      ZERO_ADDRESS,
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.vstToken.address,
      contracts.sortedTroves.address,
      VSTAContracts.communityIssuance.address,
      contracts.vestaParameters.address
    )

    await contracts.stabilityPoolERC20.setAddresses(
      contracts.erc20.address,
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.vstToken.address,
      contracts.sortedTroves.address,
      VSTAContracts.communityIssuance.address,
      contracts.vestaParameters.address
    )


    await contracts.activePool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.stabilityPoolManager.address,
      contracts.defaultPool.address,
      contracts.collSurplusPool.address
    )

    await contracts.defaultPool.setAddresses(
      contracts.troveManager.address,
      contracts.activePool.address,
    )

    await contracts.collSurplusPool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address,
    )

    // set contracts in HintHelpers
    await contracts.hintHelpers.setAddresses(
      contracts.sortedTroves.address,
      contracts.troveManager.address,
      contracts.vestaParameters.address
    )
  }

  static async connectVSTAContractsToCore(VSTAContracts, coreContracts, treasurySig, communityIssuanceNoLinks = false) {
    if (!treasurySig) {
      treasurySig = await coreContracts.borrowerOperations.owner();
    }

    await VSTAContracts.vstaStaking.setAddresses(
      VSTAContracts.vstaToken.address,
      coreContracts.vstToken.address,
      coreContracts.troveManager.address,
      coreContracts.borrowerOperations.address,
      coreContracts.activePool.address
    )

    await VSTAContracts.communityIssuance.setAddresses(
      VSTAContracts.vstaToken.address,
      coreContracts.stabilityPoolManager.address,
      treasurySig
    )

    await VSTAContracts.lockedVSTA.setAddresses(
      VSTAContracts.vstaToken.address,
      treasurySig
    )

    await VSTAContracts.vstaToken.approve(VSTAContracts.communityIssuance.address, ethers.constants.MaxUint256, { from: treasurySig });

    if (communityIssuanceNoLinks)
      return;

    await VSTAContracts.communityIssuance.addFundToStabilityPool(coreContracts.stabilityPool.address, '32000000000000000000000000', { from: treasurySig });

    await VSTAContracts.vstaToken.unprotectedMint(treasurySig, '32000000000000000000000000')
    await VSTAContracts.communityIssuance.addFundToStabilityPool(coreContracts.stabilityPoolERC20.address, '32000000000000000000000000', { from: treasurySig });
  }

  static async connectUnipool(uniPool, VSTAContracts, uniswapPairAddr, duration) {
    await uniPool.setParams(VSTAContracts.vstaToken.address, uniswapPairAddr, duration)
  }
}
module.exports = DeploymentHelper
