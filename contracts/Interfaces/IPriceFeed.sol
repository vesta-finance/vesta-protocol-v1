// SPDX-License-Identifier: MIT
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

pragma solidity ^0.8.10;

interface IPriceFeed {
	struct ChainlinkResponse {
		uint80 roundId;
		int256 answer;
		uint256 timestamp;
		bool success;
		uint8 decimals;
	}

	struct TellorResponse {
		bool ifRetrieve;
		uint256 value;
		uint256 timestamp;
		bool success;
	}

	struct RegisterOracle {
		AggregatorV3Interface chainLinkOracle;
		uint256 tellorId;
		bool isRegistered;
	}

	enum Status {
		chainlinkWorking,
		usingTellorChainlinkUntrusted,
		bothOraclesUntrusted,
		usingTellorChainlinkFrozen,
		usingChainlinkTellorUntrusted
	}

	// --- Events ---
	event PriceFeedStatusChanged(Status newStatus);
	event LastGoodPriceUpdated(
		address indexed token,
		uint256 _lastGoodPrice
	);
	event RegisteredNewOracle(
		address indexed token,
		address indexed chainLinkAggregator,
		uint256 indexed tellorId
	);

	// --- Function ---
	function fetchPrice(address _token) external returns (uint256);
}
