import { expect } from 'chai';
import * as anchor from '@coral-xyz/anchor';
import { BN, Program, Wallet } from '@coral-xyz/anchor';
import {
	BankrunContextWrapper,
	TEST_ADMIN_KEYPAIR,
} from './common/bankrunConnection';
import { startAnchor } from 'solana-bankrun';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	encodeName,
	VelocityVaults,
	VAULT_PROGRAM_ID,
	IDL,
	FeeUpdateStatus,
	getFeeUpdateAddressSync,
} from '../ts/sdk/lib';
import {
	BulkAccountLoader,
	VELOCITY_PROGRAM_ID,
	VelocityClient,
	getVariant,
	OracleSource,
	PEG_PRECISION,
	PERCENTAGE_PRECISION,
	PublicKey,
	QUOTE_PRECISION,
	TestClient,
	ZERO,
} from '@velocity-exchange/sdk';
import { TestBulkAccountLoader } from './common/testBulkAccountLoader';
import {
	assert,
	bootstrapSignerClientAndUserBankrun,
	initializeQuoteSpotMarket,
	initializeSolSpotMarket,
	mockUSDCMintBankrun,
	printTxLogs,
} from './common/testHelpers';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { mockOracleNoProgram } from './common/bankrunOracle';
import { BankrunProvider } from 'anchor-bankrun';

// ammInvariant == k == x * y
const mantissaSqrtScale = new BN(100_000);
const ammInitialQuoteAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);
const ammInitialBaseAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);

const redeemPeriod = new BN(1);

const TEN_PCT_FEE = new BN(PERCENTAGE_PRECISION.divn(10));
const TWENTY_PCT_FEE = new BN(PERCENTAGE_PRECISION.divn(5));
const FIFTY_PCT_MANAGEMENT_FEE = new BN(PERCENTAGE_PRECISION.divn(2));
const ONE_DAY_S = new BN(86400);
const ONE_WEEK_S = ONE_DAY_S.muln(7);

