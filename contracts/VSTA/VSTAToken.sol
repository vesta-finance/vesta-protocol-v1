// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../Dependencies/CheckContract.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../Dependencies/ERC20Permit.sol";

contract VSTAToken is CheckContract, ERC20Permit {
	using SafeMath for uint256;

	// uint for use with SafeMath
	uint256 internal _1_MILLION = 1e24; // 1e6 * 1e18 = 1e24

	// uint256 internal immutable lpRewardsEntitlement;

	constructor(address _treasurySig) ERC20("Vesta", "VSTA") {
		uint256 lockedVSTA = _1_MILLION; //TODO
		uint256 ethStabilityPoolSupply = 333_334 ether;
		uint256 btcStabilityPoolSupply = 333_333 ether;

		uint256 totalForExecutions = lockedVSTA
			.add(ethStabilityPoolSupply)
			.add(btcStabilityPoolSupply);

		_mint(msg.sender, totalForExecutions);

		// uint256 _lpRewardsEntitlement = _1_MILLION.mul(4).div(3); // Allocate 1.33 million for LP rewards
		// lpRewardsEntitlement = _lpRewardsEntitlement;
		// _mint(msg.sender, _lpRewardsEntitlement);

		uint256 multisigEntitlement = _1_MILLION.mul(100).sub(
			totalForExecutions
		);

		_mint(_treasurySig, multisigEntitlement);
	}
}
