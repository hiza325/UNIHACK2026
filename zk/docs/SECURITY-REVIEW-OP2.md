# OP2 — ZK Security & Integration Review

**Scope:** `paradox-zk/zk/` only
**Date:** 2026-11-03
**Reviewer role:** Senior ZK engineer / blockchain security auditor
**Constraints respected:** no commit, push, merge, deploy, blockchain transaction, production DB, or production secret access.

---

## 0. Executive verdict

> **READY TO COMMIT as an isolated, clearly labeled off-chain MVP.**
> **NOT READY for on-chain or production integration.**

The circuit is sound for the stated statement, the off-chain Ed25519 + Groth16
flow verifies correctly, and **20/20 tests pass**. One concrete High-severity
binding weakness was found and fixed during this review (bare modulo-p mapping),
with a regression test.

The blockers for production are not the circuit arithmetic. They are:

1. the development-only trusted setup;
2. the on-chain adapter trusting an authorized relayer instead of verifying the
   evaluator attestation;
3. revocation/freshness being integration responsibilities;
4. key management/rotation and nullifier policy not implemented.

---

## 1. PASS / FAIL by category

| # | Category | Result | Notes |
|---:|---|---|---|
| 1 | Circom circuit | **PASS** | Range, comparison, Poseidon commitment and public/private separation are correct. 1,133 constraints, 6 public inputs, 2 private inputs. |
| 2 | Ed25519 attestation | **PASS (off-chain)** | Signature binds all committed context. Threshold is not signed by design (Medium). Key rotation/revocation absent (Medium). |
| 3 | bytes32 → field mapping | **PASS after fix** | Bare `% p` was **FAIL** (trivial H / H+p collision). Replaced with domain-separated SHA-256 binding + regression test. |
| 4 | Trusted setup | **FAIL for production** | Single-contributor local ptau + phase-2 key; toxic waste known to the build process. Correctly labeled development-only. |
| 5 | Solidity adapter | **FAIL for trustless on-chain / PASS for trusted-relayer** | Does not verify the Ed25519 attestation. Registry/evidence/credential/threshold/proof checks are present. Replay/duplicate event behavior hardened. Not compiled or deployed. |
| 6 | Integration architecture | **PASS (design)** | APIs/UI/Learning Passport mapping proposed below; no existing module modified. |
| 7 | Automated tests | **PASS** | 20/20, including new collision, signal-tampering, prototype-pollution and revocation tests. |

---

## 2. Circuit review

File: `circuits/score_threshold.circom`

### 2.1 Range constraints — PASS

| Check | Implementation | Assessment |
|---|---|---|
| `score >= 0` | `Num2Bits(7)` | Field element `p-1` (“-1”) cannot be represented in 7 bits → rejected |
| `score <= 100` | `LessEqThan(7)` vs 100 | 101..127 rejected; 128+ already fails `Num2Bits(7)` |
| `threshold >= 0` | `Num2Bits(7)` | Negative threshold rejected |
| `threshold <= 100` | `LessEqThan(7)` vs 100 | Out-of-range policy rejected |
| `score >= threshold` | `GreaterEqThan(7)` | Bitwise comparison, no subtraction, no underflow/wraparound |

**Tests:** `rejects invalid score ranges in the API and in the circuit` feeds
`101`, `p-1`, and `128` directly to the circuit with a matching commitment, so
the rejection is attributable to the circuit, not to JS validation.

### 2.2 Comparison correctness — PASS

`GreaterEqThan`/`LessEqThan` from circomlib use bit decomposition, not field
subtraction. There is no arithmetic underflow path. Inputs are already capped at
100, well below the comparator width.

### 2.3 Poseidon commitment — PASS

```
Poseidon(DOMAIN, score, evaluationIdHash, learnerBinding,
         evidenceHash, credentialIdHash, nonce)
```

- 7 inputs; circomlib Poseidon parameters, t = 8.
- Domain separator `0x50415241444f585a4b` (`PARADOXZK`).
- Binds score plus every context value used for replay protection.
- Hiding relies on the private nonce. The score space is only 0..100, so **nonce
  secrecy is essential**.
