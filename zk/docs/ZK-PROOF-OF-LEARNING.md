# PARADOX AI — ZK Proof of Learning

**Status:** local MVP, working circuit + proof generator + independent verifier + 20 tests
**Scope:** `paradox-zk` only; no deployment, no production database, no existing flow changed
**Stack:** Circom 2.2.3 / snarkjs 0.7.6 / Groth16 / BN254 / Ed25519 attestations

---

## 1. Repository findings

The existing app already has the ingredients needed for a private proof layer.

| Area | File | Relevant facts |
|---|---|---|
| AI evaluation | `api/debate.js` | Resubmission evaluations are validated server-side. `score` is recalculated from a 4 × 25 rubric and is only persisted when evidence is sufficient. A `proofRecord` is attached with `contentHash = sha256(problem, previousSolution, solution)`. |
| Learning records | `api/learning-records/_service.js` | `publicLearningEvaluation` exposes `id`, `sessionId`, `submissionId`, `score`, `status`, `credential.id`, `credential.idHash`, `credential.hash`, `evaluatedAt`. Eligibility requires `status === 'pass'`, score >= 75 policy, and a valid `proofRecord.contentHash`. |
| Credential identity | `api/credentials/_avalanche.js` | `credentialIdFromCode()` derives a `bytes32` with `keccak256("paradox-learning-credential:" + code)`. `credential_hash` is `0x` + the 32-byte content hash. |
| Avalanche | `contracts/LearningCredentialRegistry.sol` | Fuji 43113 registry stores `credentialId -> (evidenceHash, issuer, issuedAt, revokedAt)`, an issuer allow-list, and revocation. It never stores scores or learner PII. |
| Frontend | `learning-*`, `app*.js` | Plain ES modules; the ZK layer can be consumed as a separate server-side module without changing the UI. |

**Conclusion:** the clean insertion point is a server-side signer that runs *after*
`validateEvaluation()` produces a score and *before* the credential is issued.
The ZK module can consume the existing evaluation row; it needs no changes to the
debate prompt, certificate issuance, or registry.

---

## 2. Architecture

```
┌───────────────────────────┐
│ AI gateway (Gemini etc.)  │
└─────────────┬─────────────┘
              │ validated evaluation: score, evalId, learnerId, evidenceHash, credentialId
              ▼
┌───────────────────────────┐        Ed25519 private key (KMS/HSM in production)
│ Evaluation signer         │──────┐
│ (server-only, future)     │      │
└───────────────────────────┘      │ signs commitment + public bindings
              │                    │
              │ { attestation, witness: {score, nonce} }
              ▼                    │
┌───────────────────────────┐      │
│ Learner / prover          │      │
│ score + nonce = witness   │      │
│ Groth16.fullProve(...)    │      │
└─────────────┬─────────────┘      │
              │ proof + public signals
              ▼                    ▼
┌─────────────────────────────────────────────┐
│ Verifier (server or browser)                │
│ 1. trusted issuer key?                      │
│ 2. Ed25519 attestation valid?               │
│ 3. expected eval/learner/evidence/credential│
│ 4. public signals match attestation         │
│ 5. Groth16 proof valid?                     │
└─────────────────────────────────────────────┘
```

### Isolation rules used by this MVP

- `zk/` has its own `package.json` and lockfile.
- No import from `api/`, `contracts/`, or frontend modules.
- No production `.env`, database, wallet, RPC, or key is read.
- The optional Solidity adapter is a reference file; nothing is deployed.
- The existing certificate issuance path is untouched.

### Where each piece can run

| Piece | MVP location | Production option |
|---|---|---|
| Evaluator signer | Node script, ephemeral key | Server-only module/KMS/HSM, never in the browser |
| Prover | Node (`singleThread`) | Browser with the snarkjs browser bundle (~2.4 MB wasm) or server-side proving service |
| Verifier | Node module | Server API, browser (public vkey only), or the optional Fuji adapter |
| Artifacts | `zk/build/` | CDN/object storage for wasm/zkey/vkey with pinned hashes |

