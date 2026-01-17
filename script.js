class SudokuGame {
    constructor() {
        this.board = Array(81).fill(null);
        this.solution = Array(81).fill(null);
        this.history = [];
        this.selectedCellIndex = -1;
        this.selectedNumber = null; // New: For "Number First" mode
        this.mistakes = 0;
        this.maxMistakes = 3;
        this.notesMode = false;
        this.difficulty = 'easy';
        this.timer = 0;
        this.timerInterval = null;
        this.isGameOver = false;

        this.dom = {
            board: document.getElementById('sudoku-board'),
            mistakes: document.getElementById('mistakes-count'),
            timer: document.getElementById('timer'),
            level: document.getElementById('level-display'),
            difficultySelect: document.getElementById('difficulty-select'),
            themeToggle: document.getElementById('theme-toggle'),
            newGameBtn: document.getElementById('btn-new-game'),
            undoBtn: document.getElementById('btn-undo'),
            eraseBtn: document.getElementById('btn-erase'),
            notesBtn: document.getElementById('btn-notes'),
            hintBtn: document.getElementById('btn-hint'),
            numpad: document.querySelectorAll('.num-btn'),
            modal: document.getElementById('game-over-modal'),
            modalTitle: document.getElementById('modal-title'),
            modalMessage: document.getElementById('modal-message'),
            restartBtn: document.getElementById('btn-restart'),
            appContainer: document.querySelector('.app-container')
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadTheme();
        this.startNewGame();
    }

    setupEventListeners() {
        this.dom.difficultySelect.addEventListener('change', (e) => {
            if (confirm('¿Iniciar nueva partida con esta dificultad?')) {
                this.difficulty = e.target.value;
                this.startNewGame();
                this.dom.level.textContent = e.target.options[e.target.selectedIndex].text;
            } else {
                e.target.value = this.difficulty;
            }
        });

        this.dom.themeToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleTheme();
        });

        this.dom.newGameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('¿Seguro que quieres empezar una nueva partida?')) {
                this.startNewGame();
            }
        });

        this.dom.restartBtn.addEventListener('click', () => {
            this.dom.modal.classList.add('hidden');
            this.startNewGame();
        });

        this.dom.board.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent global deselect
            const cell = e.target.closest('.cell');
            if (cell) {
                this.handleCellClick(parseInt(cell.dataset.index));
            }
        });

        // Numpad clicks
        this.dom.numpad.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const num = parseInt(btn.dataset.num);
                this.handleNumberInput(num);
            });
        });

        // Controls
        this.dom.undoBtn.addEventListener('click', (e) => { e.stopPropagation(); this.undo(); });
        this.dom.eraseBtn.addEventListener('click', (e) => { e.stopPropagation(); this.erase(); });
        this.dom.notesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleNotesMode();
        });
        this.dom.hintBtn.addEventListener('click', (e) => { e.stopPropagation(); this.useHint(); });

        // Global Deselection (Click outside)
        document.addEventListener('click', (e) => {
            // Check if click is inside app-container is not enough because controls are inside too.
            // We stopped propagation on all active elements, so if it reaches here and 
            // is not on a specific ignored area, we deselect.
            // Actually, simplest is: if we clicked on background (body) or outside the interactive parts.
            // But efficient way: stop propagation on interactive elements, let others bubble to document.
            if (!e.target.closest('.app-container')) {
                this.deselectAll();
            } else {
                // Even inside app container, if we click 'empty space' between buttons/board
                // we might want to deselect.
                // Let's rely on specific elements stopping propagation. 
                // If I click the main container background, I want deselect.
                if (e.target.classList.contains('app-container') || e.target.classList.contains('game-area') || e.target.classList.contains('header')) {
                    this.deselectAll();
                }
            }
        });

        // Keyboard support
        document.addEventListener('keydown', (e) => {
            if (this.isGameOver) return;

            if (e.key >= '1' && e.key <= '9') {
                this.handleKeyboardNumber(parseInt(e.key));
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
                this.erase();
            } else if (e.key === 'Escape') {
                this.deselectAll();
            } else if (e.key === 'ArrowUp') this.moveSelection(-9);
            else if (e.key === 'ArrowDown') this.moveSelection(9);
            else if (e.key === 'ArrowLeft') this.moveSelection(-1);
            else if (e.key === 'ArrowRight') this.moveSelection(1);
            else if (e.key.toLowerCase() === 'n') this.toggleNotesMode();
        });
    }

    toggleTheme() {
        const body = document.body;
        const currentTheme = body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', newTheme);

        const sun = document.querySelector('.sun-icon');
        const moon = document.querySelector('.moon-icon');
        if (newTheme === 'dark') {
            sun.style.display = 'none';
            moon.style.display = 'block';
        } else {
            sun.style.display = 'block';
            moon.style.display = 'none';
        }
        localStorage.setItem('theme', newTheme);
    }

    loadTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.setAttribute('data-theme', savedTheme);
        if (savedTheme === 'dark') {
            document.querySelector('.sun-icon').style.display = 'none';
            document.querySelector('.moon-icon').style.display = 'block';
        }
    }

    startNewGame() {
        this.isGameOver = false;
        this.mistakes = 0;
        this.updateMistakesDisplay();
        this.resetTimer();
        this.history = [];
        this.selectedCellIndex = -1;
        this.selectedNumber = null;
        this.notesMode = false;
        this.dom.notesBtn.querySelector('.toggle-indicator').textContent = 'OFF';
        this.dom.notesBtn.classList.remove('active');

        this.generateBoard();
        this.renderBoard();
        this.startTimer();
    }

    generateBoard() {
        let grid = Array(81).fill(0);
        this.fillDiagonalBoxes(grid);
        this.solveSudoku(grid);
        this.solution = [...grid];
        const attempts = this.difficulty === 'easy' ? 30 : this.difficulty === 'medium' ? 45 : 55;
        this.removeNumbers(grid, attempts);

        this.board = grid.map((val, index) => ({
            value: val === 0 ? null : val,
            fixed: val !== 0,
            notes: [],
            error: false
        }));
    }

    fillDiagonalBoxes(grid) {
        for (let i = 0; i < 9; i = i + 3) this.fillBox(grid, i, i);
    }

    fillBox(grid, row, col) {
        let num;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                do { num = Math.floor(Math.random() * 9) + 1; } while (!this.isSafeInBox(grid, row, col, num));
                grid[(row + i) * 9 + (col + j)] = num;
            }
        }
    }

    isSafeInBox(grid, rowStart, colStart, num) {
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                if (grid[(rowStart + i) * 9 + (colStart + j)] === num) return false;
        return true;
    }

    isSafe(grid, row, col, num) {
        for (let x = 0; x < 9; x++) if (grid[row * 9 + x] === num) return false;
        for (let x = 0; x < 9; x++) if (grid[x * 9 + col] === num) return false;
        let startRow = row - row % 3, startCol = col - col % 3;
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                if (grid[(startRow + i) * 9 + (startCol + j)] === num) return false;
        return true;
    }

    solveSudoku(grid) {
        for (let i = 0; i < 81; i++) {
            if (grid[i] === 0) {
                let row = Math.floor(i / 9);
                let col = i % 9;
                const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
                for (let num of nums) {
                    if (this.isSafe(grid, row, col, num)) {
                        grid[i] = num;
                        if (this.solveSudoku(grid)) return true;
                        grid[i] = 0;
                    }
                }
                return false;
            }
        }
        return true;
    }

    removeNumbers(grid, attempts) {
        while (attempts > 0) {
            let row = Math.floor(Math.random() * 9);
            let col = Math.floor(Math.random() * 9);
            let idx = row * 9 + col;
            while (grid[idx] === 0) {
                row = Math.floor(Math.random() * 9);
                col = Math.floor(Math.random() * 9);
                idx = row * 9 + col;
            }
            grid[idx] = 0;
            attempts--;
        }
    }

    renderBoard() {
        this.dom.board.innerHTML = '';
        this.updateNumpadState();

        this.board.forEach((cellData, index) => {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.index = index;

            if (cellData.fixed) {
                cell.classList.add('given');
                cell.textContent = cellData.value;
            } else if (cellData.value) {
                cell.classList.add('user-filled');
                cell.textContent = cellData.value;
            } else {
                const notesGrid = document.createElement('div');
                notesGrid.classList.add('notes-grid');
                [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(n => {
                    const note = document.createElement('div');
                    note.classList.add('note');
                    if (cellData.notes.includes(n)) note.textContent = n;
                    notesGrid.appendChild(note);
                });
                cell.appendChild(notesGrid);
            }

            if (cellData.error) cell.classList.add('error');

            // Selection Styling
            if (index === this.selectedCellIndex) {
                cell.classList.add('selected');
            }

            // Highlighting based on Selection OR Number Mode
            let highlightNumber = null;

            if (this.selectedNumber !== null) {
                highlightNumber = this.selectedNumber;
            } else if (this.selectedCellIndex !== -1) {
                const selectedVal = this.board[this.selectedCellIndex].value;
                if (selectedVal) highlightNumber = selectedVal;

                // Related Cell Highlighting (only if no specific number mode active for cleaner look, or maybe both?)
                // Let's keep related highlighting only for "Cell First" mode to differentiate.
                const r = Math.floor(index / 9), c = index % 9;
                const sr = Math.floor(this.selectedCellIndex / 9), sc = this.selectedCellIndex % 9;
                if (r === sr || c === sc ||
                    (Math.floor(r / 3) === Math.floor(sr / 3) && Math.floor(c / 3) === Math.floor(sc / 3))) {
                    if (index !== this.selectedCellIndex) cell.classList.add('highlighted');
                }
            }

            // Highlight all instances of the number
            if (highlightNumber !== null &&
                (cellData.value === highlightNumber || (cellData.fixed && cellData.value === highlightNumber))) {
                cell.classList.add('same-number');
            }

            this.dom.board.appendChild(cell);
        });
    }

    updateNumpadState() {
        this.dom.numpad.forEach(btn => {
            const num = parseInt(btn.dataset.num);
            if (num === this.selectedNumber) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // --- Interaction Logic ---

    handleCellClick(index) {
        if (this.isGameOver) return;

        // Mode 1: Number First (Active Number)
        if (this.selectedNumber !== null) {
            // Apply the number to this cell immediately
            this.applyNumberToCell(index, this.selectedNumber);
        } else {
            // Mode 2: Cell First (Classic)
            this.selectedCellIndex = index;
            this.renderBoard();
        }
    }

    handleNumberInput(num) {
        if (this.isGameOver) return;

        // Mode: Cell is selected -> Fill it (Classic)
        if (this.selectedCellIndex !== -1) {
            this.applyNumberToCell(this.selectedCellIndex, num);
            return;
        }

        // Mode: No cell selected -> Toggle Number Mode
        if (this.selectedNumber === num) {
            this.selectedNumber = null; // Deselect if same
        } else {
            this.selectedNumber = num;
        }
        this.renderBoard();
    }

    handleKeyboardNumber(num) {
        // Keyboard behaves like "Pressing Numpad"
        this.handleNumberInput(num);
    }

    applyNumberToCell(index, num) {
        const cell = this.board[index];
        if (cell.fixed) return;

        this.saveState();

        if (this.notesMode) {
            if (cell.notes.includes(num)) {
                cell.notes = cell.notes.filter(n => n !== num);
            } else {
                cell.notes.push(num);
                cell.notes.sort();
            }
            if (cell.value !== null) cell.value = null; // Switch to notes
        } else {
            if (cell.value === num) {
                cell.value = null; // Toggle off
            } else {
                cell.value = num;
                cell.notes = [];

                if (num !== this.solution[index]) {
                    cell.error = true;
                    this.mistakes++;
                    this.updateMistakesDisplay();
                    this.checkGameOver();
                } else {
                    cell.error = false;
                    this.checkWin();
                }
            }
        }
        this.renderBoard();
    }

    deselectAll() {
        this.selectedCellIndex = -1;
        this.selectedNumber = null;
        this.renderBoard();
    }

    moveSelection(delta) {
        // Only relevant for classic mode or keyboard nav
        // If we are in "Number First" mode, arrows probably shouldn't do much or should just move a phantom cursor?
        // Let's stick to: if a cell was selected, move it. If only number selected, maybe do nothing or switch to cell mode?
        // Let's assume arrows switch to cell selection mode starting from 0 or current

        if (this.selectedCellIndex === -1) {
            this.selectedCellIndex = 0;
            this.selectedNumber = null; // Switch to cell mode
        } else {
            let newIndex = this.selectedCellIndex + delta;
            if (newIndex >= 0 && newIndex < 81) {
                this.selectedCellIndex = newIndex;
                this.selectedNumber = null; // Switch to cell mode implies dropping number lock? 
                // Or maybe keep number lock but move cursor? The user said "Selecting highlighting cell... then press number".
                // If I move selection, I am "selecting a cell".
                // If I have a locked number, touching a cell fills it.
                // Moving with keyboard is "touching"? usually yes.
                // But for safety, let's say keyboard nav just moves selection highlight, user must press Enter or Number to fill?
                // Simplest: Arrows just selecting cell, clear Number Mode to avoid accidental fills.
            }
        }
        this.renderBoard();
    }

    erase() {
        // Only works if a cell is selected
        if (this.selectedCellIndex === -1 || this.isGameOver) return;
        const cell = this.board[this.selectedCellIndex];
        if (cell.fixed) return;

        this.saveState();
        cell.value = null;
        cell.notes = [];
        cell.error = false;
        this.renderBoard();
    }

    toggleNotesMode() {
        this.notesMode = !this.notesMode;
        const btn = this.dom.notesBtn;
        btn.classList.toggle('active', this.notesMode);
        btn.querySelector('.toggle-indicator').textContent = this.notesMode ? 'ON' : 'OFF';

        // As requested: "Si apagas el modo 'Notas', también se limpia la selección"
        if (!this.notesMode) {
            this.deselectAll();
        }
    }

    useHint() {
        if (this.isGameOver) return;
        const emptyIndices = this.board.map((c, i) => (c.value === null && !c.fixed) ? i : -1).filter(i => i !== -1);
        if (emptyIndices.length === 0) return;

        this.saveState();

        let targetIndex;
        if (this.selectedCellIndex !== -1 && !this.board[this.selectedCellIndex].fixed && !this.board[this.selectedCellIndex].value) {
            targetIndex = this.selectedCellIndex;
        } else {
            targetIndex = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
        }

        const visibleCell = this.board[targetIndex];
        visibleCell.value = this.solution[targetIndex];
        visibleCell.notes = [];
        visibleCell.error = false;

        // Select the revealed cell
        this.selectedCellIndex = targetIndex;
        this.selectedNumber = null; // Switch to cell mode
        this.renderBoard();
    }

    undo() {
        if (this.history.length === 0 || this.isGameOver) return;
        const prevState = this.history.pop();
        this.board = prevState.board;
        this.mistakes = prevState.mistakes;
        this.updateMistakesDisplay();
        this.renderBoard();
    }

    saveState() {
        if (this.history.length > 20) this.history.shift();
        this.history.push({
            board: JSON.parse(JSON.stringify(this.board)),
            mistakes: this.mistakes
        });
    }

    updateMistakesDisplay() {
        this.dom.mistakes.textContent = `${this.mistakes}/${this.maxMistakes}`;
        if (this.mistakes >= 2) this.dom.mistakes.style.color = 'var(--error)';
        else this.dom.mistakes.style.color = 'var(--text-primary)';
    }

    checkGameOver() {
        if (this.mistakes >= this.maxMistakes) {
            this.isGameOver = true;
            this.stopTimer();
            this.dom.modalTitle.textContent = "¡Juego Terminado!";
            this.dom.modalMessage.textContent = "Has cometido demasiados errores.";
            this.dom.modal.classList.remove('hidden');
        }
    }

    checkWin() {
        const isFull = this.board.every(cell => cell.value !== null);
        const noErrors = this.board.every(cell => !cell.error);
        if (isFull && noErrors) {
            this.isGameOver = true;
            this.stopTimer();
            this.dom.modalTitle.textContent = "¡Felicidades!";
            this.dom.modalMessage.textContent = `Has completado el nivel ${this.difficulty} en ${this.dom.timer.textContent}`;
            this.dom.modal.classList.remove('hidden');
        }
    }

    startTimer() {
        this.stopTimer();
        this.timer = 0;
        this.updateTimerDisplay();
        this.timerInterval = setInterval(() => {
            this.timer++;
            this.updateTimerDisplay();
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
    }

    resetTimer() {
        this.stopTimer();
        this.timer = 0;
        this.updateTimerDisplay();
    }

    updateTimerDisplay() {
        const min = Math.floor(this.timer / 60).toString().padStart(2, '0');
        const sec = (this.timer % 60).toString().padStart(2, '0');
        this.dom.timer.textContent = `${min}:${sec}`;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new SudokuGame();
});