- The circuit does not enforce `nonce != 0`; the JS API rejects zero, but a
  malicious/buggy signer could still create a zero-nonce attestation. This is a
  Low/defence-in-depth item, not a soundness break.

### 2.4 Public/private separation — PASS

Public: `threshold, commitment, evaluationIdHash, learnerBinding, evidenceHash,
credentialIdHash`. Private: `score, nonce`. No score is written to public signals,
proof JSON, attestation, demo output or test snapshots.

### 2.5 Threshold bypass — PASS

- A score below threshold cannot produce a witness (`GreaterEqThan` fails).
- Changing the public `threshold` after proving invalidates the Groth16 proof.
- The threshold is **not** in the signed attestation or commitment. A valid proof
  for threshold 60 can exist for the same score/commitment, but the verifier pins
  the expected policy threshold (75 in the MVP). **Integration must always pin
  it.** This is Medium M-1, not a circuit bypass.
- `threshold = 0` is valid in-circuit but rejected by verifier policy when the
  expected threshold is 75. The on-chain adapter now rejects a zero policy at
  deployment.

### 2.6 Field overflow — PASS

Witness inputs are canonical field elements. A value supplied as `p + 80`
reduces to 80, which is a legitimate score of 80, not a bypass. Values 101/128 and
negative representatives fail the range constraints. There is no modular
comparison.

---

## 3. Ed25519 attestation review

File: `lib/attestation.mjs`

### 3.1 Signature coverage — PASS with one Medium

Signed canonical JSON includes:

- `commitment`
- `evaluationIdHash`
- `learnerBinding`
- `evidenceHash`
- `credentialIdHash`
- `issuer`, `schemaVersion`, `circuit`, `circuitVersion`
- `issuedAt`

**Not signed:** `threshold` (M-1). The verifier pins the policy threshold, so the
proof cannot be used with an unexpected threshold *if the verifier is correct*.
There is no signed policy ID or issuer-fixed threshold.

### 3.2 Issuer forgery / public-key substitution — PASS

- The verifier receives `trustedIssuers` independently of the attestation.
- The attestation's `issuer` is only a key ID used to look up that independent
  key; the attestation cannot supply its own public key.
- Unknown fields are rejected.
- A rogue key produces `UNTRUSTED_ISSUER`; spoofing a trusted key ID produces
  `INVALID_ATTESTATION_SIGNATURE`.
- **Fixed in this review:** object lookups now use `Object.hasOwn`, so issuer IDs
  such as `__proto__`, `constructor`, or `toString` cannot resolve inherited
  values from `Object.prototype`. Regression test added.

### 3.3 Replay across contexts — PASS

Evaluation ID, learner, evidence, credential and commitment are bound in both the
signed attestation and the circuit. The verifier requires each public signal and
attestation field to equal the expected value. Tests cover evaluation, learner,
evidence, credential, threshold and commitment tampering.

### 3.4 Replay of the same presentation — BY DESIGN / Medium

A valid proof + attestation verifies repeatedly. This is normal for a bearer
credential, but it is **not** a one-time claim. If PARADOX needs “claim once”,
add a nullifier/consumption registry keyed by credential or evaluation.

### 3.5 Freshness — Medium

`maxAgeSeconds` is optional and has no default. A stolen old proof remains valid
unless the caller supplies a maximum age. Integration must set a policy.

### 3.6 Key lifecycle — Medium

No key rotation, revocation list, or multi-issuer threshold policy. The trusted
issuer map is static. Production needs KMS/HSM, key IDs with validity windows, and
a revocation process.

---

## 4. bytes32 → field mapping review

### 4.1 Original weakness — High (fixed)

Original implementation:

```js
field = uint256(bytes32) % FIELD_PRIME
```

BN254 `p ≈ 2^254.2`, so mapping 2^256 values into ~2^254 field elements is not
injective. Given `H`, the value `H + p` is usually still a valid 32-byte value and
maps to the same field element.

**Impact:** if an attestation/proof exists for `H'`, a verifier expecting `H`
could accept the same proof whenever `H' ≡ H (mod p)`; the on-chain adapter would
also accept it against registry evidence `H`. This breaks evidence/credential
binding uniqueness for colliding values. Exploiting cross-evidence requires an
attestation for the colliding value (normally a SHA-256 preimage), but the
cryptographic binding itself was not sound.

