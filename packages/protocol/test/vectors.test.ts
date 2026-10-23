import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  decodePaymentRequest,
  encodePaymentRequest,
  decodePaymentAuthorization,
  encodePaymentAuthorization,
  buildSigningMessage,
  normalizeLowS,
  derToRaw,
  verifyAuthorization,
} from '../src/index.js';

describe('Kasuwa Protocol Test Vectors (test-vectors/payment-auth.json)', () => {
  const vectorsPath = path.resolve(__dirname, '../../../test-vectors/payment-auth.json');
  const fileContent = fs.readFileSync(vectorsPath, 'utf8');
  const suite = JSON.parse(fileContent);

  const testPubKey = suite.test_key.public_key_uncompressed_hex;
  const ctx = {
    contractId: suite.context.contract_id_hex,
    networkId: suite.context.network_id_hex,
  };

  it('contains at least 15 comprehensive vectors', () => {
    expect(suite.vectors.length).toBeGreaterThanOrEqual(15);
  });

  for (const v of suite.vectors) {
    if (v.type === 'PaymentRequest') {
      it(`evaluates vector ${v.id}: ${v.note}`, () => {
        const inputReq = {
          version: v.inputs.version,
          merchant: Buffer.from(v.inputs.merchant, 'hex'),
          amount: BigInt(v.inputs.amount),
          tokenHint: v.inputs.tokenHint,
          requestId: Buffer.from(v.inputs.requestId, 'hex'),
          expiresAt: v.inputs.expiresAt,
        };

        const encoded = encodePaymentRequest(inputReq);
        const encodedHex = Buffer.from(encoded).toString('hex');
        const encodedBase64Url = Buffer.from(encoded).toString('base64url');
        const hashHex = crypto.createHash('sha256').update(encoded).digest('hex');

        expect(encodedHex).toBe(v.expected_encoded_hex);
        expect(encodedBase64Url).toBe(v.expected_base64url);
        expect(hashHex).toBe(v.expected_hash);

        // Strict decode round-trip
        const decoded = decodePaymentRequest(encoded);
        expect(decoded.version).toBe(inputReq.version);
        expect(Buffer.from(decoded.merchant).toString('hex')).toBe(v.inputs.merchant);
        expect(decoded.amount).toBe(inputReq.amount);
        expect(decoded.tokenHint).toBe(inputReq.tokenHint);
        expect(Buffer.from(decoded.requestId).toString('hex')).toBe(v.inputs.requestId);
        expect(decoded.expiresAt).toBe(inputReq.expiresAt);
      });
    } else if (v.type === 'PaymentAuthorization') {
      it(`evaluates vector ${v.id}: ${v.note}`, () => {
        const inputAuth = {
          version: v.inputs.version,
          allowanceId: BigInt(v.inputs.allowanceId),
          paymentId: Buffer.from(v.inputs.paymentId, 'hex'),
          merchant: Buffer.from(v.inputs.merchant, 'hex'),
          amount: BigInt(v.inputs.amount),
          issuedAt: v.inputs.issuedAt,
          expiresAt: v.inputs.expiresAt,
          signature: Buffer.from(v.inputs.signature, 'hex'),
        };

        const encoded = encodePaymentAuthorization(inputAuth);
        const encodedHex = Buffer.from(encoded).toString('hex');
        const encodedBase64Url = Buffer.from(encoded).toString('base64url');

        expect(encodedHex).toBe(v.expected_encoded_hex);
        expect(encodedBase64Url).toBe(v.expected_base64url);

        // Verify signed message hash construction
        const digest = buildSigningMessage(inputAuth, ctx.contractId, ctx.networkId);
        const digestHex = Buffer.from(digest).toString('hex');
        expect(digestHex).toBe(v.expected_hash);

        // Verify cryptographic signature with committed test public key
        const valid = verifyAuthorization(inputAuth, testPubKey, ctx);
        expect(valid).toBe(true);

        // Strict decode round-trip
        const decoded = decodePaymentAuthorization(encoded);
        expect(decoded.version).toBe(inputAuth.version);
        expect(decoded.allowanceId).toBe(inputAuth.allowanceId);
        expect(Buffer.from(decoded.paymentId).toString('hex')).toBe(v.inputs.paymentId);
        expect(Buffer.from(decoded.merchant).toString('hex')).toBe(v.inputs.merchant);
        expect(decoded.amount).toBe(inputAuth.amount);
        expect(decoded.issuedAt).toBe(inputAuth.issuedAt);
        expect(decoded.expiresAt).toBe(inputAuth.expiresAt);
        expect(Buffer.from(decoded.signature).toString('hex')).toBe(v.inputs.signature);
      });
    } else if (v.type === 'SignatureNormalization') {
      it(`evaluates vector ${v.id}: ${v.note}`, () => {
        const rawSig = Buffer.from(v.inputs.raw_signature_hex, 'hex');
        const normalized = normalizeLowS(rawSig);
        const normalizedHex = Buffer.from(normalized).toString('hex');

        expect(normalizedHex).toBe(v.expected_normalized_hex);
      });
    } else if (v.type === 'DerSignatureConversion') {
      it(`evaluates vector ${v.id}: ${v.note}`, () => {
        const der = Buffer.from(v.inputs.der_hex, 'hex');
        const raw = derToRaw(der);
        const rawHex = Buffer.from(raw).toString('hex');

        expect(rawHex).toBe(v.expected_raw_hex);
      });
    }
  }
});
