# Manual Testing Guide

This document records the manual test steps required for functionality that
cannot be fully exercised in automated CI (physical hardware key stores, NFC,
real biometrics).

---

## 1. Hardware key store signing (iOS — Secure Enclave)

**Device:** Any iPhone with Face ID or Touch ID (A7 or later).

**Build:**
```bash
cd apps/mobile
pnpm expo prebuild --platform ios
pnpm expo run:ios --device
```

### Steps

| # | Action | Expected |
|---|---|---|
| 1 | Launch app, choose Customer mode | Mode select screen disappears, Allowance tab shown |
| 2 | Tap "Create Allowance" | Biometric prompt appears |
| 3 | Authenticate with Face ID / Touch ID | `generate()` returns a 65-byte uncompressed P-256 public key (check Xcode console log) |
| 4 | Confirm `exists('allowance-<id>')` returns `true` | Shown in dev debug panel |
| 5 | Switch to Pay tab, scan a test request QR | Biometric prompt appears with the payment description |
| 6 | Authenticate | `sign()` returns 64-byte raw r‖s, low-S; authorization QR displayed |
| 7 | In the merchant app, verify the QR | "Verified offline ✓" shown |
| 8 | On a second phone in airplane mode, repeat steps 5–7 | Same result; demonstrates offline path |

**Verification:** Use the test QR decoder script:
```bash
pnpm tsx scripts/verify-qr.ts <base64url>
```
It calls `verifyAuthorization` from `@kasuwa/protocol` and prints `VALID` or `INVALID`.

---

## 2. Hardware key store signing (Android — StrongBox / TEE)

**Devices:**
- Primary: a device with StrongBox (e.g., Pixel 6+, Samsung Galaxy S21+).
- Fallback: any Android 9+ device (TEE path).

**Build:**
```bash
cd apps/mobile
pnpm expo prebuild --platform android
pnpm expo run:android --device
```

### Steps

Same as iOS above, substituting fingerprint / face unlock.

**Confirm StrongBox vs TEE:** The debug panel (DEV builds only) shows
`StrongBox: yes` or `StrongBox: no (TEE fallback)`.

**NONEwithECDSA note:** The Android native module uses `NONEwithECDSA` (not
`SHA256withECDSA`) so that the Keystore signs the raw 32-byte digest without
re-hashing. Verify this is correct by checking the logcat output for
`"algorithm: NONEwithECDSA"` when signing.

---

## 3. Key invalidation recovery path

**Scenario:** Customer adds a new fingerprint / re-enrols Face ID after creating
an allowance. The hardware key is invalidated.

### Steps

| # | Action | Expected |
|---|---|---|
| 1 | Create an allowance on a real device (sets up hardware key) | Allowance ID stored locally |
| 2 | Go to device Settings → Biometrics → add a new fingerprint | |
| 3 | Return to Kasuwa, tap Pay | `sign()` throws `DeviceKeyError { code: KEY_INVALIDATED }` |
| 4 | App shows: "Your signing key was invalidated. Create a new allowance." | Recovery screen |
| 5 | Recovery screen shows: "Your old allowance (ID: X) can be reclaimed after [date]." | reclaim window = valid_until + max_payment_ttl + grace |
| 6 | Tap "Create new allowance" | New key generated, new allowance created |

**Note:** The old allowance's `device_key` cannot sign new payments, but the
escrowed funds are fully recoverable after the reclaim window. No funds are lost.

---

## 4. Offline two-QR flow (airplane mode)

**Requirement:** Two physical devices (or one device + one emulator) with the app installed.

| # | Action | Expected |
|---|---|---|
| 1 | Phone A (Customer): create a 10 USDC allowance while online | Allowance ID shown |
| 2 | Put **both** phones in airplane mode | |
| 3 | Phone B (Merchant): tap "New request", enter 1 USDC | Payment request QR shown |
| 4 | Phone A: scan Phone B's QR | Confirmation screen: merchant, amount, estimated balance |
| 5 | Phone A: tap "Authorize" → biometric prompt | Authorization QR shown |
| 6 | Phone B: scan Phone A's authorization QR | All 5 checks pass; "Verified offline ✓" shown |
| 7 | Phone B: Outbox tab shows 1 queued entry | |
| 8 | Restore networking on Phone B | Outbox auto-submits; entry transitions to `settled` |
| 9 | Phone A: local spent counter decremented | Refresh shows updated estimated balance |

---

## 5. Simulator / emulator (software fallback)

On simulators and emulators `__DEV__` is `true` and the `SoftwareDeviceKey`
is used automatically. A yellow warning badge "⚠ software signing" appears in
the UI.

The software path produces signatures compatible with `verifyAuthorization`
(both sides use WebCrypto with the same hashing sequence).

Run automated tests to confirm:
```bash
cd apps/mobile
pnpm test
```

All `DeviceKey.test.ts` tests should pass.

---

## 6. Result matrix

| Platform | Hardware key | BiometricPrompt | StrongBox | Verified |
|---|---|---|---|---|
| iPhone 14 (Face ID) | Secure Enclave | ✓ | N/A | [ ] |
| iPhone SE (Touch ID) | Secure Enclave | ✓ | N/A | [ ] |
| Pixel 8 (Android 14) | StrongBox | ✓ | ✓ | [ ] |
| Samsung Galaxy S21 | StrongBox | ✓ | ✓ | [ ] |
| Older Android (TEE only) | TEE | ✓ | ✗ | [ ] |
| iOS Simulator | Software fallback | N/A | N/A | [ ] |
| Android Emulator | Software fallback | N/A | N/A | [ ] |

---

## 7. Automated Non-Camera E2E Suite & QR Injection Hooks

For headless CI environments where pointing physical cameras between emulators is impractical, the mobile app provides clearly named test-only hooks:

```typescript
import { __testInjectQrPayload } from '../native/testQrHook.js';

// Injects raw scanned base64url payload directly into the receive verification pipeline:
__testInjectQrPayload(qrPayload);
```

### Running the E2E Test Suite Locally
```bash
pnpm test:e2e
```
This runs `scripts/e2e.ts`, which exercises:
1. Two-QR payment creation, signing, and local offline verification.
2. The honest limit double-spend bounded loss scenario ($20 allowance across two $15 payments).
3. Relayer batch settlement, indexer event ingestion, and dashboard reconciliation.
