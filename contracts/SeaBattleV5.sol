// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title SeaBattleV5
/// @notice Wager state + per-player results + check-in. New in V5: bombs are
///         a per-account inventory, no longer bound to a specific gameId.
///         Consumption is tracked off-chain (Supabase) — the contract is the
///         single audit trail for purchases (and Builder Code attribution),
///         while the off-chain game state owns "which game this bomb fired in".
contract SeaBattleV5 {
    address public owner;
    IERC20 public usdc;

    uint256 public constant BOMB_PRICE = 2_000_000; // 2 USDC (6 decimals)

    struct Game {
        address player1;
        address player2;
        uint8 gameType;      // 2 = wager (only on-chain mode kept since V4)
        uint256 wagerAmount;
        bool finished;
        address winner;
        bool cancelled;
    }

    uint256 public nextGameId;
    mapping(uint256 => Game) public games;
    mapping(uint256 => bool) public prizeClaimed;

    /// @notice Per-account bomb counter (purchases minus on-chain consumes;
    ///         V5 has no on-chain consume, so this tracks total purchased).
    ///         Off-chain game DB tracks which games actually fired the bomb.
    mapping(address => uint256) public bombs;

    // ─── Wager events (parity with V4) ───
    event GameCreated(uint256 indexed gameId, address player1, uint8 gameType);
    event PlayerJoined(uint256 indexed gameId, address player2);
    event GameFinished(uint256 indexed gameId, address winner);
    event PrizeClaimed(uint256 indexed gameId, address winner, uint256 prize);
    event GameCancelled(uint256 indexed gameId, address player1, uint256 refund);

    // ─── Per-player result + daily check-in ───
    event SoloResult(address indexed player, address opponent, bool isWin, uint256 timestamp);
    event Checkin(address indexed player, uint256 timestamp);

    // ─── V5 new: inventory bombs ───
    /// @param newBalance bombs[player] AFTER the purchase
    event BombPurchased(address indexed player, uint256 newBalance);

    constructor(address _usdc) {
        owner = msg.sender;
        usdc = IERC20(_usdc);
    }

    // ─── Per-player solo/friend result fix ───

    function recordSoloResult(address opponent, bool isWin) external {
        emit SoloResult(msg.sender, opponent, isWin, block.timestamp);
    }

    // ─── Daily check-in ───

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

    // ─── V5: inventory bombs ───

    /// @notice Buy one bomb for 2 USDC; adds to caller's inventory.
    ///         Off-chain layer tracks which games actually fire each bomb.
    function buyBomb() external {
        require(usdc.transferFrom(msg.sender, owner, BOMB_PRICE), "Transfer failed");
        uint256 newBalance = ++bombs[msg.sender];
        emit BombPurchased(msg.sender, newBalance);
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

    /// @notice Total bombs ever purchased by `player`.
    ///         "Available" = this minus off-chain bomb-used count (DB).
    function playerBombs(address player) external view returns (uint256) {
        return bombs[player];
    }
}
