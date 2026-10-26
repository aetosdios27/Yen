// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

/// @title RootRegistry
/// @notice Append-only registry of Yen's interval commitments. Holds no funds or personal data.
/// @dev Each root is SHA256(0x04 || u64be(fundCount) || merkleRoot(fundLeaves)), computed off-chain.
/// The publisher is also the sole owner of publication authority; there is no separate admin role.
/// Sequence 0 is reserved for the empty registry. Publications must be exactly previous + 1 so
/// clients can detect missing publication numbers and retry a failed transaction without gaps.
/// This orders publications, not wall-clock intervals, and does not prove off-chain completeness.
/// There is no upgrade, overwrite, deletion, renunciation, payable entry point, or external call.
contract RootRegistry {
    error InvalidPublisher(address proposed);
    error UnauthorizedPublisher(address caller);
    error NoPendingPublisher();
    error UnauthorizedPendingPublisher(address caller);
    error ZeroRoot();
    error InvalidSequence(uint64 supplied, uint256 expected);

    event RootPublished(uint64 indexed sequence, bytes32 indexed root, address indexed publisher);
    event PublisherTransferProposed(address indexed publisher, address indexed pendingPublisher);
    event PublisherTransferred(address indexed previousPublisher, address indexed newPublisher);

    address public publisher;
    uint64 public latestSequence;
    address public pendingPublisher;
    mapping(uint64 sequence => bytes32 root) private _roots;

    modifier onlyPublisher() {
        if (msg.sender != publisher) revert UnauthorizedPublisher(msg.sender);
        _;
    }

    /// @param initialPublisher Nonzero owner of publication and publisher-transfer authority.
    constructor(address initialPublisher) {
        if (initialPublisher == address(0)) revert InvalidPublisher(initialPublisher);
        publisher = initialPublisher;
        emit PublisherTransferred(address(0), initialPublisher);
    }

    /// @notice Publish one nonzero global root at the next sequence, starting at 1.
    /// @dev A uint256 expected value prevents uint64 wraparound: after uint64.max the registry
    /// is permanently full. Gapless monotonic writes make all previously stored roots immutable.
    function publishRoot(bytes32 root, uint64 sequence) external onlyPublisher {
        if (root == bytes32(0)) revert ZeroRoot();
        uint256 expected = uint256(latestSequence) + 1;
        if (uint256(sequence) != expected) revert InvalidSequence(sequence, expected);
        _roots[sequence] = root;
        latestSequence = sequence;
        emit RootPublished(sequence, root, msg.sender);
    }

    /// @notice Latest published commitment, or zero before the first publication.
    function latestRoot() external view returns (bytes32) {
        return _roots[latestSequence];
    }

    /// @notice Commitment at a publication number, or zero if it has never been published.
    function rootAt(uint64 sequence) external view returns (bytes32) {
        return _roots[sequence];
    }

    /// @notice Propose a nonzero successor. Replaces any pending proposal.
    /// @dev The current publisher keeps all authority until the successor accepts.
    function proposePublisher(address proposed) external onlyPublisher {
        if (proposed == address(0)) revert InvalidPublisher(proposed);
        if (proposed == publisher) revert InvalidPublisher(proposed);
        pendingPublisher = proposed;
        emit PublisherTransferProposed(publisher, proposed);
    }

    /// @notice Accept publication authority as the currently proposed successor.
    function acceptPublisher() external {
        address proposed = pendingPublisher;
        if (proposed == address(0)) revert NoPendingPublisher();
        if (msg.sender != proposed) revert UnauthorizedPendingPublisher(msg.sender);
        address previous = publisher;
        publisher = proposed;
        delete pendingPublisher;
        emit PublisherTransferred(previous, proposed);
    }
}