The existing frontend does not need to change for a backend-only MVP: the browser
can call an API that returns the public signals, proof and attestation, while the
server keeps the witness (or the learner browser keeps it). The important rule is
that the **signer key never leaves the server/KMS**.

### Components

| Component | Responsibility |
|---|---|
| `circuits/score_threshold.circom` | Range + threshold + commitment constraints |
| `lib/field.mjs` | Domain-separated hash-to-field and BN254 field constants |
| `lib/commitment.mjs` | Poseidon commitment used by both signer and circuit |
| `lib/attestation.mjs` | Evaluator-signed statement, canonical JSON, Ed25519 |
| `lib/prover.mjs` | Witness validation + `snarkjs.groth16.fullProve` |
| `lib/verifier.mjs` | Independent attestation + binding + Groth16 verification |
| `lib/mock-evaluation.mjs` | Local mock row + read-only adapter sketch for `learning_records` |
| `scripts/build.mjs` | Circom compile, local ptau, Groth16 setup, manifest |
| `scripts/demo.mjs` | End-to-end mock proof; writes only public artifacts |

### Evaluation → ZK mapping

| Existing field | ZK input | Notes |
|---|---|---|
| `evaluations.id` (UUID) | `evaluationId` → `evaluationIdHash` | SHA-256 hash-to-field with domain separation |
| `learner_id` (UUID) | `learnerBinding` | SHA-256 hash-to-field; production should use an HMAC pepper |
| `proof_record.contentHash` / `credential_hash` | `evidenceHash` | `sha256(domain‖"evidence"‖bytes32) % p`; reproducible with the Solidity SHA-256 precompile |
| `credential_id_hash` (bytes32) | `credentialIdHash` | `sha256(domain‖"credential-id"‖bytes32) % p`; links to the registry key |
| `score` | private `score` | Never leaves the witness |
| `status`, `rubric_version`, `model` | not public | Authenticated by the evaluator signature/attestation metadata |

The human-readable credential code can also be bound (`credentialIdBinding` hashes
it) for local demos, but the Avalanche path must use the `credential_id_hash`
bytes32 form so the on-chain value and the circuit field agree.

---

## 3. Trust model

### What is trusted

1. **Evaluator key** — the holder is the only party that can attest that a score
   belongs to an evaluation. In production this must be a server-side key in a
   KMS/HSM, with rotation and an issuer allow-list.
2. **Circuit + verification key** — a wrong or backdoored circuit can prove a false
   statement. The circuit is small and auditable, but has not been formally audited.
3. **Trusted setup** — Groth16 requires a circuit-specific ceremony. The MVP setup
   is development-only.
4. **Verifier policy** — the verifier must pin the required threshold and expected
   bindings. A correct proof for threshold 60 is not proof for policy 75.

### What is not trusted

- The learner cannot invent a commitment and have it accepted: without the
  evaluator key they cannot produce the Ed25519 attestation.
- The learner cannot reuse a proof for another evaluation ID, learner, evidence
  hash, credential, or threshold: all are bound either in the signed attestation
  or in the circuit's public inputs.
- The learner cannot claim a different score than the one the evaluator committed
  to: the circuit recomputes the commitment from the private score and nonce and
  requires equality with the signed commitment.

### The critical distinction

> **A self-generated commitment is not proof that the AI awarded the score.**

The circuit only proves:

```
commit(score, ...) = C  AND  score >= threshold
```

It does **not** know whether `C` came from a real evaluation. That is why the
verifier requires an attestation signed by a trusted evaluator over `C` and the
bindings. The signature is the bridge from "a number in range" to "this number
was awarded for this evaluation".

### Attestation shape

Canonical JSON (sorted keys, no whitespace) signed with Ed25519:

```json
{
  "schemaVersion": "paradox-zk-evaluation-attestation-v1",
  "circuit": "score_threshold",
  "circuitVersion": "1.0.0",
  "issuer": "paradox-ai-evaluator-local",
  "commitment": "<decimal field element>",
  "evaluationIdHash": "<decimal field element>",
  "learnerBinding": "<decimal field element>",
  "evidenceHash": "<decimal field element>",
  "credentialIdHash": "<decimal field element>",
  "issuedAt": "2026-11-03T18:00:00.000Z",
  "signature": "<base64 Ed25519 signature>"
}
```

No `score`, `nonce`, solution text, or learner PII is included. The signature
covers every other field, so changing any binding invalidates it.

---

## 4. Circuit

File: [`circuits/score_threshold.circom`](../circuits/score_threshold.circom)

### Signals

| Type | Signal | Range / meaning |
|---|---|---|
| public | `threshold` | 0..100, pinned by verifier to policy |
| public | `commitment` | Poseidon output |
| public | `evaluationIdHash` | field element |
| public | `learnerBinding` | field element |
| public | `evidenceHash` | field element |
| public | `credentialIdHash` | field element, 0 allowed |
| private | `score` | 0..100 |
| private | `nonce` | non-zero field element, high entropy |

### Constraints

1. **Score range.** `Num2Bits(7)` proves the score is representable in 7 bits,
   rejecting negative field representatives and values ≥ 128. `LessEqThan(7)`
   against 100 caps it at 100. Together: `0 <= score <= 100`.
2. **Threshold range.** The same construction constrains the public threshold to
   `0..100`, so the relation is well-defined even if a caller supplies a bad value.
3. **Threshold relation.** `GreaterEqThan(7)` enforces `score >= threshold`.
4. **Commitment.** `Poseidon(7)` over
   `(DOMAIN, score, evaluationIdHash, learnerBinding, evidenceHash, credentialIdHash, nonce)`
   must equal the public `commitment`.
   - Hiding: `nonce` is 254-bit private randomness; a 0..100 score cannot be
     brute-forced from the commitment without it.
   - Binding: Poseidon collision resistance binds score and context.
   - Domain: `0x50415241444f585a4b` = ASCII `PARADOXZK`.

Compiled size: **1,133 constraints, 6 public inputs, 2 private inputs**.

### Why the whole context is in the commitment

Binding only the score would let a valid proof be re-labelled with another
evaluation or learner. Putting `evaluationIdHash`, `learnerBinding`, `evidenceHash`
and `credentialIdHash` inside the commitment — and exposing them as public
signals — means the verifier can require exact equality with the expected
context, and the signature covers those same values.

---

## 5. Proof generation and verification

### Generation

`generateLearningProof()`:

1. Validates `score ∈ [0,100]` and `threshold ∈ [0,100]` (defence in depth).
2. Recomputes the Poseidon commitment from the private witness.
3. Refuses to prove if it differs from the signed attestation
   (`COMMITMENT_MISMATCH`), so a learner cannot substitute a different score.
4. Builds the witness input and calls `snarkjs.groth16.fullProve` in
   `singleThread` mode.
5. Returns `{ proof, publicSignals, threshold, meta }` — no score and no nonce.

### Verification

`verifyLearningProof()` runs, in order:

| Check | Failure reason |
|---|---|
| Six decimal public signals | `INVALID_PUBLIC_SIGNALS` |
| Attestation present and signed | `INVALID_ATTESTATION` |
| Issuer key ID is trusted | `UNTRUSTED_ISSUER` |
| Ed25519 signature valid | `INVALID_ATTESTATION_SIGNATURE` |
| Schema/circuit/version match | `ATTESTATION_SCHEMA_MISMATCH` |
| `issuedAt` not in the future | `ATTESTATION_IN_FUTURE` |
| Optional `maxAgeSeconds` freshness | `ATTESTATION_EXPIRED` |
| Public threshold equals policy | `THRESHOLD_MISMATCH` |
| Evaluation ID binding equals expected | `EVALUATION_BINDING_MISMATCH` |
| Learner binding equals expected | `LEARNER_BINDING_MISMATCH` |
| Evidence binding equals expected | `EVIDENCE_BINDING_MISMATCH` |
| Credential binding equals expected | `CREDENTIAL_BINDING_MISMATCH` |
| Public commitment equals signed commitment | `COMMITMENT_MISMATCH` |
| Groth16 pairing check | `INVALID_PROOF` |

