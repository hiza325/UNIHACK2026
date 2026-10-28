// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PARADOX Learning Credential Registry
/// @notice Stores only opaque credential and evidence hashes. No learner PII or
///         submitted work belongs in this contract.
contract LearningCredentialRegistry {
    struct Credential {
        bytes32 evidenceHash;
        address issuer;
        uint64 issuedAt;
        uint64 revokedAt;
    }

    error OnlyOwner();
    error OnlyPendingOwner();
    error UnauthorizedIssuer(address account);
    error InvalidAddress();
    error InvalidCredentialId();
    error InvalidEvidenceHash();
    error CredentialAlreadyExists(bytes32 credentialId);
    error EvidenceAlreadyRegistered(bytes32 evidenceHash);
    error CredentialNotFound(bytes32 credentialId);
    error CredentialAlreadyRevoked(bytes32 credentialId);
    error OwnerMustRemainIssuer();

    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event IssuerAuthorizationUpdated(address indexed issuer, bool authorized, address indexed updatedBy);
    event CredentialIssued(
        bytes32 indexed credentialId,
        bytes32 indexed evidenceHash,
        address indexed issuer,
        uint64 issuedAt
    );
    event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, uint64 revokedAt);

    address public owner;
    address public pendingOwner;

    mapping(address issuer => bool authorized) public authorizedIssuers;
    mapping(bytes32 credentialId => Credential credential) private credentials;
    mapping(bytes32 evidenceHash => bytes32 credentialId) private evidenceCredentials;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyIssuer() {
        if (!authorizedIssuers[msg.sender]) revert UnauthorizedIssuer(msg.sender);
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedIssuers[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit IssuerAuthorizationUpdated(msg.sender, true, msg.sender);
    }

    function setIssuer(address issuer, bool authorized) external onlyOwner {
        if (issuer == address(0)) revert InvalidAddress();
        if (issuer == owner && !authorized) revert OwnerMustRemainIssuer();
        authorizedIssuers[issuer] = authorized;
        emit IssuerAuthorizationUpdated(issuer, authorized, msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert OnlyPendingOwner();
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        if (!authorizedIssuers[msg.sender]) {
            authorizedIssuers[msg.sender] = true;
            emit IssuerAuthorizationUpdated(msg.sender, true, msg.sender);
        }
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function issueCredential(bytes32 credentialId, bytes32 evidenceHash) external onlyIssuer {
        if (credentialId == bytes32(0)) revert InvalidCredentialId();
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (credentials[credentialId].issuer != address(0)) revert CredentialAlreadyExists(credentialId);
        if (evidenceCredentials[evidenceHash] != bytes32(0)) revert EvidenceAlreadyRegistered(evidenceHash);

        uint64 issuedAt = uint64(block.timestamp);
        credentials[credentialId] = Credential({
            evidenceHash: evidenceHash,
            issuer: msg.sender,
            issuedAt: issuedAt,
            revokedAt: 0
        });
        evidenceCredentials[evidenceHash] = credentialId;
        emit CredentialIssued(credentialId, evidenceHash, msg.sender, issuedAt);
    }

    function revokeCredential(bytes32 credentialId) external onlyIssuer {
        Credential storage credential = credentials[credentialId];
        if (credential.issuer == address(0)) revert CredentialNotFound(credentialId);
        if (credential.revokedAt != 0) revert CredentialAlreadyRevoked(credentialId);

        credential.revokedAt = uint64(block.timestamp);
        emit CredentialRevoked(credentialId, msg.sender, credential.revokedAt);
    }

    function credentialExists(bytes32 credentialId) external view returns (bool) {
        return credentials[credentialId].issuer != address(0);
    }

    function credentialIdForEvidence(bytes32 evidenceHash) external view returns (bytes32) {
        return evidenceCredentials[evidenceHash];
    }

    function isCredentialValid(bytes32 credentialId) external view returns (bool) {
        Credential storage credential = credentials[credentialId];
        return credential.issuer != address(0) && credential.revokedAt == 0;
    }

    function getCredential(bytes32 credentialId)
        external
        view
        returns (bytes32 evidenceHash, address issuer, uint64 issuedAt, uint64 revokedAt)
    {
        Credential storage credential = credentials[credentialId];
        if (credential.issuer == address(0)) revert CredentialNotFound(credentialId);
        return (credential.evidenceHash, credential.issuer, credential.issuedAt, credential.revokedAt);
    }
}
