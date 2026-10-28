import { Transaction, FeeBumpTransaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { FeePayerSigner } from './FeePayerSigner.js';

export interface KmsSignerConfig {
  keyId: string;
  region?: string;
  publicKey?: string;
}

/**
 * KMS-backed fee-payer signer stub.
 *
 * Implements remote signing via AWS KMS / GCP Cloud KMS as specified in `infra/kms/README.md`.
 * Key material never leaves the secure cryptographic boundary of the cloud HSM.
 */
export class KmsSigner implements FeePayerSigner {
  private readonly keyId: string;
  private readonly region: string;
  private readonly publicKey: string;

  constructor(config: KmsSignerConfig) {
    if (!config.keyId) {
      throw new Error('RELAYER_KMS_KEY_ID is required for KmsSigner');
    }
    this.keyId = config.keyId;
    this.region = config.region ?? 'us-east-1';
    // When live KMS is configured, publicKey can be queried via kms:GetPublicKey
    this.publicKey = config.publicKey ?? 'GBKMSFEEPAYERSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUB';
  }

  async getPublicKey(): Promise<string> {
    // TODO(infra/kms): Query KMS GetPublicKey API if not cached:
    // const client = new KMSClient({ region: this.region });
    // const resp = await client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    // parse SPKI DER into Stellar Ed25519 public key.
    return this.publicKey;
  }

  async signFeeBump(
    innerTx: Transaction,
    networkPassphrase: string,
    maxFee: string = '1000000',
  ): Promise<FeeBumpTransaction> {
    const feeSource = await this.getPublicKey();
    TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      maxFee,
      innerTx,
      networkPassphrase,
    );

    // TODO(infra/kms): Implement AWS KMS Sign command:
    // const txHash = feeBump.hash();
    // const client = new KMSClient({ region: this.region });
    // const command = new SignCommand({
    //   KeyId: this.keyId,
    //   Message: txHash,
    //   MessageType: 'DIGEST',
    //   SigningAlgorithm: 'ED25519_SHA_512' // or raw ed25519 per KMS config
    // });
    // const response = await client.send(command);
    // feeBump.addSignature(feeSource, Buffer.from(response.Signature).toString('base64'));

    throw new Error(
      `KmsSigner [Key: ${this.keyId}, Region: ${this.region}] live signing not yet connected to AWS KMS. ` +
        `Refer to infra/kms/README.md for IAM policies and deployment guide.`,
    );
  }
}
