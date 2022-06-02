pragma solidity ^0.8.10;

interface IVestaWrapper {
	function wrap(uint256 amount) external returns (bool);

	function unwrap(uint256 amount) external returns (bool);
}
