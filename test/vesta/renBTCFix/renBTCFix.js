const deploymentHelper = require("../../../utils/deploymentHelpers.js")
const testHelpers = require("../../../utils/testHelpers.js")

const BorrowerOperationsTester = artifacts.require("../BorrowerOperationsTester.sol")
const TroveManagerTester = artifacts.require("TroveManagerTester")
const ERC20Test = artifacts.require("ERC20Test")

const th = testHelpers.TestHelper

const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const ZERO_ADDRESS = th.ZERO_ADDRESS
const assertRevert = th.assertRevert

/* NOTE: Some of the borrowing tests do not test for specific VST fee values. They only test that the
 * fees are non-zero when they should occur, and that they decay over time.
 *
 * Specific VST fee values will depend on the final fee schedule used, and the final choice for
 *  the parameter MINUTE_DECAY_FACTOR in the TroveManager, which is still TBD based on economic
 * modelling.
 * 
 */

contract('renBTCFix', async accounts => {
  const [
    owner, alice, bob, carol, dennis, whale,
    A, B, C, D, E, F, G, H,] = accounts;

  const [multisig] = accounts.slice(997, 1000)

  let priceFeed
  let vstToken
  let sortedTroves
  let troveManager
  let activePool
  let defaultPool
  let borrowerOperations
  let vstaStaking
  let vstaToken
  let vestaParams
  let erc20

  let contracts

  const getOpenTroveVSTAmount = async (totalDebt, asset) => th.getOpenTroveVSTAmount(contracts, totalDebt, asset)
  const getNetBorrowingAmount = async (debtWithFee, asset) => th.getNetBorrowingAmount(contracts, debtWithFee, asset)
  const getActualDebtFromComposite = async (compositeDebt) => th.getActualDebtFromComposite(compositeDebt, contracts)
  const openTrove = async (params) => th.openTrove(contracts, params)
  const getTroveEntireColl = async (trove, asset) => th.getTroveEntireColl(contracts, trove, asset)
  const getTroveEntireDebt = async (trove, asset) => th.getTroveEntireDebt(contracts, trove, asset)
  const getTroveStake = async (trove, asset) => th.getTroveStake(contracts, trove, asset)

  let VST_GAS_COMPENSATION
  let MIN_NET_DEBT
  let BORROWING_FEE_FLOOR
  let VST_GAS_COMPENSATION_ERC20
  let MIN_NET_DEBT_ERC20
  let BORROWING_FEE_FLOOR_ERC20

  describe("Community Issuance", async () => {
    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.borrowerOperations = await BorrowerOperationsTester.new()
      contracts.troveManager = await TroveManagerTester.new()
      contracts.erc20 = await ERC20Test.new()
      contracts = await deploymentHelper.deployVSTToken(contracts)

      const VSTAContracts = await deploymentHelper.deployVSTAContractsHardhat(accounts[0])

      await deploymentHelper.connectCoreContracts(contracts, VSTAContracts)
      await deploymentHelper.connectVSTAContractsToCore(VSTAContracts, contracts, false, false)

      priceFeed = contracts.priceFeedTestnet
      vstToken = contracts.vstToken
      sortedTroves = contracts.sortedTroves
      troveManager = contracts.troveManager
      activePool = contracts.activePool
      defaultPool = contracts.defaultPool
      borrowerOperations = contracts.borrowerOperations
      hintHelpers = contracts.hintHelpers
      vestaParams = contracts.vestaParameters

      vstaStaking = VSTAContracts.vstaStaking
      vstaToken = VSTAContracts.vstaToken
      communityIssuance = VSTAContracts.communityIssuance
      erc20 = contracts.erc20;

      await erc20.setDecimals(8);

      await vestaParams.sanitizeParameters(ZERO_ADDRESS);
      await vestaParams.sanitizeParameters(erc20.address);

      VST_GAS_COMPENSATION = await vestaParams.VST_GAS_COMPENSATION(ZERO_ADDRESS)
      MIN_NET_DEBT = await vestaParams.MIN_NET_DEBT(ZERO_ADDRESS)
      BORROWING_FEE_FLOOR = await vestaParams.BORROWING_FEE_FLOOR(ZERO_ADDRESS)

      VST_GAS_COMPENSATION_ERC20 = await vestaParams.VST_GAS_COMPENSATION(erc20.address)
      MIN_NET_DEBT_ERC20 = await vestaParams.MIN_NET_DEBT(erc20.address)
      BORROWING_FEE_FLOOR_ERC20 = await vestaParams.BORROWING_FEE_FLOOR(erc20.address)

      await vstaToken.unprotectedMint(multisig, dec(5, 24))

      let index = 0;
      for (const acc of accounts) {
        await vstaToken.approve(vstaStaking.address, await web3.eth.getBalance(acc), { from: acc })
        await erc20.approve(vstaStaking.address, await web3.eth.getBalance(acc), { from: acc })
        index++;

        if (index >= 20)
          break;
      }
    })

    it("Creating Vault with ERC20 8 decimals", async () => {

      await priceFeed.setPrice(dec(1, 18));
      await erc20.mint(bob, dec(600, 8));

      await borrowerOperations.openTrove(erc20.address, dec(600, 18), dec(1, 18), dec(300, 18), ZERO_ADDRESS, ZERO_ADDRESS, { from: bob });

      assert.equal(await vstToken.balanceOf(bob), dec(300, 18))
      assert.equal(await erc20.balanceOf(bob), 0)
    })


    it("Adjust Vault with ERC20 8 decimals", async () => {

      await priceFeed.setPrice(dec(1, 18));
      await erc20.mint(bob, dec(1200, 8));

      await borrowerOperations.openTrove(erc20.address, dec(600, 18), dec(1, 18), dec(300, 18), ZERO_ADDRESS, ZERO_ADDRESS, { from: bob });



    })
  })
})

