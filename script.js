// Firebase Configuration (Directly in file to support file:// protocol)
const firebaseConfig = {
    apiKey: "AIzaSyDy02OC8VwNPEu4-E8if0SgX4ApC48xpcI",
    authDomain: "sudoku-web-1af44.firebaseapp.com",
    projectId: "sudoku-web-1af44",
    storageBucket: "sudoku-web-1af44.firebasestorage.app",
    messagingSenderId: "949457141420",
    appId: "1:949457141420:web:cb4580c171e2e195d62909",
    measurementId: "G-C0Y9EBJN2L"
};

// Initialize Firebase (Compat Mode)
let db;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();

    // Enable Offline Persistence
    db.enablePersistence()
        .catch((err) => {
            if (err.code == 'failed-precondition') {
                console.log('Persistence failed: Multiple tabs open');
            } else if (err.code == 'unimplemented') {
                console.log('Persistence not supported');
            }
        });
} catch (e) {
    console.error("Firebase Initialization Error:", e);
    alert("Error conectando con la base de datos. El ranking online no funcionará.");
}

// Sound Manager using Web Audio API
class SoundManager {
    constructor() {
        this.context = null;
        this.enabled = true;
        this.masterGain = null;
    }

    init() {
        if (!this.enabled || this.context) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.context = new AudioContext();
            this.masterGain = this.context.createGain();
            this.masterGain.gain.value = 0.3; // Default volume
            this.masterGain.connect(this.context.destination);
        } catch (e) {
            console.warn("Web Audio API not supported", e);
        }
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.enabled && !this.context) this.init();
        return this.enabled;
    }

    playTone(freq, type, duration, startTime = 0, vol = 1) {
        if (!this.enabled || !this.context) return;

        // Resume context if suspended (browser auto-play policy)
        if (this.context.state === 'suspended') this.context.resume();

        const osc = this.context.createOscillator();
        const gain = this.context.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.context.currentTime + startTime);

        gain.gain.setValueAtTime(vol, this.context.currentTime + startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + startTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(this.context.currentTime + startTime);
        osc.stop(this.context.currentTime + startTime + duration);
    }

    playClick() {
        // Soft sine "bop"
        this.playTone(800, 'sine', 0.1, 0, 0.5);
    }

    playError() {
        // Buzzer: Low sawtooth
        this.playTone(150, 'sawtooth', 0.4, 0, 0.8);
        this.playTone(100, 'sawtooth', 0.4, 0.1, 0.8);
        this.vibrate(200); // Heavy impact
    }

    playSuccess() {
        // Chime: Major triad
        const now = 0;
        this.playTone(523.25, 'sine', 0.2, now, 0.6); // C5
        this.playTone(659.25, 'sine', 0.2, now + 0.1, 0.6); // E5
        this.playTone(783.99, 'sine', 0.4, now + 0.2, 0.6); // G5
        this.vibrate(50); // Light impact
    }

    playWin() {
        // Fanfare
        const now = 0;
        const notes = [
            { f: 523.25, t: 0, d: 0.2 }, // C
            { f: 523.25, t: 0.2, d: 0.2 }, // C
            { f: 523.25, t: 0.4, d: 0.2 }, // C
            { f: 659.25, t: 0.6, d: 0.4 }, // E
            { f: 783.99, t: 1.0, d: 0.4 }, // G
            { f: 1046.50, t: 1.4, d: 0.8 } // C6
        ];
        notes.forEach(n => this.playTone(n.f, 'triangle', n.d, n.t, 0.7));
    }

    vibrate(pattern) {
        if (this.enabled && navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    }
}

