// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title SeaBattleV4
/// @notice Wager-only on-chain state plus per-player result fixing for free
///         bot/friend modes and a daily check-in event for Base.dev attribution.
/// @dev    Every transactional function emits an event so the contract
///         remains the single audit trail for stats and Builder Code attribution.
contract SeaBattleV4 {
    address public owner;
    IERC20 public usdc;

    struct Game {
        address player1;
        address player2;
        uint8 gameType;      // 2 = wager (only on-chain mode kept in V4)
        uint256 wagerAmount;
        bool finished;
        address winner;
        bool cancelled;
    }

    uint256 public nextGameId;
    mapping(uint256 => Game) public games;
    mapping(uint256 => mapping(address => bool)) public hasBomb;
    mapping(uint256 => bool) public prizeClaimed;

    // ─── Wager events (parity with V3) ───
    event GameCreated(uint256 indexed gameId, address player1, uint8 gameType);
    event PlayerJoined(uint256 indexed gameId, address player2);
    event GameFinished(uint256 indexed gameId, address winner);
    event BombPurchased(uint256 indexed gameId, address player);
    event PrizeClaimed(uint256 indexed gameId, address winner, uint256 prize);
    event GameCancelled(uint256 indexed gameId, address player1, uint256 refund);

    // ─── V4: per-player result + daily check-in ───
    /// Each player calls for themselves once per finished bot/friend game.
    /// `opponent` is address(0) for bot games and the friend's address for PvP.
    event SoloResult(address indexed player, address opponent, bool isWin, uint256 timestamp);
    event Checkin(address indexed player, uint256 timestamp);

    constructor(address _usdc) {
        owner = msg.sender;
        usdc = IERC20(_usdc);
    }

    // ─── V4 new: per-player result fix for free bot / friend modes ───

    /// @notice Each player records their own outcome. No on-chain state is
    ///         touched; the SoloResult event is the audit trail and the
    ///         off-chain leaderboard reads from Supabase. Both players in a
    ///         friend match can call independently — neither will revert.
    function recordSoloResult(address opponent, bool isWin) external {
        emit SoloResult(msg.sender, opponent, isWin, block.timestamp);
    }

    // ─── V4 new: daily check-in ───

    /// @notice Lightweight on-chain check-in. Replaces the old self-transfer
    ///         pattern so Base.dev / Builder Code attribution works on PC
    ///         wallets and Base App alike.
    function checkin() external {
        emit Checkin(msg.sender, block.timestamp);
    }

    // ─── Wager (USDC) ───

    function createWagerGame(uint256 amount) external returns (uint256) {
        require(amount > 0, "Zero amount");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        uint256 gameId = nextGameId++;
        Game storage g = games[gameId];
        g.player1 = msg.sender;
        g.gameType = 2;
        g.wagerAmount = amount;
        emit GameCreated(gameId, msg.sender, 2);
        return gameId;
    }

    function joinWagerGame(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.gameType == 2, "Not wager");
        require(g.player2 == address(0), "Full");
        require(g.player1 != msg.sender, "Own game");
        require(!g.finished && !g.cancelled, "Closed");
        require(usdc.transferFrom(msg.sender, address(this), g.wagerAmount), "Transfer failed");
        g.player2 = msg.sender;
        emit PlayerJoined(gameId, msg.sender);
    }

    function cancelWagerGame(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.gameType == 2, "Not wager");
        require(g.player1 == msg.sender, "Not creator");
        require(g.player2 == address(0), "Already joined");
        require(!g.finished, "Finished");
        require(!g.cancelled, "Already cancelled");
        g.cancelled = true;
        uint256 refund = g.wagerAmount;
        require(usdc.transfer(msg.sender, refund), "Refund failed");
        emit GameCancelled(gameId, msg.sender, refund);
    }

    /// @notice Wager-only result fix. Sets finished + winner so claimPrize works.
    function recordResult(uint256 gameId, address _winner) external {
        Game storage g = games[gameId];
        require(g.gameType == 2, "Wager only");
        require(!g.finished, "Already finished");
        require(!g.cancelled, "Cancelled");
        require(msg.sender == g.player1 || msg.sender == g.player2, "Not a player");
        require(_winner == g.player1 || _winner == g.player2, "Invalid winner");
        g.finished = true;
        g.winner = _winner;
        emit GameFinished(gameId, _winner);
    }

    function claimPrize(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.gameType == 2, "Not wager");
        require(g.finished, "Not finished");
        require(g.winner == msg.sender, "Not winner");
        require(!prizeClaimed[gameId], "Already claimed");
        prizeClaimed[gameId] = true;
        uint256 total = g.wagerAmount * 2;
        uint256 commission = total / 10; // 10%
        uint256 prize = total - commission;
        require(usdc.transfer(owner, commission), "Commission failed");
        require(usdc.transfer(msg.sender, prize), "Prize failed");
        emit PrizeClaimed(gameId, msg.sender, prize);
    }

    function buyBomb(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.gameType == 2, "Wager only");
        require(!g.finished && !g.cancelled, "Closed");
        require(msg.sender == g.player1 || msg.sender == g.player2, "Not a player");
        require(!hasBomb[gameId][msg.sender], "Already bought");
        require(usdc.transferFrom(msg.sender, owner, 2_000_000), "Transfer failed"); // 2 USDC
        hasBomb[gameId][msg.sender] = true;
        emit BombPurchased(gameId, msg.sender);
    }

    // ─── Views ───

    function getGame(uint256 gameId) external view returns (
        address player1,
        address player2,
        uint8 gameType,
        uint256 wagerAmount,
        bool finished,
        address winner,
        bool cancelled
    ) {
        Game storage g = games[gameId];
        return (g.player1, g.player2, g.gameType, g.wagerAmount, g.finished, g.winner, g.cancelled);
    }

    function playerHasBomb(uint256 gameId, address player) external view returns (bool) {
        return hasBomb[gameId][player];
    }
}
