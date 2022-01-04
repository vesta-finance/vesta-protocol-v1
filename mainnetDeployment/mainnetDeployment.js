const { ChainlinkAggregatorV3Interface } = require("./ABIs/ChainlinkAggregatorV3Interface.js")
const { UniswapV3Factory } = require("./ABIs/UniswapV3Factory.js")
const { UniswapV3PositionManager } = require("./ABIs/UniswapV3PositionManager.js")
const { UniswapV3Pool } = require("./ABIs/UniswapV3Pool.js")

const { UniswapV2Factory } = require("./ABIs/UniswapV2Factory.js")
const { UniswapV2Pair } = require("./ABIs/UniswapV2Pair.js")
const { UniswapV2Router02 } = require("./ABIs/UniswapV2Router02.js")

const { TestHelper: th, TimeValues: timeVals } = require("../utils/testHelpers.js")
const { dec } = th
const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { BigNumber } = require("ethers")
const toBigNum = ethers.BigNumber.from


let mdh;
let uniswapV2Factory;
let config;
let deployerWallet;
let gasPrice;
let liquityCore;
let VSTWETHPairAddr;
let USDVETHPair;
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

  assert.equal(deployerWallet.address, config.vestaAddresses.DEPLOYER)
  let deployerETHBalance = await ethers.provider.getBalance(deployerWallet.address)

  console.log(`deployerETHBalance before: ${deployerETHBalance}`)

  loadContracts();

  console.log(`Uniswp addr: ${uniswapV2Factory.address}`)

  deployerETHBalance = await ethers.provider.getBalance(deployerWallet.address)
  console.log(`deployer's ETH balance before deployments: ${deployerETHBalance}`)

  // Deploy core logic contracts
  liquityCore = await mdh.deployLiquityCoreMainnet(config.externalAddrs.TELLOR_MASTER, deploymentState, ADMIN_WALLET)

  await mdh.logContractObjects(liquityCore)

  // Check Uniswap Pair VST-ETH pair before pair creation
  VSTWETHPairAddr = await uniswapV2Factory.getPair(liquityCore.vstToken.address, config.externalAddrs.WETH_ERC20)
  let WETHUSDVPairAddr = await uniswapV2Factory.getPair(config.externalAddrs.WETH_ERC20, liquityCore.vstToken.address)
  assert.equal(VSTWETHPairAddr, WETHUSDVPairAddr)


  if (VSTWETHPairAddr == th.ZERO_ADDRESS) {
    await createUniswapPool_VST();
  }
  else {
    console.log("Uniswap VST Pool already created.");
  }

  // Deploy Unipool
  // const unipool = await mdh.deployUnipoolMainnet(deploymentState)

  // Deploy VSTA Contracts
  VSTAContracts = await mdh.deployVSTAContractsMainnet(
    TREASURY_WALLET, // multisig VSTA endowment address
    deploymentState,
  )

  // Connect all core contracts up
  console.log("Connect Core Contracts up");

  const BTCAddress = !config.IsMainnet
    ? await mdh.deployMockERC20Contract(deploymentState, liquityCore)
    : config.externalAddrs.REN_BTC

  if (!BTCAddress)
    throw ("CANNOT FIND THE renBTC Address")

  await mdh.connectCoreContractsMainnet(
    liquityCore,
    VSTAContracts,
    config.externalAddrs.CHAINLINK_ETHUSD_PROXY,
    config.externalAddrs.CHAINLINK_FLAG_HEALTH,
    config.vestaAddresses.ADMIN_MULTI,
    TREASURY_WALLET,
    BTCAddress)

  console.log("Connect VSTA Contract to Core");
  await mdh.connectVSTAContractsToCoreMainnet(VSTAContracts, liquityCore, TREASURY_WALLET)

  //Activate StabilityPool
  await VSTAContracts.VSTAToken.approve(VSTAContracts.communityIssuance.address, ethers.constants.MaxUint256)
  await VSTAContracts.communityIssuance.addFundToStabilityPool(liquityCore.stabilityPoolETH.address, dec(333_334, 18))
  await VSTAContracts.communityIssuance.addFundToStabilityPool(liquityCore.stabilityPoolBTC.address, dec(333_333, 18))

  // Deploy a read-only multi-trove getter
  await mdh.deployMultiTroveGetterMainnet(liquityCore, deploymentState)

  //// WILL BE REPLACED BY THE FARMING CONTRACT
  // Connect Unipool to VSTAToken and the VST-WETH pair address, with a 6 week duration
  // const LPRewardsDuration = timeVals.SECONDS_IN_SIX_WEEKS
  // await mdh.connectUnipoolMainnet(unipool, VSTAContracts, VSTWETHPairAddr, LPRewardsDuration)

  // Log VSTA and Unipool addresses
  await mdh.logContractObjects(VSTAContracts)
  // console.log(`Unipool address: ${unipool.address}`)

  // create vesting rule to beneficiaries
  console.log("Beneficiaries")

  if (await VSTAContracts.VSTAToken.allowance(deployerWallet.address, liquityCore.lockedVsta.address) == 0)
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

  await uniswapPoolTryAddFund();
}

function loadContracts() {
  uniswapV2Factory = new ethers.Contract(
    config.externalAddrs.SUSHISWAP_V2_FACTORY,
    UniswapV2Factory.abi,
    deployerWallet
  )
}

