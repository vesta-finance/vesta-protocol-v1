const { assert } = require("hardhat")
const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const StabilityPool = artifacts.require('StabilityPool.sol')

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('CommunityIssuance', async accounts => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const assertRevert = th.assertRevert
  const DECIMAL_PRECISION = toBN(dec(1, 18))
  const [owner, user, A, C, B, multisig, treasury] = accounts;
  const timeValues = testHelpers.TimeValues

  const INDEX_REWARD_TOKEN = 0;
  const INDEX_TOTAL_REWARD_ISSUED = 1;
  const INDEX_LAST_UPDATE_TIME = 2;
  const INDEX_TOTAL_REWARD_SUPPLY = 3;
  const INDEX_REWARD_DISTRIBUTION = 4;

  let communityIssuance
  let stabilityPool
  let stabilityPoolERC20
  let vstaToken
  let erc20

  describe("Community Issuance", async () => {
    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.troveManager = await TroveManagerTester.new()
      const VSTAContracts = await deploymentHelper.deployVSTAContractsHardhat(treasury)

      vstaToken = VSTAContracts.vstaToken
      communityIssuance = VSTAContracts.communityIssuance
      erc20 = contracts.erc20;

      await deploymentHelper.connectCoreContracts(contracts, VSTAContracts)
      await deploymentHelper.connectVSTAContractsToCore(VSTAContracts, contracts, true)

      await contracts.adminContract.addNewCollateral(ZERO_ADDRESS, contracts.stabilityPoolTemplate.address, ZERO_ADDRESS, ZERO_ADDRESS, '0', 0, 0)
      await contracts.adminContract.addNewCollateral(erc20.address, contracts.stabilityPoolTemplate.address, ZERO_ADDRESS, ZERO_ADDRESS, '0', 0, 0)

      stabilityPool = await StabilityPool.at(await contracts.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS))
      stabilityPoolERC20 = await StabilityPool.at(await contracts.stabilityPoolManager.getAssetStabilityPool(erc20.address));

      await communityIssuance.configStabilityPool(stabilityPool.address, vstaToken.address, 0);
      await communityIssuance.configStabilityPool(stabilityPoolERC20.address, vstaToken.address, 0);

      await communityIssuance.transferOwnership(treasury);
      await VSTAContracts.vstaToken.approve(VSTAContracts.communityIssuance.address, ethers.constants.MaxUint256, { from: treasury });
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

    it("addFundToStabilityPool: Called by owner, valid inputs, add stability pool", async () => {
      await communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18), { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, dec(100, 18), { from: treasury })

      const distribution = await communityIssuance.stabilityPoolRewards(stabilityPool.address);
      const distributionERC20 = await communityIssuance.stabilityPoolRewards(stabilityPoolERC20.address);

      assert.equal(distribution[INDEX_TOTAL_REWARD_SUPPLY].toString(), dec(100, 18))
      assert.equal(distributionERC20[INDEX_TOTAL_REWARD_SUPPLY].toString(), dec(100, 18))
    })

    it("addFundToStabilityPool: Called by owner twice, double total supply, don't change deploy time", async () => {
      await communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18), { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, dec(100, 18), { from: treasury })

      const deployTimePool = await communityIssuance.lastUpdateTime(stabilityPool.address);
      const deployTimePoolERC20 = await communityIssuance.lastUpdateTime(stabilityPoolERC20.address);

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, dec(100, 18), { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, dec(100, 18), { from: treasury })

      const deployTimePoolAfter = await communityIssuance.lastUpdateTime(stabilityPool.address);
      const deployTimePoolAfterERC20 = await communityIssuance.lastUpdateTime(stabilityPoolERC20.address);

      const distribution = await communityIssuance.stabilityPoolRewards(stabilityPool.address);
      const distributionERC20 = await communityIssuance.stabilityPoolRewards(stabilityPoolERC20.address);

      assert.equal(distribution[INDEX_TOTAL_REWARD_SUPPLY].toString(), dec(200, 18))
      assert.equal(distributionERC20[INDEX_TOTAL_REWARD_SUPPLY].toString(), dec(200, 18))
      assert.equal(deployTimePool.toString(), deployTimePoolAfter.toString())
      assert.equal(deployTimePoolERC20.toString(), deployTimePoolAfterERC20.toString())
    })

    it("addFundToStabilityPool: Called by owner, valid inputs, change total supply", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.addFundToStabilityPool(stabilityPoolERC20.address, supply, { from: treasury })

      const distribution = await communityIssuance.stabilityPoolRewards(stabilityPool.address);
      const distributionERC20 = await communityIssuance.stabilityPoolRewards(stabilityPoolERC20.address);

      assert.equal(distribution[INDEX_TOTAL_REWARD_SUPPLY].toString(), supply.mul(toBN(2)))
      assert.equal(distributionERC20[INDEX_TOTAL_REWARD_SUPPLY].toString(), supply)
    })

    it("removeFundFromStabilityPool: Called by user, valid inputs, then reverts", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await assertRevert(communityIssuance.removeFundFromStabilityPool(stabilityPool.address, dec(50, 18), { from: user }))
    })


    it("removeFundFromStabilityPool: Called by owner, invalid inputs, then reverts", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await assertRevert(communityIssuance.removeFundFromStabilityPool(stabilityPool.address, dec(101, 18), { from: treasury }))
    })

    it("removeFundFromStabilityPool: Called by owner, valid amount, then remove from supply and give to caller", async () => {
      const supply = toBN(dec(100, 18))
      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })

      const beforeBalance = await vstaToken.balanceOf(communityIssuance.address);
      const beforeBalanceTreasury = await vstaToken.balanceOf(treasury);

      await communityIssuance.removeFundFromStabilityPool(stabilityPool.address, dec(50, 18), { from: treasury })

      const distribution = await communityIssuance.stabilityPoolRewards(stabilityPool.address);

      assert.equal(distribution[INDEX_TOTAL_REWARD_SUPPLY].toString(), dec(50, 18))
      assert.equal((await vstaToken.balanceOf(communityIssuance.address)).toString(), beforeBalance.sub(toBN(dec(50, 18))))
      assert.equal((await vstaToken.balanceOf(treasury)).toString(), beforeBalanceTreasury.add(toBN(dec(50, 18))).toString())
    })

    it("removeFundFromStabilityPool: Called by owner, max supply, then disable pool", async () => {
      const supply = toBN(dec(100, 18))

      await communityIssuance.addFundToStabilityPool(stabilityPool.address, supply, { from: treasury })
      await communityIssuance.removeFundFromStabilityPool(stabilityPool.address, supply, { from: treasury })

      const distribution = await communityIssuance.stabilityPoolRewards(stabilityPool.address);

      assert.equal(distribution[INDEX_TOTAL_REWARD_SUPPLY].toString(), 0)
      assert.equal(distribution[INDEX_LAST_UPDATE_TIME].toString(), 0)
      assert.equal(distribution[INDEX_TOTAL_REWARD_ISSUED].toString(), 0)
    })

    it("setStabilityPoolAdmin: Called by user, then reverts", async () => {
      await assertRevert(communityIssuance.setStabilityPoolAdmin(stabilityPool.address, user, true, { from: user }))
    })

    it("setStabilityPoolAdmin: Called by owner(treasury), then update user status", async () => {
      await communityIssuance.setStabilityPoolAdmin(stabilityPool.address, user, true, { from: treasury })
      assert.isTrue(await communityIssuance.isWalletAdminOfPool(stabilityPool.address, user));
    })

    it("setProtocolAccessOf: Called by user, then reverts", async () => {
      await assertRevert(communityIssuance.setProtocolAccessOf(user, true, { from: user }))
    })

    it("setProtocolAccessOf: Called by owner(treasury), then update user status", async () => {
      await communityIssuance.setProtocolAccessOf(user, true, { from: treasury })
      assert.isTrue(await communityIssuance.protocolFullAccess(user));
    })

    it("convertPoolFundV1toV2: Called by user, then reverts", async () => {
      await assertRevert(communityIssuance.convertPoolFundV1toV2([], { from: user }))
    })
  })
})
