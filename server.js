const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

let waitingPlayer = null;
let rooms = {};
let roomIdCounter = 1;

// Board setup: Player 1 (top, index 0) vs Player 2 (bottom, index 6)
// Size: 'S' (Small), 'M' (Medium), 'L' (Large)
function createInitialBoard() {
    let board = Array(7).fill(null).map(() => Array(7).fill(null));
    
    // Player 1 (Top, row 0 & 1)
    board[0] = [
        { owner: 1, size: 'M', freeze: 0, locked: false },
        { owner: 1, size: 'M', freeze: 0, locked: false },
        { owner: 1, size: 'L', freeze: 0, locked: false },
        { owner: 1, size: 'L', freeze: 0, locked: false },
        { owner: 1, size: 'L', freeze: 0, locked: false },
        { owner: 1, size: 'M', freeze: 0, locked: false },
        { owner: 1, size: 'M', freeze: 0, locked: false }
    ];
    board[1] = [
        null,
        { owner: 1, size: 'S', freeze: 0, locked: false },
        { owner: 1, size: 'S', freeze: 0, locked: false },
        { owner: 1, size: 'S', freeze: 0, locked: false },
        { owner: 1, size: 'S', freeze: 0, locked: false },
        { owner: 1, size: 'S', freeze: 0, locked: false },
        null
    ];

    // Player 2 (Bottom, row 5 & 6)
    board[5] = [
        null,
        { owner: 2, size: 'S', freeze: 0, locked: false },
        { owner: 2, size: 'S', freeze: 0, locked: false },
        { owner: 2, size: 'S', freeze: 0, locked: false },
        { owner: 2, size: 'S', freeze: 0, locked: false },
        { owner: 2, size: 'S', freeze: 0, locked: false },
        null
    ];
    board[6] = [
        { owner: 2, size: 'M', freeze: 0, locked: false },
        { owner: 2, size: 'M', freeze: 0, locked: false },
        { owner: 2, size: 'L', freeze: 0, locked: false },
        { owner: 2, size: 'L', freeze: 0, locked: false },
        { owner: 2, size: 'L', freeze: 0, locked: false },
        { owner: 2, size: 'M', freeze: 0, locked: false },
        { owner: 2, size: 'M', freeze: 0, locked: false }
    ];

    return board;
}

const FREEZE_TIME = { 'S': 1, 'M': 2, 'L': 3 };

// A move message from the client is untrusted input — always validate
// that r/c are actual integers within the 7x7 board before touching
// room.board[r][c], otherwise a malformed/out-of-range value crashes
// the whole process (and both players' games with it).
function isValidPosition(pos) {
    return (
        pos &&
        Number.isInteger(pos.r) &&
        Number.isInteger(pos.c) &&
        pos.r >= 0 && pos.r < 7 &&
        pos.c >= 0 && pos.c < 7
    );
}

wss.on('connection', (ws) => {
    if (!waitingPlayer) {
        waitingPlayer = ws;
        ws.playerNum = 1;
        ws.send(JSON.stringify({ type: 'WAITING', message: 'Waiting for an opponent...' }));
    } else {
        const roomId = 'room_' + roomIdCounter++;
        const p1 = waitingPlayer;
        const p2 = ws;
        p2.playerNum = 2;
        waitingPlayer = null;

        const room = {
            id: roomId,
            p1: p1,
            p2: p2,
            board: createInitialBoard(),
            scores: { 1: 0, 2: 0 },
            p1Timer: null,
            p2Timer: null,
            p1TimeLeft: 5,
            p2TimeLeft: 5,
            gameStarted: true,
            gameOver: false
        };

        p1.room = room;
        p2.room = room;

        rooms[roomId] = room;

        p1.send(JSON.stringify({ type: 'START', player: 1, board: room.board }));
        p2.send(JSON.stringify({ type: 'START', player: 2, board: room.board }));

        // Start the 5-second move timer for BOTH players right away.
        // Previously this only happened after a player's first move,
        // so a player could stall forever before making one.
        resetTimer(room, 1);
        resetTimer(room, 2);
    }

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (err) {
            // Malformed JSON from a client should never take the server down.
            return;
        }

        const room = ws.room;
        if (!room || room.gameOver) return;

        if (data.type === 'MOVE') {
            if (!isValidPosition(data.from) || !isValidPosition(data.to)) return;
            handleMove(room, ws.playerNum, data.from, data.to);
        }
    });

    ws.on('error', () => {
        // Swallow socket errors instead of letting them crash the process;
        // the eventual 'close' event still handles cleanup for this player.
    });

    ws.on('close', () => {
        if (waitingPlayer === ws) waitingPlayer = null;
        if (ws.room) {
            const room = ws.room;
            room.gameOver = true;
            stopTimers(room);
            const other = ws.playerNum === 1 ? room.p2 : room.p1;
            if (other && other.readyState === WebSocket.OPEN) {
                other.send(JSON.stringify({ type: 'GAMEOVER', reason: 'Opponent disconnected!', winner: other.playerNum }));
            }
            delete rooms[room.id];
        }
    });
});