describe('feeUpdate', () => {
	let vaultProgram: Program<VelocityVaults>;
	const initialSolPerpPrice = 100;
	let adminVelocityClient: TestClient;
	let bulkAccountLoader: TestBulkAccountLoader;
	let bankrunContextWrapper: BankrunContextWrapper;
	let usdcMint: PublicKey;
	let solPerpOracle: PublicKey;
	const vaultName = 'fuel distribution vault';
	const commonVaultKey = getVaultAddressSync(
		VAULT_PROGRAM_ID,
		encodeName(vaultName)
	);
	const usdcAmount = new BN(1_000_000_000).mul(QUOTE_PRECISION);

	const managerSigner = Keypair.generate();
	let managerClient: VaultClient;
	let managerVelocityClient: VelocityClient;

	let adminClient: VaultClient;

	const user1Signer = Keypair.generate();
	let user1Client: VaultClient;
	let user1VelocityClient: VelocityClient;

	const user2Signer = Keypair.generate();
	let user2Client: VaultClient;
	let user2VelocityClient: VelocityClient;

	const user3Signer = Keypair.generate();
	let user3Client: VaultClient;
	let user3VelocityClient: VelocityClient;

	beforeEach(async () => {
		const context = await startAnchor(
			'',
			[
				{
					name: 'velocity',
					programId: new PublicKey(
						'vELoC1audYbSYVRXn1vPaV8Axoa9oU6BYmNGZZBDZ1P'
					),
				},
			],
			[]
		);

		// wrap the context to use it with the test helpers
		bankrunContextWrapper = new BankrunContextWrapper(context);

		vaultProgram = new Program<VelocityVaults>(
			IDL,
			bankrunContextWrapper.provider
		);

		bulkAccountLoader = new TestBulkAccountLoader(
			bankrunContextWrapper.connection.toConnection(),
			'processed',
			1
		);

		usdcMint = await mockUSDCMintBankrun(bankrunContextWrapper);

		solPerpOracle = await mockOracleNoProgram(
			bankrunContextWrapper,
			initialSolPerpPrice
		);

		const adminWallet = new Wallet(
			Keypair.fromSecretKey(Buffer.from(TEST_ADMIN_KEYPAIR))
			// Keypair.generate()
		);

		await bankrunContextWrapper.fundKeypair(
			adminWallet.payer,
			100 * LAMPORTS_PER_SOL
		);

		adminVelocityClient = new TestClient({
			connection: bankrunContextWrapper.connection.toConnection(),
			wallet: adminWallet,
			programID: new PublicKey(VELOCITY_PROGRAM_ID),
			opts: {
				commitment: 'confirmed',
			},
			activeSubAccountId: 0,
			perpMarketIndexes: [0],
			spotMarketIndexes: [0, 1],
			subAccountIds: [],
			oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
			accountSubscription: {
				type: 'polling',
				accountLoader: bulkAccountLoader as BulkAccountLoader,
			},
		});

		await adminVelocityClient.initialize(usdcMint, true);
		await adminVelocityClient.subscribe();

		await initializeQuoteSpotMarket(adminVelocityClient, usdcMint);
		await initializeSolSpotMarket(adminVelocityClient, solPerpOracle);

		await adminVelocityClient.initializePerpMarket(
			0,
			solPerpOracle,
			ammInitialBaseAssetReserve,
			ammInitialQuoteAssetReserve,
			new BN(0), // 1 HOUR
			new BN(initialSolPerpPrice).mul(PEG_PRECISION),
			OracleSource.PYTH
		);

		await adminVelocityClient.fetchAccounts();

		const managerBootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: managerSigner,
			usdcMint: usdcMint,
			usdcAmount,
			vaultClientCliMode: true,
			velocityClientConfig: {
				accountSubscription: {
					type: 'polling',
					accountLoader: bulkAccountLoader as BulkAccountLoader,
				},
				activeSubAccountId: 0,
				subAccountIds: [],
				perpMarketIndexes: [0],
				spotMarketIndexes: [0, 1],
				oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
			},
		});
		managerClient = managerBootstrap.vaultClient;
		managerVelocityClient = managerBootstrap.velocityClient;

		const provider = new BankrunProvider(
			bankrunContextWrapper.context,
			adminVelocityClient.wallet as anchor.Wallet
		);
		const program = new Program(IDL, provider);
		adminClient = new VaultClient({
			velocityClient: adminVelocityClient,
			// @ts-ignore
			program,
		});

		const user1Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: user1Signer,
			usdcMint: usdcMint,
			usdcAmount,
			vaultClientCliMode: true,
			velocityClientConfig: {
				accountSubscription: {
					type: 'polling',
					accountLoader: bulkAccountLoader as BulkAccountLoader,
				},
				activeSubAccountId: 0,
				subAccountIds: [],
				perpMarketIndexes: [0],
				spotMarketIndexes: [0, 1],
				oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
			},
		});
		user1Client = user1Bootstrap.vaultClient;
		user1VelocityClient = user1Bootstrap.velocityClient;

		const user2Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: user2Signer,
			usdcMint: usdcMint,
			usdcAmount,
			vaultClientCliMode: true,
			velocityClientConfig: {
				accountSubscription: {
					type: 'polling',
					accountLoader: bulkAccountLoader as BulkAccountLoader,
				},
				activeSubAccountId: 0,
				subAccountIds: [],
				perpMarketIndexes: [0],
				spotMarketIndexes: [0, 1],
				oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
			},
		});
		user2Client = user2Bootstrap.vaultClient;
		user2VelocityClient = user2Bootstrap.velocityClient;

		const user3Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: user3Signer,
			usdcMint: usdcMint,
			usdcAmount,
			vaultClientCliMode: true,
			velocityClientConfig: {
				accountSubscription: {
					type: 'polling',
					accountLoader: bulkAccountLoader as BulkAccountLoader,
				},
				activeSubAccountId: 0,
				subAccountIds: [],
				perpMarketIndexes: [0],
				spotMarketIndexes: [0, 1],
				oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
			},
		});
		user3Client = user3Bootstrap.vaultClient;
		user3VelocityClient = user3Bootstrap.velocityClient;

		// initialize a vault and depositors
		await managerClient.initializeVault(
			{
				name: encodeName(vaultName),
				spotMarketIndex: 0,
				redeemPeriod,
				maxTokens: ZERO,
				managementFee: TWENTY_PCT_FEE,
				profitShare: TWENTY_PCT_FEE.toNumber(),
				hurdleRate: TEN_PCT_FEE.toNumber(),
				permissioned: false,
				minDepositAmount: ZERO,
			},
			{ noLut: true }
		);
		await user1Client.initializeVaultDepositor(
			commonVaultKey,
			user1Signer.publicKey,
			user1Signer.publicKey,
			{ noLut: true }
		);
		await user2Client.initializeVaultDepositor(
			commonVaultKey,
			user2Signer.publicKey,
			user2Signer.publicKey,
			{ noLut: true }
		);
	});

	afterEach(async () => {
		await adminVelocityClient.unsubscribe();
		await adminClient.unsubscribe();
		await managerClient.unsubscribe();
		await managerVelocityClient.unsubscribe();
		await user1Client.unsubscribe();
		await user1VelocityClient.unsubscribe();
		await user2Client.unsubscribe();
		await user2VelocityClient.unsubscribe();
		await user3Client.unsubscribe();
		await user3VelocityClient.unsubscribe();
	});

	it('vaults initialized', async () => {
		const vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.manager).to.eql(managerSigner.publicKey);

		const vaultDepositor = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user2Signer.publicKey
		);
		const vdAcct = await vaultProgram.account.vaultDepositor.fetch(
			vaultDepositor
		);
		expect(vdAcct.vault).to.eql(commonVaultKey);

		const vaultDepositor2 = getVaultDepositorAddressSync(
			vaultProgram.programId,
			commonVaultKey,
			user1Signer.publicKey
		);
		const vdAcct2 = await vaultProgram.account.vaultDepositor.fetch(
			vaultDepositor2
		);
		expect(vdAcct2.vault).to.eql(commonVaultKey);
	});

	it('only admin can init fee update account', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.feeUpdateStatus).to.eql(FeeUpdateStatus.None);

		const feeUpdate = getFeeUpdateAddressSync(
			vaultProgram.programId,
			commonVaultKey
		);
		expect(
			await bankrunContextWrapper.connection.getAccountInfo(feeUpdate)
		).to.equal(null);

		// manager cannot init their own FeeUpdate account
		try {
			await managerClient.adminInitFeeUpdate(commonVaultKey, { noLut: true });
			assert(false, 'should not get here');
		} catch (e) {
			expect(e).to.not.equal(undefined);
		}

		// admin can init the FeeUpdate account
		await adminClient.adminInitFeeUpdate(commonVaultKey, { noLut: true });

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.feeUpdateStatus).to.eql(FeeUpdateStatus.None);

		expect(
			await bankrunContextWrapper.connection.getAccountInfo(feeUpdate)
		).to.not.equal(null);
	});

	it('manager can lower fee from normal update', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).to.eql(
			TWENTY_PCT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).to.eql(TWENTY_PCT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).to.eql(TEN_PCT_FEE.toNumber());

		await managerClient.managerUpdateVault(
			commonVaultKey,
			{
				redeemPeriod: null,
				maxTokens: null,
				minDepositAmount: null,
				permissioned: null,
				managementFee: TEN_PCT_FEE,
				profitShare: TEN_PCT_FEE.toNumber(),
				hurdleRate: TWENTY_PCT_FEE.toNumber(),
			},
			{ noLut: true }
		);

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).to.eql(TEN_PCT_FEE.toNumber());
		expect(vaultAcct.profitShare).to.eql(TEN_PCT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).to.eql(TWENTY_PCT_FEE.toNumber());
	});

	it('manager cannot raise fee from normal update', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).to.eql(
			TWENTY_PCT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).to.eql(TWENTY_PCT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).to.eql(TEN_PCT_FEE.toNumber());

		try {
			await managerClient.managerUpdateVault(
				commonVaultKey,
				{
					redeemPeriod: null,
					maxTokens: null,
					minDepositAmount: null,
					permissioned: null,
					managementFee: FIFTY_PCT_MANAGEMENT_FEE,
					profitShare: FIFTY_PCT_MANAGEMENT_FEE.toNumber(),
					hurdleRate: TEN_PCT_FEE.toNumber(),
				},
				{ noLut: true }
			);
			assert(false, 'should not get here');
		} catch (e) {
			expect(e).to.not.equal(undefined);
		}

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).to.eql(
			TWENTY_PCT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).to.eql(TWENTY_PCT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).to.eql(TEN_PCT_FEE.toNumber());
	});

	it('manager must choose timelock duration greater than 2x redeem period and 1 week', async () => {
		const vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).to.eql(
			TWENTY_PCT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).to.eql(TWENTY_PCT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).to.eql(TEN_PCT_FEE.toNumber());

		const timelockDuration = ONE_WEEK_S.divn(2);

		try {
			await managerClient.managerUpdateFees(
				commonVaultKey,
				{
					timelockDuration,
					newManagementFee: TEN_PCT_FEE,
					newProfitShare: TEN_PCT_FEE.toNumber(),
					newHurdleRate: TWENTY_PCT_FEE.toNumber(),
				},
				{ noLut: true }
			);
			assert(false, 'should not get here');
		} catch (e) {
			expect(e).to.not.equal(undefined);
		}
	});

	it('manager can raise fee through timelock', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).to.eql(
			TWENTY_PCT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).to.eql(TWENTY_PCT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).to.eql(TEN_PCT_FEE.toNumber());

		const timelockDuration = ONE_WEEK_S;

		await adminClient.adminInitFeeUpdate(commonVaultKey, { noLut: true });

		const tx = await managerClient.managerUpdateFees(
			commonVaultKey,
			{
				timelockDuration,
				newManagementFee: TEN_PCT_FEE,
				newProfitShare: TEN_PCT_FEE.toNumber(),
				newHurdleRate: TWENTY_PCT_FEE.toNumber(),
			},
			{ noLut: true }
		);
		const events = await printTxLogs(
			bankrunContextWrapper.connection.toConnection(),
			tx,
			false,
			// @ts-ignore
			vaultProgram
		);

		expect(events.length).to.eql(1);
		expect(getVariant(events[0].data.action)).to.eql('pending');
		const ts = events[0].data.ts;
		const timeLockEndTs = events[0].data.timelockEndTs;
		expect(timeLockEndTs.sub(ts).toNumber()).to.eql(
			timelockDuration.toNumber()
		);

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).to.eql(
			TWENTY_PCT_FEE.toNumber()
		);
		expect(vaultAcct.profitShare).to.eql(TWENTY_PCT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).to.eql(TEN_PCT_FEE.toNumber());
		expect(vaultAcct.feeUpdateStatus).to.eql(FeeUpdateStatus.PendingFeeUpdate);

		// user deposits after 1 day, new fee should come into effect
		await bankrunContextWrapper.moveTimeForward(ONE_WEEK_S.toNumber());

		// trigger the fee upduate
		const tx1 = await managerClient.managerUpdateFees(
			commonVaultKey,
			{
				timelockDuration: new BN(0),
				newManagementFee: null,
				newProfitShare: null,
				newHurdleRate: null,
			},
			{ noLut: true }
		);
		const events1 = await printTxLogs(
			bankrunContextWrapper.connection.toConnection(),
			tx1,
			false,
			// @ts-ignore
			vaultProgram
		);
		const feeUpdateEvent = events1.find((e) => e.name === 'feeUpdateRecord');
		expect(feeUpdateEvent).to.not.equal(null);
		expect(getVariant(feeUpdateEvent?.data.action)).to.eql('applied');

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.managementFee.toNumber()).to.eql(TEN_PCT_FEE.toNumber());
		expect(vaultAcct.profitShare).to.eql(TEN_PCT_FEE.toNumber());
		expect(vaultAcct.hurdleRate).to.eql(TWENTY_PCT_FEE.toNumber());
		expect(vaultAcct.feeUpdateStatus).to.eql(FeeUpdateStatus.None);
	});

	it('manager can cancel fee updates', async () => {
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		const timelockDuration = ONE_WEEK_S;

		await adminClient.adminInitFeeUpdate(commonVaultKey, { noLut: true });

		await managerClient.managerUpdateFees(
			commonVaultKey,
			{
				timelockDuration,
				newManagementFee: TEN_PCT_FEE,
				newProfitShare: TEN_PCT_FEE.toNumber(),
				newHurdleRate: TWENTY_PCT_FEE.toNumber(),
			},
			{ noLut: true }
		);

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.feeUpdateStatus).to.eql(FeeUpdateStatus.PendingFeeUpdate);

		await managerClient.managerCancelFeeUpdate(commonVaultKey, { noLut: true });

		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.feeUpdateStatus).to.eql(FeeUpdateStatus.None);
	});

	it('admin can delete fee update account', async () => {
		await adminClient.adminInitFeeUpdate(commonVaultKey, { noLut: true });
		let vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);

		await adminClient.adminDeleteFeeUpdate(commonVaultKey, { noLut: true });
		vaultAcct = await vaultProgram.account.vault.fetch(commonVaultKey);
		expect(vaultAcct.feeUpdateStatus).to.eql(FeeUpdateStatus.None);
	});
});
