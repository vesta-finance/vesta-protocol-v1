const externalAddrs = {
  // https://data.chain.link/eth-usd
  CHAINLINK_ETHUSD_PROXY: "0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8",
  CHAINLINK_FLAG_HEALTH: "0x491B1dDA0A8fa069bbC1125133A975BF4e85a91b",
  // https://docs.tellor.io/tellor/integration/reference-page
  TELLOR_MASTER: "0xbc2f9E092ac5CED686440E5062D11D6543202B24",
  // https://uniswap.org/docs/v2/smart-contracts/factory/
  // https://github.com/Uniswap/v3-periphery/blob/main/deploys.md
  UNISWAP_V3_FACTORY: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  UNISWAP_V3_POSITION_MANAGER: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  WETH_ERC20: "0xB47e6A5f8b33b3F17603C83a0535A9dcD7E32681",
}

const vestaAddresses = {
  ADMIN_MULTI: "0x87209dc4B76b14B67BC5E5e5c0737E7d002a219c",
  VSTA_SAFE: "0x20c81d658aae3a8580d990e441a9ef2c9809be74",  //  Hardhat dev address
  DEPLOYER: "0x31c57298578f7508B5982062cfEc5ec8BD346247" // hardhat first account
}

const beneficiaries = {
  TEST_INVESTOR_A: "0xdad05aa3bd5a4904eb2a9482757be5da8d554b3d",
  TEST_INVESTOR_B: "0x625b473f33b37058bf8b9d4c3d3f9ab5b896996a",
  TEST_INVESTOR_C: "0x9ea530178b9660d0fae34a41a02ec949e209142e",
  TEST_INVESTOR_D: "0xffbb4f4b113b05597298b9d8a7d79e6629e726e8",
  TEST_INVESTOR_E: "0x89ff871dbcd0a456fe92db98d190c38bc10d1cc1"
}

const OUTPUT_FILE = './mainnetDeployment/localForkDeploymentOutput.json'

const waitFunction = async () => {
  // Fast forward time 1000s (local mainnet fork only)
  ethers.provider.send("evm_increaseTime", [1000])
  ethers.provider.send("evm_mine")
}

const GAS_PRICE = 1000
const TX_CONFIRMATIONS = 1 // for local fork test

module.exports = {
  externalAddrs,
  vestaAddresses,
  beneficiaries,
  OUTPUT_FILE,
  waitFunction,
  GAS_PRICE,
  TX_CONFIRMATIONS,
};