async function createUniswapPool_VST() {
  console.log("Create UniswapPool VST");
  // Deploy Unipool for VST-WETH
  await mdh.sendAndWaitForTransaction(uniswapV2Factory.createPair(
    config.externalAddrs.WETH_ERC20,
    liquityCore.vstToken.address,
    { gasPrice }
  ))

  // Check Uniswap Pair VST-WETH pair after pair creation (forwards and backwards should have same address)
  VSTWETHPairAddr = await uniswapV2Factory.getPair(liquityCore.vstToken.address, config.externalAddrs.WETH_ERC20)
  assert.notEqual(VSTWETHPairAddr, th.ZERO_ADDRESS)
  WETHUSDVPairAddr = await uniswapV2Factory.getPair(config.externalAddrs.WETH_ERC20, liquityCore.vstToken.address)
  console.log(`VST-WETH pair contract address after Uniswap pair creation: ${VSTWETHPairAddr}`)
  assert.equal(WETHUSDVPairAddr, VSTWETHPairAddr)
}

function getPoolFee() {
  return toBigNum("500");
}


async function uniswapPoolTryAddFund() {

  // console.log("OPEN TROVE NEED TO BE THERE FOR MAINNET");
  //await OpenTrove();

  console.log("Uniswap pool Try adding funds");
  // Check Uniswap pool has VST and WETH tokens
  USDVETHPair = await new ethers.Contract(
    VSTWETHPairAddr,
    UniswapV2Pair.abi,
    deployerWallet
  )

  const token0Addr = await USDVETHPair.token0()
  const token1Addr = await USDVETHPair.token1()
  console.log(`VST-ETH Pair token 0: ${th.squeezeAddr(token0Addr)},
        VSTToken contract addr: ${th.squeezeAddr(liquityCore.vstToken.address)}`)
  console.log(`VST-ETH Pair token 1: ${th.squeezeAddr(token1Addr)},
        WETH ERC20 contract addr: ${th.squeezeAddr(config.externalAddrs.WETH_ERC20)}`)

  // Check initial LUSD-ETH pair reserves before provision
  let reserves = await USDVETHPair.getReserves()
  th.logBN("LUSD-ETH Pair's VST reserves before provision", reserves[0])
  th.logBN("LUSD-ETH Pair's ETH reserves before provision", reserves[1])

  // Get the UniswapV2Router contract
  const uniswapV2Router02 = new ethers.Contract(
    config.externalAddrs.SUSHISWAP_V2_ROUTER02,
    UniswapV2Router02.abi,
    deployerWallet
  )


  // --- Provide liquidity to LUSD-ETH pair if not yet done so ---
  let deployerLPTokenBal = await USDVETHPair.balanceOf(deployerWallet.address)
  if (deployerLPTokenBal.toString() == '0') {
    console.log('Providing liquidity to Uniswap...')
    // Give router an allowance for LUSD

    if (await liquityCore.vstToken.allowance(deployerWallet.address, uniswapV2Router02.address) == 0)
      await liquityCore.vstToken.approve(uniswapV2Router02.address, dec(10000, 18))

    // Check Router's spending allowance
    const routerUSDVAllowanceFromDeployer = await liquityCore.vstToken.allowance(deployerWallet.address, uniswapV2Router02.address)
    th.logBN("router's spending allowance for deployer's VST", routerUSDVAllowanceFromDeployer)

    // Get amounts for liquidity provision
    const LP_ETH = dec(1, 'ether')

    const chainlinkProxy = new ethers.Contract(
      config.externalAddrs.CHAINLINK_ETHUSD_PROXY,
      ChainlinkAggregatorV3Interface,
      deployerWallet
    )

    await liquityCore.vstToken.mint(ZERO_ADDRESS, deployerWallet.address, dec(5000, 18))

    // Convert 8-digit CL price to 18 and multiply by ETH amount
    let chainlinkPrice = await chainlinkProxy.latestAnswer()
    const VSTAmount = toBigNum(chainlinkPrice)
      .mul(toBigNum(dec(1, 10)))
      .mul(toBigNum(LP_ETH))
      .div(toBigNum(dec(1, 18)))

    const minUSDVAmount = VSTAmount.sub(toBigNum(dec(100, 18)))

    latestBlock = await ethers.provider.getBlockNumber()
    now = (await ethers.provider.getBlock(latestBlock)).timestamp
    let tenMinsFromNow = now + (60 * 60 * 10)

    console.log("Add Liquidity ETH -- VST: " + VSTAmount)
    console.log("deadLine: " + tenMinsFromNow);
    console.log("min: " + minUSDVAmount);
    // Provide liquidity to LUSD-ETH pair
    await mdh.sendAndWaitForTransaction(
      uniswapV2Router02.addLiquidityETH(
        liquityCore.vstToken.address, // address of LUSD token
        VSTAmount, // LUSD provision
        minUSDVAmount, // minimum LUSD provision
        LP_ETH, // minimum ETH provision
        config.vestaAddresses.ADMIN_MULTI, // address to send LP tokens to
        tenMinsFromNow, // deadline for this tx
        {
          value: dec(1, 'ether'),
          gasPrice,
          gasLimit: 5000000 // For some reason, ethers can't estimate gas for this tx
        }
      )
    )
    console.log("Sent Liquidity ETH")

  } else {
    console.log('Liquidity already provided to Sushiswap')
  }
  // Check LUSD-ETH reserves after liquidity provision:
  reserves = await USDVETHPair.getReserves()
  th.logBN("VST-ETH Pair's LUSD reserves after provision", reserves[0])
  th.logBN("VST-ETH Pair's ETH reserves after provision", reserves[1])
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
