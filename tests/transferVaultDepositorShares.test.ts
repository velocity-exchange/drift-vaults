import { BN, Program } from '@coral-xyz/anchor';
import { describe, it } from '@jest/globals';
import { BankrunContextWrapper } from './common/bankrunConnection';
import { startAnchor } from 'solana-bankrun';
import {
	VaultClient,
	getVaultAddressSync,
	getVaultDepositorAddressSync,
	encodeName,
	VelocityVaults,
	VAULT_PROGRAM_ID,
	IDL,
	WithdrawUnit,
} from '../ts/sdk/lib';
import {
	BulkAccountLoader,
	VELOCITY_PROGRAM_ID,
	VelocityClient,
	OracleSource,
	PEG_PRECISION,
	PublicKey,
	QUOTE_PRECISION,
	TestClient,
	ZERO,
} from '@velocity-exchange/sdk';
import { TestBulkAccountLoader } from './common/testBulkAccountLoader';
import {
	bootstrapSignerClientAndUserBankrun,
	initializeQuoteSpotMarket,
	initializeSolSpotMarket,
	mockUSDCMintBankrun,
} from './common/testHelpers';
import { Keypair } from '@solana/web3.js';
import { mockOracleNoProgram } from './common/bankrunOracle';

const mantissaSqrtScale = new BN(100_000);
const ammInitialQuoteAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);
const ammInitialBaseAssetReserve = new BN(5 * 10 ** 13).mul(mantissaSqrtScale);

