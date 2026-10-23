---
name: Protocol Change Proposal
about: Propose a modification to the Kasuwa wire format or contract interaction
title: 'protocol: '
labels: ['protocol', 'needs-adr']
assignees: ''
---

## Summary of Proposed Change
<!-- High-level description of the change to PaymentRequest, PaymentAuthorization, or Vault interface. -->

## Rationale
<!-- Why is this change necessary? What limitations in Protocol v1 does it resolve? -->

## Wire & Serialization Impact
- [ ] Modifies `PaymentRequest` wire format
- [ ] Modifies `PaymentAuthorization` wire format
- [ ] Modifies signed message construction / domain tag
- [ ] Requires protocol version bump

## Required Updates Checklist
- [ ] Architecture Decision Record (ADR) drafted in `docs/adr/`
- [ ] Specification updated in `docs/protocol.md`
- [ ] Test vectors updated in `test-vectors/payment-auth.json`
- [ ] Rust contract (`contracts/allowance-vault`) implementation & tests
- [ ] TypeScript package (`packages/protocol`) implementation & tests
