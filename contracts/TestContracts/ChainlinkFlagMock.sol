pragma solidity ^0.8.10;
import "../VSTA/CommunityIssuance.sol";

import "@chainlink/contracts/src/v0.8/interfaces/FlagsInterface.sol";

contract ChainlinkFlagMock is FlagsInterface {
	function getFlag(address) external view override returns (bool) {
		return false;
	}

	function getFlags(address[] calldata)
		external
		view
		override
		returns (bool[] memory aa)
	{
		return aa;
	}

	function raiseFlag(address) external override {}

	function raiseFlags(address[] calldata) external override {}

	function lowerFlags(address[] calldata) external override {}

	function setRaisingAccessController(address) external override {}
}