function handleMove(room, playerNum, from, to) {
    const piece = room.board[from.r][from.c];
    if (!piece || piece.owner !== playerNum || piece.freeze > 0 || piece.locked) return;

    if (!isValidMove(room.board, from, to, piece)) return;

    // Reset inactivity timer for the player making the move
    resetTimer(room, playerNum);

    // Perform capture / movement logic
    const target = room.board[to.r][to.c];
    room.board[from.r][from.c] = null;
    room.board[to.r][to.c] = piece;

    // Update freeze state for ALL player pieces
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            let p = room.board[r][c];
            if (p && p.owner === playerNum) {
                if (p === piece) {
                    p.freeze = FREEZE_TIME[p.size];
                } else if (p.freeze > 0) {
                    p.freeze -= 1;
                }
            }
        }
    }

    // Check back row locking condition
    const opponentBackRow = playerNum === 1 ? 6 : 0;
    if (to.r === opponentBackRow && !piece.locked) {
        piece.locked = true;
        piece.freeze = 0; // Locked pieces don't need freeze indicators
        room.scores[playerNum] += 1;
    }

    // Broadcast move to both players
    broadcast(room, {
        type: 'MOVE_MADE',
        from: from,
        to: to,
        board: room.board,
        scores: room.scores
    });

    // Check Win Conditions
    if (room.scores[playerNum] >= 3) {
        endGame(room, playerNum, `Player ${playerNum} reached 3 pieces on opponent's back row!`);
        return;
    }

    // Check if opponent can move or if all their pieces are frozen/captured
    const oppNum = playerNum === 1 ? 2 : 1;
    if (!hasLegalMoves(room.board, oppNum)) {
        endGame(room, playerNum, `Player ${oppNum} has no legal moves available!`);
        return;
    }
}

function sizeRank(size) {
    return { 'S': 1, 'M': 2, 'L': 3 }[size];
}

function isValidMove(board, from, to, piece) {
    const target = board[to.r][to.c];
    if (target && target.locked) return false; // Locked spaces cannot be captured
    if (target && target.owner === piece.owner) return false;
    if (target && sizeRank(piece.size) < sizeRank(target.size)) return false; // Cannot capture larger piece

    const dr = to.r - from.r;
    const dc = to.c - from.c;
    const absR = Math.abs(dr);
    const absC = Math.abs(dc);

    // Direction must be straight or diagonal line
    const stepR = dr === 0 ? 0 : dr / absR;
    const stepC = dc === 0 ? 0 : dc / absC;

    if (dr !== 0 && dc !== 0 && absR !== absC) return false;

    // Small and Medium move max 2 spaces; Large moves 1 space
    const maxDist = (piece.size === 'S' || piece.size === 'M') ? 2 : 1;
    const dist = Math.max(absR, absC);

    if (dist < 1 || dist > maxDist) return false;

    // Path obstruction checking (cannot pass through any piece)
    let currR = from.r + stepR;
    let currC = from.c + stepC;
    while (currR !== to.r || currC !== to.c) {
        if (board[currR][currC] !== null) return false;
        currR += stepR;
        currC += stepC;
    }

    return true;
}

function hasLegalMoves(board, playerNum) {
    let hasPieces = false;
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            let p = board[r][c];
            if (p && p.owner === playerNum && !p.locked) {
                hasPieces = true;
                if (p.freeze === 0) {
                    // Check if at least one valid destination exists
                    for (let tr = 0; tr < 7; tr++) {
                        for (let tc = 0; tc < 7; tc++) {
                            if (isValidMove(board, { r, c }, { r: tr, c: tc }, p)) return true;
                        }
                    }
                }
            }
        }
    }
    return false;
}

function resetTimer(room, playerNum) {
    if (playerNum === 1) {
        clearInterval(room.p1Timer);
        room.p1TimeLeft = 5;
        broadcast(room, { type: 'TIMER_UPDATE', player: 1, time: 5 });
        room.p1Timer = setInterval(() => {
            room.p1TimeLeft--;
            broadcast(room, { type: 'TIMER_UPDATE', player: 1, time: room.p1TimeLeft });
            if (room.p1TimeLeft <= 0) {
                endGame(room, 2, 'Player 1 ran out of time!');
            }
        }, 1000);
    } else {
        clearInterval(room.p2Timer);
        room.p2TimeLeft = 5;
        broadcast(room, { type: 'TIMER_UPDATE', player: 2, time: 5 });
        room.p2Timer = setInterval(() => {
            room.p2TimeLeft--;
            broadcast(room, { type: 'TIMER_UPDATE', player: 2, time: room.p2TimeLeft });
            if (room.p2TimeLeft <= 0) {
                endGame(room, 1, 'Player 2 ran out of time!');
            }
        }, 1000);
    }
}

function stopTimers(room) {
    clearInterval(room.p1Timer);
    clearInterval(room.p2Timer);
}

function endGame(room, winner, reason) {
    room.gameOver = true;
    stopTimers(room);
    broadcast(room, { type: 'GAMEOVER', winner: winner, reason: reason });
    // Previously only cleaned up on disconnect, so rooms that ended via
    // a normal win/timeout condition were leaked forever.
    delete rooms[room.id];
}

function broadcast(room, msg) {
    const payload = JSON.stringify(msg);
    if (room.p1 && room.p1.readyState === WebSocket.OPEN) room.p1.send(payload);
    if (room.p2 && room.p2.readyState === WebSocket.OPEN) room.p2.send(payload);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));