The verifier returns `{ valid, reason, checks }` rather than throwing, so callers
can log the exact failure without leaking secrets.

### Running

```bash
cd zk
npm install
npm run build
npm test
npm run demo
```

`npm run demo` writes `build/demo/{attestation,proof,public-signals,verification}.json`
and an issuer public key. It never writes the score or nonce.

### Trusted setup requirements

`scripts/build.mjs` currently performs a **development-only** setup:

1. `powersoftau new bn128 12`
2. one contribution with process-generated entropy
3. `prepare phase2`
4. `groth16 setup`
5. one circuit-specific contribution
6. export verification key + reference Solidity verifier

This is **not** a secure ceremony: the build process knows every contribution
secret, so it could forge proofs. For production:

- Use a public multi-party powers-of-tau (e.g. an existing Hermez/iden3 ptau
  transcript) and a circuit-specific phase-2 ceremony with independent
  contributors and published transcripts.
- Verify the final `verification_key.json` hash against the published ceremony.
- Pin the verification key in the verifier and in any on-chain adapter.
- Re-run the ceremony for **every** circuit change; never reuse a zkey across
  circuit versions.
- Pin and verify the Circom compiler checksum. `scripts/build.mjs` downloads the
  current official release when no local binary is present; production builds
  should use a vendored, hash-pinned compiler.

---

## 6. Automated tests

`zk/tests/proof-of-learning.test.mjs`, run with `npm test` — **20/20 pass**.

| Required case | Test |
|---|---|
| Valid score above threshold | `accepts a score above the public threshold without revealing the score` |
| Score exactly equal to threshold | `accepts a score exactly equal to the threshold` |
| Score below threshold | `rejects proof generation when the score is below the threshold` |
| Invalid score range | `rejects invalid score ranges in the API and in the circuit` |
| Modified proof | `rejects a modified proof` |
| Incorrect commitment | `rejects a witness whose score does not match the signed commitment` |
| Reused with different evaluation ID | `rejects proof reuse with a different evaluation ID` |
| Reused with different learner binding | `rejects proof reuse with a different learner binding` |
| Extra: evidence/credential rebinding | `rejects proof reuse against different evidence or credential bindings` |
| Extra: self-generated commitment | `rejects a self-generated commitment without a trusted evaluator signature` |
| Extra: freshness / future-dated attestation | `enforces attestation freshness when a max age is supplied` |
| Extra: threshold policy | `binds the threshold as a public policy value` |
| Extra: bytes32 ↔ field mapping | `bytes32 evidence and credential hashes use the Solidity-compatible SHA-256 binding` |
| Extra: modulo collision regression | `rejects bytes32 bindings that collide only under bare modulo p` |
| Extra: public signal tampering | `rejects tampering with every public signal` |
| Extra: issuer lookup hardening | `does not resolve issuer IDs through Object.prototype` |
| Extra: revocation status | `rejects revoked or invalid credential status when supplied` |
| Extra: replay semantics | `presents the same proof idempotently; one-time claims need a nullifier` |
| Extra: hiding | `commitment is hiding: equal scores with different nonces produce different commitments` |
| Build metadata | `build produces a Groth16 verification key and documents a non-production setup` |

Detailed results and measured timings: [`TEST-RESULTS.md`](TEST-RESULTS.md).

---

## 7. Avalanche Fuji integration design

