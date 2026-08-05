const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

let waitingPlayer = null;
let games = {};

function createInitialBoard() {
    // 7x7 grid
    // Row 0: Player 1 (Top) -> M, M, L, L, L, M, M
    // Row 1: Player 1 -> empty, S, S, S, S, S, empty
    // Row 5: Player 2 -> empty, S, S, S, S, S, empty
    // Row 6: Player 2 (Bottom) -> M, M, L, L, L, M, M
    let board = Array(7).fill(null).map(() => Array(7).fill(null));

    // Player 1 setup
    board[0][0] = { owner: 1, size: 'M', freeze: 0, locked: false };
    board[0][1] = { owner: 1, size: 'M', freeze: 0, locked: false };
    board[0][2] = { owner: 1, size: 'L', freeze: 0, locked: false };
    board[0][3] = { owner: 1, size: 'L', freeze: 0, locked: false };
    board[0][4] = { owner: 1, size: 'L', freeze: 0, locked: false };
    board[0][5] = { owner: 1, size: 'M', freeze: 0, locked: false };
    board[0][6] = { owner: 1, size: 'M', freeze: 0, locked: false };

    for (let c = 1; c <= 5; c++) {
        board[1][c] = { owner: 1, size: 'S', freeze: 0, locked: false };
    }

    // Player 2 setup
    for (let c = 1; c <= 5; c++) {
        board[5][c] = { owner: 2, size: 'S', freeze: 0, locked: false };
    }

    board[6][0] = { owner: 2, size: 'M', freeze: 0, locked: false };
    board[6][1] = { owner: 2, size: 'M', freeze: 0, locked: false };
    board[6][2] = { owner: 2, size: 'L', freeze: 0, locked: false };
    board[6][3] = { owner: 2, size: 'L', freeze: 0, locked: false };
    board[6][4] = { owner: 2, size: 'L', freeze: 0, locked: false };
    board[6][5] = { owner: 2, size: 'M', freeze: 0, locked: false };
    board[6][6] = { owner: 2, size: 'M', freeze: 0, locked: false };

    return board;
}

wss.on('connection', (ws) => {
    if (!waitingPlayer) {
        waitingPlayer = ws;
        ws.send(JSON.stringify({ type: 'WAITING', message: 'Waiting for an opponent...' }));
    } else {
        const gameId = Date.now().toString();
        const player1 = waitingPlayer;
        const player2 = ws;
        waitingPlayer = null;

        const gameState = {
            id: gameId,
            p1: player1,
            p2: player2,
            board: createInitialBoard(),
            scores: { 1: 0, 2: 0 },
            timers: { 1: 5, 2: 5 },
            timerInterval: null
        };

        games[gameId] = gameState;
        player1.gameId = gameId;
        player1.playerNum = 1;
        player2.gameId = gameId;
        player2.playerNum = 2;

        player1.send(JSON.stringify({ type: 'START', player: 1, board: gameState.board }));
        player2.send(JSON.stringify({ type: 'START', player: 2, board: gameState.board }));

        startInactivityTimer(gameState);
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const game = games[ws.gameId];
            if (!game) return;

            if (data.type === 'MOVE') {
                handleMove(game, ws.playerNum, data.from, data.to);
            }
        } catch (e) {
            console.error("Server error handling message:", e);
        }
    });

    ws.on('close', () => {
        if (waitingPlayer === ws) {
            waitingPlayer = null;
        }
        if (ws.gameId && games[ws.gameId]) {
            const game = games[ws.gameId];
            clearInterval(game.timerInterval);
            const opponent = ws.playerNum === 1 ? game.p2 : game.p1;
            if (opponent && opponent.readyState === WebSocket.OPEN) {
                opponent.send(JSON.stringify({ type: 'GAMEOVER', reason: 'Opponent disconnected.', winner: opponent.playerNum }));
            }
            delete games[ws.gameId];
        }
    });
});

