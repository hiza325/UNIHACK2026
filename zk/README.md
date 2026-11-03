# PARADOX ZK Proof of Learning (isolated MVP)

Prove **`score >= threshold`** for an authenticated AI evaluation without revealing
the learner's actual score or private learning evidence.

This directory is intentionally self-contained. It does **not** import, modify, or
write to the existing certificate issuance, credential registry, database, or
blockchain modules.

```
zk/
├─ circuits/score_threshold.circom   Circom 2 circuit
├─ lib/                              commitment, attestation, prover, verifier
├─ scripts/build.mjs                 compile + local Groth16 setup
├─ scripts/demo.mjs                  mock evaluation end-to-end demo
├─ tests/proof-of-learning.test.mjs  15 automated tests
├─ contracts/optional/               reference-only Solidity adapter (not deployed)
└─ docs/                             architecture, Avalanche design, test results
```

## Requirements

- Node.js **>= 22.12** (tested on v24.18.0)
- Circom 2 compiler. On first build, `scripts/build.mjs` downloads the official
  release binary into `zk/tools/` (gitignored). You can also provide `circom` on
  `PATH`.
- No API keys, wallets, private keys, or network access to staging/production are
  required. The demo creates ephemeral Ed25519 keys in memory.

## Quick start

```bash
cd zk
npm install
npm run build     # compiles the circuit + local dev trusted setup (~1 min first run)
npm test          # 20/20 passing
npm run demo      # writes public artifacts to zk/build/demo/
```

The build writes:

| File | Purpose |
|---|---|
| `build/score_threshold.r1cs` | constraint system |
| `build/score_threshold_js/score_threshold.wasm` | witness generator |
| `build/score_threshold.zkey` | Groth16 proving key |
| `build/verification_key.json` | independent verifier key |
| `build/Groth16Verifier.sol` | generated reference Solidity verifier |
| `build/manifest.json` | circuit counts + artifact hashes + setup warning |

`build/` and `tools/` are gitignored. Keys/circuit artifacts are reproducible
only while the local setup files remain; a regenerated zkey changes the
verification key.

## Public statement

```
exists private (score, nonce) such that
  0 <= score <= 100
  0 <= threshold <= 100
  score >= threshold
  commitment == Poseidon(DOMAIN, score, evaluationIdHash, learnerBinding,
                         evidenceHash, credentialIdHash, nonce)
```

Public signals, in order:

| # | Signal | Meaning |
|---:|---|---|
| 0 | `threshold` | Public policy value, 0..100 |
| 1 | `commitment` | Poseidon commitment to the private score |
| 2 | `evaluationIdHash` | Field-bound authenticated evaluation ID |
| 3 | `learnerBinding` | Field-bound pseudonymous learner ID |
| 4 | `evidenceHash` | `sha256(domain‖"evidence"‖bytes32) % p` |
| 5 | `credentialIdHash` | `sha256(domain‖"credential-id"‖bytes32) % p` |

The score and nonce are private witness values. The score is never written to
the attestation, proof, public signals, or demo output.

## Trust in one paragraph

The circuit proves only a relation to `commitment`. It does **not** prove that an
AI awarded the score. Trust comes from a separate **Ed25519 attestation** signed
by the evaluation service over `commitment` and all public bindings. A learner
can generate any commitment they like, but cannot produce a signature from the
trusted evaluator key. The verifier checks the signature, pins the expected
evaluation/learner/evidence/credential context, and only then verifies the
Groth16 proof.

Read the full design: [`docs/ZK-PROOF-OF-LEARNING.md`](docs/ZK-PROOF-OF-LEARNING.md).

Security review and production gates:
[`docs/SECURITY-REVIEW-OP2.md`](docs/SECURITY-REVIEW-OP2.md). The short version:
this is an **off-chain MVP**; the local trusted setup and the optional on-chain
adapter are **not production-ready**.

## Programmatic use

```js
import { createEvaluationAttestation, generateIssuerKeyPair } from './lib/attestation.mjs';
import { generateLearningProof } from './lib/prover.mjs';
import { verifyLearningProof } from './lib/verifier.mjs';

const issuer = generateIssuerKeyPair(); // production: load from a KMS/HSM, never commit

const { attestation, witness } = await createEvaluationAttestation({
  evaluationId, learnerId, evidenceHash, credentialId,
  score,                              // stays private
  issuerPrivateKey: issuer.privateKey,
});

const proof = await generateLearningProof({ attestation, witness, threshold: 75 });

const result = await verifyLearningProof({
  proof: proof.proof,
  publicSignals: proof.publicSignals,
  attestation,
  trustedIssuers: { [attestation.issuer]: issuer.publicKey },
  expected: { threshold: 75, evaluationId, learnerId, evidenceHash, credentialId },
});
// result.valid === true, result.reason === 'OK'
```

## What is not done

- No contract deployment, no Fuji transaction, no database write.
- No production trusted setup (the local one is a single-contributor dev setup).
- No production key management, revocation, or uniqueness/nullifier registry.
- No audit. See the limitations section before using this beyond the hackathon MVP.
