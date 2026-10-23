# ADR-003: Two-QR-Code Flow

## Status
Accepted

## Context
In a payment flow between two physical parties, user experience must be balanced against adversarial security:
- A single-QR flow where the customer presents a QR code displaying their allowance or generic authorization ("pay anyone") is vulnerable to eavesdropping and theft (Threat T4). Any bystander with a camera or mirror can capture the customer's QR code and submit it to claim the funds.
- Bluetooth Low Energy (BLE) or NFC can achieve two-way communication silently, but require hardware compatibility, permissions, and pairing handshakes that frequently fail on low-cost devices.

## Decision
We require a **two-QR handshake** using the device cameras:
1. **QR #1 (Merchant → Customer)**: `PaymentRequest` containing `merchant` address, `amount`, `token_hint`, `request_id`, and `expires_at`.
2. **QR #2 (Customer → Merchant)**: `PaymentAuthorization` cryptographically binding the payment to the scanned `merchant` address and `amount`.

## Consequences
- **Positive**: Eliminates QR theft and redirection attacks (Threat T4). Stolen QR codes are useless because funds can only settle to the merchant named inside the signature.
- **Positive**: Zero reliance on Bluetooth pairing, NFC, or radio transports.
- **Negative**: Requires two sequential camera scans instead of one.
