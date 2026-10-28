import { Keypair, Account, rpc } from '@stellar/stellar-sdk';

export interface ChannelAccountState {
  index: number;
  keypair: Keypair;
  publicKey: string;
  sequence: bigint;
  isBusy: boolean;
  lastUsedAt: number;
  balanceXlm?: string;
  isHealthy: boolean;
  lastError?: string;
}

export interface ChannelHealth {
  index: number;
  publicKey: string;
  isBusy: boolean;
  sequence: string;
  balanceXlm?: string;
  isHealthy: boolean;
  lastError?: string;
}

export class ChannelManager {
  private readonly channels: ChannelAccountState[] = [];
  private readonly rpcServer: rpc.Server;

  constructor(
    channelKeypairs: Keypair[],
    rpcUrl: string,
    allowHttp: boolean = true,
  ) {
    this.rpcServer = new rpc.Server(rpcUrl, { allowHttp });

    this.channels = channelKeypairs.map((keypair, index) => ({
      index,
      keypair,
      publicKey: keypair.publicKey(),
      sequence: 0n,
      isBusy: false,
      lastUsedAt: 0,
      isHealthy: true,
    }));
  }

  /**
   * Initializes / bootstraps sequences for all channel accounts from Soroban RPC.
   */
  async bootstrap(): Promise<void> {
    for (const channel of this.channels) {
      try {
        await this.syncAccountSequence(channel);
        channel.isHealthy = true;
        channel.lastError = undefined;
      } catch (err) {
        channel.isHealthy = false;
        channel.lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  /**
   * Syncs sequence and balance for a specific channel account from Soroban RPC.
   */
  async syncAccountSequence(channel: ChannelAccountState): Promise<void> {
    try {
      const accountRes = await this.rpcServer.getAccount(channel.publicKey);
      channel.sequence = BigInt(accountRes.sequenceNumber());
      channel.isHealthy = true;
    } catch (err) {
      // In tests or offline mocked RPC, handle fallback
      channel.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Acquires an available channel account with safe sequence locking.
   * Throws if all channels are currently busy.
   */
  async acquireChannel(): Promise<ChannelAccountState> {
    // Find an available and healthy channel, preferred least recently used
    const available = this.channels
      .filter((c) => !c.isBusy && c.isHealthy)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    if (available.length === 0) {
      // Check if any busy channel can be waited for, or throw channel exhaustion
      throw new Error(
        `Channel accounts exhausted: all ${this.channels.length} channels are currently busy or unhealthy`,
      );
    }

    const channel = available[0]!;
    channel.isBusy = true;
    channel.lastUsedAt = Date.now();
    return channel;
  }

  /**
   * Builds a Stellar Account object with the current sequence for transaction building,
   * then increments the channel's sequence counter.
   */
  getAndIncrementAccount(channel: ChannelAccountState): Account {
    const currentSeq = channel.sequence.toString();
    channel.sequence = channel.sequence + 1n;
    return new Account(channel.publicKey, currentSeq);
  }

  /**
   * Releases a channel account back to the available pool.
   * If badSequenceError is true, triggers a background sequence resync.
   */
  async releaseChannel(
    channel: ChannelAccountState,
    badSequenceError: boolean = false,
  ): Promise<void> {
    const found = this.channels.find((c) => c.publicKey === channel.publicKey);
    if (!found) return;

    if (badSequenceError) {
      try {
        await this.syncAccountSequence(found);
      } catch (e) {
        found.isHealthy = false;
        found.lastError = 'Sequence desynchronized: ' + String(e);
      }
    }

    found.isBusy = false;
  }

  /**
   * Returns health status of all channel accounts.
   */
  getHealth(): ChannelHealth[] {
    return this.channels.map((c) => ({
      index: c.index,
      publicKey: c.publicKey,
      isBusy: c.isBusy,
      sequence: c.sequence.toString(),
      balanceXlm: c.balanceXlm,
      isHealthy: c.isHealthy,
      lastError: c.lastError,
    }));
  }

  getPoolSize(): number {
    return this.channels.length;
  }

  getAvailableCount(): number {
    return this.channels.filter((c) => !c.isBusy && c.isHealthy).length;
  }
}
