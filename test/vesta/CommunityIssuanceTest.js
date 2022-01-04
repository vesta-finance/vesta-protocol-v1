const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('CommunityIssuance', async accounts => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const assertRevert = th.assertRevert
  const DECIMAL_PRECISION = toBN(dec(1, 18))
  const [owner, user, A, C, B, multisig, treasury] = accounts;
  const timeValues = testHelpers.TimeValues

  let communityIssuance
  let stabilityPool
  let stabilityPoolERC20
  let vstaToken

  describe("Community Issuance", async () => {
    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.troveManager = await TroveManagerTester.new()
      const VSTAContracts = await deploymentHelper.deployVSTAContractsHardhat(treasury)

      vstaToken = VSTAContracts.vstaToken
      communityIssuance = VSTAContracts.communityIssuance
      stabilityPool = contracts.stabilityPool
      stabilityPoolERC20 = contracts.stabilityPoolERC20

      await deploymentHelper.connectCoreContracts(contracts, VSTAContracts)
      await deploymentHelper.connectVSTAContractsToCore(VSTAContracts, contracts, treasury, true)
    })

    it("Owner(): Contract has been initialized, owner should be the treasury", async () => {
      assert.equal(await communityIssuance.owner(), treasury)
    })

    it("addFundToStabilityPool: Called by owner, invalid SP then invalid supply, revert transaction", async () => {
      const balance = await vstaToken.balanceOf(treasury);

      await assertRevert(communityIssuance.addFundToStabilityPool(communityIssuance.address, dec(100, 18), { from: treasury }))
      await assertRevert(communityIssuance.addFundToStabilityPool(stabilityPool.address, balance.add(toBN(1)), { from: treasury }))
    })

    it("addFundToStabilityPool: Called by user, valid inputs, revert transaction", async () => {
      await communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18), { from: treasury })
      await assertRevert(communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18), { from: user }))
    })

    it("addFundToStabilityPool: Called by deployer, valid inputs, add stability pool", async () => {
      await vstaToken.unprotectedMint(owner, dec(200, 18))
      await vstaToken.approve(communityIssuance.address, dec(200, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18))
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, dec(100, 18))
      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPool.address)).toString(), dec(100, 18))
      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPoolERC20.address)).toString(), dec(100, 18))
    })

    it("addFundToStabilityPool: Called by owner, valid inputs, add stability pool", async () => {
      await communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18), { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, dec(100, 18), { from: treasury })
      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPool.address)).toString(), dec(100, 18))
      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPoolERC20.address)).toString(), dec(100, 18))
    })

    it("addFundToStabilityPool: Called by owner twice, double total supply, don't change deploy time", async () => {
      await communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18), { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, dec(100, 18), { from: treasury })

      const deployTimePool = await communityIssuance.deploymentTime(stabilityPool.address);
      const deployTimePoolERC20 = await communityIssuance.deploymentTime(stabilityPoolERC20.address);

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18), { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, dec(100, 18), { from: treasury })

      const deployTimePoolAfter = await communityIssuance.deploymentTime(stabilityPool.address);
      const deployTimePoolAfterERC20 = await communityIssuance.deploymentTime(stabilityPoolERC20.address);

      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPool.address)).toString(), dec(200, 18))
      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPoolERC20.address)).toString(), dec(200, 18))
      assert.equal(deployTimePool.toString(), deployTimePoolAfter.toString())
      assert.equal(deployTimePoolERC20.toString(), deployTimePoolAfterERC20.toString())
    })

    it("addFundToStabilityPool: Called by owner, valid inputs, change total supply", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPool.address)).toString(), supply.mul(toBN(2)))
      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPoolERC20.address)).toString(), supply)
    })

    it("transferFunToAnotherStabilityPool: Called by user, valid inputs, revert transaction", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      await assertRevert(communityIssuance.transferFunToAnotherStabilityPool(stabilityPool.address, stabilityPoolERC20.address, dec(50, 18), { from: user }))
    })

    it("transferFunToAnotherStabilityPool: Called by owner, invalid target then invalid receiver, revert transaction", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      await assertRevert(communityIssuance.transferFunToAnotherStabilityPool(communityIssuance.address, stabilityPoolERC20.address, dec(50, 18), { from: treasury }))
      await assertRevert(communityIssuance.transferFunToAnotherStabilityPool(stabilityPool.address, communityIssuance.address, dec(50, 18), { from: treasury }))
    })

    it("transferFunToAnotherStabilityPool: Called by owner, valid pools, quantity over cap, revert transaction", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      await assertRevert(communityIssuance.transferFunToAnotherStabilityPool(stabilityPool.address, stabilityPoolERC20.address, supply.add(toBN(1)), { from: treasury }))
    })

    it("transferFunToAnotherStabilityPool: Called by owner, valid pools, issuedVSTA, transfer over caps, revert transaction", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)
      await communityIssuance.unprotectedIssueVSTA(stabilityPool.address)

      const issued = await communityIssuance.totalVSTAIssued(stabilityPool.address);
      const gapsOverByOne = supply.sub(issued).add(toBN(1))

      await assertRevert(communityIssuance.transferFunToAnotherStabilityPool(stabilityPool.address, stabilityPoolERC20.address, gapsOverByOne, { from: treasury }))
    })

    it("transferFunToAnotherStabilityPool: Called by owner, valid inputs, 50% balance, transfer VSTA", async () => {
      const supply = toBN(dec(100, 18))
      const supplyTransfered = supply.div(toBN(2))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      await communityIssuance.transferFunToAnotherStabilityPool(stabilityPool.address, stabilityPoolERC20.address, supplyTransfered, { from: treasury })

      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPool.address)).toString(), supplyTransfered)
      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPoolERC20.address)).toString(), supply.add(supplyTransfered))
    })

    it("transferFunToAnotherStabilityPool: Called by owner, valid inputs, 100% balance, transfer VSTA and close pool", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)
      await communityIssuance.unprotectedIssueVSTA(stabilityPool.address)

      const issued = await communityIssuance.totalVSTAIssued(stabilityPool.address);
      const lefOver = supply.sub(issued)

      await communityIssuance.transferFunToAnotherStabilityPool(stabilityPool.address, stabilityPoolERC20.address, lefOver, { from: treasury })

      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPool.address)).toString(), 0)
      assert.equal((await communityIssuance.deploymentTime(stabilityPool.address)).toString(), 0)
      assert.equal((await communityIssuance.totalVSTAIssued(stabilityPool.address)).toString(), 0)
      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPoolERC20.address)).toString(), supply.add(lefOver))
    })


    it("transferFunToAnotherStabilityPool: Called by owner, valid inputs, issued VSTA, 100% left over, transfer VSTA and close pool", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      await communityIssuance.transferFunToAnotherStabilityPool(stabilityPool.address, stabilityPoolERC20.address, supply, { from: treasury })

      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPool.address)).toString(), 0)
      assert.equal((await communityIssuance.deploymentTime(stabilityPool.address)).toString(), 0)
      assert.equal((await communityIssuance.totalVSTAIssued(stabilityPool.address)).toString(), 0)

      assert.equal((await communityIssuance.VSTASupplyCaps(stabilityPoolERC20.address)).toString(), supply.add(supply))
    })
  })
})
