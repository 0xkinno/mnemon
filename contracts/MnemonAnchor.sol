pragma solidity ^0.8.20;

contract MnemonAnchor {
    event Anchored(string entity, string epoch, bytes32 claimHash, string verdict, string operationId);

    function anchor(string calldata entity, string calldata epoch, bytes32 claimHash, string calldata verdict, string calldata operationId) external {
        emit Anchored(entity, epoch, claimHash, verdict, operationId);
    }
}

