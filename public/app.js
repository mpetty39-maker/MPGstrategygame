let socket;
let myPlayerNum = null;
let selectedCell = null;
let currentBoard = null;

const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const timerElement = document.getElementById('timer');
const scoreElement = document.getElementById('score');

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
                currentBoard = data.board;
                selectedCell = null;
                if (data.scores) updateScores(data.scores);
                renderBoard();
                break;

            case 'TIMER_UPDATE':
                if (data.player === myPlayerNum) {
                    timerElement.innerText = `Move Timer: ${data.time}s`;
                }
                break;

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

function renderBoard() {
    if (!currentBoard) return;
    boardElement.innerHTML = '';

    for (let displayR = 0; displayR < 7; displayR++) {
        for (let displayC = 0; displayC < 7; displayC++) {
            // Map coordinates so Player 2 baseline is on bottom
            const r = myPlayerNum === 2 ? (6 - displayR) : displayR;
            const c = myPlayerNum === 2 ? (6 - displayC) : displayC;

            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;

            // Highlight selected cell
            if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
                cell.classList.add('selected');
            }

            // Highlight legal target squares
            if (selectedCell && isValidMoveDestination(selectedCell, { r, c })) {
                cell.classList.add('valid-target');
            }

            // Render piece on top of square
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

            // Single unified click handler
            cell.addEventListener('click', () => handleCellClick(r, c));
            boardElement.appendChild(cell);
        }
    }
}

function handleCellClick(r, c) {
    if (!currentBoard) return;
    const clickedPiece = currentBoard[r] ? currentBoard[r][c] : null;

    // Case 1: Tapping your own unfrozen piece -> SELECT IT
    if (clickedPiece && clickedPiece.owner === myPlayerNum && clickedPiece.freeze === 0 && !clickedPiece.locked) {
        if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
            selectedCell = null; // Toggle off if clicked again
        } else {
            selectedCell = { r, c };
        }
        renderBoard();
        return;
    }

    // Case 2: Tapping a target square while a piece is selected -> EXECUTE MOVE
    if (selectedCell) {
        const from = selectedCell;
        const to = { r, c };

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
    if (from.r === to.r && from.c === to.c) return false;

    const piece = currentBoard[from.r] ? currentBoard[from.r][from.c] : null;
    if (!piece || piece.owner !== myPlayerNum || piece.freeze > 0 || piece.locked) return false;

    const target = currentBoard[to.r] ? currentBoard[to.r][to.c] : null;
    
    // Cannot land on locked pieces or your own pieces
    if (target && (target.locked || target.owner === piece.owner)) return false;

    // Size check for captures: S=1, M=2, L=3. Cannot capture larger pieces
    const sizeRank = { 'S': 1, 'M': 2, 'L': 3 };
    if (target && sizeRank[piece.size] < sizeRank[target.size]) return false;

    const dr = to.r - from.r;
    const dc = to.c - from.c;
    const absR = Math.abs(dr);
    const absC = Math.abs(dc);

    // Straight line required (orthogonal or 45-degree diagonal)
    if (dr !== 0 && dc !== 0 && absR !== absC) return false;

    // Small = max 2, Medium = max 2, Large = max 1
    const maxDist = (piece.size === 'S' || piece.size === 'M') ? 2 : 1;
    const dist = Math.max(absR, absC);

    if (dist < 1 || dist > maxDist) return false;

    // Check line-of-sight for obstructions
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
    if (scores && scoreElement) {
        scoreElement.innerText = `Player 1: ${scores[1]} | Player 2: ${scores[2]}`;
    }
}