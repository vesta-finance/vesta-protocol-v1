const { ChainlinkAggregatorV3Interface } = require("./ABIs/ChainlinkAggregatorV3Interface.js")
const { TestHelper: th, TimeValues: timeVals } = require("../utils/testHelpers.js")
const { dec } = th

const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const toBigNum = ethers.BigNumber.from


let mdh;
let config;
let deployerWallet;
let gasPrice;
let liquityCore;
let VSTAContracts;

let ADMIN_WALLET
let TREASURY_WALLET

async function mainnetDeploy(configParams) {
  console.log(new Date().toUTCString())

  config = configParams;
  gasPrice = config.GAS_PRICE;

  ADMIN_WALLET = config.vestaAddresses.ADMIN_MULTI
  TREASURY_WALLET = config.vestaAddresses.VSTA_SAFE

  deployerWallet = (await ethers.getSigners())[0]
  mdh = new MainnetDeploymentHelper(config, deployerWallet)

  const deploymentState = mdh.loadPreviousDeployment()

  console.log(`deployer address: ${deployerWallet.address}`)

  // assert.equal(deployerWallet.address, config.vestaAddresses.DEPLOYER)
  let deployerETHBalance = await ethers.provider.getBalance(deployerWallet.address)
  console.log(`deployerETHBalance before: ${deployerETHBalance}`)

  deployerETHBalance = await ethers.provider.getBalance(deployerWallet.address)
  console.log(`deployer's ETH balance before deployments: ${deployerETHBalance}`)

  // Deploy core logic contracts
  liquityCore = await mdh.deployLiquityCoreMainnet(config.externalAddrs.TELLOR_MASTER, deploymentState, ADMIN_WALLET)

  await mdh.logContractObjects(liquityCore)

  // Deploy VSTA Contracts
  VSTAContracts = await mdh.deployVSTAContractsMainnet(
    TREASURY_WALLET, // multisig VSTA endowment address
    deploymentState,
  )

  // Connect all core contracts up
  console.log("Connect Core Contracts up");


  await mdh.connectCoreContractsMainnet(
    liquityCore,
    VSTAContracts,
    config.externalAddrs.CHAINLINK_FLAG_HEALTH,
  )

  console.log("Connect VSTA Contract to Core");
  await mdh.connectVSTAContractsToCoreMainnet(VSTAContracts, liquityCore)

  //Add collaterals

  const allowance = (await VSTAContracts.VSTAToken.allowance(deployerWallet.address, VSTAContracts.communityIssuance.address));

  if (allowance == 0)
    await VSTAContracts.VSTAToken.approve(VSTAContracts.communityIssuance.address, ethers.constants.MaxUint256)

  console.log(await VSTAContracts.communityIssuance.adminContract(), liquityCore.adminContract.address);

  if ((await liquityCore.stabilityPoolManager.unsafeGetAssetStabilityPool(ZERO_ADDRESS)) == ZERO_ADDRESS) {
    console.log("Creating Collateral - ETH")

    const txReceiptProxyETH = await mdh
      .sendAndWaitForTransaction(
        liquityCore.adminContract.addNewCollateral(
          ZERO_ADDRESS,
          liquityCore.stabilityPoolV1.address,
          config.externalAddrs.CHAINLINK_ETHUSD_PROXY,
          1,
          dec(333_334, 18),
          config.REDEMPTION_SAFETY), {
        gasPrice,
      })

    deploymentState["ProxyStabilityPoolETH"] = {
      address: await liquityCore.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS),
      txHash: txReceiptProxyETH.transactionHash
    }
  }

  const BTCAddress = !config.IsMainnet
    ? await mdh.deployMockERC20Contract(deploymentState)
    : config.externalAddrs.REN_BTC

  if (!BTCAddress)
    throw ("CANNOT FIND THE renBTC Address")


  if ((await liquityCore.stabilityPoolManager.unsafeGetAssetStabilityPool(BTCAddress)) == ZERO_ADDRESS) {
    console.log("Creating Collateral - BTC")

    const txReceiptProxyBTC = await mdh
      .sendAndWaitForTransaction(
        liquityCore.adminContract.addNewCollateral(
          BTCAddress,
          liquityCore.stabilityPoolV1.address,
          config.externalAddrs.CHAINLINK_ETHUSD_PROXY,
          2,
          dec(333_333, 18),
          config.REDEMPTION_SAFETY))

    deploymentState["ProxyStabilityPoolRenBTC"] = {
      address: await liquityCore.stabilityPoolManager.getAssetStabilityPool(BTCAddress),
      txHash: txReceiptProxyBTC.transactionHash
    }
  }

  mdh.saveDeployment(deploymentState)

  // Deploy a read-only multi-trove getter
  await mdh.deployMultiTroveGetterMainnet(liquityCore, deploymentState)

  // Log VSTA  
  await mdh.logContractObjects(VSTAContracts)

  // create vesting rule to beneficiaries
  console.log("Beneficiaries")

  if ((await VSTAContracts.VSTAToken.allowance(deployerWallet.address, liquityCore.lockedVsta.address)) == 0)
    await VSTAContracts.VSTAToken.approve(liquityCore.lockedVsta.address, ethers.constants.MaxUint256)

  for (const [wallet, amount] of Object.entries(config.beneficiaries)) {
    console.log("Beneficiary: %s for %s", wallet, amount)

    if (amount == 0) continue

    if (!(await liquityCore.lockedVsta.isEntityExits(wallet))) {
      const txReceipt = await mdh.sendAndWaitForTransaction(liquityCore.lockedVsta.addEntityVesting(wallet, dec(amount, 18)))

      deploymentState[wallet] = {
        amount: amount,
        txHash: txReceipt.transactionHash
      }

      mdh.saveDeployment(deploymentState)
    }
  }

  const lastGoodPrice = await liquityCore.priceFeed.lastGoodPrice(ZERO_ADDRESS)
  const priceFeedInitialStatus = await liquityCore.priceFeed.status()
  th.logBN('PriceFeed first stored price', lastGoodPrice)
  console.log(`PriceFeed initial status: ${priceFeedInitialStatus}`)
  console.log(`PriceFeed initial status: ${priceFeedInitialStatus}`)

  // Manually deploy
  // await uniswapPoolTryAddFund();

  await transferOwnership(liquityCore.adminContract, ADMIN_WALLET);
  await transferOwnership(liquityCore.priceFeed, ADMIN_WALLET);
  await transferOwnership(liquityCore.vestaParameters, ADMIN_WALLET);
  await transferOwnership(liquityCore.stabilityPoolManager, ADMIN_WALLET);
  await transferOwnership(liquityCore.vstToken, ADMIN_WALLET);

  await transferOwnership(VSTAContracts.lockedVsta, TREASURY_WALLET);
  await transferOwnership(VSTAContracts.communityIssuance, TREASURY_WALLET);
}

