import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




/**
 * Status of an allowance lifecycle.
 */
export enum Status {
  Active = 0,
  Closing = 1,
  Closed = 2,
}


/**
 * An escrowed allowance deposited by a customer.
 */
export interface Allowance {
  /**
 * Remaining, unspent token balance in base units.
 */
balance: i128;
  /**
 * Unix timestamp (seconds) when the owner requested close, if any.
 */
close_requested_at: Option<u64>;
  /**
 * Uncompressed secp256r1 public key (65 bytes: 0x04 || X[32] || Y[32]) of the customer's device.
 */
device_key: Buffer;
  /**
 * The depositor who owns the allowance and can top up, close, or reclaim unspent funds.
 */
owner: string;
  /**
 * Maximum amount that can be authorized in any single payment from this allowance.
 */
per_payment_cap: i128;
  /**
 * Current lifecycle status.
 */
status: Status;
  /**
 * The token address (e.g. USDC SAC) escrowed in this allowance.
 */
token: string;
  /**
 * Unix timestamp (seconds) until which authorizations can be issued.
 */
valid_until: u64;
}

/**
 * Custom contract errors for fatal operational failures.
 */
export const VaultError = {
  /**
   * Contract is already initialized.
   */
  1: {message:"AlreadyInitialized"},
  /**
   * Contract has not been initialized yet.
   */
  2: {message:"NotInitialized"},
  /**
   * Allowance deposit amount is outside [min_allowance, max_allowance].
   */
  3: {message:"InvalidAmount"},
  /**
   * Valid until timestamp is in the past or invalid.
   */
  4: {message:"InvalidWindow"},
  /**
   * Per-payment cap is non-positive or exceeds allowance amount.
   */
  5: {message:"InvalidCap"},
  /**
   * Allowance does not exist.
   */
  6: {message:"AllowanceNotFound"},
  /**
   * Allowance is not in Active status.
   */
  7: {message:"AllowanceNotActive"},
  /**
   * Allowance is already closed.
   */
  8: {message:"AlreadyClosed"},
  /**
   * Reclaim attempted before the required settlement and grace window elapsed.
   */
  9: {message:"ReclaimTooEarly"},
  /**
   * Checked arithmetic overflow or underflow occurred.
   */
  10: {message:"ArithmeticOverflow"},
  /**
   * Caller is not authorized.
   */
  11: {message:"Unauthorized"},
  /**
   * Batch exceeds maximum allowed size.
   */
  12: {message:"BatchTooLarge"}
}


/**
 * Signed payment authorization presented by a customer to a merchant.
 */
export interface PaymentAuth {
  /**
 * On-chain identifier of the customer's allowance.
 */
allowance_id: u64;
  /**
 * Payment amount in token base units.
 */
amount: i128;
  /**
 * Unix timestamp (seconds) when payment expires.
 */
expires_at: u64;
  /**
 * Unix timestamp (seconds) when payment was authorized.
 */
issued_at: u64;
  /**
 * Merchant address bound as the sole recipient of the funds.
 */
merchant: string;
  /**
 * Unique 128-bit random identifier preventing replay attacks.
 */
payment_id: Buffer;
  /**
 * Wire protocol version (must be 1).
 */
version: u32;
}

/**
 * Specific, non-reverting reason for settlement rejection.
 */
export enum RejectReason {
  BadSignature = 0,
  Expired = 1,
  OverCap = 2,
  Replay = 3,
  UnknownAllowance = 4,
  WrongMerchant = 5,
  BadWindow = 6,
  Insufficient = 7,
}

/**
 * Result of attempting to settle a payment authorization.
 */
export type SettleResult = {tag: "Settled", values: void} | {tag: "Partial", values: readonly [i128, i128]} | {tag: "Rejected", values: readonly [RejectReason]};


/**
 * An on-chain shortfall record attributed to a customer device key.
 */
