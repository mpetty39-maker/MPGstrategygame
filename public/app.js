let ws;
let myPlayerNum = null;
let currentBoard = [];
let selectedCell = null;
let validMoves = [];
let isAnimating = false;

const statusEl = document.getElementById('status');
const boardEl = document.getElementById('board');
const p1TimerEl = document.getElementById('p1-timer');
const p2TimerEl = document.getElementById('p2-timer');
const p1ScoreEl = document.getElementById('p1-score');
const p2ScoreEl = document.getElementById('p2-score');

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case 'WAITING':
                statusEl.innerText = msg.message;
                break;
            case 'START':
                myPlayerNum = msg.player;
                currentBoard = msg.board;
                statusEl.innerText = `Game Started! You are Player ${myPlayerNum} (${myPlayerNum === 1 ? 'Red' : 'Blue'})`;
                renderBoard();
                break;
            case 'MOVE_MADE':
                animateAndApplyMove(msg);
                break;
            case 'TIMER_UPDATE':
                if (msg.player === 1) p1TimerEl.innerText = `${msg.time}s`;
                if (msg.player === 2) p2TimerEl.innerText = `${msg.time}s`;
                break;
            case 'GAMEOVER':
                statusEl.innerText = `GAME OVER: ${msg.reason} ${msg.winner === myPlayerNum ? 'You Win! 🎉' : 'You Lost! ❌'}`;
                break;
        }
    };
}

// Convert screen grid coords (r, c) to backend array coords (actualR, actualC)
// Both players will have their pieces starting at the bottom row (rendered r = 6)
function getActualCoords(r, c) {
    if (myPlayerNum === 1) {
        return { actualR: 6 - r, actualC: 6 - c };
    } else {
        return { actualR: r, actualC: c };
    }
}

function renderBoard() {
    boardEl.innerHTML = '';

    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            const { actualR, actualC } = getActualCoords(r, c);

            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.r = actualR;
            cell.dataset.c = actualC;

            if (validMoves.some(m => m.r === actualR && m.c === actualC)) {
                cell.classList.add('valid-move');
            }

            const piece = currentBoard[actualR][actualC];
            if (piece) {
                const pieceEl = document.createElement('div');
                pieceEl.className = `piece p${piece.owner} size-${piece.size}`;
                pieceEl.innerText = piece.size;

                if (piece.locked) pieceEl.classList.add('locked');

                if (selectedCell && selectedCell.r === actualR && selectedCell.c === actualC) {
                    pieceEl.classList.add('selected');
                }

                if (piece.freeze > 0) {
                    const freezeOverlay = document.createElement('div');
                    freezeOverlay.className = 'freeze-overlay';
                    freezeOverlay.innerText = piece.freeze;
                    pieceEl.appendChild(freezeOverlay);
                }

                cell.appendChild(pieceEl);
            }

            cell.addEventListener('click', () => handleCellClick(actualR, actualC));
            boardEl.appendChild(cell);
        }
    }
}

function animateAndApplyMove(msg) {
    const fromCell = document.querySelector(`.cell[data-r="${msg.from.r}"][data-c="${msg.from.c}"]`);
    const toCell = document.querySelector(`.cell[data-r="${msg.to.r}"][data-c="${msg.to.c}"]`);
    const pieceEl = fromCell ? fromCell.querySelector('.piece') : null;

    if (pieceEl && toCell) {
        isAnimating = true;
        const fromRect = fromCell.getBoundingClientRect();
        const toRect = toCell.getBoundingClientRect();

        const deltaX = toRect.left - fromRect.left;
        const deltaY = toRect.top - fromRect.top;

        pieceEl.classList.add('sliding');
        pieceEl.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

        setTimeout(() => {
            currentBoard = msg.board;
            p1ScoreEl.innerText = msg.scores[1];
            p2ScoreEl.innerText = msg.scores[2];
            selectedCell = null;
            validMoves = [];
            isAnimating = false;
            renderBoard();
        }, 280);
    } else {
        currentBoard = msg.board;
        p1ScoreEl.innerText = msg.scores[1];
        p2ScoreEl.innerText = msg.scores[2];
        selectedCell = null;
        validMoves = [];
        renderBoard();
    }
}

function handleCellClick(r, c) {
    if (isAnimating) return;

    const piece = currentBoard[r][c];

    // Select piece
    if (piece && piece.owner === myPlayerNum && piece.freeze === 0 && !piece.locked) {
        selectedCell = { r, c };
        calculateValidMoves(r, c, piece);
        renderBoard();
        return;
    }

    // Execute Move
    if (selectedCell && validMoves.some(m => m.r === r && m.c === c)) {
        ws.send(JSON.stringify({
            type: 'MOVE',
            from: selectedCell,
            to: { r, c }
        }));
        selectedCell = null;
        validMoves = [];
        renderBoard();
    }
}

function calculateValidMoves(fromR, fromC, piece) {
    validMoves = [];
    for (let tr = 0; tr < 7; tr++) {
        for (let tc = 0; tc < 7; tc++) {
            if (isValidMoveLocal(currentBoard, { r: fromR, c: fromC }, { r: tr, c: tc }, piece)) {
                validMoves.push({ r: tr, c: tc });
            }
        }
    }
}

function isValidMoveLocal(board, from, to, piece) {
    const target = board[to.r][to.c];
    if (target && target.locked) return false;
    if (target && target.owner === piece.owner) return false;
    
    const sizeRank = { 'S': 1, 'M': 2, 'L': 3 };
    if (target && sizeRank[piece.size] < sizeRank[target.size]) return false;

    const dr = to.r - from.r;
    const dc = to.c - from.c;
    const absR = Math.abs(dr);
    const absC = Math.abs(dc);

    const stepR = dr === 0 ? 0 : dr / absR;
    const stepC = dc === 0 ? 0 : dc / absC;

    if (dr !== 0 && dc !== 0 && absR !== absC) return false;

    // Small and Medium move max 2 spaces; Large moves 1 space
    const maxDist = (piece.size === 'S' || piece.size === 'M') ? 2 : 1;
    const dist = Math.max(absR, absC);

    if (dist < 1 || dist > maxDist) return false;

    let currR = from.r + stepR;
    let currC = from.c + stepC;
    while (currR !== to.r || currC !== to.c) {
        if (board[currR][currC] !== null) return false;
        currR += stepR;
        currC += stepC;
    }

    return true;
}

connect();