const fs = require('fs')

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const maxBytes32 = '0x' + 'f'.repeat(64)

class MainnetDeploymentHelper {
  constructor(configParams, deployerWallet) {
    this.configParams = configParams
    this.deployerWallet = deployerWallet
    this.hre = require("hardhat")
  }

  loadPreviousDeployment() {
    let previousDeployment = {}
    if (fs.existsSync(this.configParams.OUTPUT_FILE)) {
      console.log(`Loading previous deployment...`)
      previousDeployment = require('../' + this.configParams.OUTPUT_FILE)
    }

    return previousDeployment
  }

  saveDeployment(deploymentState) {
    const deploymentStateJSON = JSON.stringify(deploymentState, null, 2)
    fs.writeFileSync(this.configParams.OUTPUT_FILE, deploymentStateJSON)

  }
  // --- Deployer methods ---

  async getFactory(name) {
    const factory = await ethers.getContractFactory(name, this.deployerWallet)
    return factory
  }

  async sendAndWaitForTransaction(txPromise) {
    const tx = await txPromise
    const minedTx = await ethers.provider.waitForTransaction(tx.hash, this.configParams.TX_CONFIRMATIONS)

    if (!minedTx.status) {
      throw ('Transaction Failed', txPromise);
    }

    return minedTx
  }

  async loadOrDeploy(factory, name, deploymentState, params = []) {
    if (deploymentState[name] && deploymentState[name].address) {
      console.log(`Using previously deployed ${name} contract at address ${deploymentState[name].address}`)
      return await factory.attach(deploymentState[name].address);
    }

    const contract = await factory.deploy(...params, { gasPrice: this.configParams.GAS_PRICE })
    await this.deployerWallet.provider.waitForTransaction(contract.deployTransaction.hash, this.configParams.TX_CONFIRMATIONS)

    deploymentState[name] = {
      address: contract.address,
      txHash: contract.deployTransaction.hash
    }

    this.saveDeployment(deploymentState)

    return contract
  }


  async deployMockERC20Contract(deploymentState, contracts) {
    const gasPrice = this.configParams.GAS_PRICE
    const ERC20TestFactory = await this.getFactory("ERC20Test")
    const erc20Mock = await this.loadOrDeploy(ERC20TestFactory, 'erc20Mock', deploymentState)

    await contracts.priceFeed.addOracle(erc20Mock.address, "0x0c9973e7a27d00e656B9f153348dA46CaD70d03d", 2, { gasPrice });
    return erc20Mock.address
  }


