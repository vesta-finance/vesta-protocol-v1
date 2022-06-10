const { assert } = require("hardhat")
const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const StabilityPool = artifacts.require("./StabilityPool.sol")
const VSTTokenTester = artifacts.require("./VSTTokenTester.sol")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('TroveManager', async accounts => {
  const BonusToSP_5_PERCENT = '50000000000000000'
  const ICR_103_PERCENT = '103000000000000000000'
  const ICR_107_PERCENT = '107000000000000000000'
  const ZERO_ADDRESS = th.ZERO_ADDRESS

  const [owner, alice, whale] = accounts;

  const multisig = accounts[999]

  let priceFeed
  let VSTToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let collSurplusPool
  let defaultPool
  let borrowerOperations
  let vestaParameters
  let hintHelpers
  let erc20

  let contracts

  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts.vstToken = await VSTTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPoolManager.address,
      contracts.borrowerOperations.address
    )
    const VSTAContracts = await deploymentHelper.deployVSTAContractsHardhat(accounts[0])

    priceFeed = contracts.priceFeedTestnet
    VSTToken = contracts.vstToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    defaultPool = contracts.defaultPool
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers
    vestaParameters = contracts.vestaParameters;

    vstaStaking = VSTAContracts.vstaStaking
    vstaToken = VSTAContracts.vstaToken
    communityIssuance = VSTAContracts.communityIssuance

    await vstaToken.unprotectedMint(multisig, dec(1, 24))

    erc20 = contracts.erc20;

    let index = 0;
    for (const acc of accounts) {
      await vstaToken.approve(vstaStaking.address, await web3.eth.getBalance(acc), { from: acc })
      await erc20.mint(acc, await web3.eth.getBalance(acc))
      index++;

      if (index >= 20)
        break;
    }

    await deploymentHelper.connectCoreContracts(contracts, VSTAContracts)
    await deploymentHelper.connectVSTAContractsToCore(VSTAContracts, contracts)

    stabilityPool = await StabilityPool.at(await contracts.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS))
  })

  it('liquidate(): when debt(2000) > SP(1000) and ICR(103%) <= 100 + BonusToSP(5%), send collateral to stability pool and Default Pool only', async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

    await stabilityPool.provideToSP(dec(1000, 18), { from: whale })

    let collAlice = await troveManager.getTroveColl(ZERO_ADDRESS, alice)
    let debtAlice = await troveManager.getTroveDebt(ZERO_ADDRESS, alice)

    // set BonusToSP to 5%
    await vestaParameters.setBonusToSP(ZERO_ADDRESS, BonusToSP_5_PERCENT)
    assert.equal((await vestaParameters.BonusToSP(ZERO_ADDRESS)).toString(), BonusToSP_5_PERCENT)

    // price drops to 1ETH = 103VST, reducing Alice's ICR below MCR(103%)
    await priceFeed.setPrice(ICR_103_PERCENT);

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // SP's debt < alice's debt
    let totalDebtSP = await stabilityPool.getTotalVSTDeposits()
    assert.isTrue((debtAlice).gt(totalDebtSP))

    let totalCollSP_Before = await stabilityPool.getAssetBalance()
    let totalCollDP_Before = await defaultPool.getAssetBalance(ZERO_ADDRESS)
    let collAliceSurplusPool_Before = await collSurplusPool.getCollateral(alice, ZERO_ADDRESS)

    let gasCompensation = await troveManager.getCollGasCompensation(ZERO_ADDRESS, collAlice)
    let collToLiquidate = collAlice.sub(gasCompensation)
    let expectedCollToSP = collToLiquidate.mul(totalDebtSP).div(debtAlice)
    let expectedCollToDP = collToLiquidate.sub(expectedCollToSP)

    // liquidate Trove
    await troveManager.liquidate(ZERO_ADDRESS, alice, { from: owner });

    let totalCollSP_After = await stabilityPool.getAssetBalance()
    let totalCollDP_After = await defaultPool.getAssetBalance(ZERO_ADDRESS)
    let collAliceSurplusPool_After = await collSurplusPool.getCollateral(alice, ZERO_ADDRESS)

    assert.equal(totalCollSP_After.sub(totalCollSP_Before).toString(), expectedCollToSP.toString())
    assert.equal(totalCollDP_After.sub(totalCollDP_Before).toString(), expectedCollToDP.toString())
    assert.equal(collAliceSurplusPool_After.toString(), collAliceSurplusPool_Before.toString())

    // check the Trove is successfully closed, and removed from sortedList
    const status = (await troveManager.Troves(alice, ZERO_ADDRESS))[th.TROVE_STATUS_INDEX]
    assert.equal(status, 3)  // status enum 3 corresponds to "Closed by liquidation"
    assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, alice))
  })

  it('liquidate(): when debt(2000) > SP(1000) and ICR(107%) > 100 + BonusToSP(5%), send collateral to surplus pool(for borrower) and stability pool', async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

    await stabilityPool.provideToSP(dec(1000, 18), { from: whale })

    let collAlice = await troveManager.getTroveColl(ZERO_ADDRESS, alice)
    let debtAlice = await troveManager.getTroveDebt(ZERO_ADDRESS, alice)

    // set BonusToSP to 5%
    await vestaParameters.setBonusToSP(ZERO_ADDRESS, BonusToSP_5_PERCENT)
    assert.equal((await vestaParameters.BonusToSP(ZERO_ADDRESS)).toString(), BonusToSP_5_PERCENT)

    // price drops to 1ETH:107VST, reducing Alice's ICR below MCR(107%)
    await priceFeed.setPrice(ICR_107_PERCENT);

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // SP's debt < alice's debt
    let totalDebtSP = await stabilityPool.getTotalVSTDeposits()
    assert.isTrue((debtAlice).gt(totalDebtSP))

    let price = await priceFeed.getPrice()
    let ICR = await troveManager.getCurrentICR(ZERO_ADDRESS, alice, price)
    let BonusToSP = await vestaParameters.BonusToSP(ZERO_ADDRESS);

    let totalCollSP_Before = await stabilityPool.getAssetBalance()
    let totalCollDP_Before = await defaultPool.getAssetBalance(ZERO_ADDRESS)
    let collAliceSurplusPool_Before = await collSurplusPool.getCollateral(ZERO_ADDRESS, alice)

    let gasCompensation = await troveManager.getCollGasCompensation(ZERO_ADDRESS, collAlice)
    let collToLiquidate = collAlice.sub(gasCompensation)
    let expectedCollToSurplusPool = collToLiquidate.mul(ICR.sub(toBN('1000000000000000000')).sub(BonusToSP)).div(ICR);
    let expectedCollToSP = collToLiquidate.sub(expectedCollToSurplusPool).mul(totalDebtSP).div(debtAlice)
    let expectedCollToDP = collToLiquidate.sub(expectedCollToSurplusPool).sub(expectedCollToSP)

    // liquidate Trove
    await troveManager.liquidate(ZERO_ADDRESS, alice, { from: owner });

    let totalCollSP_After = await stabilityPool.getAssetBalance()
    let totalCollDP_After = await defaultPool.getAssetBalance(ZERO_ADDRESS)
    let collAliceSurplusPool_After = await collSurplusPool.getCollateral(ZERO_ADDRESS, alice)

    assert.equal(totalCollSP_After.sub(totalCollSP_Before).toString(), expectedCollToSP.toString())
    assert.equal(totalCollDP_After.sub(totalCollDP_Before).toString(), expectedCollToDP.toString())
    assert.equal(collAliceSurplusPool_After.sub(collAliceSurplusPool_Before).toString(), expectedCollToSurplusPool.toString())

    // check the Trove is successfully closed, and removed from sortedList
    const status = (await troveManager.Troves(alice, ZERO_ADDRESS))[th.TROVE_STATUS_INDEX]
    assert.equal(status, 3)  // status enum 3 corresponds to "Closed by liquidation"
    assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, alice))
  })

  it('liquidate(): when debt(2000) <= SP(3000), any ICR(107%) and BonusToSP(5%), send nothing to default pool because debts in SP is enough to cover vault debt', async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraVSTAmount: dec(1, 24), extraParams: { from: whale } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

    await stabilityPool.provideToSP(dec(3000, 18), { from: whale })

    // set BonusToSP to 5%
    await vestaParameters.setBonusToSP(ZERO_ADDRESS, BonusToSP_5_PERCENT)
    assert.equal((await vestaParameters.BonusToSP(ZERO_ADDRESS)).toString(), BonusToSP_5_PERCENT)

    // price drops to 1ETH:107VST, reducing Alice's ICR below MCR(107%)
    await priceFeed.setPrice(ICR_107_PERCENT);

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts))

    let totalCollDP_Before = await defaultPool.getAssetBalance(ZERO_ADDRESS)

    // liquidate Trove
    await troveManager.liquidate(ZERO_ADDRESS, alice, { from: owner });

    let totalCollDP_After = await defaultPool.getAssetBalance(ZERO_ADDRESS)

    assert.equal(totalCollDP_After.toString(), totalCollDP_Before.toString())

    // check the Trove is successfully closed, and removed from sortedList
    const status = (await troveManager.Troves(alice, ZERO_ADDRESS))[th.TROVE_STATUS_INDEX]
    assert.equal(status, 3)  // status enum 3 corresponds to "Closed by liquidation"
    assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, alice))
  })
})
