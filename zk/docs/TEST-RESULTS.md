# ZK Proof of Learning — Test Results

**Date:** 2026-11-03
**Environment:** Windows, Node.js v24.18.0, npm 11.16.0
**Curve:** BN254 (bn128)
**Circuit:** `score_threshold` — 1,133 constraints, 6 public inputs, 2 private inputs
**Setup:** local development ptau 2^12 + local circuit contribution (not production)
**Command:** `cd zk && npm test`

```
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms ~16s (observed 15.7–16.1s across runs)
```

## Results by required case

| # | Case | Test | Result |
|---:|---|---|---|
| 1 | Score above threshold | `accepts a score above the public threshold without revealing the score` | PASS |
| 2 | Score exactly equal to threshold | `accepts a score exactly equal to the threshold` | PASS |
| 3 | Score below threshold | `rejects proof generation when the score is below the threshold` | PASS |
| 4 | Invalid score range | `rejects invalid score ranges in the API and in the circuit` | PASS |
| 5 | Modified proof | `rejects a modified proof` | PASS |
| 6 | Incorrect commitment | `rejects a witness whose score does not match the signed commitment` | PASS |
| 7 | Reuse with a different evaluation ID | `rejects proof reuse with a different evaluation ID` | PASS |
| 8 | Reuse with a different learner binding | `rejects proof reuse with a different learner binding` | PASS |

## Additional coverage

| Case | Test | Result |
|---|---|---|
| Evidence or credential rebinding | `rejects proof reuse against different evidence or credential bindings` | PASS |
| Self-generated commitment / rogue issuer | `rejects a self-generated commitment without a trusted evaluator signature` | PASS |
| Attestation freshness and future dating | `enforces attestation freshness when a max age is supplied` | PASS |
| Threshold policy pinning | `binds the threshold as a public policy value` | PASS |
| bytes32 ↔ field mapping for Avalanche | `bytes32 evidence and credential hashes use the Solidity-compatible SHA-256 binding` | PASS |
| Modulo-p collision regression | `rejects bytes32 bindings that collide only under bare modulo p` | PASS |
| Public signal tampering | `rejects tampering with every public signal` | PASS |
| Issuer lookup hardening | `does not resolve issuer IDs through Object.prototype` | PASS |
| Revocation status | `rejects revoked or invalid credential status when supplied` | PASS |
| Replay semantics | `presents the same proof idempotently; one-time claims need a nullifier` | PASS |
| Commitment hiding with different nonces | `commitment is hiding: equal scores with different nonces produce different commitments` | PASS |
| Build manifest / setup warning | `build produces a Groth16 verification key and documents a non-production setup` | PASS |

## What each negative test proves

- **Below threshold:** witness generation fails at the `GreaterEqThan` constraint
  (line 71 of the circuit). No proof is produced.
- **Invalid range:** `101` fails `LessEqThan(100)`, `128` fails `Num2Bits(7)`, and
  `-1` (fed as `p-1`) fails `Num2Bits(7)`. The test bypasses JS validation and
  builds a matching commitment, so the rejection is attributable to the circuit.
- **Modified proof:** changing one `pi_a` coordinate makes the pairing check fail.
- **Incorrect commitment:** changing the witness score while keeping the signed
  commitment is rejected before proving (`COMMITMENT_MISMATCH`); changing the
  public signal is rejected by the verifier; changing the signed commitment breaks
  the Ed25519 signature.
- **Different evaluation/learner/evidence/credential:** the verifier compares
  recomputed or supplied bindings with both the public signals and the signed
  attestation, so a valid proof cannot be re-labelled.
- **Self-generated commitment:** a proof generated with an attacker key is
  rejected as `UNTRUSTED_ISSUER`; spoofing the trusted key ID is rejected as
  `INVALID_ATTESTATION_SIGNATURE`.

## Demo run

```
$ npm run demo
  evaluation:       <uuid>
  threshold:        75
  score:            private (meets threshold)
  commitment:       418699197979545998891585…
  public signals:   6
  verification:     VALID (OK)
  artifacts:        build/demo/
```

`build/demo/attestation.json` contains only the commitment, field bindings,
issuer, timestamp and signature. There is no `score` field. The witness
(`score`, `nonce`) is not written to disk.

## Performance observed (local machine)

| Operation | Time |
|---|---|
| Full build (compile + ptau + setup, first run) | under 1 minute |
| Proof generation (Groth16, single-threaded) | ~0.5 s per proof |
| Independent verification | ~0.1–0.7 s including curve setup/cleanup |
| Circuit compile | ~1 s |
| Test suite (20 tests, 9 successful proofs + rejected witness attempts) | ~16 s |

These are indicative only; browser proving and on-chain verification have
different cost profiles.

## Not tested here

- Avalanche Fuji deployment, RPC calls, or gas measurement.
- Production multi-party trusted setup or key management.
- Browser-side proving (the MVP runs in Node).
- Existing certificate issuance integration (deliberately untouched).
- Formal circuit audit or fuzzing beyond the listed cases.
- Cross-device replay, clock-skew extremes, or denial-of-service behavior.

See the limitations in [`ZK-PROOF-OF-LEARNING.md`](ZK-PROOF-OF-LEARNING.md#8-security-limitations).
