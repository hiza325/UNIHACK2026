pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

/*
 * PARADOX ZK Proof of Learning — score threshold circuit.
 *
 * Public statement:
 *   "The committed evaluation score is inside [0, 100] and is at least `threshold`."
 *
 * Public signals (declaration order):
 *   [0] threshold         policy value, 0..100
 *   [1] commitment        Poseidon(DOMAIN, score, evaluationIdHash, learnerBinding,
 *                                evidenceHash, credentialIdHash, nonce)
 *   [2] evaluationIdHash  field-bound authenticated evaluation identifier
 *   [3] learnerBinding    field-bound pseudonymous learner identifier
 *   [4] evidenceHash      field-bound hash of the private learning evidence
 *   [5] credentialIdHash  field-bound credential identifier (may be 0 for no credential)
 *
 * Private signals:
 *   score  0..100, never public
 *   nonce  high-entropy blinding value, never public
 *
 * The circuit proves the relation only. It does NOT prove that an AI awarded the
 * score. That trust comes from the evaluator's signature over the public
 * commitment and bindings, checked off-circuit by the verifier.
 */
template ScoreThresholdProof() {
    // --- Public statement -------------------------------------------------
    signal input threshold;
    signal input commitment;
    signal input evaluationIdHash;
    signal input learnerBinding;
    signal input evidenceHash;
    signal input credentialIdHash;

    // --- Private witness --------------------------------------------------
    signal input score;
    signal input nonce;

    // Domain separator: ASCII "PARADOXZK" as a field constant.
    var DOMAIN = 0x50415241444F585A4B;

    // --- 1. Valid score range: 0 <= score <= 100 --------------------------
    // Num2Bits(7) rejects any field element >= 2^7, including negative
    // representatives such as p - 1. The comparison then caps the score at 100.
    component scoreBits = Num2Bits(7);
    scoreBits.in <== score;

    component scoreAtMost100 = LessEqThan(7);
    scoreAtMost100.in[0] <== score;
    scoreAtMost100.in[1] <== 100;
    scoreAtMost100.out === 1;

    // --- 2. Valid threshold range: 0 <= threshold <= 100 ------------------
    // The verifier also pins `threshold` to the requested policy value, but
    // constraining it in-circuit keeps the relation well-defined.
    component thresholdBits = Num2Bits(7);
    thresholdBits.in <== threshold;

    component thresholdAtMost100 = LessEqThan(7);
    thresholdAtMost100.in[0] <== threshold;
    thresholdAtMost100.in[1] <== 100;
    thresholdAtMost100.out === 1;

    // --- 3. Score >= threshold -------------------------------------------
    component meetsThreshold = GreaterEqThan(7);
    meetsThreshold.in[0] <== score;
    meetsThreshold.in[1] <== threshold;
    meetsThreshold.out === 1;

    // --- 4. Commitment binds score, evaluation, learner, evidence --------
    // The commitment is hiding because `nonce` is private and unpredictable.
    // It is binding because Poseidon is collision resistant.
    component digest = Poseidon(7);
    digest.inputs[0] <== DOMAIN;
    digest.inputs[1] <== score;
    digest.inputs[2] <== evaluationIdHash;
    digest.inputs[3] <== learnerBinding;
    digest.inputs[4] <== evidenceHash;
    digest.inputs[5] <== credentialIdHash;
    digest.inputs[6] <== nonce;
    digest.out === commitment;
}

component main {
    public [
        threshold,
        commitment,
        evaluationIdHash,
        learnerBinding,
        evidenceHash,
        credentialIdHash
    ]
} = ScoreThresholdProof();
