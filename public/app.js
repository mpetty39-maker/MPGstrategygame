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
    const data = JSON.parse(event.data);

    switch (data.type) {
        case 'WAITING':
            statusElement.innerText = data.message;
            break;

        case 'START':
            myPlayerNum = data.player;
            currentBoard = data.board;
            statusElement.innerText = `Game Started! You are Player ${myPlayerNum} (${myPlayerNum === 1 ? 'Red' : 'Blue'})`;
            
            // Orient board so the current player's pieces are always at the bottom
            if (myPlayerNum === 2) {
                boardElement.classList.add('flipped');
            } else {
                boardElement.classList.remove('flipped');
            }
            renderBoard();
            break;

        case 'MOVE_MADE':
            animateAndSyncMove(data.from, data.to, data.board, data.scores);
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

        // Perform visual slide animation
        pieceElem.style.transition = 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)';
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

    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;

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

    // Select your own active piece
    if (clickedPiece && clickedPiece.owner === myPlayerNum && clickedPiece.freeze === 0 && !clickedPiece.locked) {
        if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
            selectedCell = null;
        } else {
            selectedCell = { r, c };
        }
        renderBoard();
        return;
    }

    // Move to target square
    if (selectedCell) {
        const from = selectedCell;
        const to = { r, c };

        socket.send(JSON.stringify({
            type: 'MOVE',
            from: from,
            to: to
        }));

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