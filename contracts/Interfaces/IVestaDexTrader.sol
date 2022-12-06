// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface IVestaDexTrader {
	/**
	 * @param traderSelector the Selector of the Dex you want to use. If not sure, you can find them in VestaDexTrader.sol
	 * @param tokenInOut the token0 is the one that will be swapped, the token1 is the one that will be returned
	 * @param data the encoded structure for the exchange function of a ITrader.
	 * @dev {data}'s structure should have 0 for expectedAmountIn and expectedAmountOut
	 */
	struct ManualExchange {
		bytes16 traderSelector;
		address[2] tokenInOut;
		bytes data;
	}

	/**
	 * exchange uses Vesta's traders but with your own routing.
	 * @param _receiver the wallet that will receives the output token
	 * @param _firstTokenIn the token that will be swapped
	 * @param _firstAmountIn the amount of Token In you will send
	 * @param _requests Your custom routing
	 * @return swapDatas_ elements are the amountOut from each swaps
	 *
	 * @dev this function only uses expectedAmountIn
	 */
	function exchange(
		address _receiver,
		address _firstTokenIn,
		uint256 _firstAmountIn,
		ManualExchange[] calldata _requests
	) external returns (uint256[] memory swapDatas_);

	function getAmountIn(uint256 _amountOut, ManualExchange[] calldata _requests)
		external
		returns (uint256 amountIn_);

	function getAmountOut(uint256 _amountIn, ManualExchange[] calldata _requests)
		external
		returns (uint256 amountOut_);

	/**
	 * isRegisteredTrader check if a contract is a Trader
	 * @param _trader address of the trader
	 * @return registered_ is true if the trader is registered
	 */
	function isRegisteredTrader(address _trader) external view returns (bool);

	/**
	 * getTraderAddressWithSelector get Trader address with selector
	 * @param _selector Trader's selector
	 * @return address_ Trader's address
	 */
	function getTraderAddressWithSelector(bytes16 _selector) external view returns (address);
}

