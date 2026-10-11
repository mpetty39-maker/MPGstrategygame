let socket;
let myPlayerNum = null;
let selectedCell = null;
let currentBoard = null;

const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
// index.html has separate per-player elements (there is no single
// #timer/#score element), so grab both pairs instead.
const p1TimerElement = document.getElementById('p1-timer');
const p2TimerElement = document.getElementById('p2-timer');
const p1ScoreElement = document.getElementById('p1-score');
const p2ScoreElement = document.getElementById('p2-score');
const startButton = document.getElementById('start-btn');
const countdownOverlay = document.getElementById('countdown-overlay');

// Becomes true at "Go!" and false again at game over. Taps on the board are
// ignored until then (the server enforces this too; this just keeps the UI honest).
let gameLive = false;

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
socket = new WebSocket(`${protocol}//${window.location.host}`);

socket.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'WAITING':
                statusElement.innerText = data.message;
                break;

            case 'START': {
                // Paired up, but nothing is live until Player 1 presses Start.
                myPlayerNum = data.player;
                currentBoard = data.board;
                gameLive = false;
                const colour = myPlayerNum === 1 ? 'Red' : 'Blue';
                if (myPlayerNum === 1) {
                    statusElement.innerText = `Opponent connected! You are Player 1 (${colour}). Press Start when ready.`;
                    startButton.hidden = false;
                } else {
                    statusElement.innerText = `You are Player 2 (${colour}). Waiting for Player 1 to start...`;
                }
                renderBoard();
                break;
            }

            case 'COUNTDOWN':
                startButton.hidden = true;
                showCountdown(data.value);
                break;

            case 'MOVE_MADE':
                animateAndSyncMove(data.from, data.to, data.board, data.scores);
                break;

            case 'TIMER_UPDATE': {
                const timerElement = data.player === 1 ? p1TimerElement : p2TimerElement;
                if (timerElement) timerElement.innerText = `${data.time}s`;
                break;
            }

            case 'GAMEOVER':
                gameLive = false;
                startButton.hidden = true;
                countdownOverlay.hidden = true;
                statusElement.innerText = `GAME OVER: ${data.reason}`;
                if (data.winner === myPlayerNum) {
                    statusElement.innerText += " YOU WIN!";
                } else {
                    statusElement.innerText += " YOU LOSE!";
                }
                break;
        }
    } catch (e) {
        console.error("Error processing socket message:", e);
    }
};

// A MOVE_MADE broadcast fires for BOTH players' moves. Previously this
// unconditionally cleared the local selection, so if your opponent moved
// while you had a piece selected, your selection was wiped out from under
// you before you could click your destination — making it feel like your
// moves were being ignored during fast opponent play. Only clear the
// selection if it's no longer a piece you can legally act on.
function clearSelectionIfInvalid() {
    if (!selectedCell) return;
    const p = currentBoard[selectedCell.r] ? currentBoard[selectedCell.r][selectedCell.c] : null;
    if (!p || p.owner !== myPlayerNum || p.freeze > 0 || p.locked) {
        selectedCell = null;
    }
}

let countdownHideTimeout = null;

// value: 3, 2, 1 shows the number; 0 shows "Go!" and unlocks the board.
function showCountdown(value) {
    clearTimeout(countdownHideTimeout);
    countdownOverlay.hidden = false;
    countdownOverlay.classList.toggle('go', value === 0);

    // Fresh element each tick so the pop animation replays.
    const span = document.createElement('span');
    span.className = 'count-num';
    span.innerText = value === 0 ? 'Go!' : value;
    countdownOverlay.innerHTML = '';
    countdownOverlay.appendChild(span);

    if (value > 0) {
        statusElement.innerText = 'Get ready...';
    } else {
        gameLive = true;
        statusElement.innerText = 'GO!';
        // Leave "Go!" up briefly, then clear it so the board is visible.
        countdownHideTimeout = setTimeout(() => {
            countdownOverlay.hidden = true;
        }, 700);
    }
}

startButton.addEventListener('click', () => {
    startButton.hidden = true; // prevent double-taps; server also ignores repeats
    socket.send(JSON.stringify({ type: 'BEGIN_COUNTDOWN' }));
});

function animateAndSyncMove(from, to, newBoard, scores) {
    const fromCell = document.querySelector(`.cell[data-row="${from.r}"][data-col="${from.c}"]`);
    const toCell = document.querySelector(`.cell[data-row="${to.r}"][data-col="${to.c}"]`);

    if (fromCell && toCell && fromCell.firstElementChild) {
        const pieceElem = fromCell.firstElementChild;
        const fromRect = fromCell.getBoundingClientRect();
        const toRect = toCell.getBoundingClientRect();

        const deltaX = toRect.left - fromRect.left;
        const deltaY = toRect.top - fromRect.top;

        pieceElem.style.transition = 'transform 0.2s ease-out';
        pieceElem.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        pieceElem.style.zIndex = '100';

        setTimeout(() => {
            currentBoard = newBoard;
            clearSelectionIfInvalid();
            if (scores) updateScores(scores);
            renderBoard();
        }, 200);
    } else {
        currentBoard = newBoard;
        clearSelectionIfInvalid();
        if (scores) updateScores(scores);
        renderBoard();
    }
}

