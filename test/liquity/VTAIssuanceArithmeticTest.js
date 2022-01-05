const Decimal = require("decimal.js");
const deploymentHelper = require("../../utils/deploymentHelpers.js")
const { BNConverter } = require("../../utils/BNConverter.js")
const testHelpers = require("../../utils/testHelpers.js")
const StabilityPool = artifacts.require("./StabilityPool.sol")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec


const logVSTABalanceAndError = (VSTABalance_A, expectedVSTABalance_A) => {
  console.log(
    `Expected final balance: ${expectedVSTABalance_A}, \n
    Actual final balance: ${VSTABalance_A}, \n
    Abs. error: ${expectedVSTABalance_A.sub(VSTABalance_A)}`
  )
}

const repeatedlyIssueVSTA = async (stabilityPool, timeBetweenIssuances, duration) => {
  const startTimestamp = th.toBN(await th.getLatestBlockTimestamp(web3))
  let timePassed = 0

  // while current time < 1 month from deployment, issue VSTA every minute
  while (timePassed < duration) {
    // console.log(`timePassed: ${timePassed}`)
    await th.fastForwardTime(timeBetweenIssuances, web3.currentProvider)
    await stabilityPool._unprotectedTriggerVSTAIssuance()

    const currentTimestamp = th.toBN(await th.getLatestBlockTimestamp(web3))
    timePassed = currentTimestamp.sub(startTimestamp)
  }
}


