// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract CollStakingManagerMock {
    
    using SafeERC20 for IERC20;

	mapping(address => bool) supportedTokens;

    mapping(address => mapping(address => uint256)) balances;

	function isSupportedAsset(address _asset) external view returns (bool) {
        return supportedTokens[_asset];
    }

	function setSupportedTokens(address _asset, bool isSupported) external {
        supportedTokens[_asset] = isSupported;
    }

	function stakeCollaterals(address _asset, uint256 _amount) external {
        IERC20(_asset).safeTransferFrom(msg.sender, address(this), _amount);
    }

	function unstakeCollaterals(address _asset, uint256 _amount) external {
        IERC20(_asset).safeTransfer(msg.sender, _amount);
    }
}