function renderBoard() {
    if (!currentBoard) return;
    boardElement.innerHTML = '';

    for (let displayR = 0; displayR < 7; displayR++) {
        for (let displayC = 0; displayC < 7; displayC++) {
            // Map screen coordinates so each player's OWN pieces are
            // anchored at the bottom of their own screen. Player 1's
            // home rows are 0-1 (need a 180-degree flip to land at the
            // bottom); Player 2's home rows are 5-6 (already at the
            // bottom with no flip needed).
            const r = myPlayerNum === 1 ? (6 - displayR) : displayR;
            const c = myPlayerNum === 1 ? (6 - displayC) : displayC;

            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;

            // Highlight selected cell
            if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
                cell.classList.add('selected');
            }

            // Check if this cell is a valid move destination for the selected piece
            if (selectedCell && isValidMoveDestination(selectedCell, { r, c })) {
                cell.classList.add('valid-target');
            }

            // Render piece if one exists on this cell
            const piece = currentBoard[r] ? currentBoard[r][c] : null;
            if (piece) {
                const pieceDiv = document.createElement('div');
                pieceDiv.classList.add('piece', `p${piece.owner}`, piece.size.toLowerCase());
                pieceDiv.innerText = piece.size;

                if (piece.locked) {
                    pieceDiv.classList.add('locked');
                } else if (piece.freeze > 0) {
                    pieceDiv.classList.add('frozen');
                    const overlay = document.createElement('div');
                    overlay.classList.add('freeze-overlay');
                    overlay.innerText = piece.freeze;
                    pieceDiv.appendChild(overlay);
                }

                cell.appendChild(pieceDiv);
            }

            cell.addEventListener('click', () => handleCellClick(r, c));
            boardElement.appendChild(cell);
        }
    }
}

function handleCellClick(r, c) {
    if (!currentBoard || !gameLive) return;
    const clickedPiece = currentBoard[r] ? currentBoard[r][c] : null;

    // Case 1: Tapping your own active, unfrozen piece -> SELECT IT
    if (clickedPiece && clickedPiece.owner === myPlayerNum && clickedPiece.freeze === 0 && !clickedPiece.locked) {
        if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
            selectedCell = null; // Toggle off if tapped again
        } else {
            selectedCell = { r, c };
        }
        renderBoard();
        return;
    }

    // Case 2: Tapping a square (empty or opponent) while a piece is selected -> ATTEMPT MOVE
    if (selectedCell) {
        const from = selectedCell;
        const to = { r, c };

        // Only send if it's a valid move
        if (isValidMoveDestination(from, to)) {
            socket.send(JSON.stringify({
                type: 'MOVE',
                from: from,
                to: to
            }));
        }

        selectedCell = null;
        renderBoard();
    }
}

function isValidMoveDestination(from, to) {
    if (!currentBoard || !from || !to) return false;
    
    // Cannot move to the exact same square
    if (from.r === to.r && from.c === to.c) return false;

    const piece = currentBoard[from.r] ? currentBoard[from.r][from.c] : null;
    if (!piece || piece.owner !== myPlayerNum || piece.freeze > 0 || piece.locked) return false;

    const target = currentBoard[to.r] ? currentBoard[to.r][to.c] : null;
    
    // Cannot move onto locked pieces or your own pieces
    if (target && (target.locked || target.owner === piece.owner)) return false;

    // Size hierarchy check for captures: Small (1) < Medium (2) < Large (3)
    // You CANNOT capture a piece bigger than yourself
    const sizeRank = { 'S': 1, 'M': 2, 'L': 3 };
    if (target && sizeRank[piece.size] < sizeRank[target.size]) return false;

    const dr = to.r - from.r;
    const dc = to.c - from.c;
    const absR = Math.abs(dr);
    const absC = Math.abs(dc);

    // Must move in a straight line (orthogonal or 45-degree diagonal)
    if (dr !== 0 && dc !== 0 && absR !== absC) return false;

    // Range rules: Small = max 2, Medium = max 2, Large = max 1
    const maxDist = (piece.size === 'S' || piece.size === 'M') ? 2 : 1;
    const dist = Math.max(absR, absC);

    if (dist < 1 || dist > maxDist) return false;

    // Path obstruction check (cannot jump through intermediate pieces)
    const stepR = dr === 0 ? 0 : dr / absR;
    const stepC = dc === 0 ? 0 : dc / absC;
    let currR = from.r + stepR;
    let currC = from.c + stepC;

    while (currR !== to.r || currC !== to.c) {
        if (currentBoard[currR] && currentBoard[currR][currC] !== null) return false;
        currR += stepR;
        currC += stepC;
    }

    return true;
}

function updateScores(scores) {
    if (!scores) return;
    if (p1ScoreElement) p1ScoreElement.innerText = scores[1];
    if (p2ScoreElement) p2ScoreElement.innerText = scores[2];
}