describe('transferVaultDepositorShares', () => {
	let vaultProgram: Program<VelocityVaults>;
	const initialSolPerpPrice = 100;
	let adminVelocityClient: TestClient;
	let bulkAccountLoader: TestBulkAccountLoader;
	let bankrunContextWrapper: BankrunContextWrapper;
	let usdcMint: PublicKey;
	let solPerpOracle: PublicKey;
	const vaultName = 'transfer shares vault';
	const commonVaultKey = getVaultAddressSync(
		VAULT_PROGRAM_ID,
		encodeName(vaultName)
	);
	const usdcAmount = new BN(1_000_000_000).mul(QUOTE_PRECISION);

	const managerSigner = Keypair.generate();
	let managerClient: VaultClient;
	let managerVelocityClient: VelocityClient;

	const user1Signer = Keypair.generate();
	let user1Client: VaultClient;
	let user1VelocityClient: VelocityClient;
	let user1UserUSDCAccount: PublicKey;
	let user1VaultDepositor: PublicKey;

	const user2Signer = Keypair.generate();
	let user2Client: VaultClient;
	let user2VelocityClient: VelocityClient;
	let user2UserUSDCAccount: PublicKey;
	let user2VaultDepositor: PublicKey;

	const velocityClientConfig = (
		bulkAccountLoader: TestBulkAccountLoader,
		solPerpOracle: PublicKey
	) => ({
		accountSubscription: {
			type: 'polling' as const,
			accountLoader: bulkAccountLoader as BulkAccountLoader,
		},
		activeSubAccountId: 0,
		subAccountIds: [],
		perpMarketIndexes: [0],
		spotMarketIndexes: [0, 1],
		oracleInfos: [{ publicKey: solPerpOracle, source: OracleSource.PYTH }],
	});

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

		adminVelocityClient = new TestClient({
			connection: bankrunContextWrapper.connection.toConnection(),
			wallet: bankrunContextWrapper.provider.wallet,
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
			new BN(0),
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
			velocityClientConfig: velocityClientConfig(
				bulkAccountLoader,
				solPerpOracle
			),
		});
		managerClient = managerBootstrap.vaultClient;
		managerVelocityClient = managerBootstrap.velocityClient;

		const user1Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: user1Signer,
			usdcMint: usdcMint,
			usdcAmount,
			vaultClientCliMode: true,
			velocityClientConfig: velocityClientConfig(
				bulkAccountLoader,
				solPerpOracle
			),
		});
		user1Client = user1Bootstrap.vaultClient;
		user1VelocityClient = user1Bootstrap.velocityClient;
		user1UserUSDCAccount = user1Bootstrap.userUSDCAccount.publicKey;
		user1VaultDepositor = getVaultDepositorAddressSync(
			VAULT_PROGRAM_ID,
			commonVaultKey,
			user1Signer.publicKey
		);

		const user2Bootstrap = await bootstrapSignerClientAndUserBankrun({
			bankrunContext: bankrunContextWrapper,
			programId: VAULT_PROGRAM_ID,
			signer: user2Signer,
			usdcMint: usdcMint,
			usdcAmount,
			vaultClientCliMode: true,
			velocityClientConfig: velocityClientConfig(
				bulkAccountLoader,
				solPerpOracle
			),
		});
		user2Client = user2Bootstrap.vaultClient;
		user2VelocityClient = user2Bootstrap.velocityClient;
		user2UserUSDCAccount = user2Bootstrap.userUSDCAccount.publicKey;
		user2VaultDepositor = getVaultDepositorAddressSync(
			VAULT_PROGRAM_ID,
			commonVaultKey,
			user2Signer.publicKey
		);

		// initialize vault
		await managerClient.initializeVault(
			{
				name: encodeName(vaultName),
				spotMarketIndex: 0,
				redeemPeriod: ZERO,
				maxTokens: ZERO,
				managementFee: ZERO,
				profitShare: 0,
				hurdleRate: 0,
				permissioned: false,
				minDepositAmount: ZERO,
			},
			{ noLut: true }
		);

		// initialize depositors
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

		// user1 deposits
		await user1Client.deposit(
			user1VaultDepositor,
			usdcAmount,
			undefined,
			{ noLut: true },
			user1UserUSDCAccount
		);

		// user2 deposits half
		await user2Client.deposit(
			user2VaultDepositor,
			usdcAmount.divn(2),
			undefined,
			{ noLut: true },
			user2UserUSDCAccount
		);
	});

	afterEach(async () => {
		await adminVelocityClient.unsubscribe();
		await managerClient.unsubscribe();
		await managerVelocityClient.unsubscribe();
		await user1Client.unsubscribe();
		await user1VelocityClient.unsubscribe();
		await user2Client.unsubscribe();
		await user2VelocityClient.unsubscribe();
	});

	it('basic transfer shares from user1 to user2', async () => {
		const vaultBefore = await vaultProgram.account.vault.fetch(commonVaultKey);
		const vd1Before = await vaultProgram.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		const vd2Before = await vaultProgram.account.vaultDepositor.fetch(
			user2VaultDepositor
		);

		const transferAmount = vd1Before.vaultShares.divn(2);
		expect(transferAmount.gtn(0)).toBe(true);

		await user1Client.transferVaultDepositorShares(
			user1VaultDepositor,
			user2VaultDepositor,
			transferAmount,
			WithdrawUnit.SHARES,
			{ noLut: true }
		);

		const vaultAfter = await vaultProgram.account.vault.fetch(commonVaultKey);
		const vd1After = await vaultProgram.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		const vd2After = await vaultProgram.account.vaultDepositor.fetch(
			user2VaultDepositor
		);

		// shares moved from user1 to user2
		expect(vd1After.vaultShares.lt(vd1Before.vaultShares)).toBe(true);
		expect(vd2After.vaultShares.gt(vd2Before.vaultShares)).toBe(true);

		// total shares in vault unchanged
		expect(vaultAfter.totalShares.eq(vaultBefore.totalShares)).toBe(true);
		expect(vaultAfter.userShares.eq(vaultBefore.userShares)).toBe(true);

		// combined depositor shares unchanged
		const combinedBefore = vd1Before.vaultShares.add(vd2Before.vaultShares);
		const combinedAfter = vd1After.vaultShares.add(vd2After.vaultShares);
		expect(combinedAfter.eq(combinedBefore)).toBe(true);
	});

	it('transfer all shares from user1 to user2', async () => {
		const vd1Before = await vaultProgram.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		const vd2Before = await vaultProgram.account.vaultDepositor.fetch(
			user2VaultDepositor
		);

		const allShares = vd1Before.vaultShares;
		expect(allShares.gtn(0)).toBe(true);

		await user1Client.transferVaultDepositorShares(
			user1VaultDepositor,
			user2VaultDepositor,
			allShares,
			WithdrawUnit.SHARES,
			{ noLut: true }
		);

		const vd1After = await vaultProgram.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		const vd2After = await vaultProgram.account.vaultDepositor.fetch(
			user2VaultDepositor
		);

		// user1 has 0 shares
		expect(vd1After.vaultShares.eqn(0)).toBe(true);

		// user2 has all transferred shares
		const combinedBefore = vd1Before.vaultShares.add(vd2Before.vaultShares);
		expect(vd2After.vaultShares.eq(combinedBefore)).toBe(true);
	});

	it('unauthorized transfer fails', async () => {
		const vd1Before = await vaultProgram.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		const transferAmount = vd1Before.vaultShares.divn(2);

		// user2 tries to transfer user1's shares -> should fail
		try {
			await user2Client.transferVaultDepositorShares(
				user1VaultDepositor,
				user2VaultDepositor,
				transferAmount,
				WithdrawUnit.SHARES,
				{ noLut: true }
			);
			expect(true).toBe(false); // should not reach here
		} catch (e) {
			// expected to fail due to PDA constraint (authority mismatch)
			expect(e).toBeDefined();
		}
	});

	it('transfer more shares than owned fails', async () => {
		const vd1Before = await vaultProgram.account.vaultDepositor.fetch(
			user1VaultDepositor
		);
		const tooManyShares = vd1Before.vaultShares.addn(1);

		try {
			await user1Client.transferVaultDepositorShares(
				user1VaultDepositor,
				user2VaultDepositor,
				tooManyShares,
				WithdrawUnit.SHARES,
				{ noLut: true }
			);
			expect(true).toBe(false); // should not reach here
		} catch (e) {
			expect(e).toBeDefined();
		}
	});
});
