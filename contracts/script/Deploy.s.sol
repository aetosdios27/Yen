// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {RootRegistry} from "../src/RootRegistry.sol";

contract Deploy is Script {
    error WrongChain(uint256 chainId);

    /// @notice Deploy on Amoy using environment configuration and the CLI's encrypted keystore.
    function run() external returns (RootRegistry registry) {
        if (block.chainid != 80002) revert WrongChain(block.chainid);
        address publisher = vm.envAddress("ROOT_REGISTRY_PUBLISHER");
        vm.startBroadcast();
        registry = new RootRegistry(publisher);
        vm.stopBroadcast();
    }
}
