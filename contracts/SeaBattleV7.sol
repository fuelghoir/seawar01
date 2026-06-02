// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20V7 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title Sea Battle V7
/// @notice Wager games with self-service timeout refunds and the existing revenue split.
contract SeaBattleV7 {
    uint256 public constant BOMB_PRICE = 2_000_000; // 2 USDC
    uint256 public constant SEASON_SHARE_BPS = 8_000; // 80% of net platform revenue
    uint256 public constant BPS = 10_000;
    uint256 public constant UNJOINED_REFUND_DELAY = 3 minutes;
    uint256 public constant JOINED_REFUND_DELAY = 15 minutes;

    address public owner;
    address public rewardVault;
    IERC20V7 public immutable usdc;
    uint256 public seasonFundingTotal;

    struct Game {
        address player1;
        address player2;
        uint8 gameType; // 2 = wager
        uint256 wagerAmount;
        bool finished;
        address winner;
        bool cancelled;
        uint64 createdAt;
        uint64 joinedAt;
        bool refundClaimedP1;
        bool refundClaimedP2;
    }

    uint256 public nextGameId = 1;
    mapping(uint256 => Game) public games;
    mapping(uint256 => bool) public prizeClaimed;
    mapping(address => uint256) public bombs;

    event GameCreated(uint256 indexed gameId, address player1, uint8 gameType);
    event PlayerJoined(uint256 indexed gameId, address player2);
    event GameFinished(uint256 indexed gameId, address winner);
    event PrizeClaimed(uint256 indexed gameId, address winner, uint256 prize);
    event GameCancelled(uint256 indexed gameId, address player1, uint256 refund);
    event StaleWagerRefundClaimed(uint256 indexed gameId, address indexed player, uint256 refund);
    event SoloResult(address indexed player, address opponent, bool isWin, uint256 timestamp);
    event Checkin(address indexed player, uint256 timestamp);
    event BombPurchased(address indexed player, uint256 newBalance);
    event SeasonRevenueFunded(address indexed payer, bytes32 indexed source, uint256 amount);
    event RewardVaultUpdated(address indexed rewardVault);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address usdcAddress, address initialRewardVault) {
        require(usdcAddress != address(0), "Zero USDC");
        require(initialRewardVault != address(0), "Zero reward vault");
        owner = msg.sender;
        usdc = IERC20V7(usdcAddress);
        rewardVault = initialRewardVault;
        emit OwnershipTransferred(address(0), msg.sender);
        emit RewardVaultUpdated(initialRewardVault);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function recordSoloResult(address opponent, bool isWin) external {
        emit SoloResult(msg.sender, opponent, isWin, block.timestamp);
    }

    function checkin() external {
        emit Checkin(msg.sender, block.timestamp);
    }

    function createWagerGame(uint256 amount) external returns (uint256 gameId) {
        require(amount > 0, "Amount must be > 0");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        gameId = nextGameId++;
        games[gameId] = Game({
            player1: msg.sender,
            player2: address(0),
            gameType: 2,
            wagerAmount: amount,
            finished: false,
            winner: address(0),
            cancelled: false,
            createdAt: uint64(block.timestamp),
            joinedAt: 0,
            refundClaimedP1: false,
            refundClaimedP2: false
        });
        emit GameCreated(gameId, msg.sender, 2);
    }

    function joinWagerGame(uint256 gameId) external {
        Game storage game = games[gameId];
        require(game.gameType == 2, "Not wager game");
        require(game.player1 != address(0), "Game not found");
        require(game.player2 == address(0), "Already joined");
        require(game.player1 != msg.sender, "Cannot join own game");
        require(!game.finished && !game.cancelled, "Game closed");
        require(usdc.transferFrom(msg.sender, address(this), game.wagerAmount), "Transfer failed");

        game.player2 = msg.sender;
        game.joinedAt = uint64(block.timestamp);
        emit PlayerJoined(gameId, msg.sender);
    }

    /// @notice Creator reclaims an unmatched wager after three minutes.
    function cancelWagerGame(uint256 gameId) external {
        Game storage game = games[gameId];
        require(game.player1 == msg.sender, "Not creator");
        require(game.player2 == address(0), "Already joined");
        require(!game.finished && !game.cancelled, "Game closed");
        require(block.timestamp >= uint256(game.createdAt) + UNJOINED_REFUND_DELAY, "Refund not ready");

        game.cancelled = true;
        game.refundClaimedP1 = true;
        require(usdc.transfer(game.player1, game.wagerAmount), "Refund failed");
        emit GameCancelled(gameId, game.player1, game.wagerAmount);
    }

    /// @notice Each player independently reclaims their own stake if a joined game stalls.
    function claimStaleWagerRefund(uint256 gameId) external {
        Game storage game = games[gameId];
        require(game.gameType == 2, "Not wager game");
        require(game.player2 != address(0), "Waiting for player");
        require(!game.finished, "Game finished");
        require(block.timestamp >= uint256(game.joinedAt) + JOINED_REFUND_DELAY, "Refund not ready");

        if (msg.sender == game.player1) {
            require(!game.refundClaimedP1, "Refund already claimed");
            game.refundClaimedP1 = true;
        } else if (msg.sender == game.player2) {
            require(!game.refundClaimedP2, "Refund already claimed");
            game.refundClaimedP2 = true;
        } else {
            revert("Not player");
        }

        game.cancelled = true;
        require(usdc.transfer(msg.sender, game.wagerAmount), "Refund failed");
        emit StaleWagerRefundClaimed(gameId, msg.sender, game.wagerAmount);
    }

    function recordResult(uint256 gameId, address winner) external {
        Game storage game = games[gameId];
        require(game.gameType == 2, "Not wager game");
        require(game.player2 != address(0), "Waiting for player");
        require(!game.finished && !game.cancelled, "Game closed");
        require(winner == game.player1 || winner == game.player2, "Invalid winner");
        require(msg.sender == game.player1 || msg.sender == game.player2, "Not player");

        game.finished = true;
        game.winner = winner;
        emit GameFinished(gameId, winner);
    }

    function claimPrize(uint256 gameId) external {
        Game storage game = games[gameId];
        require(game.finished && !game.cancelled, "Game not finished");
        require(game.winner == msg.sender, "Not winner");
        require(!prizeClaimed[gameId], "Already claimed");

        prizeClaimed[gameId] = true;
        uint256 total = game.wagerAmount * 2;
        uint256 commission = total / 10; // Platform earns 10% of the pot.
        uint256 prize = total - commission;
        uint256 seasonShare = (commission * SEASON_SHARE_BPS) / BPS; // 8% of total pot.
        uint256 ownerShare = commission - seasonShare;

        require(usdc.transfer(rewardVault, seasonShare), "Season transfer failed");
        require(usdc.transfer(owner, ownerShare), "Owner transfer failed");
        require(usdc.transfer(game.winner, prize), "Prize transfer failed");
        seasonFundingTotal += seasonShare;

        emit SeasonRevenueFunded(address(this), keccak256("WAGER"), seasonShare);
        emit PrizeClaimed(gameId, game.winner, prize);
    }

    function buyBomb() external {
        _collectPurchaseRevenue(msg.sender, BOMB_PRICE, keccak256("BOMB"));
        bombs[msg.sender] += 1;
        emit BombPurchased(msg.sender, bombs[msg.sender]);
    }

    function fundSeasonRewards(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(usdc.transferFrom(msg.sender, rewardVault, amount), "Transfer failed");
        seasonFundingTotal += amount;
        emit SeasonRevenueFunded(msg.sender, keccak256("DIRECT"), amount);
    }

    function playerBombs(address player) external view returns (uint256) {
        return bombs[player];
    }

    function getGame(uint256 gameId)
        external
        view
        returns (
            address player1,
            address player2,
            uint8 gameType,
            uint256 wagerAmount,
            bool finished,
            address winner,
            bool cancelled
        )
    {
        Game storage game = games[gameId];
        return (
            game.player1,
            game.player2,
            game.gameType,
            game.wagerAmount,
            game.finished,
            game.winner,
            game.cancelled
        );
    }

    function getWagerRefundState(uint256 gameId)
        external
        view
        returns (
            uint256 createdAt,
            uint256 joinedAt,
            bool refundClaimedP1,
            bool refundClaimedP2,
            bool cancelled
        )
    {
        Game storage game = games[gameId];
        return (
            game.createdAt,
            game.joinedAt,
            game.refundClaimedP1,
            game.refundClaimedP2,
            game.cancelled
        );
    }

    function setRewardVault(address nextRewardVault) external onlyOwner {
        require(nextRewardVault != address(0), "Zero reward vault");
        rewardVault = nextRewardVault;
        emit RewardVaultUpdated(nextRewardVault);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "Zero owner");
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    function _collectPurchaseRevenue(address payer, uint256 amount, bytes32 source) internal {
        uint256 seasonShare = (amount * SEASON_SHARE_BPS) / BPS;
        uint256 ownerShare = amount - seasonShare;
        require(usdc.transferFrom(payer, rewardVault, seasonShare), "Season transfer failed");
        require(usdc.transferFrom(payer, owner, ownerShare), "Owner transfer failed");
        seasonFundingTotal += seasonShare;
        emit SeasonRevenueFunded(payer, source, seasonShare);
    }
}
