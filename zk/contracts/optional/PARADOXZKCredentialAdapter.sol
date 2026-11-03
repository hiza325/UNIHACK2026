// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/*
 * PARADOX ZK Proof of Learning — REFERENCE ONLY.
 *
 * This adapter is NOT compiled, deployed, or tested against Fuji in this MVP.
 * It documents the optional on-chain integration. Before any deployment:
 *   - run a production trusted setup and pin the verification key;
 *   - audit the adapter and the circuit;
 *   - decide the attestation model (off-chain Ed25519 issuer vs EIP-712);
 *   - add replay/nullifier policy;
 *   - test on a local Fuji fork.
 *
 * TRUST BOUNDARY: this contract does NOT verify the Ed25519 evaluator
 * attestation. Only `authorizedVerifier` (the existing issuer/relayer role) may
 * submit a proof, and that role is responsible for verifying the attestation,
 * evaluation ID, learner binding and freshness off-chain before submission.
 * Do not describe this contract as trustless on-chain AI verification. For a
 * trustless claim, add EIP-712/secp256k1 attestation verification on-chain.
 *
 * The contract independently checks the registry credential, evidence and
 * credential bindings, policy threshold and the Groth16 proof.
 */

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[6] calldata publicSignals
    ) external view returns (bool);
}

interface ILearningCredentialRegistry {
    function isCredentialValid(bytes32 credentialId) external view returns (bool);
    function getCredential(bytes32 credentialId)
        external
        view
        returns (bytes32 evidenceHash, address issuer, uint64 issuedAt, uint64 revokedAt);
}

contract PARADOXZKCredentialAdapter {
    /// BN254 scalar field modulus, identical to the circuit's field.
    uint256 private constant FIELD_PRIME =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// Must match BINDING_DOMAIN in zk/lib/field.mjs.
    string private constant BINDING_DOMAIN = "paradox-zk-proof-of-learning-v1";

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    IGroth16Verifier public immutable verifier;
    ILearningCredentialRegistry public immutable registry;
    address public immutable authorizedVerifier;
    uint256 public immutable policyThreshold;

    /// credentialId => commitment. Prevents a second, different proof/commitment
    /// from being bound to the same credential (equivocation guard).
    mapping(bytes32 => bytes32) public credentialCommitment;

    event ZKProofVerified(
        bytes32 indexed credentialId,
        bytes32 indexed evidenceHash,
        bytes32 commitment,
        uint256 threshold,
        address submittedBy,
        uint64 verifiedAt
    );

    error NotAuthorized();
    error InvalidCredential();
    error EvidenceMismatch();
    error BindingMismatch();
    error ThresholdTooLow();
    error InvalidProof();
    error ConflictingCommitment();

    constructor(
        IGroth16Verifier verifier_,
        ILearningCredentialRegistry registry_,
        address authorizedVerifier_,
        uint256 policyThreshold_
    ) {
        if (authorizedVerifier_ == address(0)) revert NotAuthorized();
        if (policyThreshold_ == 0 || policyThreshold_ > 100) revert ThresholdTooLow();
        verifier = verifier_;
        registry = registry_;
        authorizedVerifier = authorizedVerifier_;
        policyThreshold = policyThreshold_;
    }

    /// @param credentialId              existing registry key (bytes32)
    /// @param evidenceHash              existing registry evidence hash (bytes32)
    /// @param expectedEvaluationIdHash  checked off-chain by the relayer, pinned here
    /// @param expectedLearnerBinding    checked off-chain by the relayer, pinned here
    /// @param publicSignals             [threshold, commitment, evaluationIdHash,
    ///                                   learnerBinding, evidenceHash, credentialIdHash]
    function verifyAndBind(
        bytes32 credentialId,
        bytes32 evidenceHash,
        uint256 expectedEvaluationIdHash,
        uint256 expectedLearnerBinding,
        uint256[6] calldata publicSignals,
        Proof calldata proof
    ) external returns (bool) {
        if (msg.sender != authorizedVerifier) revert NotAuthorized();
        if (!registry.isCredentialValid(credentialId)) revert InvalidCredential();

        (bytes32 registeredEvidence,,,) = registry.getCredential(credentialId);
        if (registeredEvidence != evidenceHash) revert EvidenceMismatch();

        // Bind the public signals to the exact registry values. The binding is
        // SHA-256(domain || label || bytes32) % p, matching zk/lib/field.mjs,
        // not a bare modulo that would allow H and H + p to collide.
        if (publicSignals[4] != _evidenceBinding(evidenceHash)) revert BindingMismatch();
        if (publicSignals[5] != _credentialIdBinding(credentialId)) revert BindingMismatch();
        if (publicSignals[2] != expectedEvaluationIdHash) revert BindingMismatch();
        if (publicSignals[3] != expectedLearnerBinding) revert BindingMismatch();
        if (publicSignals[0] < policyThreshold || publicSignals[0] > 100) revert ThresholdTooLow();

        if (!verifier.verifyProof(proof.a, proof.b, proof.c, publicSignals)) revert InvalidProof();

        bytes32 commitment = bytes32(publicSignals[1]);
        bytes32 previous = credentialCommitment[credentialId];
        if (previous != bytes32(0)) {
            // Idempotent re-verification: do not record a duplicate event.
            if (previous != commitment) revert ConflictingCommitment();
            return true;
        }
        credentialCommitment[credentialId] = commitment;

        emit ZKProofVerified(
            credentialId,
            evidenceHash,
            commitment,
            publicSignals[0],
            msg.sender,
            uint64(block.timestamp)
        );
        return true;
    }

    function _evidenceBinding(bytes32 value) internal pure returns (uint256) {
        return uint256(sha256(abi.encodePacked(BINDING_DOMAIN, "|evidence|", value))) % FIELD_PRIME;
    }

    function _credentialIdBinding(bytes32 value) internal pure returns (uint256) {
        return uint256(sha256(abi.encodePacked(BINDING_DOMAIN, "|credential-id|", value))) % FIELD_PRIME;
    }
}
