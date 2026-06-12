import { AnchorProvider } from '@coral-xyz/anchor';
import { VelocityClient, IWallet } from '@velocity-exchange/sdk';
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { VelocityVaults } from './types/velocity_vaults';
import velocityVaultsIDL from './idl/velocity_vaults.json';

export const IDL = velocityVaultsIDL as VelocityVaults;
import { VaultClient } from './vaultClient';
import * as anchor from '@coral-xyz/anchor';
import {
	createAssociatedTokenAccountInstruction,
	getAssociatedTokenAddress,
} from '@solana/spl-token';

export const getVelocityVaultProgram = (
	connection: Connection,
	wallet: IWallet
): anchor.Program<VelocityVaults> => {
	const provider = new AnchorProvider(connection, wallet as anchor.Wallet, {});
	anchor.setProvider(provider);
	const vaultProgram = new anchor.Program<VelocityVaults>(
		velocityVaultsIDL as VelocityVaults,
		provider
	);

	return vaultProgram;
};

export const getVaultClient = (
	connection: Connection,
	wallet: IWallet,
	velocityClient: VelocityClient
): VaultClient => {
	const vaultProgram = getVelocityVaultProgram(connection, wallet);

	const vaultClient = new VaultClient({
		velocityClient,
		program: vaultProgram,
	});

	return vaultClient;
};

export const getOrCreateATAInstruction = async (
	tokenMint: PublicKey,
	owner: PublicKey,
	connection: Connection,
	allowOwnerOffCurve = true,
	payer = owner
): Promise<[PublicKey, TransactionInstruction?]> => {
	let toAccount;
	try {
		toAccount = await getAssociatedTokenAddress(
			tokenMint,
			owner,
			allowOwnerOffCurve
		);
		const account = await connection.getAccountInfo(toAccount);
		if (!account) {
			const ix = createAssociatedTokenAccountInstruction(
				payer,
				toAccount,
				owner,
				tokenMint
			);
			return [toAccount, ix];
		}
		return [toAccount, undefined];
	} catch (e) {
		/* handle error */
		console.error('Error::getOrCreateATAInstruction', e);
		throw e;
	}
};