**Tests:** `rejects bytes32 bindings that collide only under bare modulo p`.

### 4.2 Fix applied — PASS

New binding:

```
field = sha256("paradox-zk-proof-of-learning-v1|" || label || "|" || bytes32) % p
```

- `label` is `evidence` or `credential-id`.
- The raw 32 bytes are hashed, not a decimal/hex string, so JS and Solidity agree.
- Solidity: `uint256(sha256(abi.encodePacked(domain, "|evidence|", value))) % p`.
- `H` and `H + p` now produce different bindings.
- Residual reduction is 2^256 → ~2^254, but a collision now requires breaking
  SHA-256 collision/preimage resistance, not integer addition.

**Stronger alternative if information-theoretic injectivity is required:** split
the bytes32 into two 128-bit limbs (`hi`, `lo`), expose both as public signals,
and commit both. This adds two signals per bytes32 and changes the circuit ABI; it
is not necessary for the current 128-bit security target but is the cleanest
long-term binding.

### 4.3 Evaluation ID / learner binding — ACCEPTABLE

These are SHA-256 hash-to-field of a string with domain separation. A modular
collision requires a SHA-256 collision/preimage. The learner binding is
deterministic in the MVP; production should use a server-side HMAC pepper to avoid
cross-context correlation.

---

## 5. Trusted setup review

### 5.1 Development setup — FAIL for production, correctly labeled

`scripts/build.mjs` performs:

1. `powersoftau new bn128 12`
2. one contribution using process-generated entropy
3. `prepare phase2`
4. `groth16 setup`
5. one circuit-specific contribution
6. export vkey + reference Solidity verifier

Limitations:

- Single contributor; the build process knows the toxic waste and could forge
  proofs.
- Entropy is passed on the command line during the build (`-e=...`), visible to
  other local processes.
- `build/` is gitignored, but if distributed, the zkey/vkey/manifest are only
  development artifacts.
- The compiler binary is downloaded from GitHub without a pinned checksum.
- Any circuit change requires a new setup; the build script detects r1cs changes
  and regenerates the key.

### 5.2 Production ceremony requirements — PASS as a plan

1. Audit/freeze the circuit.
2. Use a public, verified powers-of-tau transcript (e.g. a Hermez/iden3
   transcript) or run a multi-party ptau ceremony. Power ≥ next power of two above
   the constraint count, with margin.
3. Run a circuit-specific phase-2 ceremony with independent contributors on
   separate machines, air-gapped where possible, publishing contribution hashes.
4. Verify the final zkey/vkey against the published transcript.
5. Pin the verification key hash in the verifier and adapter; store artifacts on
   immutable/versioned storage.
6. Reproduce the build from a pinned compiler and source commit.
7. Never reuse a zkey across circuit versions.

**No production secrets were created or used in this review.**

---

## 6. Solidity adapter review

File: `contracts/optional/PARADOXZKCredentialAdapter.sol` (reference only)

| Question | Answer | Assessment |
|---|---|---|
| Does it verify the evaluator attestation? | **No.** It trusts `authorizedVerifier` to do that off-chain. | **High for trustless on-chain claims.** Documented as a trusted-relayer design. |
| Can it accept a self-generated commitment? | An unauthorized user cannot. The authorized relayer could submit a valid proof for a commitment it invented, because the contract cannot see the Ed25519 attestation. | **High if the relayer is compromised.** Use EIP-712 or keep verification off-chain. |
| Does it check Avalanche credential state? | Yes: `isCredentialValid` and `getCredential` evidence equality. | PASS |
| Can it be replayed or recorded multiple times? | Cross-context replay is blocked by bindings. Same-credential replay with the same commitment is now **idempotent** (no duplicate event); a conflicting commitment reverts. No one-time nullifier. | Medium for one-time claims |
| Is the threshold policy checked? | Yes, `>= policyThreshold` and `<= 100`; constructor rejects `0`. | PASS |
| Are evidence/credential bindings checked? | Yes, using the SHA-256 formula matching JS. | PASS after binding fix |
| Are evaluation/learner bindings checked? | Now passed by the relayer and pinned against public signals. | PASS as a relayed check, not trustless |
| Reentrancy / state ordering? | Registry/verifier calls are `view`; state updated before event, no external state-changing calls. | PASS |
| Compilation/deployment tested? | **No.** Reference only; generated verifier is not committed. | Must compile/audit/test on a Fuji fork before use |

