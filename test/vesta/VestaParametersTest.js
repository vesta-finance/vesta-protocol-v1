const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('VestaParameters', async accounts => {
    const ZERO_ADDRESS = th.ZERO_ADDRESS
    const assertRevert = th.assertRevert
    const DECIMAL_PRECISION = toBN(dec(1, 18))
    const [owner, user, A, C, B, multisig] = accounts;

    let contracts
    let priceFeed
    let troveManager
    let activePool
    let defaultPool
    let borrowerOperations
    let vestaParameters
    let erc20

    let MCR
    let CCR
    let GAS_COMPENSATION
    let MIN_NET_DEBT
    let PERCENT_DIVISOR
    let BORROWING_FEE_FLOOR
    let MAX_BORROWING_FEE
    let REDEMPTION_FEE_FLOOR

    const openTrove = async (params) => th.openTrove(contracts, params)

    function applyDecimalPrecision(value) {
        return DECIMAL_PRECISION.div(toBN(1000)).mul(value)
    }


    describe("Vesta Parameters", async () => {
        beforeEach(async () => {
            contracts = await deploymentHelper.deployLiquityCore()
            contracts.troveManager = await TroveManagerTester.new()
            const VSTAContracts = await deploymentHelper.deployVSTAContractsHardhat()

            priceFeed = contracts.priceFeedTestnet
            troveManager = contracts.troveManager
            activePool = contracts.activePool
            defaultPool = contracts.defaultPool
            borrowerOperations = contracts.borrowerOperations
            vestaParameters = contracts.vestaParameters
            erc20 = contracts.erc20

            MCR = await vestaParameters.MCR_DEFAULT()
            CCR = await vestaParameters.CCR_DEFAULT()
            GAS_COMPENSATION = await vestaParameters.VST_GAS_COMPENSATION_DEFAULT()
            MIN_NET_DEBT = await vestaParameters.MIN_NET_DEBT_DEFAULT()
            PERCENT_DIVISOR = await vestaParameters.PERCENT_DIVISOR_DEFAULT()
            BORROWING_FEE_FLOOR = await vestaParameters.BORROWING_FEE_FLOOR_DEFAULT()
            MAX_BORROWING_FEE = await vestaParameters.MAX_BORROWING_FEE_DEFAULT()
            REDEMPTION_FEE_FLOOR = await vestaParameters.REDEMPTION_FEE_FLOOR_DEFAULT()

            let index = 0;
            for (const acc of accounts) {
                await erc20.mint(acc, await web3.eth.getBalance(acc))
                index++;

                if (index >= 20)
                    break;
            }

            await deploymentHelper.connectCoreContracts(contracts, VSTAContracts)
            await deploymentHelper.connectVSTAContractsToCore(VSTAContracts, contracts)
        })

        it("Try to edit Parameters has User, Revert Transactions", async () => {
            await assertRevert(vestaParameters.setPriceFeed(priceFeed.address, { from: user }));
            await assertRevert(vestaParameters.setAsDefault(ZERO_ADDRESS, { from: user }));
            await assertRevert(vestaParameters.setCollateralParameters(
                ZERO_ADDRESS,
                MCR,
                CCR,
                GAS_COMPENSATION,
                MIN_NET_DEBT,
                PERCENT_DIVISOR,
                BORROWING_FEE_FLOOR,
                MAX_BORROWING_FEE,
                REDEMPTION_FEE_FLOOR,
                { from: user }
            ))

            await assertRevert(vestaParameters.setMCR(ZERO_ADDRESS, MCR, { from: user }))
            await assertRevert(vestaParameters.setCCR(ZERO_ADDRESS, CCR, { from: user }))
            await assertRevert(vestaParameters.setVSTGasCompensation(ZERO_ADDRESS, GAS_COMPENSATION, { from: user }))
            await assertRevert(vestaParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT, { from: user }))
            await assertRevert(vestaParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR, { from: user }))
            await assertRevert(vestaParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR, { from: user }))
            await assertRevert(vestaParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE, { from: user }))
            await assertRevert(vestaParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR, { from: user }))
        })

        it("sanitizeParameters: User call sanitizeParameters on Non-Configured Collateral - Set Default Values", async () => {
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS, { from: user })

            assert.equal(MCR.toString(), (await vestaParameters.MCR(ZERO_ADDRESS)))
            assert.equal(CCR.toString(), (await vestaParameters.CCR(ZERO_ADDRESS)))
            assert.equal(GAS_COMPENSATION.toString(), (await vestaParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)))
            assert.equal(MIN_NET_DEBT.toString(), (await vestaParameters.MIN_NET_DEBT(ZERO_ADDRESS)))
            assert.equal(PERCENT_DIVISOR.toString(), (await vestaParameters.PERCENT_DIVISOR(ZERO_ADDRESS)))
            assert.equal(BORROWING_FEE_FLOOR.toString(), (await vestaParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)))
            assert.equal(MAX_BORROWING_FEE.toString(), (await vestaParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)))
            assert.equal(REDEMPTION_FEE_FLOOR.toString(), (await vestaParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)))
        })

        it("sanitizeParameters: User call sanitizeParamaters on Configured Collateral - Ignore it", async () => {
            const newMCR = toBN("100000000000000000000")
            const newCCR = toBN("100000000000000000000")
            const newGasComp = dec(200, 18)
            const newMinNetDebt = dec(1800, 18);
            const newPercentDivisor = toBN(200)
            const newBorrowingFeeFloor = toBN(50)
            const newMaxBorrowingFee = toBN(200)
            const newRedemptionFeeFloor = toBN(100)

            const expectedBorrowingFeeFloor = applyDecimalPrecision(newBorrowingFeeFloor);
            const expectedMaxBorrowingFee = applyDecimalPrecision(newMaxBorrowingFee);
            const expectedRedemptionFeeFloor = applyDecimalPrecision(newRedemptionFeeFloor);

            await vestaParameters.setCollateralParameters(
                ZERO_ADDRESS,
                newMCR,
                newCCR,
                newGasComp,
                newMinNetDebt,
                newPercentDivisor,
                newBorrowingFeeFloor,
                newMaxBorrowingFee,
                newRedemptionFeeFloor,
                { from: owner }
            )

            await vestaParameters.sanitizeParameters(ZERO_ADDRESS, { from: user })

            assert.equal(newMCR.toString(), (await vestaParameters.MCR(ZERO_ADDRESS)));
            assert.equal(newCCR.toString(), (await vestaParameters.CCR(ZERO_ADDRESS)));
            assert.equal(newGasComp.toString(), (await vestaParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)));
            assert.equal(newMinNetDebt.toString(), (await vestaParameters.MIN_NET_DEBT(ZERO_ADDRESS)));
            assert.equal(newPercentDivisor.toString(), (await vestaParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));
            assert.equal(expectedBorrowingFeeFloor.toString(), (await vestaParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
            assert.equal(expectedMaxBorrowingFee.toString(), (await vestaParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));
            assert.equal(expectedRedemptionFeeFloor.toString(), (await vestaParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));
        })

        it("setPriceFeed: Owner change parameter - Failing SafeCheck", async () => {
            await assertRevert(vestaParameters.setPriceFeed(ZERO_ADDRESS))
        })

        it("setPriceFeed: Owner change parameter - Valid Check", async () => {
            await vestaParameters.setPriceFeed(priceFeed.address)
        })

        it("setMCR: Owner change parameter - Failing SafeCheck", async () => {
            const min = toBN("1010000000000000000");
            const max = toBN("100000000000000000000")
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await assertRevert(vestaParameters.setMCR(ZERO_ADDRESS, min.sub(toBN(1))))
            await assertRevert(vestaParameters.setMCR(ZERO_ADDRESS, max.add(toBN(1))))
        })

        it("setMCR: Owner change parameter - Valid SafeCheck", async () => {
            const min = toBN("1010000000000000000");
            const max = toBN("100000000000000000000")
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await vestaParameters.setMCR(ZERO_ADDRESS, min);
            assert.equal(min.toString(), (await vestaParameters.MCR(ZERO_ADDRESS)));

            await vestaParameters.setMCR(ZERO_ADDRESS, max);
            assert.equal(max.toString(), (await vestaParameters.MCR(ZERO_ADDRESS)));
        })

        it("setCCR: Owner change parameter - Failing SafeCheck", async () => {
            const min = toBN("1200000000000000000");
            const max = toBN("100000000000000000000")
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await assertRevert(vestaParameters.setCCR(ZERO_ADDRESS, min.sub(toBN(1))))
            await assertRevert(vestaParameters.setCCR(ZERO_ADDRESS, max.add(toBN(1))))
        })

        it("setCCR: Owner change parameter - Valid SafeCheck", async () => {
            const min = toBN("1200000000000000000");
            const max = toBN("100000000000000000000")
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await vestaParameters.setCCR(ZERO_ADDRESS, min);
            assert.equal(min.toString(), (await vestaParameters.CCR(ZERO_ADDRESS)));

            await vestaParameters.setCCR(ZERO_ADDRESS, max);
            assert.equal(max.toString(), (await vestaParameters.CCR(ZERO_ADDRESS)));
        })

        it("setVSTGasCompensation: Owner change parameter - Failing SafeCheck", async () => {
            const min = toBN(dec(1, 18));
            const max = toBN(dec(200, 18))
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await assertRevert(vestaParameters.setVSTGasCompensation(ZERO_ADDRESS, min.sub(toBN(1))))
            await assertRevert(vestaParameters.setVSTGasCompensation(ZERO_ADDRESS, max.add(toBN(1))))
        })

        it("setVSTGasCompensation: Owner change parameter - Valid SafeCheck", async () => {
            const min = toBN(dec(1, 18));
            const max = toBN(dec(200, 18))
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await vestaParameters.setVSTGasCompensation(ZERO_ADDRESS, min);
            assert.equal(min.toString(), (await vestaParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)));

            await vestaParameters.setVSTGasCompensation(ZERO_ADDRESS, max);
            assert.equal(max.toString(), (await vestaParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)));
        })

        it("setMinNetDebt: Owner change parameter - Failing SafeCheck", async () => {
            const max = toBN(dec(1800, 18))

            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)
            await assertRevert(vestaParameters.setMinNetDebt(ZERO_ADDRESS, max.add(toBN(1))))
        })

        it("setMinNetDebt: Owner change parameter - Valid SafeCheck", async () => {
            const min = toBN(0);
            const max = toBN(dec(1800, 18))
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await vestaParameters.setMinNetDebt(ZERO_ADDRESS, min);
            assert.equal(min.toString(), (await vestaParameters.MIN_NET_DEBT(ZERO_ADDRESS)));

            await vestaParameters.setMinNetDebt(ZERO_ADDRESS, max);
            assert.equal(max.toString(), (await vestaParameters.MIN_NET_DEBT(ZERO_ADDRESS)));
        })

        it("setPercentDivisor: Owner change parameter - Failing SafeCheck", async () => {
            const min = toBN(2);
            const max = toBN(200)
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await assertRevert(vestaParameters.setPercentDivisor(ZERO_ADDRESS, min.sub(toBN(1))))
            await assertRevert(vestaParameters.setPercentDivisor(ZERO_ADDRESS, max.add(toBN(1))))
        })

        it("setPercentDivisor: Owner change parameter - Valid SafeCheck", async () => {
            const min = toBN(2);
            const max = toBN(200)

            await vestaParameters.setPercentDivisor(ZERO_ADDRESS, min);
            assert.equal(min.toString(), (await vestaParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));

            await vestaParameters.setPercentDivisor(ZERO_ADDRESS, max);
            assert.equal(max.toString(), (await vestaParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));
        })

        it("setBorrowingFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
            const max = toBN(50)
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await assertRevert(vestaParameters.setBorrowingFeeFloor(ZERO_ADDRESS, max.add(toBN(1))))
        })

        it("setBorrowingFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
            const min = toBN(0);
            const max = toBN(50)

            const expectedMin = applyDecimalPrecision(min);
            const expectedMax = applyDecimalPrecision(max);

            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await vestaParameters.setBorrowingFeeFloor(ZERO_ADDRESS, min);
            assert.equal(expectedMin.toString(), (await vestaParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));

            await vestaParameters.setBorrowingFeeFloor(ZERO_ADDRESS, max);
            assert.equal(expectedMax.toString(), (await vestaParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
        })

        it("setMaxBorrowingFee: Owner change parameter - Failing SafeCheck", async () => {
            const max = toBN(200)
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await assertRevert(vestaParameters.setMaxBorrowingFee(ZERO_ADDRESS, max.add(toBN(1))))
        })

        it("setMaxBorrowingFee: Owner change parameter - Valid SafeCheck", async () => {
            const min = toBN(0);
            const max = toBN(200)

            const expectedMin = applyDecimalPrecision(min);
            const expectedMax = applyDecimalPrecision(max);

            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await vestaParameters.setMaxBorrowingFee(ZERO_ADDRESS, min);
            assert.equal(expectedMin.toString(), (await vestaParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));

            await vestaParameters.setMaxBorrowingFee(ZERO_ADDRESS, max);
            assert.equal(expectedMax.toString(), (await vestaParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));
        })

        it("setRedemptionFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
            const min = toBN(3);
            const max = toBN(100)

            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await assertRevert(vestaParameters.setRedemptionFeeFloor(ZERO_ADDRESS, min.sub(toBN(1))))
            await assertRevert(vestaParameters.setRedemptionFeeFloor(ZERO_ADDRESS, max.add(toBN(1))))
        })

        it("setRedemptionFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
            const min = toBN(3);
            const max = toBN(100)

            const expectedMin = applyDecimalPrecision(min);
            const expectedMax = applyDecimalPrecision(max);

            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)

            await vestaParameters.setRedemptionFeeFloor(ZERO_ADDRESS, min);
            assert.equal(expectedMin.toString(), (await vestaParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));

            await vestaParameters.setRedemptionFeeFloor(ZERO_ADDRESS, max);
            assert.equal(expectedMax.toString(), (await vestaParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));
        })

        it("setCollateralParameters: Owner change parameter - Failing SafeCheck", async () => {
            await assertRevert(
                vestaParameters.setCollateralParameters(
                    ZERO_ADDRESS,
                    toBN("100000000000000000001"),
                    CCR,
                    GAS_COMPENSATION,
                    MIN_NET_DEBT,
                    PERCENT_DIVISOR,
                    BORROWING_FEE_FLOOR,
                    MAX_BORROWING_FEE,
                    REDEMPTION_FEE_FLOOR
                )
            )

            await assertRevert(
                vestaParameters.setCollateralParameters(
                    ZERO_ADDRESS,
                    MCR,
                    toBN("100000000000000000001"),
                    GAS_COMPENSATION,
                    MIN_NET_DEBT,
                    PERCENT_DIVISOR,
                    BORROWING_FEE_FLOOR,
                    MAX_BORROWING_FEE,
                    REDEMPTION_FEE_FLOOR
                )
            )

            await assertRevert(
                vestaParameters.setCollateralParameters(
                    ZERO_ADDRESS,
                    MCR,
                    CCR,
                    dec(201, 18),
                    MIN_NET_DEBT,
                    PERCENT_DIVISOR,
                    BORROWING_FEE_FLOOR,
                    MAX_BORROWING_FEE,
                    REDEMPTION_FEE_FLOOR
                )
            )

            await assertRevert(
                vestaParameters.setCollateralParameters(
                    ZERO_ADDRESS,
                    MCR,
                    CCR,
                    GAS_COMPENSATION,
                    dec(1801, 18),
                    PERCENT_DIVISOR,
                    BORROWING_FEE_FLOOR,
                    MAX_BORROWING_FEE,
                    REDEMPTION_FEE_FLOOR
                )
            )

            await assertRevert(
                vestaParameters.setCollateralParameters(
                    ZERO_ADDRESS,
                    MCR,
                    CCR,
                    GAS_COMPENSATION,
                    MIN_NET_DEBT,
                    201,
                    BORROWING_FEE_FLOOR,
                    MAX_BORROWING_FEE,
                    REDEMPTION_FEE_FLOOR
                )
            )

            await assertRevert(
                vestaParameters.setCollateralParameters(
                    ZERO_ADDRESS,
                    MCR,
                    CCR,
                    GAS_COMPENSATION,
                    MIN_NET_DEBT,
                    PERCENT_DIVISOR,
                    51,
                    MAX_BORROWING_FEE,
                    REDEMPTION_FEE_FLOOR
                )
            )

            await assertRevert(
                vestaParameters.setCollateralParameters(
                    ZERO_ADDRESS,
                    MCR,
                    CCR,
                    GAS_COMPENSATION,
                    MIN_NET_DEBT,
                    PERCENT_DIVISOR,
                    BORROWING_FEE_FLOOR,
                    201,
                    REDEMPTION_FEE_FLOOR
                )
            )

            await assertRevert(
                vestaParameters.setCollateralParameters(
                    ZERO_ADDRESS,
                    MCR,
                    CCR,
                    GAS_COMPENSATION,
                    MIN_NET_DEBT,
                    PERCENT_DIVISOR,
                    BORROWING_FEE_FLOOR,
                    MAX_BORROWING_FEE,
                    101
                )
            )
        })

        it("setCollateralParameters: Owner change parameter - Valid SafeCheck Then Reset", async () => {
            const newMCR = toBN("100000000000000000000")
            const newCCR = toBN("100000000000000000000")
            const newGasComp = dec(200, 18)
            const newMinNetDebt = dec(1800, 18);
            const newPercentDivisor = toBN(200)
            const newBorrowingFeeFloor = toBN(50)
            const newMaxBorrowingFee = toBN(200)
            const newRedemptionFeeFloor = toBN(100)

            const expectedBorrowingFeeFloor = applyDecimalPrecision(newBorrowingFeeFloor);
            const expectedMaxBorrowingFee = applyDecimalPrecision(newMaxBorrowingFee);
            const expectedRedemptionFeeFloor = applyDecimalPrecision(newRedemptionFeeFloor);

            await vestaParameters.setCollateralParameters(
                ZERO_ADDRESS,
                newMCR,
                newCCR,
                newGasComp,
                newMinNetDebt,
                newPercentDivisor,
                newBorrowingFeeFloor,
                newMaxBorrowingFee,
                newRedemptionFeeFloor,
                { from: owner }
            )

            assert.equal(newMCR.toString(), (await vestaParameters.MCR(ZERO_ADDRESS)));
            assert.equal(newCCR.toString(), (await vestaParameters.CCR(ZERO_ADDRESS)));
            assert.equal(newGasComp.toString(), (await vestaParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)));
            assert.equal(newMinNetDebt.toString(), (await vestaParameters.MIN_NET_DEBT(ZERO_ADDRESS)));
            assert.equal(newPercentDivisor.toString(), (await vestaParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));
            assert.equal(expectedBorrowingFeeFloor.toString(), (await vestaParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
            assert.equal(expectedMaxBorrowingFee.toString(), (await vestaParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));
            assert.equal(expectedRedemptionFeeFloor.toString(), (await vestaParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));

            await vestaParameters.setAsDefault(ZERO_ADDRESS);

            assert.equal(MCR.toString(), (await vestaParameters.MCR(ZERO_ADDRESS)));
            assert.equal(CCR.toString(), (await vestaParameters.CCR(ZERO_ADDRESS)));
            assert.equal(GAS_COMPENSATION.toString(), (await vestaParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)));
            assert.equal(MIN_NET_DEBT.toString(), (await vestaParameters.MIN_NET_DEBT(ZERO_ADDRESS)));
            assert.equal(PERCENT_DIVISOR.toString(), (await vestaParameters.PERCENT_DIVISOR(ZERO_ADDRESS)));
            assert.equal(BORROWING_FEE_FLOOR.toString(), (await vestaParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
            assert.equal(MAX_BORROWING_FEE.toString(), (await vestaParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)));
            assert.equal(REDEMPTION_FEE_FLOOR.toString(), (await vestaParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)));
        })

        it("openTrove(): Borrowing at zero base rate charges minimum fee with different borrowingFeeFloor", async () => {
            await vestaParameters.sanitizeParameters(ZERO_ADDRESS)
            await vestaParameters.sanitizeParameters(erc20.address)

            await vestaParameters.setBorrowingFeeFloor(ZERO_ADDRESS, 0)
            await vestaParameters.setBorrowingFeeFloor(erc20.address, 50);

            assert.equal(applyDecimalPrecision(toBN(0)).toString(), (await vestaParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)));
            assert.equal(applyDecimalPrecision(toBN(50)).toString(), (await vestaParameters.BORROWING_FEE_FLOOR(erc20.address)));

            await openTrove({ extraVSTAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
            await openTrove({ extraVSTAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

            await openTrove({ asset: erc20.address, extraVSTAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
            await openTrove({ asset: erc20.address, extraVSTAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

            const USDVRequest = toBN(dec(10000, 18))
            const txC = await borrowerOperations.openTrove(ZERO_ADDRESS, 0, th._100pct, USDVRequest, ZERO_ADDRESS, ZERO_ADDRESS, { value: dec(100, 'ether'), from: C })
            const txC_Asset = await borrowerOperations.openTrove(erc20.address, dec(100, 'ether'), th._100pct, USDVRequest, ZERO_ADDRESS, ZERO_ADDRESS, { from: C })
            const _VSTFee = toBN(th.getEventArgByName(txC, "VSTBorrowingFeePaid", "_VSTFee"))
            const _USDVFee_Asset = toBN(th.getEventArgByName(txC_Asset, "VSTBorrowingFeePaid", "_VSTFee"))

            const expectedFee = (await vestaParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)).mul(toBN(USDVRequest)).div(toBN(dec(1, 18)))
            const expectedFee_Asset = (await vestaParameters.BORROWING_FEE_FLOOR(erc20.address)).mul(toBN(USDVRequest)).div(toBN(dec(1, 18)))
            assert.isTrue(_VSTFee.eq(expectedFee))
            assert.isTrue(_USDVFee_Asset.eq(expectedFee_Asset))
        })
    })
})