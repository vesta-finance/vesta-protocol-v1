// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";

contract OwnableDeployer is Ownable {
	address internal DEPLOYER;

	constructor() {
		DEPLOYER = msg.sender;
	}

	modifier onlyDeployerOrOwner() {
		require(
			msg.sender == owner() || msg.sender == DEPLOYER,
			"OwnableDeployer: Do not have the permission"
		);
		_;
	}
}
