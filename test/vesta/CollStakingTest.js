const { current } = require("@openzeppelin/test-helpers/src/balance")
const { web3 } = require("@openzeppelin/test-helpers/src/setup")
const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const ActivePool = artifacts.require("./ActivePool.sol")
const StabilityPoolManager = artifacts.require("./StabilityPoolManager.sol")
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol")
const CollStakingManagerMock = artifacts.require("./CollStakingManagerMock.sol")
const ERC20Mock = artifacts.require("./ERC20Mock.sol")
const NonPayable = artifacts.require("./NonPayable.sol")

const th = testHelpers.TestHelper
const dec = th.dec

contract('CollStakingManager', async accounts => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const assertRevert = th.assertRevert

  const [owner, user] = accounts;
  
  let activePool
  let mockBorrowerOperations
  let collStakingManager
  let collateral

  describe("ActivePool Contract Test for staking collaterals", async () => {
    beforeEach(async () => {
      
      collStakingManager = await CollStakingManagerMock.new()
      activePool = await ActivePool.new()
      mockBorrowerOperations = await NonPayable.new()
      let collSurplusPool = await CollSurplusPool.new()
      let stabilityPoolManager = await StabilityPoolManager.new()
      const dumbContractAddress = (await NonPayable.new()).address
      await activePool.setAddresses(mockBorrowerOperations.address, dumbContractAddress, stabilityPoolManager.address, dumbContractAddress, collSurplusPool.address)
      await activePool.setCollStakingManagerAddress(collStakingManager.address)

      collateral = await ERC20Mock.new("TestColl", "COLL", 18)
      await collateral.mint(owner, dec(100, 18))
      await collStakingManager.setSupportedTokens(collateral.address, true)
    })

    it("ActivePool: receivedERC20() called for supported tokens, then stake collaterals to Staking Manager", async () => {
      collateral.transfer(activePool.address, dec(10, 18))
      const recevivedERC20Data = th.getTransactionData('receivedERC20(address,uint256)', [collateral.address, dec(10, 18)])
      const tx = await mockBorrowerOperations.forward(activePool.address, recevivedERC20Data)
      assert.isTrue(tx.receipt.status)

      assert.equal(await collateral.balanceOf(activePool.address), 0)
      assert.equal(await collateral.balanceOf(collStakingManager.address), dec(10, 18))
    })

    it("ActivePool: receivedERC20() called for unsupported tokens, then keep collaterals in the pool", async () => {
      await collStakingManager.setSupportedTokens(collateral.address, false)
      collateral.transfer(activePool.address, dec(10, 18))
      const recevivedERC20Data = th.getTransactionData('receivedERC20(address,uint256)', [collateral.address, dec(10, 18)])
      const tx = await mockBorrowerOperations.forward(activePool.address, recevivedERC20Data)
      assert.isTrue(tx.receipt.status)

      assert.equal(await collateral.balanceOf(activePool.address), dec(10, 18))
      assert.equal(await collateral.balanceOf(collStakingManager.address), 0)
    })

    it("ActivePool: sendAsset() called, then unstake collaterals from Staking Manager", async () => {
      collateral.transfer(activePool.address, dec(10, 18))
      const recevivedERC20Data = th.getTransactionData('receivedERC20(address,uint256)', [collateral.address, dec(10, 18)])
      await mockBorrowerOperations.forward(activePool.address, recevivedERC20Data)
      
      const sendAssetData = th.getTransactionData('sendAsset(address,address,uint256)', [collateral.address, user, dec(10, 18)])
      const tx = await mockBorrowerOperations.forward(activePool.address, sendAssetData)
      assert.isTrue(tx.receipt.status)

      assert.equal(await collateral.balanceOf(collStakingManager.address), 0)
      assert.equal(await collateral.balanceOf(activePool.address), 0)
      assert.equal(await collateral.balanceOf(user), dec(10, 18))
    })

    it("ActivePool: sendAsset() called, if not-staked balance exists, then unstake shortage amount only", async () => {
      collateral.transfer(activePool.address, dec(20, 18))

      await collStakingManager.setSupportedTokens(collateral.address, false)
      const recevivedERC20Data = th.getTransactionData('receivedERC20(address,uint256)', [collateral.address, dec(10, 18)])
      await mockBorrowerOperations.forward(activePool.address, recevivedERC20Data)

      await collStakingManager.setSupportedTokens(collateral.address, true)
      await mockBorrowerOperations.forward(activePool.address, recevivedERC20Data)
      
      const sendAssetData = th.getTransactionData('sendAsset(address,address,uint256)', [collateral.address, user, dec(15, 18)])
      const tx = await mockBorrowerOperations.forward(activePool.address, sendAssetData)
      assert.isTrue(tx.receipt.status)

      assert.equal(await collateral.balanceOf(collStakingManager.address), dec(5, 18))
      assert.equal(await collateral.balanceOf(activePool.address), 0)
      assert.equal(await collateral.balanceOf(user), dec(15, 18))
    })
  })
})
