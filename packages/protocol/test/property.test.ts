import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  encodePaymentRequest,
  decodePaymentRequest,
  encodePaymentAuthorization,
  decodePaymentAuthorization,
  ProtocolError,
  PaymentRequest,
  PaymentAuthorization,
} from '../src/index.js';

describe('Kasuwa Protocol Property-Based & Fuzz Tests', () => {
  const arbitraryPaymentRequest: fc.Arbitrary<PaymentRequest> = fc.record({
    version: fc.constant(1),
    merchant: fc.uint8Array({ minLength: 32, maxLength: 32 }),
    amount: fc.bigInt({ min: 0n, max: 18446744073709551615n }),
    tokenHint: fc.integer({ min: 0, max: 255 }),
    requestId: fc.uint8Array({ minLength: 8, maxLength: 8 }),
    expiresAt: fc.integer({ min: 0, max: 0xffffffff }),
  });

  const arbitraryPaymentAuth: fc.Arbitrary<PaymentAuthorization> = fc.record({
    version: fc.constant(1),
    allowanceId: fc.bigInt({ min: 0n, max: 18446744073709551615n }),
    paymentId: fc.uint8Array({ minLength: 16, maxLength: 16 }),
    merchant: fc.uint8Array({ minLength: 32, maxLength: 32 }),
    amount: fc.bigInt({ min: 0n, max: 18446744073709551615n }),
    issuedAt: fc.integer({ min: 0, max: 1099511627775 }),
    expiresAt: fc.integer({ min: 0, max: 1099511627775 }),
    signature: fc.uint8Array({ minLength: 64, maxLength: 64 }),
  });

  it('PaymentRequest round-trip: decode(encode(x)) === x', () => {
    fc.assert(
      fc.property(arbitraryPaymentRequest, (req) => {
        const encoded = encodePaymentRequest(req);
        const decoded = decodePaymentRequest(encoded);

        expect(decoded.version).toBe(req.version);
        expect(decoded.merchant).toEqual(req.merchant);
        expect(decoded.amount).toBe(req.amount);
        expect(decoded.tokenHint).toBe(req.tokenHint);
        expect(decoded.requestId).toEqual(req.requestId);
        expect(decoded.expiresAt).toBe(req.expiresAt);
      }),
      { numRuns: 1000 },
    );
  });

  it('PaymentAuthorization round-trip: decode(encode(x)) === x', () => {
    fc.assert(
      fc.property(arbitraryPaymentAuth, (auth) => {
        const encoded = encodePaymentAuthorization(auth);
        const decoded = decodePaymentAuthorization(encoded);

        expect(decoded.version).toBe(auth.version);
        expect(decoded.allowanceId).toBe(auth.allowanceId);
        expect(decoded.paymentId).toEqual(auth.paymentId);
        expect(decoded.merchant).toEqual(auth.merchant);
        expect(decoded.amount).toBe(auth.amount);
        expect(decoded.issuedAt).toBe(auth.issuedAt);
        expect(decoded.expiresAt).toBe(auth.expiresAt);
        expect(decoded.signature).toEqual(auth.signature);
      }),
      { numRuns: 1000 },
    );
  });

  it('Decoder fuzzing: 10,000 random inputs only throw ProtocolError', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 300 }), (randomBytes) => {
        // Fuzz decodePaymentRequest
        try {
          decodePaymentRequest(randomBytes);
        } catch (err) {
          expect(err).toBeInstanceOf(ProtocolError);
        }

        // Fuzz decodePaymentAuthorization
        try {
          decodePaymentAuthorization(randomBytes);
        } catch (err) {
          expect(err).toBeInstanceOf(ProtocolError);
        }
      }),
      { numRuns: 10000 },
    );
  });
});
