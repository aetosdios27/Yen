// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {RootRegistry} from "../src/RootRegistry.sol";

contract RootRegistryHandler is Test {
    RootRegistry public immutable registry;
    address public expectedPublisher;
    address public expectedPending;
    bytes32[] public published;
    uint256 public unauthorizedAttempts;

    constructor(RootRegistry target, address initialPublisher) {
        registry = target;
        expectedPublisher = initialPublisher;
    }

    function publish(bytes32 root) external {
        if (root == bytes32(0)) root = bytes32(uint256(1));
        uint64 previous = registry.latestSequence();
        uint64 next = uint64(published.length + 1);
        vm.prank(expectedPublisher);
        registry.publishRoot(root, next);
        published.push(root);
        assertEq(uint256(registry.latestSequence()), uint256(previous) + 1);
    }

    function rejectUnauthorizedWrite(address caller, bytes32 root) external {
        caller = _different(caller, expectedPublisher);
        uint64 next = uint64(published.length + 1);
        vm.startPrank(caller);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.UnauthorizedPublisher.selector, caller));
        registry.publishRoot(root, next);
        vm.expectRevert(abi.encodeWithSelector(RootRegistry.UnauthorizedPublisher.selector, caller));
        registry.proposePublisher(caller);
        vm.stopPrank();
        unauthorizedAttempts++;
        assertEq(registry.latestSequence(), published.length);
        assertEq(registry.rootAt(next), bytes32(0));
        assertEq(registry.publisher(), expectedPublisher);
        assertEq(registry.pendingPublisher(), expectedPending);
    }

    function rejectPastOrSkippedSequence(uint64 sequence, bytes32 root) external {
        if (root == bytes32(0)) root = bytes32(uint256(1));
        uint256 next = published.length + 1;
        // Includes attempts to create gaps, overwrite existing roots, and use reserved sequence 0.
        if (sequence == next) sequence = 0;
        vm.prank(expectedPublisher);
        vm.expectRevert(
            abi.encodeWithSelector(RootRegistry.InvalidSequence.selector, sequence, next)
        );
        registry.publishRoot(root, sequence);
        assertEq(registry.latestSequence(), published.length);
    }

    function rejectZeroRoot() external {
        vm.prank(expectedPublisher);
        vm.expectRevert(RootRegistry.ZeroRoot.selector);
        registry.publishRoot(bytes32(0), uint64(published.length + 1));
        assertEq(registry.latestSequence(), published.length);
    }

    function propose(address candidate) external {
        candidate = _different(candidate, expectedPublisher);
        if (candidate == address(0)) candidate = _different(address(1), expectedPublisher);
        vm.prank(expectedPublisher);
        registry.proposePublisher(candidate);
        expectedPending = candidate;
    }

    function accept() external {
        if (expectedPending == address(0)) {
            vm.expectRevert(RootRegistry.NoPendingPublisher.selector);
            registry.acceptPublisher();
            return;
        }
        vm.prank(expectedPending);
        registry.acceptPublisher();
        expectedPublisher = expectedPending;
        expectedPending = address(0);
    }

    function rejectAcceptance(address caller) external {
        if (expectedPending == address(0)) {
            vm.prank(caller);
            vm.expectRevert(RootRegistry.NoPendingPublisher.selector);
            registry.acceptPublisher();
        } else {
            caller = _different(caller, expectedPending);
            vm.prank(caller);
            vm.expectRevert(
                abi.encodeWithSelector(RootRegistry.UnauthorizedPendingPublisher.selector, caller)
            );
            registry.acceptPublisher();
        }
        assertEq(registry.publisher(), expectedPublisher);
        assertEq(registry.pendingPublisher(), expectedPending);
    }

    function publicationCount() external view returns (uint256) {
        return published.length;
    }

    function _different(address candidate, address excluded) private pure returns (address) {
        if (candidate != excluded) return candidate;
        return excluded == address(1) ? address(2) : address(1);
    }
}

contract RootRegistryInvariantTest is StdInvariant, Test {
    RootRegistry internal registry;
    RootRegistryHandler internal handler;

    function setUp() public {
        address publisher = makeAddr("publisher");
        registry = new RootRegistry(publisher);
        handler = new RootRegistryHandler(registry, publisher);
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.publish.selector;
        selectors[1] = handler.rejectUnauthorizedWrite.selector;
        selectors[2] = handler.rejectPastOrSkippedSequence.selector;
        selectors[3] = handler.rejectZeroRoot.selector;
        selectors[4] = handler.propose.selector;
        selectors[5] = handler.accept.selector;
        selectors[6] = handler.rejectAcceptance.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariantSequenceIsGaplessAndStrictlyIncreasing() public view {
        uint256 count = handler.publicationCount();
        assertEq(registry.latestSequence(), count);
        assertEq(registry.rootAt(0), bytes32(0));
        assertEq(registry.rootAt(uint64(count + 1)), bytes32(0));
        bytes32 expectedLatest = count == 0 ? bytes32(0) : handler.published(count - 1);
        assertEq(registry.latestRoot(), expectedLatest);
    }

    function invariantEveryPastRootIsImmutable() public view {
        uint256 count = handler.publicationCount();
        for (uint256 i = 0; i < count; ++i) {
            assertEq(registry.rootAt(uint64(i + 1)), handler.published(i));
            assertNotEq(registry.rootAt(uint64(i + 1)), bytes32(0));
        }
    }

    function invariantOnlyPublisherCanWriteOrTransferAuthority() public view {
        assertEq(registry.publisher(), handler.expectedPublisher());
        assertNotEq(registry.publisher(), address(0));
        assertEq(registry.pendingPublisher(), handler.expectedPending());
        // Only authenticated successful handler publications enter this independent history.
        assertEq(registry.latestSequence(), handler.publicationCount());
    }
}