class SudokuGame {
    constructor() {
        this.board = Array(81).fill(null);
        this.solution = Array(81).fill(null);
        this.history = [];
        this.selectedCellIndex = -1;
        this.selectedNumber = null;
        this.mistakes = 0;
        this.maxMistakes = 3;
        this.notesMode = false;
        this.difficulty = 'easy';
        this.timer = 0;
        this.timerInterval = null;
        this.isGameOver = false;
        this.soundManager = new SoundManager();

        this.dom = {
            board: document.getElementById('sudoku-board'),
            mistakes: document.getElementById('mistakes-count'),
            timer: document.getElementById('timer'),
            level: document.getElementById('level-display'),
            difficultySelect: document.getElementById('difficulty-select'),
            themeToggle: document.getElementById('theme-toggle'),
            soundToggle: document.getElementById('sound-toggle'), // Added
            newGameBtn: document.getElementById('btn-new-game'),
            undoBtn: document.getElementById('btn-undo'),
            eraseBtn: document.getElementById('btn-erase'),
            notesBtn: document.getElementById('btn-notes'),
            hintBtn: document.getElementById('btn-hint'),
            numpad: document.querySelectorAll('.num-btn'),

            // Modals
            modal: document.getElementById('game-over-modal'),
            victoryModal: document.getElementById('victory-modal'),
            leaderboardModal: document.getElementById('leaderboard-modal'),

            // Modal Elements
            modalTitle: document.getElementById('modal-title'),
            modalMessage: document.getElementById('modal-message'),
            restartBtn: document.getElementById('btn-restart'),
            reviveBtn: document.getElementById('btn-revive'),

            // Victory & Leaderboard
            finalTime: document.getElementById('final-time'),
            playerName: document.getElementById('player-name'),
            saveScoreBtn: document.getElementById('btn-save-score'),
            leaderboardBtn: document.getElementById('btn-leaderboard'),
            closeLeaderboardBtn: document.getElementById('btn-close-leaderboard'),
            leaderboardList: document.querySelector('.leaderboard-list'),
            tabBtns: document.querySelectorAll('.tab-btn'),

            appContainer: document.querySelector('.app-container')
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadTheme();
        this.startNewGame();

        // Audio Init
        const initAudio = () => {
            if (this.soundManager) {
                this.soundManager.init();
                document.removeEventListener('click', initAudio);
                document.removeEventListener('keydown', initAudio);
            }
        };
        document.addEventListener('click', initAudio);
        document.addEventListener('keydown', initAudio);
    }

    setupEventListeners() {
        // Sound Toggle
        if (this.dom.soundToggle) {
            this.dom.soundToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isEnabled = this.soundManager.toggle();
                this.dom.soundToggle.querySelector('.sound-on').style.display = isEnabled ? 'block' : 'none';
                this.dom.soundToggle.querySelector('.sound-off').style.display = isEnabled ? 'none' : 'block';
            });
        }

        // Difficulty
        this.dom.difficultySelect.addEventListener('change', (e) => {
            if (confirm('¿Iniciar nueva partida con esta dificultad?')) {
                this.difficulty = e.target.value;
                this.startNewGame();
                this.dom.level.textContent = e.target.options[e.target.selectedIndex].text;
            } else {
                e.target.value = this.difficulty;
            }
        });

