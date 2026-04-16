// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract SeaBattleV2 {
    address public owner;
    IERC20 public usdc;

    struct Game {
        address player1;
        address player2;
        uint8 gameType;      // 0=hybrid, 1=bot, 2=wager
        uint256 wagerAmount; // 0 for non-wager
        bool finished;
        address winner;
    }

    uint256 public nextGameId;
    mapping(uint256 => Game) public games;
    mapping(uint256 => mapping(address => bool)) public hasBomb;
    mapping(uint256 => bool) public prizeClaimed;

    event GameCreated(uint256 indexed gameId, address player1, uint8 gameType);
    event PlayerJoined(uint256 indexed gameId, address player2);
    event GameFinished(uint256 indexed gameId, address winner);
    event BombPurchased(uint256 indexed gameId, address player);
    event PrizeClaimed(uint256 indexed gameId, address winner, uint256 prize);

    constructor(address _usdc) {
        owner = msg.sender;
        usdc = IERC20(_usdc);
    }

    // ─── Hybrid (free onchain, 2 txs) ───

    function createGame() external returns (uint256) {
        uint256 gameId = nextGameId++;
        Game storage g = games[gameId];
        g.player1 = msg.sender;
        g.gameType = 0;
        emit GameCreated(gameId, msg.sender, 0);
        return gameId;
    }

    function joinGame(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.player1 != address(0), "Not found");
        require(g.player2 == address(0), "Full");
        require(g.player1 != msg.sender, "Own game");
        require(g.gameType != 1, "Bot game");
        require(!g.finished, "Finished");
        g.player2 = msg.sender;
        emit PlayerJoined(gameId, msg.sender);
    }

    // ─── Bot ───

    function createBotGame() external returns (uint256) {
        uint256 gameId = nextGameId++;
        Game storage g = games[gameId];
        g.player1 = msg.sender;
        g.player2 = address(1); // sentinel for bot
        g.gameType = 1;
        emit GameCreated(gameId, msg.sender, 1);
        return gameId;
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
        require(!g.finished, "Finished");
        require(usdc.transferFrom(msg.sender, address(this), g.wagerAmount), "Transfer failed");
        g.player2 = msg.sender;
        emit PlayerJoined(gameId, msg.sender);
    }

    // ─── Record result (any mode) ───

    function recordResult(uint256 gameId, address _winner) external {
        Game storage g = games[gameId];
        require(!g.finished, "Already finished");
        require(msg.sender == g.player1 || msg.sender == g.player2, "Not a player");
        require(_winner == g.player1 || _winner == g.player2, "Invalid winner");
        g.finished = true;
        g.winner = _winner;
        emit GameFinished(gameId, _winner);
    }

    // ─── Claim prize (wager only) ───

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

    // ─── Buy bomb (wager only, 2 USDC) ───

    function buyBomb(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.gameType == 2, "Wager only");
        require(!g.finished, "Finished");
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
        address winner
    ) {
        Game storage g = games[gameId];
        return (g.player1, g.player2, g.gameType, g.wagerAmount, g.finished, g.winner);
    }

    function playerHasBomb(uint256 gameId, address player) external view returns (bool) {
        return hasBomb[gameId][player];
    }
}
