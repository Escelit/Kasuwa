import { Keypair, Transaction, TransactionBuilder, FeeBumpTransaction } from '@stellar/stellar-sdk';
import { FeePayerSigner } from './FeePayerSigner.js';

export class LocalKeySigner implements FeePayerSigner {
  private readonly keypair: Keypair;

  constructor(secretKeyOrKeypair: string | Keypair, network: string) {
    if (network === 'mainnet') {
      throw new Error(
        'SECURITY INVARIANT VIOLATION: LocalKeySigner is forbidden when STELLAR_NETWORK=mainnet. ' +
          'Production relayer must use KmsSigner backed by hardware key protection (infra/kms).',
      );
    }

    if (typeof secretKeyOrKeypair === 'string') {
      this.keypair = Keypair.fromSecret(secretKeyOrKeypair);
    } else {
      this.keypair = secretKeyOrKeypair;
    }
  }

  async getPublicKey(): Promise<string> {
    return this.keypair.publicKey();
  }

  async signFeeBump(
    innerTx: Transaction,
    networkPassphrase: string,
    maxFee: string = '1000000', // 0.1 XLM default cap in stroops
  ): Promise<FeeBumpTransaction> {
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      this.keypair,
      maxFee,
      innerTx,
      networkPassphrase,
    );
    feeBump.sign(this.keypair);
    return feeBump;
  }
}
