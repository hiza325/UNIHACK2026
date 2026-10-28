// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LearningCredentialRegistry} from "./LearningCredentialRegistry.sol";

contract RegistryActor {
    function issue(LearningCredentialRegistry registry, bytes32 credentialId, bytes32 evidenceHash) external {
        registry.issueCredential(credentialId, evidenceHash);
    }

    function revoke(LearningCredentialRegistry registry, bytes32 credentialId) external {
        registry.revokeCredential(credentialId);
    }

    function setIssuer(LearningCredentialRegistry registry, address issuer, bool authorized) external {
        registry.setIssuer(issuer, authorized);
    }

    function acceptOwnership(LearningCredentialRegistry registry) external {
        registry.acceptOwnership();
    }
}

contract LearningCredentialRegistryTest {
    LearningCredentialRegistry private registry;
    RegistryActor private issuer;
    RegistryActor private outsider;

    bytes32 private constant CREDENTIAL_ID = keccak256("PXP-TEST-CREDENTIAL-0001");
    bytes32 private constant SECOND_CREDENTIAL_ID = keccak256("PXP-TEST-CREDENTIAL-0002");
    bytes32 private constant EVIDENCE_HASH = sha256("MOCK TEST EVIDENCE - NOT A REAL CREDENTIAL");
    bytes32 private constant SECOND_EVIDENCE_HASH = sha256("SECOND MOCK TEST EVIDENCE - NOT A REAL CREDENTIAL");

    function setUp() public {
        registry = new LearningCredentialRegistry();
        issuer = new RegistryActor();
        outsider = new RegistryActor();
    }

    function test_DeployerOwnsRegistryAndIsAuthorized() public view {
        require(registry.owner() == address(this), "unexpected owner");
        require(registry.authorizedIssuers(address(this)), "owner must be issuer");
        require(!registry.authorizedIssuers(address(outsider)), "outsider must not be issuer");
    }

    function test_OwnerCanAuthorizeAndRemoveIssuer() public {
        registry.setIssuer(address(issuer), true);
        require(registry.authorizedIssuers(address(issuer)), "issuer was not authorized");
        registry.setIssuer(address(issuer), false);
        require(!registry.authorizedIssuers(address(issuer)), "issuer was not removed");
    }

    function test_UnauthorizedAccountCannotManageOrIssueOrRevoke() public {
        _expectFailure(
            address(outsider),
            abi.encodeCall(RegistryActor.setIssuer, (registry, address(outsider), true)),
            LearningCredentialRegistry.OnlyOwner.selector
        );
        _expectFailure(
            address(outsider),
            abi.encodeCall(RegistryActor.issue, (registry, CREDENTIAL_ID, EVIDENCE_HASH)),
            LearningCredentialRegistry.UnauthorizedIssuer.selector
        );

        registry.issueCredential(CREDENTIAL_ID, EVIDENCE_HASH);
        _expectFailure(
            address(outsider),
            abi.encodeCall(RegistryActor.revoke, (registry, CREDENTIAL_ID)),
            LearningCredentialRegistry.UnauthorizedIssuer.selector
        );
        require(registry.isCredentialValid(CREDENTIAL_ID), "unauthorized revoke changed state");
    }

    function test_AuthorizedIssuerCanIssueAndCredentialCanBeVerified() public {
        registry.setIssuer(address(issuer), true);
        issuer.issue(registry, CREDENTIAL_ID, EVIDENCE_HASH);

        (bytes32 evidenceHash, address issuedBy, uint64 issuedAt, uint64 revokedAt) = registry.getCredential(CREDENTIAL_ID);
        require(evidenceHash == EVIDENCE_HASH, "wrong evidence hash");
        require(issuedBy == address(issuer), "wrong issuer");
        require(issuedAt > 0, "missing issue timestamp");
        require(revokedAt == 0, "unexpected revoke timestamp");
        require(registry.credentialExists(CREDENTIAL_ID), "credential should exist");
        require(registry.isCredentialValid(CREDENTIAL_ID), "credential should be valid");
        require(registry.credentialIdForEvidence(EVIDENCE_HASH) == CREDENTIAL_ID, "evidence index mismatch");
    }

    function test_AuthorizedIssuerCanRevokeCredential() public {
        registry.issueCredential(CREDENTIAL_ID, EVIDENCE_HASH);
        registry.setIssuer(address(issuer), true);
        issuer.revoke(registry, CREDENTIAL_ID);

        (, , , uint64 revokedAt) = registry.getCredential(CREDENTIAL_ID);
        require(revokedAt > 0, "missing revoke timestamp");
        require(!registry.isCredentialValid(CREDENTIAL_ID), "revoked credential is still valid");
    }

    function test_DuplicateCredentialIdAndEvidenceAreRejected() public {
        registry.issueCredential(CREDENTIAL_ID, EVIDENCE_HASH);
        _expectRegistryFailure(
            abi.encodeCall(LearningCredentialRegistry.issueCredential, (CREDENTIAL_ID, SECOND_EVIDENCE_HASH)),
            LearningCredentialRegistry.CredentialAlreadyExists.selector
        );
        _expectRegistryFailure(
            abi.encodeCall(LearningCredentialRegistry.issueCredential, (SECOND_CREDENTIAL_ID, EVIDENCE_HASH)),
            LearningCredentialRegistry.EvidenceAlreadyRegistered.selector
        );
    }

    function test_InvalidHashesMissingCredentialAndSecondRevocationFail() public {
        _expectRegistryFailure(
            abi.encodeCall(LearningCredentialRegistry.issueCredential, (bytes32(0), EVIDENCE_HASH)),
            LearningCredentialRegistry.InvalidCredentialId.selector
        );
        _expectRegistryFailure(
            abi.encodeCall(LearningCredentialRegistry.issueCredential, (CREDENTIAL_ID, bytes32(0))),
            LearningCredentialRegistry.InvalidEvidenceHash.selector
        );
        _expectRegistryFailure(
            abi.encodeCall(LearningCredentialRegistry.revokeCredential, (CREDENTIAL_ID)),
            LearningCredentialRegistry.CredentialNotFound.selector
        );

        registry.issueCredential(CREDENTIAL_ID, EVIDENCE_HASH);
        registry.revokeCredential(CREDENTIAL_ID);
        _expectRegistryFailure(
            abi.encodeCall(LearningCredentialRegistry.revokeCredential, (CREDENTIAL_ID)),
            LearningCredentialRegistry.CredentialAlreadyRevoked.selector
        );
    }

    function test_OwnershipTransferRequiresPendingOwnerAndKeepsOwnerAuthorized() public {
        registry.transferOwnership(address(issuer));
        _expectFailure(
            address(outsider),
            abi.encodeCall(RegistryActor.acceptOwnership, (registry)),
            LearningCredentialRegistry.OnlyPendingOwner.selector
        );
        issuer.acceptOwnership(registry);
        require(registry.owner() == address(issuer), "ownership was not transferred");
        require(registry.authorizedIssuers(address(issuer)), "new owner must be authorized");
    }

    function _expectRegistryFailure(bytes memory callData, bytes4 expectedSelector) private {
        _expectFailure(address(registry), callData, expectedSelector);
    }

    function _expectFailure(address target, bytes memory callData, bytes4 expectedSelector) private {
        (bool success, bytes memory revertData) = target.call(callData);
        require(!success, "call should have reverted");
        require(revertData.length >= 4, "missing custom error selector");
        bytes4 actualSelector;
        assembly {
            actualSelector := mload(add(revertData, 32))
        }
        require(actualSelector == expectedSelector, "unexpected custom error");
    }
}
