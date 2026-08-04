let socket;
let myPlayerNum = null;
let selectedCell = null;
let currentBoard = null;

const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const timerElement = document.getElementById('timer');
const scoreElement = document.getElementById('score');

// Connect WebSocket
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
socket = new WebSocket(`${protocol}//${window.location.host}`);

socket.onmessage = (event) => {
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
            selectedCell = null; // Clear selection after any move to prevent stale taps
            updateScores(data.scores);
            renderBoard();
            break;

        case 'TIMER_UPDATE':
            if (data.player === myPlayerNum) {
                timerElement.innerText = `Your Move Time: ${data.time}s`;
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
};

function renderBoard() {
    if (!currentBoard) return;
    boardElement.innerHTML = '';

    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;

            // Highlight selected cell
            if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
                cell.classList.add('selected');
            }

            const piece = currentBoard[r][c];
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

            // Highlighting valid move destinations for selected piece
            if (selectedCell && isValidMoveDestination(selectedCell, { r, c })) {
                cell.classList.add('valid-target');
            }

            cell.addEventListener('click', () => handleCellClick(r, c));
            boardElement.appendChild(cell);
        }
    }
}

function handleCellClick(r, c) {
    const clickedPiece = currentBoard[r][c];

    // Case 1: Tapping your own unfrozen, unlocked piece -> SELECT IT
    if (clickedPiece && clickedPiece.owner === myPlayerNum && clickedPiece.freeze === 0 && !clickedPiece.locked) {
        // Tapping the already selected piece deselects it
        if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
            selectedCell = null;
        } else {
            selectedCell = { r, c };
        }
        renderBoard();
        return;
    }

    // Case 2: Tapping a destination while a piece is selected -> TRY MOVE
    if (selectedCell) {
        const from = selectedCell;
        const to = { r, c };

        // Send move request to server
        socket.send(JSON.stringify({
            type: 'MOVE',
            from: from,
            to: to
        }));

        // Instantly clear selection to prevent rapid duplicate sends
        selectedCell = null;
        renderBoard();
    }
}

function isValidMoveDestination(from, to) {
    if (!currentBoard) return false;
    const piece = currentBoard[from.r][from.c];
    if (!piece || piece.owner !== myPlayerNum || piece.freeze > 0 || piece.locked) return false;

    const target = currentBoard[to.r][to.c];
    if (target && target.locked) return false;
    if (target && target.owner === piece.owner) return false;
    
    // Size check
    const sizeRank = { 'S': 1, 'M': 2, 'L': 3 };
    if (target && sizeRank[piece.size] < sizeRank(target.size)) return false;

    const dr = to.r - from.r;
    const dc = to.c - from.c;
    const absR = Math.abs(dr);
    const absC = Math.abs(dc);

    if (dr !== 0 && dc !== 0 && absR !== absC) return false;

    const maxDist = (piece.size === 'S' || piece.size === 'M') ? 2 : 1;
    const dist = Math.max(absR, absC);

    if (dist < 1 || dist > maxDist) return false;

    // Path check
    const stepR = dr === 0 ? 0 : dr / absR;
    const stepC = dc === 0 ? 0 : dc / absC;
    let currR = from.r + stepR;
    let currC = from.c + stepC;
    while (currR !== to.r || currC !== to.c) {
        if (currentBoard[currR][currC] !== null) return false;
        currR += stepR;
        currC += stepC;
    }

    return true;
}

function updateScores(scores) {
    scoreElement.innerText = `Player 1: ${scores[1]} | Player 2: ${scores[2]}`;
}