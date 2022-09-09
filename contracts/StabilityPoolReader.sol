pragma solidity ^0.8.10;

import { StabilityPool } from "./StabilityPool.sol";
import { CommunityIssuance } from "./VSTA/CommunityIssuance.sol";

contract StabilityPoolReader {
	struct RealtimeData {
		uint256 snapG;
		uint256 snapP;
		uint128 snapEpoch;
		uint128 snapScale;
	}

	CommunityIssuance private communityIssuance;

	constructor(CommunityIssuance _communityIssuance) {
		communityIssuance = _communityIssuance;
	}

	function getPendingIssuanceRewards(StabilityPool _stabilityPoolAddr, address _user)
		external
		view
		returns (uint256)
	{
		StabilityPool stabilityPool = _stabilityPoolAddr;
		RealtimeData memory realTimeData = RealtimeData(0, 0, 0, 0);

		uint256 initialDeposit = stabilityPool.deposits(_user);
		if (initialDeposit == 0) return 0;

		(
			,
			realTimeData.snapP,
			realTimeData.snapG,
			realTimeData.snapScale,
			realTimeData.snapEpoch
		) = stabilityPool.depositSnapshots(_user);

		uint128 systemCurrentEpoch = stabilityPool.currentEpoch();
		uint128 systemCurrentScale = stabilityPool.currentScale();

		if (
			systemCurrentEpoch != realTimeData.snapEpoch ||
			systemCurrentScale - realTimeData.snapScale > 1
		) {
			return stabilityPool.getDepositorVSTAGain(_user);
		}

		uint256 epochToScaleToG = stabilityPool.epochToScaleToG(
			systemCurrentEpoch,
			systemCurrentScale
		);

		(uint256 issuance, , ) = _estimateNextIssueVSTA(address(stabilityPool));
		epochToScaleToG += _updateG(stabilityPool, issuance);

		bool isSystemAhead = systemCurrentScale > realTimeData.snapScale;

		uint256 firstPortion = isSystemAhead
			? stabilityPool.epochToScaleToG(realTimeData.snapEpoch, realTimeData.snapScale)
			: epochToScaleToG;

		uint256 secondPortion = isSystemAhead
			? epochToScaleToG
			: stabilityPool.epochToScaleToG(realTimeData.snapEpoch, realTimeData.snapScale + 1);

		return
			_getVSTAGainFromSnapshots(
				stabilityPool,
				initialDeposit,
				[firstPortion, secondPortion],
				[realTimeData.snapG, realTimeData.snapP]
			);
	}

	function _updateG(StabilityPool _stabilityPool, uint256 _VSTAIssuance)
		internal
		view
		returns (uint256)
	{
		uint256 totalVST = _stabilityPool.getTotalVSTDeposits();
		if (totalVST == 0 || _VSTAIssuance == 0) {
			return 0;
		}

		uint256 VSTANumerator = (_VSTAIssuance * _stabilityPool.DECIMAL_PRECISION()) +
			_stabilityPool.lastVSTAError();

		return (VSTANumerator / totalVST) * _stabilityPool.P();
	}

	function _getVSTAGainFromSnapshots(
		StabilityPool _stabilityPool,
		uint256 initialStake,
		uint256[2] memory _positions,
		uint256[2] memory G_P_Snapshot
	) internal view returns (uint256) {
		uint256 firstPortion = _positions[0] - G_P_Snapshot[0];
		uint256 secondPortion = _positions[1] / _stabilityPool.SCALE_FACTOR();

		uint256 VSTAGain = (initialStake * (firstPortion + secondPortion)) /
			(G_P_Snapshot[1]) /
			(_stabilityPool.DECIMAL_PRECISION());

		return VSTAGain;
	}

	function getIssuanceLeftInPool(address _pool) external view returns (uint256) {
		(, uint256 issued, uint256 totalSupply) = _estimateNextIssueVSTA(_pool);

		return totalSupply - issued;
	}

	function _estimateNextIssueVSTA(address _pool)
		internal
		view
		returns (
			uint256 issuance_,
			uint256 totalIssuance_,
			uint256 _maxSupply
		)
	{
		(
			,
			uint256 totalRewardIssued,
			uint256 lastUpdateTime,
			uint256 totalRewardSupply,
			uint256 rewardDistributionPerMin
		) = communityIssuance.stabilityPoolRewards(_pool);

		uint256 maxPoolSupply = totalRewardSupply;
		uint256 totalIssued = totalRewardIssued;

		if (totalIssued >= maxPoolSupply) return (0, totalIssued, maxPoolSupply);

		uint256 timePassed = (block.timestamp - lastUpdateTime) / (60);
		uint256 issuance = rewardDistributionPerMin * timePassed;

		uint256 totalIssuance = issuance + totalIssued;

		if (totalIssuance > maxPoolSupply) {
			issuance = maxPoolSupply - totalIssued;
			totalIssuance = maxPoolSupply;
		}

		return (issuance, totalIssuance, maxPoolSupply);
	}
}