**Mandatory before calling this “on-chain verification”:** add EIP-712/secp256k1
attestation verification, or explicitly market it as issuer-authorized binding.
Do not deploy as trustless AI verification.

---

## 7. Integration architecture proposal

No existing module is modified. The following is the recommended additive design.

### 7.1 API — issue a proof

**Recommended: server-side proving.** The server already knows the score; it
never sends the witness or nonce to the browser.

```
POST /api/zk/proof-of-learning
Auth: learner session
Body: { evaluationId, threshold? }
Server:
  1. load evaluation owned by learner; require status = pass
  2. policy threshold = max(75, requested)
  3. create commitment + Ed25519 attestation
  4. generate Groth16 proof
  5. return public artifacts only
Response:
  {
    proof, publicSignals,
    attestation,
    circuit: { name, version, vkeySha256 },
    credential: { id, idHash, evidenceHash },
    threshold
  }
```

Store only public artifacts (`proof`, `publicSignals`, `attestation`,
`commitment`, `credential_id_hash`, `evaluation_id`, `issued_at`). Never store the
score, nonce, or witness in the proof table.

**Client-side proving option:** return `{ attestation, witness }` over TLS and
prove in the browser with the snarkjs browser bundle. This exposes the score/nonce
to the learner's own device (they already know their score) and requires a larger
frontend bundle. Server-side is simpler for the MVP.

### 7.2 API — verify a proof

```
POST /api/zk/proof-of-learning/verify
Auth: optional/public
Body: { proof, publicSignals, attestation, threshold, credentialId }
Server:
  1. verify Ed25519 signature against pinned issuer keys
  2. pin evaluationId / learnerId / evidenceHash / credentialId / threshold
  3. verify Groth16 with a pinned vkey hash
  4. enforce maxAgeSeconds
  5. query Avalanche registry (or DB projection) for revocation/evidence
  6. return { valid, reason, checks, credential }
```

`verifyLearningProof()` now accepts `expected.credentialRevoked` and
`expected.credentialValid`; integration must supply them from the registry/DB.
Do not treat a proof as certificate validity without that check.

### 7.3 UI — Learning Passport

Add a read-only **Proof of Learning** card to the Learning Passport view:

- Badge: “Score ≥ 75 — verified privately”
- Show: threshold, issuer, issued time, credential ID, evidence hash, verification
  state, revoked state, Fuji explorer link.
- **Never show** the score, nonce, witness, or raw private evidence.
- Buttons: “Verify proof”, “Copy public proof”, “View credential”.
- If the registry says revoked: show “Credential revoked” and disable sharing.

### 7.4 Learning Passport connection

- Do not edit `learning-passport-service.js` in this branch.
- Add a new server-side `zk-proof-service` that composes:
  `evaluation` + `attestation` + `proof` + `registry status`.
- Expose it through a new endpoint and let the passport UI consume that
  projection. This keeps the existing passport read model stable.
- Map fields: `evaluation.id` → evaluation binding; `credential.idHash` /
  `credential.hash` → signal 4/5 inputs; `credential.id` → display; `score` stays
  server-side.
- Use a new additive table (e.g. `zk_proofs`) or object storage; no changes to
  existing production tables are proposed here.

### 7.5 Operational controls

- Signer key in KMS/HSM; never in the browser, repo, or logs.
- Rate-limit proof generation/verification; auth on issuance.
- Pin vkey hash and circuit version in config.
- Set `maxAgeSeconds`; decide nullifier policy.
- Log verification metadata without score/evidence content.
- Check registry revocation on every presentation.

---

## 8. Findings register

### Critical

None.

### High

