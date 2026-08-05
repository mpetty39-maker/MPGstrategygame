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

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
socket = new WebSocket(`${protocol}//${window.location.host}`);

socket.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'WAITING':
                statusElement.innerText = data.message;
                break;

            case 'START':
                myPlayerNum = data.player;
                currentBoard = data.board;
                statusElement.innerText = `Game Started! You are Player ${myPlayerNum} (${myPlayerNum === 1 ? 'Red' : 'Blue'})`;
                renderBoard();
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
            selectedCell = null;
            if (scores) updateScores(scores);
            renderBoard();
        }, 200);
    } else {
        currentBoard = newBoard;
        selectedCell = null;
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
    if (!currentBoard) return;
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