async function transferOwnership(contract, newOwner) {

  console.log("Transfering Ownership of ", await contract.NAME())

  if (!newOwner)
    throw "Transfering ownership to null address";

  if (await contract.owner() != newOwner)
    await contract.transferOwnership(newOwner)
}

async function OpenTrove() {
  // Open trove if not yet opened
  const troveStatus = await liquityCore.troveManager.getTroveStatus(ZERO_ADDRESS, deployerWallet.address)
  if (troveStatus.toString() != '1') {
    let _3kLUSDWithdrawal = th.dec(5000, 18) // 5000 LUSD
    let _3ETHcoll = th.dec(5, 'ether') // 5 ETH
    console.log('Opening trove...')
    await mdh.sendAndWaitForTransaction(
      liquityCore.borrowerOperations.openTrove(
        ZERO_ADDRESS,
        _3ETHcoll,
        th._100pct,
        _3kLUSDWithdrawal,
        th.ZERO_ADDRESS,
        th.ZERO_ADDRESS,
        { value: _3ETHcoll, gasPrice }
      )
    )
  } else {
    console.log('Deployer already has an active trove')
  }

  // Check deployer now has an open trove
  console.log(`deployer is in sorted list after making trove: ${await liquityCore.sortedTroves.contains(ZERO_ADDRESS, deployerWallet.address)}`)

  const deployerTrove = await liquityCore.troveManager.Troves(ZERO_ADDRESS, deployerWallet.address)
  th.logBN('deployer debt', deployerTrove[0])
  th.logBN('deployer coll', deployerTrove[1])
  th.logBN('deployer stake', deployerTrove[2])
  console.log(`deployer's trove status: ${deployerTrove[3]}`)

  // Check deployer has LUSD
  let deployerLUSDBal = await liquityCore.vstToken.balanceOf(deployerWallet.address)
  th.logBN("deployer's LUSD balance", deployerLUSDBal)
}

module.exports = {
  mainnetDeploy
}