| ID | Finding | Status |
|---|---|---|
| H-1 | Bare `% p` bytes32 binding allowed H / H+p collisions, weakening evidence/credential binding. | **Fixed** in `lib/field.mjs`; regression test added. |
| H-2 | Solidity adapter does not verify the Ed25519 attestation; a trusted relayer could bind a self-generated commitment. | **Open** — on-chain trustless integration blocked. Add EIP-712 or keep off-chain. |
| H-3 | Development trusted setup is forgeable by the build process; vkey/artifacts are not production-pinned. | **Open** — production ceremony required. |
| H-4 | Revocation is outside the circuit/verifier; a revoked credential still verifies unless the caller checks the registry/DB. | **Mitigated** by optional status inputs; **integration must supply them.** |

### Medium

| ID | Finding |
|---|---|
| M-1 | Threshold is not signed; verifier must pin the policy value. |
| M-2 | No nullifier; the same proof can be presented repeatedly (bearer credential). |
| M-3 | Attestation freshness is opt-in; no default max age. |
| M-4 | No issuer key rotation/revocation or multi-key policy. |
| M-5 | Verification key/artifacts are not hash-pinned at runtime. |
| M-6 | Adapter has a single authorized relayer with no rotation; off-chain checks depend on it. |
| M-7 | Circuit/contract do not prove that the evidence hash is the SHA-256 of the actual evidence; the issuer must enforce that semantic link. |
| M-8 | No nullifier/consumption registry for one-time claims. |

### Low

| ID | Finding | Status |
|---|---|---|
| L-1 | Nonce = 0 is rejected in JS but not constrained in-circuit. | Open (defence in depth) |
| L-2 | Issuer lookup could resolve `Object.prototype` values. | **Fixed** with `Object.hasOwn` + test. |
| L-3 | Circom compiler binary is downloaded unpinned. | Open (pin checksum in production) |
| L-4 | Adapter allowed `policyThreshold = 0`. | **Fixed** (must be 1..100). |
| L-5 | Adapter emitted duplicate events on repeat verification. | **Fixed** (idempotent same commitment, no duplicate event). |
| L-6 | Public signal validation only checks decimal format; snarkjs performs the field range check later. | Accepted |
| L-7 | Prover does not verify the attestation signature; only the verifier does. | Accepted (documented) |
| L-8 | `maxAgeSeconds` is not validated if omitted. | Accepted (opt-in) |

---

## 9. Mandatory fixes before integration

1. **Production trusted setup** — multi-party ptau/phase-2, verified transcript,
   pinned vkey hash. Do not use the local zkey for real credentials.
2. **Evaluator key management** — KMS/HSM, key rotation, revocation, issuer
   allow-list; never ship a key.
3. **Revocation check in the verify API** — query the Avalanche registry/DB and
   pass `credentialRevoked`/`credentialValid` to the verifier.
4. **Pin threshold and freshness** — server-side policy threshold (75), explicit
   `maxAgeSeconds`.
5. **On-chain trust model** — either add EIP-712 attestation verification to the
   adapter or label it strictly as a trusted-relayer binding. Do not claim
   trustless on-chain AI verification.
6. **Nullifier policy** — if one-time claims are required, add a consumption
   registry; otherwise document bearer-credential semantics.
7. **Audit** — circuit + verifier + adapter review before real credentials.

---

## 10. Re-run results

```
cd zk
npm run build
npm test
```

Result: **20/20 tests pass** (~16 s), including the new security regressions:

- modulo-p collision separation,
- tampering with every public signal,
- prototype-pollution issuer lookup,
- revoked/invalid credential status,
- idempotent presentation replay semantics.

Full output: [`TEST-RESULTS.md`](TEST-RESULTS.md).

---

## 11. Final conclusion

| Scope | Verdict |
|---|---|
| Isolated off-chain MVP (hackathon/demo) | **READY TO COMMIT** |
| On-chain adapter as a trustless verifier | **NOT READY** |
| Production credential system | **NOT READY** |

Commit the module as an isolated MVP only if the README keeps the development
setup, trusted-relayer adapter and revocation/freshness conditions explicit. Do
not integrate it into certificate issuance or deploy the adapter until the
mandatory fixes above are completed.