function handleMove(game, playerNum, from, to) {
    const board = game.board;
    const piece = board[from.r] ? board[from.r][from.c] : null;

    if (!piece || piece.owner !== playerNum || piece.freeze > 0 || piece.locked) {
        return; // Invalid player or frozen
    }

    if (!isValidMoveServer(board, playerNum, from, to)) {
        return; // Failed path/range/capture check
    }

    // Process move
    board[to.r][to.c] = piece;
    board[from.r][from.c] = null;

    // Set freeze timer for moved piece: S=1, M=2, L=3
    const freezeDuration = piece.size === 'S' ? 1 : (piece.size === 'M' ? 2 : 3);
    piece.freeze = freezeDuration + 1; // +1 because decrement loop runs immediately

    // Decrement freeze counters for all player's pieces
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            const p = board[r][c];
            if (p && p.owner === playerNum && p.freeze > 0) {
                p.freeze--;
            }
        }
    }

    // Check back row scoring (Player 1 back row = 6, Player 2 back row = 0)
    const backRow = playerNum === 1 ? 6 : 0;
    if (to.r === backRow && !piece.locked) {
        piece.locked = true;
        game.scores[playerNum]++;
    }

    // Reset move timer for player
    game.timers[playerNum] = 5;

    // Check win conditions
    let gameOver = false;
    let winner = null;
    let reason = '';

    if (game.scores[playerNum] >= 3) {
        gameOver = true;
        winner = playerNum;
        reason = `Player ${playerNum} reached the back row with 3 pieces!`;
    }

    const payload = JSON.stringify({
        type: 'MOVE_MADE',
        from: from,
        to: to,
        board: board,
        scores: game.scores
    });

    game.p1.send(payload);
    game.p2.send(payload);

    if (gameOver) {
        clearInterval(game.timerInterval);
        const gameoverPayload = JSON.stringify({ type: 'GAMEOVER', reason: reason, winner: winner });
        game.p1.send(gameoverPayload);
        game.p2.send(gameoverPayload);
    }
}

function isValidMoveServer(board, playerNum, from, to) {
    if (from.r === to.r && from.c === to.c) return false;

    const piece = board[from.r][from.c];
    const target = board[to.r][to.c];

    if (target && (target.locked || target.owner === playerNum)) return false;

    const sizeRank = { 'S': 1, 'M': 2, 'L': 3 };
    if (target && sizeRank[piece.size] < sizeRank[target.size]) return false;

    const dr = to.r - from.r;
    const dc = to.c - from.c;
    const absR = Math.abs(dr);
    const absC = Math.abs(dc);

    if (dr !== 0 && dc !== 0 && absR !== absC) return false;

    // Strict Max Dist: S=2, M=2, L=1
    const maxDist = (piece.size === 'S' || piece.size === 'M') ? 2 : 1;
    const dist = Math.max(absR, absC);

    if (dist < 1 || dist > maxDist) return false;

    const stepR = dr === 0 ? 0 : dr / absR;
    const stepC = dc === 0 ? 0 : dc / absC;
    let currR = from.r + stepR;
    let currC = from.c + stepC;

    while (currR !== to.r || currC !== to.c) {
        if (board[currR][currC] !== null) return false;
        currR += stepR;
        currC += stepC;
    }

    return true;
}

function startInactivityTimer(game) {
    game.timerInterval = setInterval(() => {
        for (let p of [1, 2]) {
            game.timers[p]--;
            const ws = p === 1 ? game.p1 : game.p2;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'TIMER_UPDATE', player: p, time: game.timers[p] }));
            }

            if (game.timers[p] <= 0) {
                clearInterval(game.timerInterval);
                const winner = p === 1 ? 2 : 1;
                const gameoverPayload = JSON.stringify({
                    type: 'GAMEOVER',
                    reason: `Player ${p} ran out of time!`,
                    winner: winner
                });
                game.p1.send(gameoverPayload);
                game.p2.send(gameoverPayload);
                return;
            }
        }
    }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});