  async deployLiquityCoreMainnet(tellorMasterAddr, deploymentState, multisig) {
    // Get contract factories
    const priceFeedFactory = await this.getFactory("PriceFeed")
    const sortedTrovesFactory = await this.getFactory("SortedTroves")
    const troveManagerFactory = await this.getFactory("TroveManager")
    const activePoolFactory = await this.getFactory("ActivePool")
    const stabilityPoolFactory = await this.getFactory("StabilityPool")
    const StabilityPoolManagerFactory = await this.getFactory("StabilityPoolManager")
    const gasPoolFactory = await this.getFactory("GasPool")
    const defaultPoolFactory = await this.getFactory("DefaultPool")
    const collSurplusPoolFactory = await this.getFactory("CollSurplusPool")
    const borrowerOperationsFactory = await this.getFactory("BorrowerOperations")
    const hintHelpersFactory = await this.getFactory("HintHelpers")
    const VSTTokenFactory = await this.getFactory("VSTToken")
    const tellorCallerFactory = await this.getFactory("TellorCaller")
    const vaultParametersFactory = await this.getFactory("VestaParameters")
    const lockedVstaFactory = await this.getFactory("LockedVSTA")

    // Deploy txs
    const priceFeed = await this.loadOrDeploy(priceFeedFactory, 'priceFeed', deploymentState)
    const sortedTroves = await this.loadOrDeploy(sortedTrovesFactory, 'sortedTroves', deploymentState)
    const troveManager = await this.loadOrDeploy(troveManagerFactory, 'troveManager', deploymentState)
    const activePool = await this.loadOrDeploy(activePoolFactory, 'activePool', deploymentState)
    const stabilityPoolETH = await this.loadOrDeploy(stabilityPoolFactory, 'stabilityPoolETH', deploymentState)
    const stabilityPoolBTC = await this.loadOrDeploy(stabilityPoolFactory, 'stabilityPoolBTC', deploymentState)
    const stabilityPoolManager = await this.loadOrDeploy(StabilityPoolManagerFactory, 'stabilityPoolManager', deploymentState)
    const gasPool = await this.loadOrDeploy(gasPoolFactory, 'gasPool', deploymentState)
    const defaultPool = await this.loadOrDeploy(defaultPoolFactory, 'defaultPool', deploymentState)
    const collSurplusPool = await this.loadOrDeploy(collSurplusPoolFactory, 'collSurplusPool', deploymentState)
    const borrowerOperations = await this.loadOrDeploy(borrowerOperationsFactory, 'borrowerOperations', deploymentState)
    const hintHelpers = await this.loadOrDeploy(hintHelpersFactory, 'hintHelpers', deploymentState)
    const tellorCaller = await this.loadOrDeploy(tellorCallerFactory, 'tellorCaller', deploymentState, [tellorMasterAddr])
    const vestaParameters = await this.loadOrDeploy(vaultParametersFactory, 'vestaParameters', deploymentState)
    const lockedVsta = await this.loadOrDeploy(lockedVstaFactory, 'lockedVsta', deploymentState)

    const VSTTokenParams = [
      troveManager.address,
      stabilityPoolManager.address,
      borrowerOperations.address,
      multisig
    ]
    const vstToken = await this.loadOrDeploy(
      VSTTokenFactory,
      'VSTToken',
      deploymentState,
      VSTTokenParams
    )

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('priceFeed', deploymentState)
      await this.verifyContract('sortedTroves', deploymentState)
      await this.verifyContract('troveManager', deploymentState)
      await this.verifyContract('activePool', deploymentState)
      await this.verifyContract('stabilityPoolETH', deploymentState)
      await this.verifyContract('stabilityPoolBTC', deploymentState)
      await this.verifyContract('stabilityPoolManager', deploymentState)
      await this.verifyContract('gasPool', deploymentState)
      await this.verifyContract('defaultPool', deploymentState)
      await this.verifyContract('collSurplusPool', deploymentState)
      await this.verifyContract('borrowerOperations', deploymentState)
      await this.verifyContract('hintHelpers', deploymentState)
      await this.verifyContract('tellorCaller', deploymentState, [tellorMasterAddr])
      await this.verifyContract('VSTToken', deploymentState, VSTTokenParams)
      await this.verifyContract('vestaParameters', deploymentState)
      await this.verifyContract('lockedVsta', deploymentState)
    }

