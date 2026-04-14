// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract SeaBattle {
    enum GameState { Created, PlacingShips, Active, Finished }
    enum TurnPhase { Shooting, WaitingReport }

    struct Game {
        address player1;
        address player2;
        bytes32 player1BoardHash;
        bytes32 player2BoardHash;
        uint8 currentTurn;       // 1 or 2
        uint8 player1Hits;
        uint8 player2Hits;
        GameState state;
        TurnPhase turnPhase;
        address winner;
        uint8 lastShotX;
        uint8 lastShotY;
        address lastShooter;
    }

    uint256 public nextGameId;
    mapping(uint256 => Game) public games;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => mapping(uint8 => bool)))) public playerShots;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => mapping(uint8 => bool)))) public playerHits;

    event GameCreated(uint256 indexed gameId, address player1);
    event PlayerJoined(uint256 indexed gameId, address player2);
    event BoardCommitted(uint256 indexed gameId, address player);
    event ShotFired(uint256 indexed gameId, address shooter, uint8 x, uint8 y);
    event ShotResult(uint256 indexed gameId, uint8 x, uint8 y, bool isHit);
    event GameFinished(uint256 indexed gameId, address winner);

    function createGame() external returns (uint256) {
        uint256 gameId = nextGameId++;
        Game storage g = games[gameId];
        g.player1 = msg.sender;
        g.state = GameState.Created;
        g.currentTurn = 1;
        g.turnPhase = TurnPhase.Shooting;
        emit GameCreated(gameId, msg.sender);
        return gameId;
    }

    function joinGame(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.state == GameState.Created, "Game not available");
        require(g.player1 != msg.sender, "Cannot join own game");
        g.player2 = msg.sender;
        g.state = GameState.PlacingShips;
        emit PlayerJoined(gameId, msg.sender);
    }

    function commitBoard(uint256 gameId, bytes32 boardHash) external {
        Game storage g = games[gameId];
        require(g.state == GameState.PlacingShips, "Not in placement phase");
        if (msg.sender == g.player1) {
            require(g.player1BoardHash == bytes32(0), "Already committed");
            g.player1BoardHash = boardHash;
        } else if (msg.sender == g.player2) {
            require(g.player2BoardHash == bytes32(0), "Already committed");
            g.player2BoardHash = boardHash;
        } else {
            revert("Not a player");
        }
        emit BoardCommitted(gameId, msg.sender);
        if (g.player1BoardHash != bytes32(0) && g.player2BoardHash != bytes32(0)) {
            g.state = GameState.Active;
        }
    }

    function shoot(uint256 gameId, uint8 x, uint8 y) external {
        Game storage g = games[gameId];
        require(g.state == GameState.Active, "Game not active");
        require(g.turnPhase == TurnPhase.Shooting, "Waiting for hit report");
        require(x < 10 && y < 10, "Out of bounds");

        uint8 playerNum;
        if (g.currentTurn == 1) {
            require(msg.sender == g.player1, "Not your turn");
            playerNum = 1;
        } else {
            require(msg.sender == g.player2, "Not your turn");
            playerNum = 2;
        }

        require(!playerShots[gameId][playerNum][x][y], "Already shot here");

        playerShots[gameId][playerNum][x][y] = true;
        g.lastShotX = x;
        g.lastShotY = y;
        g.lastShooter = msg.sender;
        g.turnPhase = TurnPhase.WaitingReport;

        emit ShotFired(gameId, msg.sender, x, y);
    }

    function reportHit(uint256 gameId, uint8 x, uint8 y, bool isHit) external {
        Game storage g = games[gameId];
        require(g.state == GameState.Active, "Game not active");
        require(g.turnPhase == TurnPhase.WaitingReport, "No shot to report");
        require(x == g.lastShotX && y == g.lastShotY, "Wrong coordinates");

        if (g.lastShooter == g.player1) {
            require(msg.sender == g.player2, "Not the opponent");
            if (isHit) {
                playerHits[gameId][1][x][y] = true;
                g.player1Hits++;
            }
        } else {
            require(msg.sender == g.player1, "Not the opponent");
            if (isHit) {
                playerHits[gameId][2][x][y] = true;
                g.player2Hits++;
            }
        }

        emit ShotResult(gameId, x, y, isHit);

        if (g.player1Hits >= 20) {
            g.state = GameState.Finished;
            g.winner = g.player1;
            emit GameFinished(gameId, g.player1);
        } else if (g.player2Hits >= 20) {
            g.state = GameState.Finished;
            g.winner = g.player2;
            emit GameFinished(gameId, g.player2);
        }

        // If hit, shooter keeps the turn; if miss, turn switches
        if (!isHit) {
            g.currentTurn = g.currentTurn == 1 ? uint8(2) : uint8(1);
        }
        g.turnPhase = TurnPhase.Shooting;
    }

    function getGame(uint256 gameId) external view returns (
        address player1,
        address player2,
        uint8 currentTurn,
        uint8 player1Hits,
        uint8 player2Hits,
        uint8 state,
        uint8 turnPhase,
        address winner
    ) {
        Game storage g = games[gameId];
        return (
            g.player1,
            g.player2,
            g.currentTurn,
            g.player1Hits,
            g.player2Hits,
            uint8(g.state),
            uint8(g.turnPhase),
            g.winner
        );
    }

    function getGameExtra(uint256 gameId) external view returns (
        bool player1BoardCommitted,
        bool player2BoardCommitted,
        uint8 lastShotX,
        uint8 lastShotY,
        address lastShooter
    ) {
        Game storage g = games[gameId];
        return (
            g.player1BoardHash != bytes32(0),
            g.player2BoardHash != bytes32(0),
            g.lastShotX,
            g.lastShotY,
            g.lastShooter
        );
    }

    function getBoardState(uint256 gameId, uint8 playerNum) external view returns (
        bool[100] memory shots,
        bool[100] memory hits
    ) {
        for (uint8 i = 0; i < 10; i++) {
            for (uint8 j = 0; j < 10; j++) {
                uint8 idx = i * 10 + j;
                shots[idx] = playerShots[gameId][playerNum][i][j];
                hits[idx] = playerHits[gameId][playerNum][i][j];
            }
        }
    }
}
