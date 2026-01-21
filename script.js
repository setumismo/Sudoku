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
let auth;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();

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
        if (!this.enabled) return;
        if (!this.context) this.init(); // Lazy init on first sound
        if (!this.context) return;

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
        this.timerInterval = null;
        this.isGameOver = false;
        this.soundManager = new SoundManager();
        this.currentUserNick = 'Anónimo'; // New: Track user nick

        this.dom = {
            // ... filled in init()
        };

        this.init();
    }

    init() {
        this.dom = {
            // VIEWS
            homeView: document.getElementById('home-view'),
            gameView: document.getElementById('game-view'),
            appContainer: document.querySelector('.app-container'),

            // HOME Elements
            userDisplay: document.getElementById('user-nick-display'),
            freePlayBtn: document.getElementById('btn-free-play'),
            leaderboardHomeBtn: document.getElementById('leaderboard-home'), // NOTE: This ID was likely 'leaderboard-home' in footer, checking if I replaced it or if I should use the new one.
            // Actually, I added id="btn-home-leaderboard" in HTML just now. Let's use that.
            btnHomeLeaderboard: document.getElementById('btn-home-leaderboard'),
            difficultyButtons: document.querySelectorAll('.menu-btn[data-action="start"]'),

            // CHALLENGE Elements
            btnCreateChallenge: document.getElementById('btn-create-challenge'),
            btnJoinChallenge: document.getElementById('btn-join-challenge'),

            // GAME Elements (New Header)
            btnBackHome: document.getElementById('btn-back-home'),
            btnPause: document.getElementById('btn-pause'),
            pauseOverlay: document.getElementById('pause-overlay'),
            btnResume: document.getElementById('btn-resume'),

            // Common
            board: document.getElementById('sudoku-board'),
            mistakes: document.getElementById('mistakes-count'),
            timer: document.getElementById('timer'),
            level: document.getElementById('level-display'),

            // Old Controls kept in Game View
            // themeToggle: Removed from Game Header
            themeToggleHome: document.getElementById('theme-toggle-home'), // Home footer

            soundToggle: document.getElementById('sound-toggle'), // In game header
            // leaderboardBtn: Removed from Game Header
            difficultySelect: document.getElementById('difficulty-select'), // In Game Header

            undoBtn: document.getElementById('btn-undo'),
            eraseBtn: document.getElementById('btn-erase'),
            notesBtn: document.getElementById('btn-notes'),
            hintBtn: document.getElementById('btn-hint'),
            numpad: document.querySelectorAll('.num-btn'),

            // Modals
            modal: document.getElementById('game-over-modal'),
            victoryModal: document.getElementById('victory-modal'),
            leaderboardModal: document.getElementById('leaderboard-modal'),

            // Modal Action Buttons
            modalTitle: document.getElementById('modal-title'),
            modalMessage: document.getElementById('modal-message'),
            restartBtn: document.getElementById('btn-restart'),
            reviveBtn: document.getElementById('btn-revive'),
            finalTime: document.getElementById('final-time'),
            playerName: document.getElementById('player-name'),
            saveScoreBtn: document.getElementById('btn-save-score'),
            closeLeaderboardBtn: document.getElementById('btn-close-leaderboard'),
            leaderboardList: document.querySelector('.leaderboard-list'),
            tabBtns: document.querySelectorAll('.tab-btn'),
        };

        this.setupEventListeners();
        this.loadTheme();
        this.checkAuth();

        // Initial Audio Context
        const initAudio = () => {
            if (this.soundManager) {
                this.soundManager.init();
                document.removeEventListener('click', initAudio);
            }
        };
        document.addEventListener('click', initAudio);

        // Show Home by default
        this.showHome();
    }

    // --- NAVIGATION ---
    showHome() {
        this.dom.homeView.classList.remove('hidden');
        this.dom.gameView.classList.add('hidden');
        this.updateThemeIcons();
        this.stopTimer();
    }

    showGame() {
        this.dom.homeView.classList.add('hidden');
        this.dom.gameView.classList.remove('hidden');
        this.updateThemeIcons();
    }

    updateThemeIcons() {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        // Only home toggle exists now
        [this.dom.themeToggleHome].forEach(btn => {
            if (btn) {
                const sun = btn.querySelector('.sun-icon');
                const moon = btn.querySelector('.moon-icon');
                if (sun && moon) {
                    sun.style.display = isDark ? 'none' : 'block';
                    moon.style.display = isDark ? 'block' : 'none';
                }
            }
        });
    }

    setupEventListeners() {
        // --- HOME MENU LISTENERS ---

        // Difficulty Buttons (Copa Semanal)
        this.dom.difficultyButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const diff = btn.dataset.diff;
                this.difficulty = diff;
                this.startNewGame();
                this.showGame();
                if (this.dom.difficultySelect) this.dom.difficultySelect.value = diff;
                if (this.dom.level) this.dom.level.textContent = diff === 'easy' ? 'Fácil' : diff === 'medium' ? 'Medio' : 'Difícil';
            });
        });

        // Free Play
        if (this.dom.freePlayBtn) {
            this.dom.freePlayBtn.addEventListener('click', () => {
                this.difficulty = 'medium';
                this.startNewGame();
                this.showGame();
                if (this.dom.level) this.dom.level.textContent = 'Medio';
            });
        }

        // Leaderboard from Home (Footer Icon)
        // Removed leaderboardHomeBtn listener as it's replaced by btnHomeLeaderboard
        // if (this.dom.leaderboardHomeBtn) {
        //     this.dom.leaderboardHomeBtn.addEventListener('click', () => this.showLeaderboard());
        // }

        // Leaderboard from Home (New Main Button)
        if (this.dom.btnHomeLeaderboard) {
            this.dom.btnHomeLeaderboard.addEventListener('click', () => this.showLeaderboard());
        }

        // Theme Toggle (Home footer)
        if (this.dom.themeToggleHome) {
            this.dom.themeToggleHome.addEventListener('click', () => {
                this.toggleTheme();
                this.updateThemeIcons();
            });
        }

        // Difficulty Select in Header
        if (this.dom.difficultySelect) {
            this.dom.difficultySelect.addEventListener('change', (e) => {
                this.difficulty = e.target.value;
                this.startNewGame();
                // We do NOT call showGame() here as we are already there
            });
        }

        // Listeners para Reto Fantasma
        if (this.dom.btnCreateChallenge) {
            this.dom.btnCreateChallenge.addEventListener('click', () => this.handleCreateChallenge());
        }

        if (this.dom.btnJoinChallenge) {
            this.dom.btnJoinChallenge.addEventListener('click', () => this.handleJoinChallenge());
        }

        // --- GAME VIEW LISTENERS ---

        // Back to Menu
        this.dom.btnBackHome.addEventListener('click', () => {
            Swal.fire({
                title: '¿Abandonar partida?',
                text: "Se perderá el progreso actual.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí, salir',
                cancelButtonText: 'Cancelar',
                reverseButtons: true
            }).then((result) => {
                if (result.isConfirmed) {
                    this.showHome();
                }
            });
        });

        // Pause
        this.dom.btnPause.addEventListener('click', () => {
            this.stopTimer();
            this.dom.pauseOverlay.classList.remove('hidden');
        });

        // Resume (Overlay Button)
        this.dom.btnResume.addEventListener('click', () => {
            this.dom.pauseOverlay.classList.add('hidden');
            this.startTimer();
        });

        // Common
        /* themeToggle removed from game header */
        // if (this.dom.themeToggle) {
        //     this.dom.themeToggle.addEventListener('click', () => {
        //         this.toggleTheme();
        //         this.updateThemeIcons();
        //     });
        // }

        // ... (Existing Game Controls: Undo, Erase, Notes, Hint, Numpad) ...
        this.dom.undoBtn.addEventListener('click', (e) => { e.stopPropagation(); this.undo(); });
        this.dom.eraseBtn.addEventListener('click', (e) => { e.stopPropagation(); this.erase(); });
        this.dom.notesBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleNotesMode(); });
        this.dom.hintBtn.addEventListener('click', (e) => { e.stopPropagation(); this.useHint(); });

        this.dom.numpad.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleNumberInput(parseInt(btn.dataset.num));
            });
        });

        // Sound Toggle
        if (this.dom.soundToggle) {
            this.dom.soundToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isEnabled = this.soundManager.toggle();
                this.dom.soundToggle.querySelector('.sound-on').style.display = isEnabled ? 'block' : 'none';
                this.dom.soundToggle.querySelector('.sound-off').style.display = isEnabled ? 'none' : 'block';
            });
        }

        // Leaderboard within Game - REMOVED
        // if (this.dom.leaderboardBtn) {
        //     this.dom.leaderboardBtn.addEventListener('click', () => this.showLeaderboard());
        // }

        // Modals
        this.dom.restartBtn.addEventListener('click', () => { this.dom.modal.classList.add('hidden'); this.startNewGame(); });
        this.dom.reviveBtn.addEventListener('click', () => { this.reviveGame(); });
        this.dom.saveScoreBtn.addEventListener('click', () => {
            const inputName = this.dom.playerName.value.trim();
            const name = inputName || this.currentUserNick || 'Anónimo';
            this.saveScore(name);
            this.dom.victoryModal.classList.add('hidden');
            this.showLeaderboard(this.difficulty);
        });
        this.dom.closeLeaderboardBtn.addEventListener('click', () => { this.dom.leaderboardModal.classList.add('hidden'); });

        this.dom.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.dom.tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderLeaderboardScores(btn.dataset.diff);
            });
        });

        // Board Interactions
        this.dom.board.addEventListener('click', (e) => {
            e.stopPropagation();
            const cell = e.target.closest('.cell');
            if (cell) this.handleCellClick(parseInt(cell.dataset.index));
        });

        // Global Keyboard
        document.addEventListener('keydown', (e) => {
            if (!this.dom.gameView.classList.contains('hidden') && this.dom.modal.classList.contains('hidden')) {
                if (this.isGameOver) return;
                if (e.key >= '1' && e.key <= '9') this.handleKeyboardNumber(parseInt(e.key));
                else if (e.key === 'Backspace' || e.key === 'Delete') this.erase();
                else if (e.key === 'Escape') this.deselectAll();
                else if (e.key === 'ArrowUp') this.moveSelection(-9);
                else if (e.key === 'ArrowDown') this.moveSelection(9);
                else if (e.key === 'ArrowLeft') this.moveSelection(-1);
                else if (e.key === 'ArrowRight') this.moveSelection(1);
                else if (e.key.toLowerCase() === 'n') this.toggleNotesMode();
            }
        });

        // Click outside to deselect
        document.addEventListener('click', (e) => {
            // Only if in game view
            if (this.dom.gameView.classList.contains('hidden')) return;

            if (!e.target.closest('.app-container')) this.deselectAll();
            else if (e.target.classList.contains('game-area')) this.deselectAll();
        });
    }

    toggleTheme() {
        const body = document.body;
        const currentTheme = body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        // Visual updates handled by updateThemeIcons
    }

    loadTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.setAttribute('data-theme', savedTheme);
        // Initial visual update handled by init -> updateThemeIcons/showHome
    }

    // --- PRNG (Pseudo-Random Number Generator) ---
    seededRandom(a) {
        return function () {
            var t = a += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
    }

    random() {
        if (this.prng) return this.prng();
        return Math.random();
    }

    startNewGame(seed = null) {
        this.isGameOver = false;
        this.mistakes = 0;
        this.updateMistakesDisplay();
        this.resetTimer();
        this.history = [];
        this.selectedCellIndex = -1;
        this.selectedNumber = null;
        this.notesMode = false;
        if (this.dom.notesBtn) {
            this.dom.notesBtn.querySelector('.toggle-indicator').textContent = 'OFF';
            this.dom.notesBtn.classList.remove('active');
        }

        // Handle Seed
        this.currentSeed = seed;
        if (seed) {
            console.log(`Starting seeded game: ${seed}`);
            let seedNum = 0;
            for (let i = 0; i < seed.length; i++) {
                seedNum = ((seedNum << 5) - seedNum) + seed.charCodeAt(i);
                seedNum |= 0;
            }
            this.prng = this.seededRandom(seedNum);
        } else {
            console.log('Starting random game');
            this.prng = null;
        }

        // Sync UI select with internal state
        if (this.dom.difficultySelect) {
            this.dom.difficultySelect.value = this.difficulty;
        }
        if (this.dom.level) {
            this.dom.level.textContent = this.difficulty === 'easy' ? 'Fácil' : this.difficulty === 'medium' ? 'Medio' : 'Difícil';
        }

        this.generateBoard();
        this.renderBoard();
        this.startTimer();
    }

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
                do { num = Math.floor(this.random() * 9) + 1; } while (!this.isSafeInBox(grid, row, col, num));
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
                    cell.classList.add('note'); // Corrected note class application? No, note is child
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

    clearRelatedNotes(index, num) {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const startRow = row - (row % 3);
        const startCol = col - (col % 3);

        for (let c = 0; c < 9; c++) this.removeNoteFromCell(row * 9 + c, num);
        for (let r = 0; r < 9; r++) this.removeNoteFromCell(r * 9 + col, num);
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

        if (this.notesMode) {
            this.saveState();
            if (cell.notes.includes(num)) cell.notes = cell.notes.filter(n => n !== num);
            else { cell.notes.push(num); cell.notes.sort(); }
            if (cell.value !== null) cell.value = null;
            this.renderBoard();
            return;
        }

        if (cell.value === num) {
            this.saveState();
            cell.value = null;
            this.renderBoard();
        } else {
            if (num !== this.solution[index]) {
                cell.value = num;
                cell.error = true;
                this.mistakes++;
                this.soundManager.playError();
                this.applyPenalty(10);
                this.updateMistakesDisplay();
                this.renderBoard();
                this.checkGameOver();
                setTimeout(() => {
                    if (!this.isGameOver) {
                        cell.value = null;
                        cell.error = false;
                        this.renderBoard();
                    }
                }, 1000);
            } else {
                this.saveState();
                cell.value = num;
                cell.notes = [];
                cell.error = false;
                this.clearRelatedNotes(index, num);
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

        let rowComplete = true;
        for (let c = 0; c < 9; c++) {
            if (this.board[row * 9 + c].value === null) { rowComplete = false; break; }
        }
        if (rowComplete) return true;

        let colComplete = true;
        for (let r = 0; r < 9; r++) {
            if (this.board[r * 9 + col].value === null) { colComplete = false; break; }
        }
        if (colComplete) return true;

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
        this.dom.timer.classList.add('penalty-anim');
        setTimeout(() => this.dom.timer.classList.remove('penalty-anim'), 500);
    }

    reviveGame() {
        this.applyPenalty(30);
        this.mistakes = 0;
        this.updateMistakesDisplay();
        this.isGameOver = false;
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
            this.soundManager.playWin();
            this.dom.finalTime.textContent = this.dom.timer.textContent;
            this.dom.victoryModal.classList.remove('hidden');
        }
    }

    checkAuth() {
        if (!auth) return;
        auth.onAuthStateChanged((user) => {
            if (user) {
                db.collection('users').doc(user.uid).get().then((doc) => {
                    if (doc.exists) {
                        this.currentUserNick = doc.data().nick;
                        console.log("Welcome back:", this.currentUserNick);
                        this.updateUserDisplay();
                    } else {
                        console.warn("Profile missing. Re-starting flow.");
                        this.handleFirstLogin();
                    }
                }).catch(e => {
                    console.error("Auth Error:", e);
                    this.handleFirstLogin();
                });
            } else {
                this.handleFirstLogin();
            }
        });
    }

    async handleFirstLogin() {
        let isValid = false;
        let finalNick = "";

        while (!isValid) {
            const { value: nickname } = await Swal.fire({
                title: 'Bienvenido a Sudoku',
                text: 'Elige un nombre único para el ranking',
                input: 'text',
                inputPlaceholder: 'Tu Nick',
                allowOutsideClick: false,
                allowEscapeKey: false,
                confirmButtonText: 'Jugar',
                inputValidator: (value) => {
                    if (!value) return '¡Debes escribir un nombre!';
                    if (value.length < 3) return 'Mínimo 3 caracteres';
                    if (value.length > 12) return 'Máximo 12 caracteres';
                }
            });

            if (nickname) {
                Swal.showLoading();
                try {
                    const snapshot = await db.collection('users').where('nick', '==', nickname).get();
                    if (!snapshot.empty) {
                        await Swal.fire({
                            icon: 'error',
                            title: 'Nombre ocupado',
                            text: `El nick "${nickname}" ya existe. Por favor elige otro.`
                        });
                    } else {
                        isValid = true;
                        finalNick = nickname;
                    }
                } catch (error) {
                    console.error("Check Error:", error);
                    await Swal.fire("Error", "No se pudo verificar el nombre. Intenta de nuevo.", "error");
                }
            }
        }

        try {
            const result = await auth.signInAnonymously();
            const user = result.user;

            await db.collection('users').doc(user.uid).set({
                uid: user.uid,
                nick: finalNick,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            this.currentUserNick = finalNick;
            this.updateUserDisplay();

            Swal.fire({
                icon: 'success',
                title: `¡Bienvenido, ${finalNick}!`,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });

        } catch (error) {
            console.error("Login Fatal Error:", error);
            Swal.fire("Error Crítico", "No se pudo crear la cuenta: " + error.message, "error");
        }
    }

    updateUserDisplay() {
        if (this.dom.userDisplay && this.currentUserNick) {
            this.dom.userDisplay.textContent = `Hola, ${this.currentUserNick}`;
        }
        if (this.dom.playerName) {
            this.dom.playerName.value = this.currentUserNick;
            this.dom.playerName.disabled = true;
        }
    }

    async saveScore(name) {
        const timeStr = this.dom.timer.textContent;
        const seconds = this.timer;
        const date = new Date().toISOString();

        const localScores = JSON.parse(localStorage.getItem('sudokuResults')) || {};
        if (!localScores[this.difficulty]) localScores[this.difficulty] = [];

        const newScore = { name, timeStr, seconds, date };
        localScores[this.difficulty].push(newScore);
        localScores[this.difficulty].sort((a, b) => a.seconds - b.seconds);
        localScores[this.difficulty] = localScores[this.difficulty].slice(0, 100);
        localStorage.setItem('sudokuResults', JSON.stringify(localScores));

        if (db) {
            try {
                const scoreData = {
                    name: name,
                    timeStr: timeStr,
                    seconds: seconds,
                    difficulty: this.difficulty,
                    date: date
                };
                if (auth && auth.currentUser) {
                    scoreData.uid = auth.currentUser.uid;
                }
                await db.collection("scores").add(scoreData);
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

            console.log(`Fetching scores for difficulty: ${difficulty}`);
            const querySnapshot = await db.collection("scores")
                .where("difficulty", "==", difficulty)
                .limit(100)
                .get();

            let list = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                list.push({
                    name: data.name,
                    seconds: data.seconds,
                    timeStr: data.timeStr,
                    difficulty: data.difficulty,
                    date: data.date
                });
            });

            list.sort((a, b) => a.seconds - b.seconds);
            list = list.slice(0, 20);
            this.updateLeaderboardUI(list);

        } catch (error) {
            console.error("Error fetching global scores:", error);
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

    // --- CHALLENGE LOGIC ---

    async handleCreateChallenge() {
        // 1. Ask Difficulty
        const { value: finalDiff } = await Swal.fire({
            title: 'Crear Reto Fantasma',
            input: 'radio',
            inputOptions: {
                'easy': 'Fácil 🟢',
                'medium': 'Medio 🟡',
                'hard': 'Difícil 🔴'
            },
            inputValue: 'medium',
            confirmButtonText: 'Generar Código',
            confirmButtonColor: '#4c6ef5'
        });

        if (!finalDiff) return;

        // 2. Generate Code & Seed
        const code = this.generateChallengeCode();
        const seed = Math.random().toString(36).substring(2, 15);
        const userId = (firebase.auth().currentUser && firebase.auth().currentUser.uid) || 'anon';

        Swal.fire({
            title: 'Generando Reto...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            // 3. Save to Firestore
            await db.collection('challenges').doc(code).set({
                code: code,
                seed: seed,
                difficulty: finalDiff,
                createdBy: userId,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // 4. Show Code
            Swal.fire({
                title: '¡Reto Creado!',
                html: `
                    <p style="margin-bottom:10px;">Comparte este código:</p>
                    <div style="background:#f0f2f5; padding:15px; border-radius:10px; font-size:2rem; font-weight:800; letter-spacing:5px; color:#4c6ef5; border: 2px dashed #4c6ef5;">
                        ${code}
                    </div>
                `,
                icon: 'success',
                confirmButtonText: 'Empezar Partida',
                footer: 'Tu amigo jugará el mismo tablero.'
            }).then(() => {
                this.difficulty = finalDiff;
                this.startNewGame(seed);
                this.showGame();
            });

        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'No se pudo crear el reto. Inténtalo de nuevo.', 'error');
        }
    }

    async handleJoinChallenge() {
        const { value: code } = await Swal.fire({
            title: 'Unirse a Reto',
            input: 'text',
            inputLabel: 'Introduce el Código',
            inputPlaceholder: 'Ej: X9P2',
            showCancelButton: true,
            confirmButtonText: 'Buscar y Jugar',
            confirmButtonColor: '#4c6ef5',
            inputValidator: (value) => {
                if (!value) return '¡Escribe el código!';
            }
        });

        if (code) {
            Swal.fire({
                title: 'Buscando...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            try {
                const doc = await db.collection('challenges').doc(code.toUpperCase().trim()).get();
                if (doc.exists) {
                    const data = doc.data();
                    Swal.fire({
                        title: '¡Encontrado!',
                        text: `Dificultad: ${data.difficulty.toUpperCase()}`,
                        icon: 'success',
                        timer: 1500,
                        showConfirmButton: false
                    }).then(() => {
                        this.difficulty = data.difficulty;
                        this.startNewGame(data.seed);
                        this.showGame();
                    });
                } else {
                    Swal.fire('Error', 'Código inválido o no existe.', 'error');
                }
            } catch (error) {
                console.error(error);
                Swal.fire('Error', 'Fallo de conexión.', 'error');
            }
        }
    }

    generateChallengeCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
}

// Start the game (Standard JS load)
new SudokuGame();
