import { Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';

/**
 * Interface for fee-payer signing.
 * Sponsoring relayer accounts pay the network transaction fee so merchants need no XLM.
 */
export interface FeePayerSigner {
  /** Returns the Stellar public key (G...) of the fee payer account */
  getPublicKey(): Promise<string>;

  /**
   * Builds and signs a FeeBumpTransaction wrapping the given inner transaction.
   *
   * @param innerTx The inner transaction (sourced by a channel account)
   * @param networkPassphrase The network passphrase
   * @param maxFee The maximum fee the fee payer is willing to pay in stroops
   */
  signFeeBump(
    innerTx: Transaction,
    networkPassphrase: string,
    maxFee?: string,
  ): Promise<FeeBumpTransaction>;
}
