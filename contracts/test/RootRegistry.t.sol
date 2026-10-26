// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RootRegistry} from "../src/RootRegistry.sol";

/// @dev Only used to reach the uint64 boundary without 2**64 publications.
contract SequenceBoundaryRegistry is RootRegistry {
    constructor(address initialPublisher) RootRegistry(initialPublisher) {}

    function setSequence(uint64 sequence) external {
        latestSequence = sequence;
    }
}

contract RootRegistryTest is Test {
    RootRegistry internal registry;
    address internal publisher = makeAddr("publisher");
    address internal successor = makeAddr("successor");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant ROOT =
        0xce3e252723e6902cb999d7f3427700cc41d705c03427e1fb3ef1c05ec467a376;
    bytes32 internal constant OTHER_ROOT =
        0xfa54544995e994e252c22ebb6aac7a28443294ae8f5956aa4d04e2b0fa0b0222;

    event RootPublished(uint64 indexed sequence, bytes32 indexed root, address indexed publisher);
    event PublisherTransferProposed(address indexed publisher, address indexed pendingPublisher);
    event PublisherTransferred(address indexed previousPublisher, address indexed newPublisher);

    function setUp() public {
        registry = new RootRegistry(publisher);
    }

    function testConstructorAndEmptyGetters() public view {
        assertEq(registry.publisher(), publisher);
        assertEq(registry.pendingPublisher(), address(0));
        assertEq(registry.latestSequence(), 0);
        assertEq(registry.latestRoot(), bytes32(0));
        assertEq(registry.rootAt(0), bytes32(0));
        assertEq(registry.rootAt(1), bytes32(0));
        assertEq(registry.rootAt(type(uint64).max), bytes32(0));
    }

    function testConstructorEmitsTransfer() public {
        vm.expectEmit(true, true, false, true);
        emit PublisherTransferred(address(0), publisher);
        new RootRegistry(publisher);
    }

    function testConstructorRejectsZeroPublisher() public {
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.InvalidPublisher.selector, address(0)));
        new RootRegistry(address(0));
    }

    function testPublishEmitsAndPreservesHistory() public {
        vm.startPrank(publisher);
        vm.expectEmit(true, true, true, true, address(registry));
        emit RootPublished(1, ROOT, publisher);
        registry.publishRoot(ROOT, 1);
        registry.publishRoot(OTHER_ROOT, 2);
        vm.stopPrank();
        assertEq(registry.latestSequence(), 2);
        assertEq(registry.latestRoot(), OTHER_ROOT);
        assertEq(registry.rootAt(1), ROOT);
        assertEq(registry.rootAt(2), OTHER_ROOT);
        assertEq(registry.rootAt(3), bytes32(0));
    }

    function testRejectsZeroRootWithoutConsumingSequence() public {
        vm.startPrank(publisher);
        vm.expectRevert(RootRegistry.ZeroRoot.selector);
        registry.publishRoot(bytes32(0), 1);
        assertEq(registry.latestSequence(), 0);
        assertEq(registry.rootAt(1), bytes32(0));
        registry.publishRoot(ROOT, 1);
        vm.stopPrank();
    }

    function testReplayAndOverwriteAreRejected() public {
        vm.startPrank(publisher);
        registry.publishRoot(ROOT, 1);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.InvalidSequence.selector, uint64(1), 2));
        registry.publishRoot(ROOT, 1);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.InvalidSequence.selector, uint64(1), 2));
        registry.publishRoot(OTHER_ROOT, 1);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.InvalidSequence.selector, uint64(0), 2));
        registry.publishRoot(OTHER_ROOT, 0);
        assertEq(registry.rootAt(1), ROOT);
        assertEq(registry.latestSequence(), 1);
        vm.stopPrank();
    }

    function testAllowsRepeatedRootAtDifferentSequences() public {
        vm.startPrank(publisher);
        registry.publishRoot(ROOT, 1);
        registry.publishRoot(ROOT, 2);
        vm.stopPrank();
        assertEq(registry.rootAt(1), ROOT);
        assertEq(registry.rootAt(2), ROOT);
    }

    function testSequenceCannotWrap() public {
        SequenceBoundaryRegistry boundary = new SequenceBoundaryRegistry(publisher);
        boundary.setSequence(type(uint64).max - 1);
        vm.startPrank(publisher);
        boundary.publishRoot(ROOT, type(uint64).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                RootRegistry.InvalidSequence.selector, uint64(0), uint256(type(uint64).max) + 1
            )
        );
        boundary.publishRoot(OTHER_ROOT, 0);
        vm.stopPrank();
        assertEq(boundary.latestSequence(), type(uint64).max);
        assertEq(boundary.latestRoot(), ROOT);
        assertEq(boundary.rootAt(0), bytes32(0));
    }

    function testProposeEmitsAndKeepsCurrentAuthority() public {
        vm.prank(publisher);
        vm.expectEmit(true, true, false, true, address(registry));
        emit PublisherTransferProposed(publisher, successor);
        registry.proposePublisher(successor);
        assertEq(registry.pendingPublisher(), successor);
        assertEq(registry.publisher(), publisher);
        vm.prank(successor);
        vm.expectRevert(
            abi.encodeWithSelector(RootRegistry.UnauthorizedPublisher.selector, successor)
        );
        registry.publishRoot(ROOT, 1);
        vm.prank(publisher);
        registry.publishRoot(ROOT, 1);
    }

    function testProposeRejectsZeroAndSelf() public {
        vm.startPrank(publisher);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.InvalidPublisher.selector, address(0)));
        registry.proposePublisher(address(0));
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.InvalidPublisher.selector, publisher));
        registry.proposePublisher(publisher);
        vm.stopPrank();
        assertEq(registry.pendingPublisher(), address(0));
    }

    function testAcceptRejectsMissingProposal() public {
        vm.prank(stranger);
        vm.expectRevert(RootRegistry.NoPendingPublisher.selector);
        registry.acceptPublisher();
    }

    function testAcceptEmitsClearsProposalAndTransfersAllAuthority() public {
        vm.startPrank(publisher);
        registry.publishRoot(ROOT, 1);
        registry.proposePublisher(successor);
        vm.stopPrank();
        vm.prank(successor);
        vm.expectEmit(true, true, false, true, address(registry));
        emit PublisherTransferred(publisher, successor);
        registry.acceptPublisher();
        assertEq(registry.publisher(), successor);
        assertEq(registry.pendingPublisher(), address(0));
        assertEq(registry.rootAt(1), ROOT);
        vm.startPrank(publisher);
        vm.expectRevert(
            abi.encodeWithSelector(RootRegistry.UnauthorizedPublisher.selector, publisher)
        );
        registry.publishRoot(OTHER_ROOT, 2);
        vm.expectRevert(
            abi.encodeWithSelector(RootRegistry.UnauthorizedPublisher.selector, publisher)
        );
        registry.proposePublisher(stranger);
        vm.stopPrank();
        vm.startPrank(successor);
        registry.publishRoot(OTHER_ROOT, 2);
        registry.proposePublisher(publisher);
        vm.stopPrank();
        assertEq(registry.latestRoot(), OTHER_ROOT);
        assertEq(registry.pendingPublisher(), publisher);
    }

    function testReplacedProposalCannotAccept() public {
        vm.startPrank(publisher);
        registry.proposePublisher(successor);
        registry.proposePublisher(stranger);
        vm.stopPrank();
        vm.prank(successor);
        vm.expectRevert(
            abi.encodeWithSelector(RootRegistry.UnauthorizedPendingPublisher.selector, successor)
        );
        registry.acceptPublisher();
        vm.prank(stranger);
        registry.acceptPublisher();
        assertEq(registry.publisher(), stranger);
        vm.prank(stranger);
        vm.expectRevert(RootRegistry.NoPendingPublisher.selector);
        registry.acceptPublisher();
    }

    function testRejectsNativeCurrencyAndUnknownCalls() public {
        vm.deal(publisher, 1 ether);
        vm.startPrank(publisher);
        (bool plainTransfer,) = address(registry).call{value: 1}("");
        (bool payablePublish,) = address(registry).call{value: 1}(
            abi.encodeCall(RootRegistry.publishRoot, (ROOT, uint64(1)))
        );
        (bool unknownCall,) = address(registry).call(hex"deadbeef");
        vm.stopPrank();
        assertFalse(plainTransfer);
        assertFalse(payablePublish);
        assertFalse(unknownCall);
        assertEq(address(registry).balance, 0);
        assertEq(registry.latestSequence(), 0);
    }

    function testFuzzPublishRoundTrip(bytes32 first, bytes32 second) public {
        vm.assume(first != bytes32(0));
        vm.assume(second != bytes32(0));
        vm.startPrank(publisher);
        registry.publishRoot(first, 1);
        registry.publishRoot(second, 2);
        vm.stopPrank();
        assertEq(registry.rootAt(1), first);
        assertEq(registry.rootAt(2), second);
        assertEq(registry.latestRoot(), second);
        assertEq(registry.latestSequence(), 2);
    }

    function testFuzzRejectsNonNextSequence(uint64 sequence) public {
        vm.assume(sequence != 1);
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.InvalidSequence.selector, sequence, 1));
        registry.publishRoot(ROOT, sequence);
        assertEq(registry.latestSequence(), 0);
        assertEq(registry.rootAt(sequence), bytes32(0));
    }

    function testFuzzUnauthorizedPublisher(address caller, bytes32 root, uint64 sequence) public {
        vm.assume(caller != publisher);
        vm.startPrank(caller);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.UnauthorizedPublisher.selector, caller));
        registry.publishRoot(root, sequence);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.UnauthorizedPublisher.selector, caller));
        registry.proposePublisher(successor);
        vm.stopPrank();
        assertEq(registry.latestSequence(), 0);
        assertEq(registry.rootAt(sequence), bytes32(0));
        assertEq(registry.pendingPublisher(), address(0));
    }

    function testFuzzUnauthorizedAcceptance(address caller) public {
        vm.assume(caller != successor);
        vm.prank(publisher);
        registry.proposePublisher(successor);
        vm.prank(caller);
        vm.expectRevert(
            abi.encodeWithSelector(RootRegistry.UnauthorizedPendingPublisher.selector, caller)
        );
        registry.acceptPublisher();
        assertEq(registry.publisher(), publisher);
        assertEq(registry.pendingPublisher(), successor);
    }

    function testFuzzTransfer(address next) public {
        vm.assume(next != address(0) && next != publisher);
        vm.prank(publisher);
        registry.proposePublisher(next);
        vm.prank(next);
        registry.acceptPublisher();
        assertEq(registry.publisher(), next);
        assertEq(registry.pendingPublisher(), address(0));
        vm.prank(next);
        registry.publishRoot(ROOT, 1);
        assertEq(registry.latestRoot(), ROOT);
    }
}
