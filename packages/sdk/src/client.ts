import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  AssembledTransaction,
  MethodOptions,
  Result,
} from '@stellar/stellar-sdk/contract';
import {
  Client as GeneratedClient,
  Allowance,
  PaymentAuth as GeneratedPaymentAuth,
  SettleResult,
  Status,
  RejectReason,
  ShortfallRecord,
  VaultError,
} from './generated/src/index.js';

export {
  Status,
  RejectReason,
  VaultError,
  Allowance,
  GeneratedPaymentAuth,
  SettleResult,
  ShortfallRecord,
};

export interface VaultClientOptions {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  publicKey?: string;
  allowHttp?: boolean;
}

export interface CreateAllowanceArgs {
  owner: string;
  token: string;
  amount: bigint;
  validUntil: bigint;
  deviceKey: Buffer | Uint8Array;
  perPaymentCap: bigint;
}

export interface TopUpArgs {
  allowanceId: bigint;
  amount: bigint;
}

export interface SettleArgs {
  auth: GeneratedPaymentAuth;
  signature: Buffer | Uint8Array;
}

export interface SettleBatchItem {
  auth: GeneratedPaymentAuth;
  signature: Buffer | Uint8Array;
}

export interface InitializeArgs {
  admin: string;
  maxPaymentTtl: bigint;
  gracePeriod: bigint;
  minAllowance: bigint;
  maxAllowance: bigint;
}

/**
 * High-level typed client for interacting with the Kasuwa AllowanceVault contract.
 */
export class VaultClient {
  public readonly rawClient: GeneratedClient;
  public readonly contractId: string;
  public readonly rpcUrl: string;
  public readonly networkPassphrase: string;

  constructor(public readonly options: VaultClientOptions) {
    this.contractId = options.contractId;
    this.rpcUrl = options.rpcUrl;
    this.networkPassphrase = options.networkPassphrase;
    this.rawClient = new GeneratedClient({
      contractId: options.contractId,
      rpcUrl: options.rpcUrl,
      networkPassphrase: options.networkPassphrase,
      publicKey: options.publicKey,
      allowHttp: options.allowHttp ?? options.rpcUrl.startsWith('http://'),
    });
  }

  /**
   * Initializes the contract parameters (one-time call by admin/deployer).
   */
  async initialize(
    args: InitializeArgs,
    options?: MethodOptions,
  ): Promise<AssembledTransaction<Result<void>>> {
    return this.rawClient.initialize(
      {
        admin: args.admin,
        max_payment_ttl: args.maxPaymentTtl,
        grace_period: args.gracePeriod,
        min_allowance: args.minAllowance,
        max_allowance: args.maxAllowance,
      },
      options,
    );
  }

  /**
   * Creates and escrows a new offline allowance.
   */
  async createAllowance(
    args: CreateAllowanceArgs,
    options?: MethodOptions,
  ): Promise<AssembledTransaction<Result<bigint>>> {
    const deviceKeyBuf = Buffer.from(args.deviceKey);
    return this.rawClient.create_allowance(
      {
        owner: args.owner,
        token: args.token,
        amount: args.amount,
        valid_until: args.validUntil,
        device_key: deviceKeyBuf,
        per_payment_cap: args.perPaymentCap,
      },
      options,
    );
  }

  /**
   * Adds funds to an existing active allowance.
   */
  async topUp(
    args: TopUpArgs,
    options?: MethodOptions,
  ): Promise<AssembledTransaction<Result<void>>> {
    return this.rawClient.top_up(
      {
        allowance_id: args.allowanceId,
        amount: args.amount,
      },
      options,
    );
  }

  /**
   * Settles an authorized offline payment.
   */
  async settle(
    args: SettleArgs,
    options?: MethodOptions,
  ): Promise<AssembledTransaction<SettleResult>> {
    const sigBuf = Buffer.from(args.signature);
    return this.rawClient.settle(
      {
        auth: args.auth,
        signature: sigBuf,
      },
      options,
    );
  }

  /**
   * Settles a batch of signed payment authorizations in order.
   */
  async settleBatch(
    items: SettleBatchItem[],
    options?: MethodOptions,
  ): Promise<AssembledTransaction<Array<SettleResult>>> {
    const formattedItems = items.map(
      (item) =>
        [item.auth, Buffer.from(item.signature)] as readonly [
          GeneratedPaymentAuth,
          Buffer,
        ],
    );
    return this.rawClient.settle_batch(
      {
        items: formattedItems,
      },
      options,
    );
  }

  /**
   * Requests premature closure of an allowance.
   */
  async requestClose(
    allowanceId: bigint,
    options?: MethodOptions,
  ): Promise<AssembledTransaction<Result<void>>> {
    return this.rawClient.request_close(
      {
        allowance_id: allowanceId,
      },
      options,
    );
  }

  /**
   * Reclaims unspent escrowed funds back to the allowance owner.
   */
  async reclaim(
    allowanceId: bigint,
    options?: MethodOptions,
  ): Promise<AssembledTransaction<Result<bigint>>> {
    return this.rawClient.reclaim(
      {
        allowance_id: allowanceId,
      },
      options,
    );
  }

  /**
   * Read-only view returning the allowance record, if present.
   */
  async getAllowance(id: bigint | number): Promise<Allowance | null | undefined> {
    const tx = await this.rawClient.get_allowance({
      id: BigInt(id),
    });
    const result = await tx.simulate();
    return result.result;
  }

  /**
   * Read-only view returning recorded shortfalls for a customer device key.
   */
  async getShortfalls(
    deviceKey: Buffer | Uint8Array,
  ): Promise<ShortfallRecord[]> {
    const keyBuf = Buffer.from(deviceKey);
    const tx = await this.rawClient.get_shortfalls({
      device_key: keyBuf,
    });
    const result = await tx.simulate();
    return result.result ?? [];
  }

  /**
   * Extends the persistent storage TTL for an allowance.
   */
  async extendTtl(
    allowanceId: bigint,
    options?: MethodOptions,
  ): Promise<AssembledTransaction<Result<void>>> {
    return this.rawClient.extend_ttl(
      {
        allowance_id: allowanceId,
      },
      options,
    );
  }

  /**
   * Helper to simulate any assembled transaction.
   */
  async simulate<T>(tx: AssembledTransaction<T>) {
    return tx.simulate();
  }

  /**
   * Helper to sign and send an assembled transaction with a given Keypair.
   */
  async signAndSend<T>(
    tx: AssembledTransaction<T>,
    keypair: Keypair,
  ): Promise<T> {
    await tx.signAuthEntries({
      address: keypair.publicKey(),
      signAuthEntry: async (entry: string) => {
        return {
          signedAuthEntry: entry,
          signerAddress: keypair.publicKey(),
        };
      },
    });
    const res = await tx.signAndSend({
      signTransaction: async (transactionXdr: string) => {
        const transaction = TransactionBuilder.fromXDR(
          transactionXdr,
          this.networkPassphrase,
        );
        transaction.sign(keypair);
        return {
          signedTxXdr: transaction.toXDR(),
          signerAddress: keypair.publicKey(),
        };
      },
    });
    return res.result;
  }
}