contract('VSTA community issuance arithmetic tests', async accounts => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS
  let contracts
  let borrowerOperations
  let communityIssuanceTester
  let VSTAToken
  let stabilityPool
  let stabilityPoolERC20
  let erc20

  const [owner, alice, frontEnd_1] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  before(async () => {

  })

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    const VSTAContracts = await deploymentHelper.deployVSTAContractsHardhat(accounts[0])
    contracts = await deploymentHelper.deployVSTToken(contracts)

    borrowerOperations = contracts.borrowerOperations
    erc20 = contracts.erc20

    VSTAToken = VSTAContracts.VSTAToken
    communityIssuanceTester = VSTAContracts.communityIssuance

    await deploymentHelper.connectCoreContracts(contracts, VSTAContracts)
    await deploymentHelper.connectVSTAContractsToCore(VSTAContracts, contracts)
    stabilityPool = await StabilityPool.at(await contracts.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS))
    stabilityPoolERC20 = await StabilityPool.at(await contracts.stabilityPoolManager.getAssetStabilityPool(erc20.address));
  })

  // Accuracy tests
  it("getCumulativeIssuanceFraction(): fraction doesn't increase if less than a minute has passed", async () => {
    // progress time 1 week 
    await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)

    const issuanceFractionBefore = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.isTrue(issuanceFractionBefore.gt(th.toBN('0')))
    console.log(`issuance fraction before: ${issuanceFractionBefore}`)

    const issuanceFractionBeforeERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.isTrue(issuanceFractionBeforeERC20.gt(th.toBN('0')))
    console.log(`issuance fraction before: ${issuanceFractionBeforeERC20}`)

    const blockTimestampBefore = th.toBN(await th.getLatestBlockTimestamp(web3))

    // progress time 10 seconds
    await th.fastForwardTime(10, web3.currentProvider)

    const issuanceFractionAfter = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const issuanceFractionAfterERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const blockTimestampAfter = th.toBN(await th.getLatestBlockTimestamp(web3))

    const timestampDiff = blockTimestampAfter.sub(blockTimestampBefore)
    // check blockTimestamp diff < 60s
    assert.isTrue(timestampDiff.lt(th.toBN(60)))

    console.log(`issuance fraction after: ${issuanceFractionBefore}`)
    console.log(`issuance fraction after: ${issuanceFractionBeforeERC20}`)
    assert.isTrue(issuanceFractionBefore.eq(issuanceFractionAfter))
    assert.isTrue(issuanceFractionBeforeERC20.eq(issuanceFractionAfterERC20))
  })

  /*--- Issuance tests for "Yearly halving" schedule.

  Total issuance year 1: 50%, year 2: 75%, year 3:   0.875, etc   
  
  Error tolerance: 1e-9
  
  ---*/

  // using the result of this to advance time by the desired amount from the deployment time, whether or not some extra time has passed in the meanwhile
  const getDuration = async (expectedDuration) => {
    const deploymentTimeETH = (await communityIssuanceTester.deploymentTime(stabilityPool.address)).toNumber()
    const deploymentTimeERC20 = (await communityIssuanceTester.deploymentTime(stabilityPoolERC20.address)).toNumber()
    const deploymentTime = Math.max(deploymentTimeETH, deploymentTimeERC20)
    const currentTime = await th.getLatestBlockTimestamp(web3)
    const duration = Math.max(expectedDuration - (currentTime - deploymentTime), 0)

    return duration
  }

  it("Cumulative issuance fraction is 0.0000013 after a minute", async () => {
    // console.log(`supply cap: ${await communityIssuanceTester.VSTASupplyCap()}`)

    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MINUTE, stabilityPool.address)

    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '1318772305025'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '1318772305025'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 100000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 100000000)
  })

  it("Cumulative issuance fraction is 0.000079 after an hour", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_HOUR)

    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '79123260066094'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '79123260066094'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.0019 after a day", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_DAY)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '1897231348441660'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '1897231348441660'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.013 after a week", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_WEEK)

    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '13205268780628400'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '13205268780628400'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.055 after a month", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH)

    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '55378538087966600'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '55378538087966600'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.16 after 3 months", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH * 3)

    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '157105100752037000'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '157105100752037000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.29 after 6 months", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH * 6)

    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = 289528188821766000

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = 289528188821766000

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.5 after a year", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR)

    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = dec(5, 17)

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
  })

  it("Cumulative issuance fraction is 0.75 after 2 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 2)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = dec(75, 16)

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = dec(75, 16)

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.875 after 3 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 3)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = dec(875, 15)

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = dec(875, 15)

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.9375 after 4 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 4)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '937500000000000000'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '937500000000000000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.999 after 10 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 10)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '999023437500000000'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '999023437500000000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.999999 after 20 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 20)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '999999046325684000'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '999999046325684000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  it("Cumulative issuance fraction is 0.999999999 after 30 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    assert.equal(initialIssuanceFraction, 0)

    const initialIssuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    assert.equal(initialIssuanceFractionERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 30)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPool.address)
    const expectedIssuanceFraction = '999999999068677000'

    const issuanceFractionERC20 = await communityIssuanceTester.getCumulativeIssuanceFraction(stabilityPoolERC20.address)
    const expectedIssuanceFractionERC20 = '999999999068677000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, expectedIssuanceFraction), 1000000000)
    assert.isAtMost(th.getDifference(issuanceFractionERC20, expectedIssuanceFractionERC20), 1000000000)
  })

  // --- Token issuance for yearly halving ---

  // Error tolerance: 1e-3, i.e. 1/1000th of a token

  it("Total VSTA tokens issued is 42.20 after a minute", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MINUTE)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '42200713760820460000'


    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '42200713760820460000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 2,531.94 after an hour", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_HOUR)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '2531944322115010000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '2531944322115010000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 60,711.40 after a day", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)


    const duration = await getDuration(timeValues.SECONDS_IN_ONE_DAY)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '60711403150133240000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '60711403150133240000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 422,568.60 after a week", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)


    const duration = await getDuration(timeValues.SECONDS_IN_ONE_WEEK)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '422568600980110200000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '422568600980110200000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 1,772,113.21 after a month", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '1772113218814930000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '1772113218814930000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 5,027,363.22 after 3 months", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH * 3)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '5027363224065180000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '5027363224065180000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 9,264,902.04 after 6 months", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH * 6)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '9264902042296516000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '9264902042296516000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 16,000,000 after a year", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '16000000000000000000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '16000000000000000000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 24,000,000 after 2 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 2)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '24000000000000000000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '24000000000000000000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 28,000,000 after 3 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 3)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '28000000000000000000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '28000000000000000000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 30,000,000 after 4 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 4)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '30000000000000000000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '30000000000000000000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 31,968,750 after 10 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 10)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '31968750000000000000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '31968750000000000000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 31,999,969.48 after 20 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 20)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '31999969482421880000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '31999969482421880000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  it("Total VSTA tokens issued is 31,999,999.97 after 30 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    assert.equal(initialIssuance, 0)

    const initialIssuanceERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    assert.equal(initialIssuanceERC20, 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 30)
    // Fast forward time
    await th.fastForwardTime(duration, web3.currentProvider)

    // Issue VSTA
    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPool.address)
    const totalVSTAIssued = await communityIssuanceTester.totalVSTAIssued(stabilityPool.address)
    const expectedTotalVSTAIssued = '31999999970197680000000000'

    await communityIssuanceTester.unprotectedIssueVSTA(stabilityPoolERC20.address)
    const totalVSTAIssuedERC20 = await communityIssuanceTester.totalVSTAIssued(stabilityPoolERC20.address)
    const expectedTotalVSTAIssuedERC20 = '31999999970197680000000000'

    const absError = th.toBN(expectedTotalVSTAIssued).sub(totalVSTAIssued)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    totalVSTAIssued: ${totalVSTAIssued},
    //    expectedTotalVSTAIssued: ${expectedTotalVSTAIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalVSTAIssued, expectedTotalVSTAIssued), 1000000000000000)
    assert.isAtMost(th.getDifference(totalVSTAIssuedERC20, expectedTotalVSTAIssuedERC20), 1000000000000000)
  })

  /* ---  
  Accumulated issuance error: how many tokens are lost over a given period, for a given issuance frequency? 
  
  Slow tests are skipped.
  --- */

  // TODO: Convert to 25mil issuance schedule
  it.skip("Frequent token issuance: issuance event every year, for 30 years", async () => {
    // Register front end with kickback rate = 100%
    await stabilityPool.registerFrontEnd(dec(1, 18), { from: frontEnd_1 })
    await stabilityPoolERC20.registerFrontEnd(dec(1, 18), { from: frontEnd_1 })

    // Alice opens trove and deposits to SP
    await borrowerOperations.openTrove(ZERO_ADDRESS, 0, th._100pct, dec(1, 18), alice, alice, { from: alice, value: dec(1, 'ether') })
    await stabilityPool.provideToSP(dec(1, 18), { from: alice })

    await borrowerOperations.openTrove(erc20.address, dec(1, 'ether'), th._100pct, dec(1, 18), alice, alice, { from: alice })
    await stabilityPoolERC20.provideToSP(dec(1, 18), { from: alice })

    assert.isTrue(await stabilityPool.isEligibleForVSTA(alice))
    assert.isTrue(await stabilityPoolERC20.isEligibleForVSTA(alice))

    const timeBetweenIssuances = timeValues.SECONDS_IN_ONE_YEAR
    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 30)

    await repeatedlyIssueVSTA(stabilityPool, timeBetweenIssuances, duration)
    await repeatedlyIssueVSTA(stabilityPoolERC20, timeBetweenIssuances, duration)

    // Depositor withdraws their deposit and accumulated VSTA
    await stabilityPool.withdrawFromSP(dec(1, 18), { from: alice })
    await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: alice })

    const VSTABalance_A = await VSTAToken.balanceOf(alice)
    const expectedVSTABalance_A = th.toBN('33333333302289200000000000').mul(toBN(2))
    const diff = expectedVSTABalance_A.sub(VSTABalance_A)

    // logVSTABalanceAndError(VSTABalance_A, expectedVSTABalance_A)

    // Check the actual balance differs by no more than 1e18 (i.e. 1 token) from the expected balance
    assert.isTrue(diff.lte(th.toBN(dec(1, 18))))
  })
  /*  Results:
  
  Expected final balance: 33333333302289200000000000,
  Actual final balance: 33333333302289247499999999,
  Abs. error: -47499999999 */


  // TODO: Convert to 25mil issuance schedule
  it.skip("Frequent token issuance: issuance event every day, for 30 years", async () => {
    // Register front end with kickback rate = 100%
    await stabilityPool.registerFrontEnd(dec(1, 18), { from: frontEnd_1 })
    await stabilityPoolERC20.registerFrontEnd(dec(1, 18), { from: frontEnd_1 })

    // Alice opens trove and deposits to SP
    await borrowerOperations.openTrove(ZERO_ADDRESS, 0, th._100pct, dec(1, 18), alice, alice, { from: alice, value: dec(1, 'ether') })
    await stabilityPool.provideToSP(dec(1, 18), { from: alice })

    await borrowerOperations.openTrove(erc20.address, dec(1, 'ether'), th._100pct, dec(1, 18), alice, alice, { from: alice })
    await stabilityPoolERC20.provideToSP(dec(1, 18), { from: alice })

    assert.isTrue(await stabilityPool.isEligibleForVSTA(alice))
    assert.isTrue(await stabilityPoolERC20.isEligibleForVSTA(alice))

    const timeBetweenIssuances = timeValues.SECONDS_IN_ONE_DAY
    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 30)

    await repeatedlyIssueVSTA(stabilityPool, timeBetweenIssuances, duration)
    await repeatedlyIssueVSTA(stabilityPoolERC20, timeBetweenIssuances, duration)

    // Depositor withdraws their deposit and accumulated VSTA
    await stabilityPool.withdrawFromSP(dec(1, 18), { from: alice })
    await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: alice })

    const VSTABalance_A = await VSTAToken.balanceOf(alice)
    const expectedVSTABalance_A = th.toBN('33333333302289200000000000').mul(toBN(2))
    const diff = expectedVSTABalance_A.sub(VSTABalance_A)

    // logVSTABalanceAndError(VSTABalance_A, expectedVSTABalance_A)

    // Check the actual balance differs by no more than 1e18 (i.e. 1 token) from the expected balance
    assert.isTrue(diff.lte(th.toBN(dec(1, 18))))
  })
  /* Results:

  Expected final balance: 33333333302289200000000000,
  Actual final balance: 33333333302297188866666666,
  Abs. error: -7988866666666  */

  // TODO: Convert to 25mil issuance schedule
  it.skip("Frequent token issuance: issuance event every minute, for 1 month", async () => {
    // Register front end with kickback rate = 100%
    await stabilityPool.registerFrontEnd(dec(1, 18), { from: frontEnd_1 })
    await stabilityPoolERC20.registerFrontEnd(dec(1, 18), { from: frontEnd_1 })

    // Alice opens trove and deposits to SP
    await borrowerOperations.openTrove(ZERO_ADDRESS, 0, th._100pct, dec(1, 18), alice, alice, { from: alice, value: dec(1, 'ether') })
    await stabilityPool.provideToSP(dec(1, 18), { from: alice })

    await borrowerOperations.openTrove(erc20.address, dec(1, 'ether'), th._100pct, dec(1, 18), alice, alice, { from: alice })
    await stabilityPoolERC20.provideToSP(dec(1, 18), { from: alice })

    assert.isTrue(await stabilityPool.isEligibleForVSTA(alice))
    assert.isTrue(await stabilityPoolERC20.isEligibleForVSTA(alice))

    const timeBetweenIssuances = timeValues.SECONDS_IN_ONE_MINUTE
    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH, stabilityPool.address)

    await repeatedlyIssueVSTA(stabilityPool, timeBetweenIssuances, duration)
    await repeatedlyIssueVSTA(stabilityPoolERC20, timeBetweenIssuances, duration)

    // Depositor withdraws their deposit and accumulated VSTA
    await stabilityPool.withdrawFromSP(dec(1, 18), { from: alice })
    await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: alice })

    const VSTABalance_A = await VSTAToken.balanceOf(alice)
    const expectedVSTABalance_A = th.toBN('1845951269598880000000000').mul(toBN(2))
    const diff = expectedVSTABalance_A.sub(VSTABalance_A)

    // logVSTABalanceAndError(VSTABalance_A, expectedVSTABalance_A)

    // Check the actual balance differs by no more than 1e18 (i.e. 1 token) from the expected balance
    assert.isTrue(diff.lte(th.toBN(dec(1, 18))))
  })
  /* Results:

  Expected final balance: 1845951269598880000000000,
  Actual final balance: 1845951269564420199999999,
  Abs. error: 34459800000001
  */

  // TODO: Convert to 25mil issuance schedule
  it.skip("Frequent token issuance: issuance event every minute, for 1 year", async () => {
    // Register front end with kickback rate = 100%
    await stabilityPool.registerFrontEnd(dec(1, 18), { from: frontEnd_1 })
    await stabilityPoolERC20.registerFrontEnd(dec(1, 18), { from: frontEnd_1 })

    // Alice opens trove and deposits to SP
    await borrowerOperations.openTrove(ZERO_ADDRESS, 0, th._100pct, dec(1, 18), alice, alice, { from: alice, value: dec(1, 'ether') })
    await stabilityPool.provideToSP(dec(1, 18), { from: alice })

    await borrowerOperations.openTrove(erc20.address, dec(1, 'ether'), th._100pct, dec(1, 18), alice, alice, { from: alice })
    await stabilityPoolERC20.provideToSP(dec(1, 18), { from: alice })

    assert.isTrue(await stabilityPool.isEligibleForVSTA(alice))
    assert.isTrue(await stabilityPoolERC20.isEligibleForVSTA(alice))

    const timeBetweenIssuances = timeValues.SECONDS_IN_ONE_MINUTE
    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR, stabilityPool.address)

    await repeatedlyIssueVSTA(stabilityPool, timeBetweenIssuances, duration)
    await repeatedlyIssueVSTA(stabilityPoolERC20, timeBetweenIssuances, duration)

    // Depositor withdraws their deposit and accumulated VSTA
    await stabilityPool.withdrawFromSP(dec(1, 18), { from: alice })
    await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: alice })

    const VSTABalance_A = await VSTAToken.balanceOf(alice)
    const expectedVSTABalance_A = th.toBN('1845951269598880000000000').mul(toBN(2))
    const diff = expectedVSTABalance_A.sub(VSTABalance_A)

    // logVSTABalanceAndError(VSTABalance_A, expectedVSTABalance_A)

    // Check the actual balance differs by no more than 1e18 (i.e. 1 token) from the expected balance
    assert.isTrue(diff.lte(th.toBN(dec(1, 18))))
  })
})