        // Theme
        this.dom.themeToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleTheme();
        });

        // Controls
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

        this.dom.reviveBtn.addEventListener('click', () => {
            this.reviveGame();
        });

        this.dom.board.addEventListener('click', (e) => {
            e.stopPropagation();
            const cell = e.target.closest('.cell');
            if (cell) this.handleCellClick(parseInt(cell.dataset.index));
        });

        this.dom.numpad.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleNumberInput(parseInt(btn.dataset.num));
            });
        });

        this.dom.undoBtn.addEventListener('click', (e) => { e.stopPropagation(); this.undo(); });
        this.dom.eraseBtn.addEventListener('click', (e) => { e.stopPropagation(); this.erase(); });
        this.dom.notesBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleNotesMode(); });
        this.dom.hintBtn.addEventListener('click', (e) => { e.stopPropagation(); this.useHint(); });

        // Leaderboard
        this.dom.leaderboardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showLeaderboard();
        });

        this.dom.closeLeaderboardBtn.addEventListener('click', () => {
            this.dom.leaderboardModal.classList.add('hidden');
        });

        this.dom.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.dom.tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderLeaderboardScores(btn.dataset.diff);
            });
        });

        this.dom.saveScoreBtn.addEventListener('click', () => {
            const name = this.dom.playerName.value.trim() || 'Anónimo';
            this.saveScore(name);
            this.dom.victoryModal.classList.add('hidden');
            this.showLeaderboard(this.difficulty);
        });

        // Global Deselect
        document.addEventListener('click', (e) => {
            if (!this.dom.modal.classList.contains('hidden') ||
                !this.dom.victoryModal.classList.contains('hidden') ||
                !this.dom.leaderboardModal.classList.contains('hidden')) return;

            if (!e.target.closest('.app-container')) {
                this.deselectAll();
            } else {
                if (e.target.classList.contains('app-container') || e.target.classList.contains('game-area') || e.target.classList.contains('header')) {
                    this.deselectAll();
                }
            }
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (this.isGameOver) return;
            if (e.key >= '1' && e.key <= '9') this.handleKeyboardNumber(parseInt(e.key));
            else if (e.key === 'Backspace' || e.key === 'Delete') this.erase();
            else if (e.key === 'Escape') this.deselectAll();
            else if (e.key === 'ArrowUp') this.moveSelection(-9);
            else if (e.key === 'ArrowDown') this.moveSelection(9);
            else if (e.key === 'ArrowLeft') this.moveSelection(-1);
            else if (e.key === 'ArrowRight') this.moveSelection(1);
            else if (e.key.toLowerCase() === 'n') this.toggleNotesMode();
        });
    }

    // ... Theme methods same as before ...
    toggleTheme() {
        const body = document.body;
        const currentTheme = body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', newTheme);
        const sun = document.querySelector('.sun-icon');
        const moon = document.querySelector('.moon-icon');
        if (newTheme === 'dark') { sun.style.display = 'none'; moon.style.display = 'block'; }
        else { sun.style.display = 'block'; moon.style.display = 'none'; }
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

    // ... Generator methods same as before ...
    generateBoard() {
        let grid = Array(81).fill(0);
        this.fillDiagonalBoxes(grid);
        this.solveSudoku(grid);
        this.solution = [...grid];
        const attempts = this.difficulty === 'easy' ? 30 : this.difficulty === 'medium' ? 40 : 55;
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
        for (let x = 9; x < 9; x++) if (grid[row * 9 + x] === num) return false; // Bug fix: x=0
        for (let x = 0; x < 9; x++) if (grid[row * 9 + x] === num) return false; // Corrected
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
        this.updateNumpadCounts();

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
            if (index === this.selectedCellIndex) cell.classList.add('selected');

            let highlightNumber = null;
            if (this.selectedNumber !== null) highlightNumber = this.selectedNumber;
            else if (this.selectedCellIndex !== -1) {
                const selectedVal = this.board[this.selectedCellIndex].value;
                if (selectedVal) highlightNumber = selectedVal;

                const r = Math.floor(index / 9), c = index % 9;
                const sr = Math.floor(this.selectedCellIndex / 9), sc = this.selectedCellIndex % 9;
                if (r === sr || c === sc ||
                    (Math.floor(r / 3) === Math.floor(sr / 3) && Math.floor(c / 3) === Math.floor(sc / 3))) {
                    if (index !== this.selectedCellIndex) cell.classList.add('highlighted');
                }
            }

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
            if (num === this.selectedNumber) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    updateNumpadCounts() {
        const counts = Array(10).fill(0); // Index 1-9
        this.board.forEach(cell => {
            if (cell.value) counts[cell.value]++;
        });

        this.dom.numpad.forEach(btn => {
            const num = parseInt(btn.dataset.num);
            const count = counts[num];
            const remaining = 9 - count;
            const countSpan = btn.querySelector('.num-count');

            if (countSpan) countSpan.textContent = remaining > 0 ? remaining : '';

            if (remaining <= 0) {
                btn.classList.add('completed');
            } else {
                btn.classList.remove('completed');
            }
        });
    }

    // --- Core Logic Updates ---

    handleCellClick(index) {
        if (this.isGameOver) return;
        this.soundManager.playClick();
        if (this.selectedNumber !== null) {
            this.applyNumberToCell(index, this.selectedNumber);
        } else {
            this.selectedCellIndex = index;
            this.renderBoard();
        }
    }

    handleNumberInput(num) {
        if (this.isGameOver) return;
        if (this.selectedCellIndex !== -1) {
            this.applyNumberToCell(this.selectedCellIndex, num);
            return;
        }
        if (this.selectedNumber === num) this.selectedNumber = null;
        else this.selectedNumber = num;
        this.renderBoard();
    }

    handleKeyboardNumber(num) {
        this.handleNumberInput(num);
    }



    // Smart Note Logic: Clears 'num' from notes in the same Row, Col, and Box
    clearRelatedNotes(index, num) {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const startRow = row - (row % 3);
        const startCol = col - (col % 3);

        // 1. Clear Row
        for (let c = 0; c < 9; c++) this.removeNoteFromCell(row * 9 + c, num);

        // 2. Clear Column
        for (let r = 0; r < 9; r++) this.removeNoteFromCell(r * 9 + col, num);

        // 3. Clear Box (Quadrant)
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                this.removeNoteFromCell((startRow + i) * 9 + (startCol + j), num);
            }
        }
    }

    removeNoteFromCell(idx, num) {
        if (idx < 0 || idx >= 81) return;
        const cell = this.board[idx];
        if (!cell.fixed && !cell.value && cell.notes.includes(num)) {
            cell.notes = cell.notes.filter(n => n !== num);
        }
    }

    applyNumberToCell(index, num) {
        const cell = this.board[index];
        if (cell.fixed) return;

        // Notes Mode Logic (unchanged)
        if (this.notesMode) {
            this.saveState();
            if (cell.notes.includes(num)) cell.notes = cell.notes.filter(n => n !== num);
            else { cell.notes.push(num); cell.notes.sort(); }
            if (cell.value !== null) cell.value = null;
            this.renderBoard();
            return;
        }

        // Standard Input Logic
        if (cell.value === num) {
            this.saveState();
            cell.value = null;
            this.renderBoard();
        } else {
            // Check Correctness FIRST
            if (num !== this.solution[index]) {
                // Incorrect: Penalty, Visual Feedback, Auto-Clear (No History Save)
                cell.value = num;
                cell.error = true;
                this.mistakes++;
                this.soundManager.playError();
                this.applyPenalty(10);
                this.updateMistakesDisplay();

                this.renderBoard();
                this.checkGameOver();

                // Auto-clear after 1s
                setTimeout(() => {
                    if (!this.isGameOver) {
                        cell.value = null;
                        cell.error = false;
                        this.renderBoard();
                    }
                }, 1000);

            } else {
                // Correct: Save State, apply value
                this.saveState();
                cell.value = num;
                cell.notes = [];
                cell.error = false;

                this.clearRelatedNotes(index, num); // Smart Notes: Auto-clear

                // Check for unit completion (Success Sound)
                if (this.checkUnitCompletion(index)) {
                    this.soundManager.playSuccess();
                } else {
                    this.soundManager.playClick();
                }

                this.checkWin();
                this.renderBoard();
            }
        }
    }

    checkUnitCompletion(index) {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const startRow = row - (row % 3);
        const startCol = col - (col % 3);

        // Check Row
        let rowComplete = true;
        for (let c = 0; c < 9; c++) {
            if (this.board[row * 9 + c].value === null) { rowComplete = false; break; }
        }
        if (rowComplete) return true;

        // Check Col
        let colComplete = true;
        for (let r = 0; r < 9; r++) {
            if (this.board[r * 9 + col].value === null) { colComplete = false; break; }
        }
        if (colComplete) return true;

        // Check Box
        let boxComplete = true;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (this.board[(startRow + i) * 9 + (startCol + j)].value === null) { boxComplete = false; break; }
            }
        }
        if (boxComplete) return true;

        return false;
    }


    applyPenalty(seconds) {
        this.timer += seconds;
        this.updateTimerDisplay();
        // Visual feedback
        this.dom.timer.classList.add('penalty-anim');
        setTimeout(() => this.dom.timer.classList.remove('penalty-anim'), 500);
    }

    reviveGame() {
        this.applyPenalty(30); // +30s "Cost"
        this.mistakes = 0; // Reset mistakes
        this.updateMistakesDisplay();
        this.isGameOver = false;

        // Clean up any fatal errors that caused the Game Over
        this.board.forEach(cell => {
            if (cell.error) {
                cell.value = null;
                cell.error = false;
                cell.notes = [];
            }
        });
        this.renderBoard();

        this.dom.modal.classList.add('hidden');
        this.startTimer();
    }

    deselectAll() {
        this.selectedCellIndex = -1;
        this.selectedNumber = null;
        this.renderBoard();
    }

    moveSelection(delta) {
        if (this.selectedCellIndex === -1) {
            this.selectedCellIndex = 0;
            this.selectedNumber = null;
        } else {
            let newIndex = this.selectedCellIndex + delta;
            if (newIndex >= 0 && newIndex < 81) {
                this.selectedCellIndex = newIndex;
                this.selectedNumber = null;
            }
        }
        this.renderBoard();
    }

    erase() {
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
        if (!this.notesMode) this.deselectAll();
    }

    useHint() {
        if (this.isGameOver) return;
        const emptyIndices = this.board.map((c, i) => (c.value === null && !c.fixed) ? i : -1).filter(i => i !== -1);
        if (emptyIndices.length === 0) return;

        this.saveState();
        this.applyPenalty(30);

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

        this.selectedCellIndex = targetIndex;
        this.selectedNumber = null;
        this.renderBoard();
    }

    undo() {
        if (this.history.length === 0 || this.isGameOver) return;
        const prevState = this.history.pop();
        this.board = prevState.board;
        // this.mistakes = prevState.mistakes; // REMOVED: Mistakes persist through undo
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
            // Show Victory Modal
            this.soundManager.playWin();
            this.dom.finalTime.textContent = this.dom.timer.textContent;
            this.dom.victoryModal.classList.remove('hidden');
        }
    }

    // --- Leaderboard Logic ---

    async saveScore(name) {
        const timeStr = this.dom.timer.textContent;
        const seconds = this.timer;
        const date = new Date().toISOString();

        // 1. Local Save (My Records)
        const localScores = JSON.parse(localStorage.getItem('sudokuResults')) || {};
        if (!localScores[this.difficulty]) localScores[this.difficulty] = [];

        const newScore = { name, timeStr, seconds, date };
        localScores[this.difficulty].push(newScore);
        localScores[this.difficulty].sort((a, b) => a.seconds - b.seconds);
        localScores[this.difficulty] = localScores[this.difficulty].slice(0, 100); // Keep top 100 locally
        localStorage.setItem('sudokuResults', JSON.stringify(localScores));

        // 2. Global Save (Firebase Compat)
        if (db) {
            try {
                await db.collection("scores").add({
                    name: name,
                    timeStr: timeStr,
                    seconds: seconds,
                    difficulty: this.difficulty,
                    date: date
                });
                console.log("Score saved to Firebase");
            } catch (e) {
                console.error("Error adding document: ", e);
            }
        }
    }

    showLeaderboard(defaultDiff = null) {
        this.dom.leaderboardModal.classList.remove('hidden');
        const diff = defaultDiff || this.difficulty;

        this.dom.tabBtns.forEach(btn => {
            if (btn.dataset.diff === diff) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        this.renderLeaderboardScores(diff);
    }

    async renderLeaderboardScores(difficulty) {
        this.dom.leaderboardList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-secondary)">Cargando...</div>';

        try {
            if (!db) throw new Error("Database not initialized");

            // Fetch Global Scores from Firebase (Compat)
            console.log(`Fetching scores for difficulty: ${difficulty}`);
            const querySnapshot = await db.collection("scores")
                .where("difficulty", "==", difficulty)
                .limit(100) // Fetch top 100 candidates to sort client-side
                .get();

            console.log(`Found ${querySnapshot.size} documents.`);

            let list = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                console.log('Datos recibidos de Firebase:', data); // Debug requested by user

                // Explicitly mapping fields as requested
                list.push({
                    name: data.name,
                    seconds: data.seconds,
                    timeStr: data.timeStr,
                    difficulty: data.difficulty,
                    date: data.date
                });
            });

            // Client-side Sort and Limit (Bypasses missing composite index error)
            list.sort((a, b) => a.seconds - b.seconds);
            list = list.slice(0, 20);

            console.log("Procesando lista final:", list);
            this.updateLeaderboardUI(list);

        } catch (error) {
            console.error("Error fetching global scores:", error);
            // Fallback to local
            this.dom.leaderboardList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-secondary)">Offline - Mostrando récords locales</div>';

            const scores = JSON.parse(localStorage.getItem('sudokuResults')) || {};
            const localList = scores[difficulty] || [];
            this.updateLeaderboardUI(localList);
        }
    }

    updateLeaderboardUI(list) {
        this.dom.leaderboardList.innerHTML = '';

        if (list.length === 0) {
            this.dom.leaderboardList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-secondary)">No hay puntuaciones aún.</div>';
            return;
        }

        list.forEach((score, index) => {
            const row = document.createElement('div');
            row.className = 'score-row';

            const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : '';
            const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;

            // Simple date formatting if available
            let dateStr = '';
            if (score.date) {
                const d = new Date(score.date);
                dateStr = `<span class="player-date">${d.toLocaleDateString()}</span>`;
            }

            row.innerHTML = `
                <span class="rank ${rankClass}">${rankIcon}</span>
                <span class="player-name">${score.name}</span>
                <span class="player-time" style="flex-grow:0; margin-left:10px;">${score.timeStr}</span>
                ${dateStr}
            `;
            this.dom.leaderboardList.appendChild(row);
        });
    }

    startTimer() {
        this.stopTimer();
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

// Start the game (Standard JS load)
new SudokuGame();
