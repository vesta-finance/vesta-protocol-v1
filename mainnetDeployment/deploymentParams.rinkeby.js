const IsMainnet = false;

const externalAddrs = {
  // https://data.chain.link/eth-usd
  CHAINLINK_ETHUSD_PROXY: "0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8",
  CHAINLINK_FLAG_HEALTH: "0x491B1dDA0A8fa069bbC1125133A975BF4e85a91b",
  // https://docs.tellor.io/tellor/integration/reference-page
  TELLOR_MASTER: "0xbc2f9E092ac5CED686440E5062D11D6543202B24",
  // https://uniswap.org/docs/v2/smart-contracts/factory/
  // https://github.com/Uniswap/v3-periphery/blob/main/deploys.md
  // UNISWAP_V3_FACTORY: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  // UNISWAP_V3_POSITION_MANAGER: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  SUSHISWAP_V2_FACTORY: "0x00C5926aA0ad65c733e3fA6A04664690B47D2C00",
  SUSHISWAP_V2_ROUTER02: "0x2B0D4b5358f6BEf823e9d0d2de0F4ACF5b922e4b",
  WETH_ERC20: "0xB47e6A5f8b33b3F17603C83a0535A9dcD7E32681",
  REN_BTC: "NONE",
}

const vestaAddresses = {
  ADMIN_MULTI: "0x87209dc4B76b14B67BC5E5e5c0737E7d002a219c",
  VSTA_SAFE: "0x87209dc4B76b14B67BC5E5e5c0737E7d002a219c", // TODO
  DEPLOYER: "0x87209dc4B76b14B67BC5E5e5c0737E7d002a219c",
}

const beneficiaries = {
  "0x473fD837E0fFcc46CfFbf89B62aab6Fe65D4E992": 50,
  "0x15aD39c4e5aFF2D6aD278b3d335F48FDfB91e6FB": 50
}


const OUTPUT_FILE = './mainnetDeployment/rinkebyDeploymentOutput.json'

const delay = ms => new Promise(res => setTimeout(res, ms));
const waitFunction = async () => {
  return delay(90000) // wait 90s
}

const GAS_PRICE = 1000000000 // 1 Gwei
const TX_CONFIRMATIONS = 1

const ETHERSCAN_BASE_URL = 'https://rinkeby-explorer.arbitrum.io/address'

module.exports = {
  externalAddrs,
  vestaAddresses,
  beneficiaries,
  OUTPUT_FILE,
  waitFunction,
  GAS_PRICE,
  TX_CONFIRMATIONS,
  ETHERSCAN_BASE_URL,
  IsMainnet
};