    const coreContracts = {
      priceFeed,
      vstToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPoolManager,
      stabilityPoolETH,
      stabilityPoolBTC,
      gasPool,
      defaultPool,
      collSurplusPool,
      borrowerOperations,
      hintHelpers,
      tellorCaller,
      vestaParameters,
      lockedVsta
    }
    return coreContracts
  }

  async deployVSTAContractsMainnet(treasurySigAddress, deploymentState) {
    const VSTAStakingFactory = await this.getFactory("VSTAStaking")
    const communityIssuanceFactory = await this.getFactory("CommunityIssuance")
    const VSTATokenFactory = await this.getFactory("VSTAToken")

    const VSTAStaking = await this.loadOrDeploy(VSTAStakingFactory, 'VSTAStaking', deploymentState)
    const communityIssuance = await this.loadOrDeploy(communityIssuanceFactory, 'communityIssuance', deploymentState)

    // Deploy VSTA Token, passing Community Issuance and Factory addresses to the constructor
    const VSTAToken = await this.loadOrDeploy(
      VSTATokenFactory,
      'VSTAToken',
      deploymentState,
      [treasurySigAddress]
    )

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('VSTAStaking', deploymentState)
      await this.verifyContract('communityIssuance', deploymentState)
      await this.verifyContract('VSTAToken', deploymentState, [treasurySigAddress])
    }

    const VSTAContracts = {
      VSTAStaking,
      communityIssuance,
      VSTAToken
    }
    return VSTAContracts
  }

  async deployUnipoolMainnet(deploymentState) {
    const unipoolFactory = await this.getFactory("Unipool")
    const unipool = await this.loadOrDeploy(unipoolFactory, 'unipool', deploymentState)

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('unipool', deploymentState)
    }

    return unipool
  }

  async deployMultiTroveGetterMainnet(liquityCore, deploymentState) {
    const multiTroveGetterFactory = await this.getFactory("MultiTroveGetter")
    const multiTroveGetterParams = [
      liquityCore.troveManager.address,
      liquityCore.sortedTroves.address
    ]
    const multiTroveGetter = await this.loadOrDeploy(
      multiTroveGetterFactory,
      'multiTroveGetter',
      deploymentState,
      multiTroveGetterParams
    )

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('multiTroveGetter', deploymentState, multiTroveGetterParams)
    }

    return multiTroveGetter
  }
  // --- Connector methods ---

  async isOwnershipRenounced(contract) {
    let isInitialized = false;
    try {
      isInitialized = await contract.isInitialized();
    }
    catch {
    }

    const zeroAddressOwner = ((await contract.owner()) == ZERO_ADDRESS) || isInitialized;
    console.log("%s Is Initalized / Renounced Ownership: %s", await contract.NAME(), zeroAddressOwner);
    return zeroAddressOwner;
  }
  // Connect contracts to their dependencies
  async connectCoreContractsMainnet(contracts, VSTAContracts, chainlinkProxyAddress, chainlinkFlagAddress, multiSign, treasury, BTCAddress) {
    console.log("Chainlink addr ", chainlinkProxyAddress);
    const gasPrice = this.configParams.GAS_PRICE

    await this.isOwnershipRenounced(contracts.priceFeed) ||
      await this.sendAndWaitForTransaction(contracts.priceFeed.setAddresses(chainlinkProxyAddress, chainlinkFlagAddress, contracts.tellorCaller.address, { gasPrice }))

    await this.isOwnershipRenounced(contracts.sortedTroves) ||
      await this.sendAndWaitForTransaction(contracts.sortedTroves.setParams(
        contracts.troveManager.address,
        contracts.borrowerOperations.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.lockedVsta) ||
      await this.sendAndWaitForTransaction(contracts.lockedVsta.setAddresses(
        VSTAContracts.VSTAToken.address,
        treasury,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.vestaParameters) ||
      await this.sendAndWaitForTransaction(contracts.vestaParameters.setAddresses(
        contracts.activePool.address,
        contracts.defaultPool.address,
        contracts.priceFeed.address,
        multiSign,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.troveManager) ||
      await this.sendAndWaitForTransaction(contracts.troveManager.setAddresses(
        contracts.borrowerOperations.address,
        contracts.stabilityPoolManager.address,
        contracts.gasPool.address,
        contracts.collSurplusPool.address,
        contracts.vstToken.address,
        contracts.sortedTroves.address,
        VSTAContracts.VSTAStaking.address,
        contracts.vestaParameters.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.borrowerOperations) ||
      await this.sendAndWaitForTransaction(contracts.borrowerOperations.setAddresses(
        contracts.troveManager.address,
        contracts.stabilityPoolManager.address,
        contracts.gasPool.address,
        contracts.collSurplusPool.address,
        contracts.sortedTroves.address,
        contracts.vstToken.address,
        VSTAContracts.VSTAStaking.address,
        contracts.vestaParameters.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.stabilityPoolETH) ||
      await this.sendAndWaitForTransaction(contracts.stabilityPoolETH.setAddresses(
        ZERO_ADDRESS,
        contracts.borrowerOperations.address,
        contracts.troveManager.address,
        contracts.vstToken.address,
        contracts.sortedTroves.address,
        VSTAContracts.communityIssuance.address,
        contracts.vestaParameters.address,
        { gasPrice }
      ))


    await this.isOwnershipRenounced(contracts.stabilityPoolBTC) ||
      await this.sendAndWaitForTransaction(contracts.stabilityPoolBTC.setAddresses(
        ZERO_ADDRESS,
        contracts.borrowerOperations.address,
        contracts.troveManager.address,
        contracts.vstToken.address,
        contracts.sortedTroves.address,
        VSTAContracts.communityIssuance.address,
        contracts.vestaParameters.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.stabilityPoolManager) ||
      await this.sendAndWaitForTransaction(contracts.stabilityPoolManager.setAddresses(
        contracts.stabilityPoolETH.address,
        contracts.stabilityPoolBTC.address,
        BTCAddress,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.activePool) ||
      await this.sendAndWaitForTransaction(contracts.activePool.setAddresses(
        contracts.borrowerOperations.address,
        contracts.troveManager.address,
        contracts.stabilityPoolManager.address,
        contracts.defaultPool.address,
        contracts.collSurplusPool.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.defaultPool) ||
      await this.sendAndWaitForTransaction(contracts.defaultPool.setAddresses(
        contracts.troveManager.address,
        contracts.activePool.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.collSurplusPool) ||
      await this.sendAndWaitForTransaction(contracts.collSurplusPool.setAddresses(
        contracts.borrowerOperations.address,
        contracts.troveManager.address,
        contracts.activePool.address,
        { gasPrice }
      ))

    // set contracts in HintHelpers
    await this.isOwnershipRenounced(contracts.hintHelpers) ||
      await this.sendAndWaitForTransaction(contracts.hintHelpers.setAddresses(
        contracts.sortedTroves.address,
        contracts.troveManager.address,
        contracts.vestaParameters.address,
        { gasPrice }
      ))
  }

  async connectVSTAContractsToCoreMainnet(VSTAContracts, coreContracts, treasury) {
    const gasPrice = this.configParams.GAS_PRICE
    await this.isOwnershipRenounced(VSTAContracts.VSTAStaking) ||
      await this.sendAndWaitForTransaction(VSTAContracts.VSTAStaking.setAddresses(
        VSTAContracts.VSTAToken.address,
        coreContracts.vstToken.address,
        coreContracts.troveManager.address,
        coreContracts.borrowerOperations.address,
        coreContracts.activePool.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(VSTAContracts.communityIssuance) ||
      await this.sendAndWaitForTransaction(VSTAContracts.communityIssuance.setAddresses(
        VSTAContracts.VSTAToken.address,
        coreContracts.stabilityPoolManager.address,
        treasury,
        { gasPrice }
      ))
  }

  async connectUnipoolMainnet(uniPool, VSTAContracts, VSTWETHPairAddr, duration) {
    const gasPrice = this.configParams.GAS_PRICE
    await this.isOwnershipRenounced(uniPool) ||
      await this.sendAndWaitForTransaction(uniPool.setParams(VSTAContracts.VSTAToken.address, VSTWETHPairAddr, duration, { gasPrice }))
  }

  // --- Verify on Ethrescan ---
  async verifyContract(name, deploymentState, constructorArguments = []) {
    if (!deploymentState[name] || !deploymentState[name].address) {
      console.error(`  --> No deployment state for contract ${name}!!`)
      return
    }
    if (deploymentState[name].verification) {
      console.log(`Contract ${name} already verified`)
      return
    }

    try {
      await this.hre.run("verify:verify", {
        address: deploymentState[name].address,
        constructorArguments,
      })
    } catch (error) {
      // if it was already verified, it’s like a success, so let’s move forward and save it
      if (error.name != 'NomicLabsHardhatPluginError') {
        console.error(`Error verifying: ${error.name}`)
        console.error(error)
        return
      }
    }

    deploymentState[name].verification = `${this.configParams.ETHERSCAN_BASE_URL}/${deploymentState[name].address}#code`

    this.saveDeployment(deploymentState)
  }

  // --- Helpers ---

  async logContractObjects(contracts) {
    console.log(`Contract objects addresses:`)
    for (const contractName of Object.keys(contracts)) {
      console.log(`${contractName}: ${contracts[contractName].address}`);
    }
  }
}

module.exports = MainnetDeploymentHelper