export interface ShortfallRecord {
  /**
 * Allowance under which the shortfall occurred.
 */
allowance_id: u64;
  /**
 * Unpaid shortfall amount in token base units.
 */
amount: i128;
  /**
 * Merchant who received less than authorized.
 */
merchant: string;
  /**
 * Unix timestamp when the shortfall was recorded.
 */
timestamp: u64;
}

export interface Client {
  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settles an authorized payment on-chain.
   * 
   * Permissionless: anyone (relayer, merchant, third party) may submit authorizations.
   * Checks conditions in strict sequence and returns a `SettleResult` rather than panicking.
   */
  settle: ({auth, signature}: {auth: PaymentAuth, signature: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<SettleResult>>

  /**
   * Construct and simulate a top_up transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Adds funds to an existing active allowance.
   * 
   * Requires owner authorization. Only permitted while allowance is Active.
   * Does NOT shorten any valid_until or close window.
   */
  top_up: ({allowance_id, amount}: {allowance_id: u64, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reclaim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reclaims unspent escrowed funds back to the allowance owner.
   * 
   * Requires owner authorization. Allowed only after:
   * `now >= max(valid_until, close_requested_at.unwrap_or(0)) + max_payment_ttl + grace`
   * 
   * Moves remaining balance to owner and marks allowance Closed.
   * Idempotent-safe: subsequent calls return Err(VaultError::AlreadyClosed) without moving funds.
   */
  reclaim: ({allowance_id}: {allowance_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless helper that extends the TTL of persistent entries for an allowance.
   */
  extend_ttl: ({allowance_id}: {allowance_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time initialization of protocol configuration.
   * 
   * # Invariant & Non-Custodial Powers
   * The admin address set here holds strictly administrative metadata.
   * The admin CANNOT touch, withdraw, freeze, or redirect escrowed allowance funds.
   */
  initialize: ({admin, max_payment_ttl, grace_period, min_allowance, max_allowance}: {admin: string, max_payment_ttl: u64, grace_period: u64, min_allowance: i128, max_allowance: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settles a batch of signed authorizations in sequential order.
   * 
   * Never reverts the batch because of one bad item: evaluates each authorization independently
   * and returns a per-item `SettleResult`. Reverts if items length exceeds `MAX_BATCH_SIZE`.
   */
  settle_batch: ({items}: {items: Array<readonly [PaymentAuth, Buffer]>}, options?: MethodOptions) => Promise<AssembledTransaction<Array<SettleResult>>>

  /**
   * Construct and simulate a get_allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only view returning the allowance record, if present. Does not mutate storage.
   */
  get_allowance: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Allowance>>>

  /**
   * Construct and simulate a request_close transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Requests premature close of an active allowance (e.g. lost phone).
   * 
   * Requires owner authorization. Transitions status from Active to Closing.
   * Freezes further top-ups, but allows already-issued offline authorizations to settle
   * until the reclaim settlement window elapses.
   */
  request_close: ({allowance_id}: {allowance_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_shortfalls transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only view returning recorded shortfalls for a customer device key. Does not mutate storage.
   */
  get_shortfalls: ({device_key}: {device_key: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Array<ShortfallRecord>>>

  /**
   * Construct and simulate a create_allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Creates and escrows a new offline allowance.
   * 
   * Requires owner authorization and transfers `amount` tokens from owner into contract custody.
   */
  create_allowance: ({owner, token, amount, valid_until, device_key, per_payment_cap}: {owner: string, token: string, amount: i128, valid_until: u64, device_key: Buffer, per_payment_cap: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAANRTZXR0bGVzIGFuIGF1dGhvcml6ZWQgcGF5bWVudCBvbi1jaGFpbi4KClBlcm1pc3Npb25sZXNzOiBhbnlvbmUgKHJlbGF5ZXIsIG1lcmNoYW50LCB0aGlyZCBwYXJ0eSkgbWF5IHN1Ym1pdCBhdXRob3JpemF0aW9ucy4KQ2hlY2tzIGNvbmRpdGlvbnMgaW4gc3RyaWN0IHNlcXVlbmNlIGFuZCByZXR1cm5zIGEgYFNldHRsZVJlc3VsdGAgcmF0aGVyIHRoYW4gcGFuaWNraW5nLgAAAAZzZXR0bGUAAAAAAAIAAAAAAAAABGF1dGgAAAfQAAAAC1BheW1lbnRBdXRoAAAAAAAAAAAJc2lnbmF0dXJlAAAAAAAD7gAAAEAAAAABAAAH0AAAAAxTZXR0bGVSZXN1bHQ=",
        "AAAAAAAAAKZBZGRzIGZ1bmRzIHRvIGFuIGV4aXN0aW5nIGFjdGl2ZSBhbGxvd2FuY2UuCgpSZXF1aXJlcyBvd25lciBhdXRob3JpemF0aW9uLiBPbmx5IHBlcm1pdHRlZCB3aGlsZSBhbGxvd2FuY2UgaXMgQWN0aXZlLgpEb2VzIE5PVCBzaG9ydGVuIGFueSB2YWxpZF91bnRpbCBvciBjbG9zZSB3aW5kb3cuAAAAAAAGdG9wX3VwAAAAAAACAAAAAAAAAAxhbGxvd2FuY2VfaWQAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAClZhdWx0RXJyb3IAAA==",
        "AAAAAAAAAWBSZWNsYWltcyB1bnNwZW50IGVzY3Jvd2VkIGZ1bmRzIGJhY2sgdG8gdGhlIGFsbG93YW5jZSBvd25lci4KClJlcXVpcmVzIG93bmVyIGF1dGhvcml6YXRpb24uIEFsbG93ZWQgb25seSBhZnRlcjoKYG5vdyA+PSBtYXgodmFsaWRfdW50aWwsIGNsb3NlX3JlcXVlc3RlZF9hdC51bndyYXBfb3IoMCkpICsgbWF4X3BheW1lbnRfdHRsICsgZ3JhY2VgCgpNb3ZlcyByZW1haW5pbmcgYmFsYW5jZSB0byBvd25lciBhbmQgbWFya3MgYWxsb3dhbmNlIENsb3NlZC4KSWRlbXBvdGVudC1zYWZlOiBzdWJzZXF1ZW50IGNhbGxzIHJldHVybiBFcnIoVmF1bHRFcnJvcjo6QWxyZWFkeUNsb3NlZCkgd2l0aG91dCBtb3ZpbmcgZnVuZHMuAAAAB3JlY2xhaW0AAAAAAQAAAAAAAAAMYWxsb3dhbmNlX2lkAAAABgAAAAEAAAPpAAAACwAAB9AAAAAKVmF1bHRFcnJvcgAA",
        "AAAAAAAAAFJQZXJtaXNzaW9ubGVzcyBoZWxwZXIgdGhhdCBleHRlbmRzIHRoZSBUVEwgb2YgcGVyc2lzdGVudCBlbnRyaWVzIGZvciBhbiBhbGxvd2FuY2UuAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAQAAAAAAAAAMYWxsb3dhbmNlX2lkAAAABgAAAAEAAAPpAAAAAgAAB9AAAAAKVmF1bHRFcnJvcgAA",
        "AAAAAAAAAOlPbmUtdGltZSBpbml0aWFsaXphdGlvbiBvZiBwcm90b2NvbCBjb25maWd1cmF0aW9uLgoKIyBJbnZhcmlhbnQgJiBOb24tQ3VzdG9kaWFsIFBvd2VycwpUaGUgYWRtaW4gYWRkcmVzcyBzZXQgaGVyZSBob2xkcyBzdHJpY3RseSBhZG1pbmlzdHJhdGl2ZSBtZXRhZGF0YS4KVGhlIGFkbWluIENBTk5PVCB0b3VjaCwgd2l0aGRyYXcsIGZyZWV6ZSwgb3IgcmVkaXJlY3QgZXNjcm93ZWQgYWxsb3dhbmNlIGZ1bmRzLgAAAAAAAAppbml0aWFsaXplAAAAAAAFAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAD21heF9wYXltZW50X3R0bAAAAAAGAAAAAAAAAAxncmFjZV9wZXJpb2QAAAAGAAAAAAAAAA1taW5fYWxsb3dhbmNlAAAAAAAACwAAAAAAAAANbWF4X2FsbG93YW5jZQAAAAAAAAsAAAABAAAD6QAAAAIAAAfQAAAAClZhdWx0RXJyb3IAAA==",
        "AAAAAAAAAPNTZXR0bGVzIGEgYmF0Y2ggb2Ygc2lnbmVkIGF1dGhvcml6YXRpb25zIGluIHNlcXVlbnRpYWwgb3JkZXIuCgpOZXZlciByZXZlcnRzIHRoZSBiYXRjaCBiZWNhdXNlIG9mIG9uZSBiYWQgaXRlbTogZXZhbHVhdGVzIGVhY2ggYXV0aG9yaXphdGlvbiBpbmRlcGVuZGVudGx5CmFuZCByZXR1cm5zIGEgcGVyLWl0ZW0gYFNldHRsZVJlc3VsdGAuIFJldmVydHMgaWYgaXRlbXMgbGVuZ3RoIGV4Y2VlZHMgYE1BWF9CQVRDSF9TSVpFYC4AAAAADHNldHRsZV9iYXRjaAAAAAEAAAAAAAAABWl0ZW1zAAAAAAAD6gAAA+0AAAACAAAH0AAAAAtQYXltZW50QXV0aAAAAAPuAAAAQAAAAAEAAAPqAAAH0AAAAAxTZXR0bGVSZXN1bHQ=",
        "AAAAAAAAAFNSZWFkLW9ubHkgdmlldyByZXR1cm5pbmcgdGhlIGFsbG93YW5jZSByZWNvcmQsIGlmIHByZXNlbnQuIERvZXMgbm90IG11dGF0ZSBzdG9yYWdlLgAAAAANZ2V0X2FsbG93YW5jZQAAAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+gAAAfQAAAACUFsbG93YW5jZQAAAA==",
        "AAAAAAAAAQ1SZXF1ZXN0cyBwcmVtYXR1cmUgY2xvc2Ugb2YgYW4gYWN0aXZlIGFsbG93YW5jZSAoZS5nLiBsb3N0IHBob25lKS4KClJlcXVpcmVzIG93bmVyIGF1dGhvcml6YXRpb24uIFRyYW5zaXRpb25zIHN0YXR1cyBmcm9tIEFjdGl2ZSB0byBDbG9zaW5nLgpGcmVlemVzIGZ1cnRoZXIgdG9wLXVwcywgYnV0IGFsbG93cyBhbHJlYWR5LWlzc3VlZCBvZmZsaW5lIGF1dGhvcml6YXRpb25zIHRvIHNldHRsZQp1bnRpbCB0aGUgcmVjbGFpbSBzZXR0bGVtZW50IHdpbmRvdyBlbGFwc2VzLgAAAAAAAA1yZXF1ZXN0X2Nsb3NlAAAAAAAAAQAAAAAAAAAMYWxsb3dhbmNlX2lkAAAABgAAAAEAAAPpAAAAAgAAB9AAAAAKVmF1bHRFcnJvcgAA",
        "AAAAAAAAAGBSZWFkLW9ubHkgdmlldyByZXR1cm5pbmcgcmVjb3JkZWQgc2hvcnRmYWxscyBmb3IgYSBjdXN0b21lciBkZXZpY2Uga2V5LiBEb2VzIG5vdCBtdXRhdGUgc3RvcmFnZS4AAAAOZ2V0X3Nob3J0ZmFsbHMAAAAAAAEAAAAAAAAACmRldmljZV9rZXkAAAAAA+4AAABBAAAAAQAAA+oAAAfQAAAAD1Nob3J0ZmFsbFJlY29yZAA=",
        "AAAAAAAAAIpDcmVhdGVzIGFuZCBlc2Nyb3dzIGEgbmV3IG9mZmxpbmUgYWxsb3dhbmNlLgoKUmVxdWlyZXMgb3duZXIgYXV0aG9yaXphdGlvbiBhbmQgdHJhbnNmZXJzIGBhbW91bnRgIHRva2VucyBmcm9tIG93bmVyIGludG8gY29udHJhY3QgY3VzdG9keS4AAAAAABBjcmVhdGVfYWxsb3dhbmNlAAAABgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAALdmFsaWRfdW50aWwAAAAABgAAAAAAAAAKZGV2aWNlX2tleQAAAAAD7gAAAEEAAAAAAAAAD3Blcl9wYXltZW50X2NhcAAAAAALAAAAAQAAA+kAAAAGAAAH0AAAAApWYXVsdEVycm9yAAA=",
        "AAAAAwAAACFTdGF0dXMgb2YgYW4gYWxsb3dhbmNlIGxpZmVjeWNsZS4AAAAAAAAAAAAABlN0YXR1cwAAAAAAAwAAAElBbGxvd2FuY2UgaXMgYWN0aXZlOiBwYXltZW50cyBjYW4gYmUgaXNzdWVkIGFuZCBzZXR0bGVkLCB0b3AtdXBzIGFsbG93ZWQuAAAAAAAABkFjdGl2ZQAAAAAAAAAAAHxPd25lciByZXF1ZXN0ZWQgY2xvc2U6IG5vIG5ldyB0b3AtdXBzIGFsbG93ZWQ7IHNldHRsZW1lbnQgb2YgaXNzdWVkIGF1dGhvcml6YXRpb25zCmNvbnRpbnVlcyB1bnRpbCB0aGUgcmVjbGFpbSB3aW5kb3cgb3BlbnMuAAAAB0Nsb3NpbmcAAAAAAQAAAFZBbGxvd2FuY2UgaXMgY2xvc2VkOiB1bnNwZW50IGZ1bmRzIHJlY2xhaW1lZCBieSBvd25lcjsgbm8gZnVydGhlciBzZXR0bGVtZW50cyBhbGxvd2VkLgAAAAAABkNsb3NlZAAAAAAAAg==",
        "AAAAAQAAAC5BbiBlc2Nyb3dlZCBhbGxvd2FuY2UgZGVwb3NpdGVkIGJ5IGEgY3VzdG9tZXIuAAAAAAAAAAAACUFsbG93YW5jZQAAAAAAAAgAAAAvUmVtYWluaW5nLCB1bnNwZW50IHRva2VuIGJhbGFuY2UgaW4gYmFzZSB1bml0cy4AAAAAB2JhbGFuY2UAAAAACwAAAEBVbml4IHRpbWVzdGFtcCAoc2Vjb25kcykgd2hlbiB0aGUgb3duZXIgcmVxdWVzdGVkIGNsb3NlLCBpZiBhbnkuAAAAEmNsb3NlX3JlcXVlc3RlZF9hdAAAAAAD6AAAAAYAAABeVW5jb21wcmVzc2VkIHNlY3AyNTZyMSBwdWJsaWMga2V5ICg2NSBieXRlczogMHgwNCB8fCBYWzMyXSB8fCBZWzMyXSkgb2YgdGhlIGN1c3RvbWVyJ3MgZGV2aWNlLgAAAAAACmRldmljZV9rZXkAAAAAA+4AAABBAAAAVVRoZSBkZXBvc2l0b3Igd2hvIG93bnMgdGhlIGFsbG93YW5jZSBhbmQgY2FuIHRvcCB1cCwgY2xvc2UsIG9yIHJlY2xhaW0gdW5zcGVudCBmdW5kcy4AAAAAAAAFb3duZXIAAAAAAAATAAAAUE1heGltdW0gYW1vdW50IHRoYXQgY2FuIGJlIGF1dGhvcml6ZWQgaW4gYW55IHNpbmdsZSBwYXltZW50IGZyb20gdGhpcyBhbGxvd2FuY2UuAAAAD3Blcl9wYXltZW50X2NhcAAAAAALAAAAGUN1cnJlbnQgbGlmZWN5Y2xlIHN0YXR1cy4AAAAAAAAGc3RhdHVzAAAAAAfQAAAABlN0YXR1cwAAAAAAPVRoZSB0b2tlbiBhZGRyZXNzIChlLmcuIFVTREMgU0FDKSBlc2Nyb3dlZCBpbiB0aGlzIGFsbG93YW5jZS4AAAAAAAAFdG9rZW4AAAAAAAATAAAAQlVuaXggdGltZXN0YW1wIChzZWNvbmRzKSB1bnRpbCB3aGljaCBhdXRob3JpemF0aW9ucyBjYW4gYmUgaXNzdWVkLgAAAAAAC3ZhbGlkX3VudGlsAAAAAAY=",
        "AAAABAAAADZDdXN0b20gY29udHJhY3QgZXJyb3JzIGZvciBmYXRhbCBvcGVyYXRpb25hbCBmYWlsdXJlcy4AAAAAAAAAAAAKVmF1bHRFcnJvcgAAAAAADAAAACBDb250cmFjdCBpcyBhbHJlYWR5IGluaXRpYWxpemVkLgAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAmQ29udHJhY3QgaGFzIG5vdCBiZWVuIGluaXRpYWxpemVkIHlldC4AAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAENBbGxvd2FuY2UgZGVwb3NpdCBhbW91bnQgaXMgb3V0c2lkZSBbbWluX2FsbG93YW5jZSwgbWF4X2FsbG93YW5jZV0uAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAAAwAAADBWYWxpZCB1bnRpbCB0aW1lc3RhbXAgaXMgaW4gdGhlIHBhc3Qgb3IgaW52YWxpZC4AAAANSW52YWxpZFdpbmRvdwAAAAAAAAQAAAA8UGVyLXBheW1lbnQgY2FwIGlzIG5vbi1wb3NpdGl2ZSBvciBleGNlZWRzIGFsbG93YW5jZSBhbW91bnQuAAAACkludmFsaWRDYXAAAAAAAAUAAAAZQWxsb3dhbmNlIGRvZXMgbm90IGV4aXN0LgAAAAAAABFBbGxvd2FuY2VOb3RGb3VuZAAAAAAAAAYAAAAiQWxsb3dhbmNlIGlzIG5vdCBpbiBBY3RpdmUgc3RhdHVzLgAAAAAAEkFsbG93YW5jZU5vdEFjdGl2ZQAAAAAABwAAABxBbGxvd2FuY2UgaXMgYWxyZWFkeSBjbG9zZWQuAAAADUFscmVhZHlDbG9zZWQAAAAAAAAIAAAASlJlY2xhaW0gYXR0ZW1wdGVkIGJlZm9yZSB0aGUgcmVxdWlyZWQgc2V0dGxlbWVudCBhbmQgZ3JhY2Ugd2luZG93IGVsYXBzZWQuAAAAAAAPUmVjbGFpbVRvb0Vhcmx5AAAAAAkAAAAyQ2hlY2tlZCBhcml0aG1ldGljIG92ZXJmbG93IG9yIHVuZGVyZmxvdyBvY2N1cnJlZC4AAAAAABJBcml0aG1ldGljT3ZlcmZsb3cAAAAAAAoAAAAZQ2FsbGVyIGlzIG5vdCBhdXRob3JpemVkLgAAAAAAAAxVbmF1dGhvcml6ZWQAAAALAAAAI0JhdGNoIGV4Y2VlZHMgbWF4aW11bSBhbGxvd2VkIHNpemUuAAAAAA1CYXRjaFRvb0xhcmdlAAAAAAAADA==",
        "AAAAAQAAAENTaWduZWQgcGF5bWVudCBhdXRob3JpemF0aW9uIHByZXNlbnRlZCBieSBhIGN1c3RvbWVyIHRvIGEgbWVyY2hhbnQuAAAAAAAAAAALUGF5bWVudEF1dGgAAAAABwAAADBPbi1jaGFpbiBpZGVudGlmaWVyIG9mIHRoZSBjdXN0b21lcidzIGFsbG93YW5jZS4AAAAMYWxsb3dhbmNlX2lkAAAABgAAACNQYXltZW50IGFtb3VudCBpbiB0b2tlbiBiYXNlIHVuaXRzLgAAAAAGYW1vdW50AAAAAAALAAAALlVuaXggdGltZXN0YW1wIChzZWNvbmRzKSB3aGVuIHBheW1lbnQgZXhwaXJlcy4AAAAAAApleHBpcmVzX2F0AAAAAAAGAAAANVVuaXggdGltZXN0YW1wIChzZWNvbmRzKSB3aGVuIHBheW1lbnQgd2FzIGF1dGhvcml6ZWQuAAAAAAAACWlzc3VlZF9hdAAAAAAAAAYAAAA6TWVyY2hhbnQgYWRkcmVzcyBib3VuZCBhcyB0aGUgc29sZSByZWNpcGllbnQgb2YgdGhlIGZ1bmRzLgAAAAAACG1lcmNoYW50AAAAEwAAADtVbmlxdWUgMTI4LWJpdCByYW5kb20gaWRlbnRpZmllciBwcmV2ZW50aW5nIHJlcGxheSBhdHRhY2tzLgAAAAAKcGF5bWVudF9pZAAAAAAD7gAAABAAAAAiV2lyZSBwcm90b2NvbCB2ZXJzaW9uIChtdXN0IGJlIDEpLgAAAAAAB3ZlcnNpb24AAAAABA==",
        "AAAAAwAAADhTcGVjaWZpYywgbm9uLXJldmVydGluZyByZWFzb24gZm9yIHNldHRsZW1lbnQgcmVqZWN0aW9uLgAAAAAAAAAMUmVqZWN0UmVhc29uAAAACAAAAFVDcnlwdG9ncmFwaGljIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkIG9yIHNpZ25hdHVyZSBub3QgaW4gY2Fub25pY2FsIGxvdy1TIGZvcm0uAAAAAAAADEJhZFNpZ25hdHVyZQAAAAAAAABEUGF5bWVudCBhdXRob3JpemF0aW9uIGhhcyBleHBpcmVkIGJhc2VkIG9uIGN1cnJlbnQgbGVkZ2VyIHRpbWVzdGFtcC4AAAAHRXhwaXJlZAAAAAABAAAAOkF1dGhvcml6ZWQgYW1vdW50IGV4Y2VlZHMgdGhlIGFsbG93YW5jZSdzIHBlci1wYXltZW50IGNhcC4AAAAAAAdPdmVyQ2FwAAAAAAIAAABDUGF5bWVudCBJRCBoYXMgYWxyZWFkeSBiZWVuIHNldHRsZWQgb3IgYXR0ZW1wdGVkIG9uIHRoaXMgYWxsb3dhbmNlLgAAAAAGUmVwbGF5AAAAAAADAAAAPEFsbG93YW5jZSBJRCB3YXMgbm90IGZvdW5kIG9yIGlzIGluIGFuIGludmFsaWQvY2xvc2VkIHN0YXRlLgAAABBVbmtub3duQWxsb3dhbmNlAAAABAAAAFVTZXR0bGVtZW50IHRyYW5zYWN0aW9uIGNhbGxlci9yZWNpcGllbnQgZG9lcyBub3QgbWF0Y2ggdGhlIG1lcmNoYW50IGluIGF1dGhvcml6YXRpb24uAAAAAAAADVdyb25nTWVyY2hhbnQAAAAAAAAFAAAAVkludmFsaWQgYXV0aG9yaXphdGlvbiB3aW5kb3cgKGlzc3VlZCBhZnRlciB2YWxpZF91bnRpbCBvciBkdXJhdGlvbiA+IG1heF9wYXltZW50X3R0bCkuAAAAAAAJQmFkV2luZG93AAAAAAAABgAAADVBbGxvd2FuY2UgYmFsYW5jZSBpcyB6ZXJvOyBwYXltZW50IGNhbm5vdCBiZSBob25vcmVkLgAAAAAAAAxJbnN1ZmZpY2llbnQAAAAH",
        "AAAAAgAAADdSZXN1bHQgb2YgYXR0ZW1wdGluZyB0byBzZXR0bGUgYSBwYXltZW50IGF1dGhvcml6YXRpb24uAAAAAAAAAAAMU2V0dGxlUmVzdWx0AAAAAwAAAAAAAAAbRnVsbHkgcGFpZCB0byB0aGUgbWVyY2hhbnQuAAAAAAdTZXR0bGVkAAAAAAEAAABIUGFydGlhbGx5IHBhaWQgZHVlIHRvIGluc3VmZmljaWVudCBhbGxvd2FuY2UgYmFsYW5jZTogKHBhaWQsIHNob3J0ZmFsbCkuAAAAB1BhcnRpYWwAAAAAAgAAAAsAAAALAAAAAQAAAB5SZWplY3RlZCB3aXRob3V0IG1vdmluZyBmdW5kcy4AAAAAAAhSZWplY3RlZAAAAAEAAAfQAAAADFJlamVjdFJlYXNvbg==",
        "AAAAAQAAAEFBbiBvbi1jaGFpbiBzaG9ydGZhbGwgcmVjb3JkIGF0dHJpYnV0ZWQgdG8gYSBjdXN0b21lciBkZXZpY2Uga2V5LgAAAAAAAAAAAAAPU2hvcnRmYWxsUmVjb3JkAAAAAAQAAAAtQWxsb3dhbmNlIHVuZGVyIHdoaWNoIHRoZSBzaG9ydGZhbGwgb2NjdXJyZWQuAAAAAAAADGFsbG93YW5jZV9pZAAAAAYAAAAsVW5wYWlkIHNob3J0ZmFsbCBhbW91bnQgaW4gdG9rZW4gYmFzZSB1bml0cy4AAAAGYW1vdW50AAAAAAALAAAAK01lcmNoYW50IHdobyByZWNlaXZlZCBsZXNzIHRoYW4gYXV0aG9yaXplZC4AAAAACG1lcmNoYW50AAAAEwAAAC9Vbml4IHRpbWVzdGFtcCB3aGVuIHRoZSBzaG9ydGZhbGwgd2FzIHJlY29yZGVkLgAAAAAJdGltZXN0YW1wAAAAAAAABg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    settle: this.txFromJSON<SettleResult>,
        top_up: this.txFromJSON<Result<void>>,
        reclaim: this.txFromJSON<Result<i128>>,
        extend_ttl: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        settle_batch: this.txFromJSON<Array<SettleResult>>,
        get_allowance: this.txFromJSON<Option<Allowance>>,
        request_close: this.txFromJSON<Result<void>>,
        get_shortfalls: this.txFromJSON<Array<ShortfallRecord>>,
        create_allowance: this.txFromJSON<Result<u64>>
  }
}