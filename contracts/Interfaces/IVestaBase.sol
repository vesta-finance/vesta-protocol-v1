// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "./BaseVestaParameters.sol";

interface IVestaBase {
	event VaultParametersBaseChanged(address indexed newAddress);

	function vestaParams() external view returns (BaseVestaParameters);
}