> **Nothing in this section is deployed or executed.** No contract was compiled to
> Fuji, no transaction was sent, and no key/RPC was used.

### Existing on-chain state

`LearningCredentialRegistry` on Fuji (chain id 43113):

```
credentialId (bytes32) -> { evidenceHash, issuer, issuedAt, revokedAt }
authorizedIssuers(address) -> bool
```

The registry already stores exactly the two values the proof needs:
`credentialId` and `evidenceHash`. It does not store scores, so adding the ZK
layer does not require changing the registry.

### Recommended flow (two phases)

1. **Off-chain verification (today).** The issuer/verification service:
   - checks the Ed25519 attestation against the trusted evaluator key;
   - checks the evaluation ID, learner binding, evidence hash, credential ID and
     threshold policy;
   - verifies the Groth16 proof with `verification_key.json`.
2. **Optional on-chain attestation (future).** After the off-chain checks pass,
   an authorized issuer calls a small adapter that:
   - reads the registry and requires the credential is valid (not revoked);
   - requires the registry's `evidenceHash` to equal the proof's evidence binding;
   - requires the registry key to equal the proof's credential binding;
   - pins the evaluation ID and learner binding supplied by the relayer;
   - requires the proof threshold to meet policy;
   - verifies the Groth16 proof;
   - records the commitment once per credential; repeated verification with the
     same commitment is idempotent and emits no duplicate event.

Reference adapter: [`contracts/optional/PARADOXZKCredentialAdapter.sol`](../contracts/optional/PARADOXZKCredentialAdapter.sol).

### How the bindings map on-chain

| Public signal | On-chain check |
|---|---|
| `evidenceHash` | `sha256("paradox-zk-proof-of-learning-v1|evidence|" ‖ evidenceHash) % p` |
| `credentialIdHash` | `sha256("paradox-zk-proof-of-learning-v1|credential-id|" ‖ credentialId) % p` |
| `threshold` | `>= policyThreshold` (and caller-pinned) |
| `commitment` | stored once per `credentialId`; idempotent repeats only |
| `evaluationIdHash`, `learnerBinding` | relayed and pinned on-chain; originally checked off-chain by the authorized verifier |

The generated `build/Groth16Verifier.sol` exposes:

```solidity
verifyProof(
  uint[2] calldata a,
  uint[2][2] calldata b,
  uint[2] calldata c,
  uint[6] calldata publicSignals
) external view returns (bool)
```

The adapter passes the six public signals in the exact circuit order. Because
Groth16 verification is constant-time and proof size is constant (2 G1 + 1 G2 +
2 G1 points), gas is predictable — expect roughly **250k–350k gas** on Fuji.

### Attestation on-chain options

Ed25519 is cheap off-chain but is not a native EVM precompile. Three options:

