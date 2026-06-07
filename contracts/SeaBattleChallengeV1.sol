// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20Challenge {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title Sea Battle Challenge V1
/// @notice Async Sea Battle challenges: creator funds a board, one challenger pays entry,
///         server verifies shots off-chain and signs the final payout.
contract SeaBattleChallengeV1 {
    uint256 public constant BPS = 10_000;
    uint256 public constant DROP_FEE_BPS = 1_000; // 10% of the total pot
    uint256 public constant JOINED_TIMEOUT = 24 hours;

    address public owner;
    address public signer;
    address public dropVault;
    IERC20Challenge public immutable usdc;
    uint256 public nextChallengeId = 1;
    uint256 public dropFundingTotal;

    struct Challenge {
        address creator;
        address challenger;
        uint256 creatorAmount;
        uint256 entryFee;
        uint16 maxMoves;
        bytes32 boardCommitment;
        bool joined;
        bool settled;
        address winner;
        uint64 createdAt;
        uint64 joinedAt;
    }

    mapping(uint256 => Challenge) public challenges;

    event ChallengeCreated(
        uint256 indexed challengeId,
        address indexed creator,
        uint256 creatorAmount,
        uint256 entryFee,
        uint16 maxMoves,
        bytes32 boardCommitment
    );
    event ChallengeJoined(uint256 indexed challengeId, address indexed challenger);
    event ChallengeSettled(
        uint256 indexed challengeId,
        address indexed winner,
        uint256 prize,
        uint256 dropFee
    );
    event ChallengeCancelled(uint256 indexed challengeId, address indexed creator, uint256 refund);
    event DropVaultUpdated(address indexed dropVault);
    event SignerUpdated(address indexed signer);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address usdcAddress, address initialDropVault, address initialSigner) {
        require(usdcAddress != address(0), "Zero USDC");
        require(initialDropVault != address(0), "Zero drop vault");
        require(initialSigner != address(0), "Zero signer");
        owner = msg.sender;
        usdc = IERC20Challenge(usdcAddress);
        dropVault = initialDropVault;
        signer = initialSigner;
        emit OwnershipTransferred(address(0), msg.sender);
        emit DropVaultUpdated(initialDropVault);
        emit SignerUpdated(initialSigner);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function createChallenge(
        uint256 creatorAmount,
        uint256 entryFee,
        uint16 maxMoves,
        bytes32 boardCommitment
    ) external returns (uint256 challengeId) {
        require(creatorAmount > 0, "Creator amount required");
        require(entryFee > 0, "Entry fee required");
        require(maxMoves > 0, "Moves required");
        require(boardCommitment != bytes32(0), "Board commitment required");
        require(usdc.transferFrom(msg.sender, address(this), creatorAmount), "Transfer failed");

        challengeId = nextChallengeId++;
        challenges[challengeId] = Challenge({
            creator: msg.sender,
            challenger: address(0),
            creatorAmount: creatorAmount,
            entryFee: entryFee,
            maxMoves: maxMoves,
            boardCommitment: boardCommitment,
            joined: false,
            settled: false,
            winner: address(0),
            createdAt: uint64(block.timestamp),
            joinedAt: 0
        });

        emit ChallengeCreated(challengeId, msg.sender, creatorAmount, entryFee, maxMoves, boardCommitment);
    }

    function joinChallenge(uint256 challengeId) external {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.creator != address(0), "Challenge not found");
        require(!challenge.joined, "Already joined");
        require(!challenge.settled, "Already settled");
        require(challenge.creator != msg.sender, "Creator cannot join");
        require(usdc.transferFrom(msg.sender, address(this), challenge.entryFee), "Transfer failed");

        challenge.challenger = msg.sender;
        challenge.joined = true;
        challenge.joinedAt = uint64(block.timestamp);
        emit ChallengeJoined(challengeId, msg.sender);
    }

    function cancelOpenChallenge(uint256 challengeId) external {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.creator == msg.sender, "Not creator");
        require(!challenge.joined, "Already joined");
        require(!challenge.settled, "Already settled");

        challenge.settled = true;
        challenge.winner = challenge.creator;
        require(usdc.transfer(challenge.creator, challenge.creatorAmount), "Refund failed");
        emit ChallengeCancelled(challengeId, challenge.creator, challenge.creatorAmount);
    }

    function settleChallenge(
        uint256 challengeId,
        address winner,
        uint16 movesUsed,
        uint16 hits,
        bytes calldata signature
    ) external {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.creator != address(0), "Challenge not found");
        require(challenge.joined, "Not joined");
        require(!challenge.settled, "Already settled");
        require(winner == challenge.creator || winner == challenge.challenger, "Invalid winner");
        require(msg.sender == challenge.creator || msg.sender == challenge.challenger, "Not participant");
        require(
            _recover(_settlementHash(challengeId, winner, movesUsed, hits), signature) == signer,
            "Bad signature"
        );

        _payout(challenge, challengeId, winner);
    }

    function claimExpiredChallenge(uint256 challengeId) external {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.creator != address(0), "Challenge not found");
        require(challenge.joined, "Not joined");
        require(!challenge.settled, "Already settled");
        require(block.timestamp >= uint256(challenge.joinedAt) + JOINED_TIMEOUT, "Timeout not ready");
        require(msg.sender == challenge.creator || msg.sender == challenge.challenger, "Not participant");

        _payout(challenge, challengeId, challenge.creator);
    }

    function getChallenge(uint256 challengeId)
        external
        view
        returns (
            address creator,
            address challenger,
            uint256 creatorAmount,
            uint256 entryFee,
            uint16 maxMoves,
            bytes32 boardCommitment,
            bool joined,
            bool settled,
            address winner,
            uint256 createdAt,
            uint256 joinedAt
        )
    {
        Challenge storage challenge = challenges[challengeId];
        return (
            challenge.creator,
            challenge.challenger,
            challenge.creatorAmount,
            challenge.entryFee,
            challenge.maxMoves,
            challenge.boardCommitment,
            challenge.joined,
            challenge.settled,
            challenge.winner,
            challenge.createdAt,
            challenge.joinedAt
        );
    }

    function setSigner(address nextSigner) external onlyOwner {
        require(nextSigner != address(0), "Zero signer");
        signer = nextSigner;
        emit SignerUpdated(nextSigner);
    }

    function setDropVault(address nextDropVault) external onlyOwner {
        require(nextDropVault != address(0), "Zero drop vault");
        dropVault = nextDropVault;
        emit DropVaultUpdated(nextDropVault);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "Zero owner");
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    function settlementHash(
        uint256 challengeId,
        address winner,
        uint16 movesUsed,
        uint16 hits
    ) external view returns (bytes32) {
        return _settlementHash(challengeId, winner, movesUsed, hits);
    }

    function _payout(Challenge storage challenge, uint256 challengeId, address winner) internal {
        challenge.settled = true;
        challenge.winner = winner;

        uint256 pot = challenge.creatorAmount + challenge.entryFee;
        uint256 dropFee = (pot * DROP_FEE_BPS) / BPS;
        uint256 prize = pot - dropFee;
        dropFundingTotal += dropFee;

        require(usdc.transfer(dropVault, dropFee), "Drop fee failed");
        require(usdc.transfer(winner, prize), "Prize failed");
        emit ChallengeSettled(challengeId, winner, prize, dropFee);
    }

    function _settlementHash(
        uint256 challengeId,
        address winner,
        uint16 movesUsed,
        uint16 hits
    ) internal view returns (bytes32) {
        Challenge storage challenge = challenges[challengeId];
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                "SEA_BATTLE_CHALLENGE_SETTLEMENT",
                challengeId,
                challenge.creator,
                challenge.challenger,
                winner,
                movesUsed,
                hits,
                challenge.maxMoves,
                challenge.boardCommitment
            )
        );
    }

    function _recover(bytes32 hash, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "Bad signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Bad signature v");
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address recovered = ecrecover(ethHash, v, r, s);
        require(recovered != address(0), "Bad signature");
        return recovered;
    }
}
