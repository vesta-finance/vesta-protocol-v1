const { current } = require("@openzeppelin/test-helpers/src/balance")
const { web3 } = require("@openzeppelin/test-helpers/src/setup")
const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('AdminContract', async accounts => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const assertRevert = th.assertRevert
  const timeValues = testHelpers.TimeValues

  const [owner, user, fakeIndex, fakeOracle] = accounts;

  let contracts
  let adminContract
  let vstaToken
  let stabilityPoolV1;
  let stabilityPoolManager;
  let VSTAContracts;

  describe("Admin Contract", async () => {
    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.troveManager = await TroveManagerTester.new()
      VSTAContracts = await deploymentHelper.deployVSTAContractsHardhat(owner)

      adminContract = contracts.adminContract
      vstaToken = VSTAContracts.vstaToken;
      stabilityPoolV1 = contracts.stabilityPoolTemplate;
      stabilityPoolManager = contracts.stabilityPoolManager;

      await deploymentHelper.connectCoreContracts(contracts, VSTAContracts)
      await deploymentHelper.connectVSTAContractsToCore(VSTAContracts, contracts, true)

      await VSTAContracts.vstaToken.approve(VSTAContracts.communityIssuance.address, ethers.constants.MaxUint256);
    })

    it("AddNewCollateral: As User then reverts", async () => {
      await assertRevert(adminContract.addNewCollateral(ZERO_ADDRESS, stabilityPoolV1.address, ZERO_ADDRESS, ZERO_ADDRESS, dec(100, 18), dec(1, 18), 14, { from: user }));
    })

    it("AddNewCollateral: As Owner - Invalid StabilityPool Template then reverts", async () => {
      await assertRevert(adminContract.addNewCollateral(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, dec(100, 18), dec(1, 18), 14));
    })

    it("AddNewCollateral: As Owner - Stability Pool exists, then reverts", async () => {
      await adminContract.addNewCollateral(ZERO_ADDRESS, stabilityPoolV1.address, ZERO_ADDRESS, ZERO_ADDRESS, dec(100, 18), dec(1, 18), 14);
      await assertRevert(adminContract.addNewCollateral(ZERO_ADDRESS, stabilityPoolV1.address, ZERO_ADDRESS, ZERO_ADDRESS, 0, dec(1, 18), 14));
    })

    it("AddNewCollateral: As Owner - Create new Stability Pool - Verify All Systems", async () => {
      await adminContract.addNewCollateral(ZERO_ADDRESS, stabilityPoolV1.address, fakeOracle, fakeIndex, dec(100, 18), dec(1, 18), 14);

      dataOracle = await contracts.priceFeedTestnet.oracles(ZERO_ADDRESS);
      assert.equal(dataOracle[0], fakeOracle);
      assert.equal(dataOracle[1], fakeIndex);
      assert.equal(dataOracle[2], true);

      assert.notEqual((await contracts.vestaParameters.redemptionBlock(ZERO_ADDRESS)).toString(), 0);
      assert.notEqual(await stabilityPoolManager.unsafeGetAssetStabilityPool(ZERO_ADDRESS), ZERO_ADDRESS)
      assert.equal((await vstaToken.balanceOf(VSTAContracts.communityIssuance.address)).toString(), dec(100, 18))
      assert.notEqual((await VSTAContracts.communityIssuance.vstaDistributionsByPool), 0);
    })
  })
})