1. **Recommended for the MVP:** keep Ed25519 off-chain in the issuer service and
   let only an authorized issuer submit the proof (the on-chain trust is the
   registry's issuer allow-list). This is what the reference adapter assumes.
2. **EIP-712 / secp256k1:** switch the evaluator key to an Ethereum key and verify
   `ecrecover` in the adapter. The circuit and commitment stay unchanged.
3. **Register at issuance:** store the signed commitment hash in the registry when
   the credential is issued, then the adapter only needs to compare it.

Option 1 avoids changing the registry and remains compatible with today's
off-chain flow. Option 2 is the cleanest long-term design if on-chain attestation
verification is required.

### What becomes public on-chain

- Credential ID and evidence hash are **already public** in the registry.
- The threshold is public.
- The commitment is public, but the score stays hidden by the nonce.
- The learner binding/evaluation hash are public field elements; if linkability is
  a concern, use a server-side HMAC pepper for the learner binding and avoid
  publishing the evaluation UUID.

---

## 8. Security limitations

These are deliberate MVP limits, not hidden assumptions.

1. **Development trusted setup.** Single-contributor ptau and circuit key. Anyone
   who saw the build entropy could forge proofs. Production needs a multi-party
   ceremony.
2. **Trusted evaluator.** The Ed25519 key is a single point of trust. Compromise
   lets an attacker attest arbitrary scores. Production needs KMS/HSM, rotation,
   issuer allow-listing, and revocation.
3. **AI correctness is out of scope.** ZK proves the evaluator's committed score
   meets a threshold; it does not prove the AI graded correctly or fairly.
4. **Small score space.** Hiding depends entirely on the nonce. Leaking the nonce
   (logs, memory dumps, reused nonce) lets anyone brute-force the 0..100 score.
   Never persist the witness; generate a fresh nonce per evaluation.
5. **Linkability.** `learnerBinding` is deterministic in the MVP. The same learner
   produces the same public binding across credentials. Production should use an
   HMAC pepper or a per-context salt, stored server-side.
6. **No nullifier / one-time use.** A valid proof and attestation can be presented
   repeatedly for the same credential. That is usually acceptable for a
   credential, but any "claim once" flow needs a nullifier (e.g. a
   `credentialId -> commitment` registry or a nullifier hash).
7. **Attestation freshness is opt-in.** The verifier supports `maxAgeSeconds`, but
   it does not enforce a default. Callers must choose a policy.
8. **Threshold is not signed.** The evaluator signs the commitment, not the
   threshold. A learner can prove any threshold ≤ score. The verifier must pin the
   policy threshold; if the issuer must fix it, add it to the signed statement or
   commit it.
9. **No revocation inside the proof.** Revocation stays in the registry (or the
   issuer service). A proof does not encode "not revoked"; the verifier must check
   the registry/DB separately.
10. **Equivocation.** The evaluator could sign two different commitments for the
    same evaluation ID. The MVP does not prevent this. Add a uniqueness registry
    or bind the commitment at issuance to stop it.
11. **Circuit/tooling audit.** Circom, circomlib, snarkjs and the MVP circuit have
    not been formally audited. Do not use with real credentials without review.
12. **Off-chain verifier only.** The optional adapter is reference code and has not
    been compiled/deployed/tested on Fuji. No gas, RPC, or contract behavior is
    verified.
13. **Witness handling.** The score and nonce exist in process memory during
    proving. Do not log the witness; in a browser, the learner already knows their
    own score, but the nonce still must not leak to third parties.
14. **Circuit changes invalidate setup.** Any change to the circuit requires a new
    ceremony, new zkey, new verification key, and new Solidity verifier.
15. **Bytes32 binding reduction.** The fixed SHA-256 binding avoids trivial H/H+p
    collisions, but still reduces 2^256 into a ~2^254 field. Use two 128-bit limbs
    if information-theoretic injectivity is required.
16. **On-chain trust.** The reference adapter is a trusted-relayer design, not a
    trustless verifier; it does not verify the Ed25519 attestation itself.

See [`SECURITY-REVIEW-OP2.md`](SECURITY-REVIEW-OP2.md) for the full findings
register and the production gate.

---

## 9. Production hardening checklist

- [ ] Replace the local ptau with a public multi-party transcript; run a phase-2
      ceremony and publish hashes.
- [ ] Move the evaluator key to KMS/HSM; add key IDs, rotation, revocation.
- [ ] Add an attestation endpoint after `validateEvaluation()` in the server flow;
      never expose the key or the witness to the browser.
- [ ] Use `credential_id_hash` and `credential_hash` bytes32 values for the
      Avalanche path.
- [ ] Add `maxAgeSeconds`/nonce policy and reject stale attestations.
- [ ] Add a `credentialId -> commitment` uniqueness/nullifier record.
- [ ] Audit the circuit and verifier; pin artifact hashes.
- [ ] Add EIP-712 on-chain attestation if on-chain verification is required.
- [ ] Add end-to-end integration tests against a local Fuji fork (no live tx).
