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
        this.currentChallengeCode = null; // New: Track active challenge
        this.currentScoreId = null; // New: Track Firestore score doc ID

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
            soundToggle: document.getElementById('sound-toggle-home'), // Now in Home footer
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

            // Footer Elements
        };
        this.setupEventListeners();
        this.loadTheme();
        this.checkAuth();
        this.initAuth(); // Bind hybrid auth buttons

        // Show Home by default
        this.showHome();
    }

    // --- NAVIGATION ---
    showHome() {
        this.dom.homeView.classList.remove('hidden');
        this.dom.gameView.classList.add('hidden');

        // Ensure New Game button is hidden in Home
        const footer = document.getElementById('game-footer');
        if (footer) footer.classList.add('hidden');

        this.updateThemeIcons();
        this.stopTimer();

        // Optimistic Update: If we just finished a daily game, mark it immediately
        if (this.isGameOver && this.currentChallengeCode && this.currentChallengeCode.startsWith('DAILY-')) {
            const parts = this.currentChallengeCode.split('-'); // DAILY, YYYY, MM, DD, DIFF
            const diff = parts[parts.length - 1].toLowerCase();
            const btn = document.querySelector(`.menu-btn.${diff}[data-action="start"]`);
            if (btn) {
                btn.disabled = true;
                btn.classList.add('completed-daily');
                btn.innerHTML = `
                    <span class="btn-icon">✅</span>
                    <div style="display:flex; flex-direction:column; line-height:1.2;">
                        <span>${diff === 'easy' ? 'Fácil' : diff === 'medium' ? 'Medio' : 'Difícil'}</span>
                        <span style="font-size:0.8em; font-weight:normal;">Completado</span>
                    </div>
                 `;
                btn.style.borderColor = '#48bb78';
                btn.style.color = '#48bb78';
                btn.style.opacity = '0.8';
                btn.style.cursor = 'default';
            }
        }

        // Check Daily Status checking (Server validaton)
        this.checkDailyStatus();
    }

    async checkDailyStatus() {
        if (!auth || !auth.currentUser || !db) return;

        const uid = auth.currentUser.uid;

        const difficulties = ['easy', 'medium', 'hard'];
        for (const diff of difficulties) {
            const dailySeed = this.getDailySeed(diff);
            // DEBUG LOGS
            console.log(`Checking status for ${diff}:`, { uid, dailySeed });

            try {
                // We check if we have a local record FIRST for speed/offline
                const snapshot = await db.collection('scores')
                    .where('uid', '==', uid)
                    .where('challengeId', '==', dailySeed)
                    .where('status', '==', 'finished') // FIX: Only block if actually finished
                    .limit(1)
                    .get();

                if (!snapshot.empty) {
                    console.log(`Found existing score for ${diff}`);
                    const btn = document.querySelector(`.menu-btn.${diff}[data-action="start"]`);
                    if (btn) {
                        const data = snapshot.docs[0].data();
                        btn.disabled = true;
                        btn.classList.add('completed-daily');
                        btn.innerHTML = `
                            <span class="btn-icon">✅</span>
                            <div style="display:flex; flex-direction:column; line-height:1.2;">
                                <span>${diff === 'easy' ? 'Fácil' : diff === 'medium' ? 'Medio' : 'Difícil'}</span>
                                <span style="font-size:0.8em; font-weight:normal;">${data.timeStr}</span>
                            </div>
                        `;
                        btn.style.borderColor = '#48bb78';
                        btn.style.color = '#48bb78';
                        btn.style.opacity = '0.8';
                        btn.style.cursor = 'default';
                    }
                } else {
                    console.log(`No score found for ${diff}`);
                }
            } catch (e) {
                console.log("Error checking daily status:", e);
            }
        }
    }

    showDailyLeaderboard() {
        Swal.fire({
            title: '🏆 Clasificación',
            html: `
                <div style="margin-bottom:15px; display:flex; justify-content:center;">
                    <select id="swal-week-select" class="swal2-input" style="width:auto; margin:0;" onchange="window.gameInstance.onSwalWeekChange(this.value)">
                        <option value="current">📅 Semana Actual</option>
                        <option value="previous">⏮️ Semana Pasada</option>
                    </select>
                </div>
                
                <div style="display:flex; justify-content:center; gap:10px; margin-bottom:15px;">
                     <button id="view-mode-daily" class="tab-btn active" style="flex:1;" onclick="window.gameInstance.switchRankingMode('daily')">📅 Diario</button>
                     <button id="view-mode-weekly" class="tab-btn" style="flex:1;" onclick="window.gameInstance.switchRankingMode('weekly')">📅 Semanal</button>
                </div>
                
                <div class="tabs" style="margin-bottom:15px; display:flex; gap:10px; justify-content:center;">
                    <button id="tab-daily-easy" class="tab-btn active" onclick="window.gameInstance.loadRankingTab('easy')">Fácil</button>
                    <button id="tab-daily-medium" class="tab-btn" onclick="window.gameInstance.loadRankingTab('medium')">Medio</button>
                    <button id="tab-daily-hard" class="tab-btn" onclick="window.gameInstance.loadRankingTab('hard')">Difícil</button>
                </div>

                <div id="ranking-list" style="max-height:300px; overflow-y:auto; text-align:left;">
                    <p style="text-align:center;">Cargando...</p>
                </div>
            `,
            showConfirmButton: false,
            showCloseButton: true,
            didOpen: () => {
                this.currentRankingMode = 'daily';
                this.currentRankingDiff = 'easy';
                this.currentSwalWeekOffset = 0; // Default current week
                this.loadRankingTab('easy');
            }
        });
    }

    onSwalWeekChange(value) {
        this.currentSwalWeekOffset = (value === 'previous') ? 1 : 0;
        this.loadRankingTab(this.currentRankingDiff);
    }

    switchRankingMode(mode) {
        this.currentRankingMode = mode;
        document.getElementById('view-mode-daily').classList.toggle('active', mode === 'daily');
        document.getElementById('view-mode-weekly').classList.toggle('active', mode === 'weekly');
        this.loadRankingTab(this.currentRankingDiff);
    }

    async loadRankingTab(diff) {
        this.currentRankingDiff = diff;
        // Update tabs visual
        document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.getElementById(`tab-daily-${diff}`);
        if (activeBtn) activeBtn.classList.add('active');

        const listContainer = document.getElementById('ranking-list');
        listContainer.innerHTML = '<p style="text-align:center; color:#888;">Cargando...</p>';

        if (this.currentRankingMode === 'daily') {
            await this.loadDailyData(diff, listContainer);
        } else {
            await this.loadWeeklyData(diff, listContainer, this.currentSwalWeekOffset || 0);
        }
    }

    async loadDailyData(diff, container) {
        // Daily data logic typically usually implies TODAY. 
        // If we want "Previous Week Daily Data", we might need more complex UI (Select Day).
        // For now, assuming Daily Tab always shows TODAY's ranking regardless of week selector (or we disable week selector for daily).
        // User request specifically mentioned "Weekly Season", implying the week selector affects the Weekly Cup accumulation.

        const dailySeed = this.getDailySeed(diff);
        try {
            const snapshot = await db.collection('scores')
                .where('challengeId', '==', dailySeed)
                .where('status', '==', 'finished')
                .orderBy('seconds', 'asc')
                .limit(50)
                .get();

            if (snapshot.empty) {
                container.innerHTML = '<p style="text-align:center; padding:20px; color:#aaa;">Nadie ha completado este nivel hoy.</p>';
                return;
            }

            let html = '';
            snapshot.docs.forEach((doc, index) => {
                const s = doc.data();
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
                html += `
                    <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; align-items:center;">
                        <div>
                            <span style="font-size:1.2em; margin-right:8px;">${medal}</span>
                            <span style="font-weight:bold; color:#2d3748;">${s.name || s.nick || 'Anónimo'}</span>
                        </div>
                        <span style="font-family:monospace; color:#4c6ef5; font-weight:bold;">${s.timeStr}</span>
                    </div>
                `;
            });
            container.innerHTML = html;
        } catch (e) {
            console.error(e);
            container.innerHTML = `<p style="color:red; text-align:center;">Error: ${e.message}</p>`;
        }
    }

    async loadWeeklyData(diff, container, weekOffset = 0) {
        try {
            // 1. Calculate correct week's challenge IDs
            // We need to shift the "current date" back by weekOffset weeks
            const referenceDate = new Date();
            referenceDate.setDate(referenceDate.getDate() - (weekOffset * 7));

            // Helper to get monotonic IDs for that specific week
            const ids = this.getWeeklyChallengeIdsForDate(diff, referenceDate);
            const dates = this.getDatesForWeekOf(referenceDate);

            // Fetch ALL scores for the week
            const snapshot = await db.collection('scores')
                .where('challengeId', 'in', ids)
                .where('status', '==', 'finished')
                .get();

            // 1. Process Max Times per Day (for penalties)
            const dayMaxTimes = {}; // { challengeId: maxSeconds } OR null if no one played
            const dayStats = {}; // { challengeId: { count: 0, date: Date } }

            // Init stats
            ids.forEach((id, idx) => {
                dayStats[id] = { date: dates[idx], present: false };
                dayMaxTimes[id] = null; // Default null (no one played)
            });

            snapshot.docs.forEach(doc => {
                const d = doc.data();
                const cid = d.challengeId;
                if (dayStats[cid]) dayStats[cid].present = true;

                // Track max time
                if (dayMaxTimes[cid] === null || d.seconds > dayMaxTimes[cid]) {
                    dayMaxTimes[cid] = d.seconds;
                }
            });

            // 2. Group by User
            const users = {}; // { uid: { nick: '', totalSeconds: 0, days: {}, penalized: false } }

            snapshot.docs.forEach(doc => {
                const d = doc.data();
                const uid = d.uid || d.nick; // Fallback to nick if uid missing (legacy)

                if (!users[uid]) {
                    users[uid] = {
                        nick: d.nick || d.name,
                        totalSeconds: 0,
                        days: {},
                        penalized: false,
                        uid: uid
                    };
                }
                users[uid].days[d.challengeId] = d.seconds;
            });

            // 3. Calc Totals & Penalties
            // NEW: Penalty base addition based on difficulty
            let penaltyAdd = 0;
            if (diff === 'easy') penaltyAdd = 5;
            else if (diff === 'medium') penaltyAdd = 10;
            else if (diff === 'hard') penaltyAdd = 15;

            const rankedUsers = Object.values(users).map(u => {
                let total = 0;
                let isPenalized = false;

                ids.forEach(id => {
                    if (u.days[id]) {
                        total += u.days[id];
                    } else {
                        // PENALTY LOGIC:
                        // Only penalize if SOMEONE played that day (dayMaxTimes[id] !== null)
                        if (dayMaxTimes[id] !== null) {
                            const pTime = dayMaxTimes[id] + penaltyAdd;
                            total += pTime;
                            isPenalized = true;
                            u.days[id] = -pTime; // Use negative to signal penalty value
                        } else {
                            // No one played => 0 penalty
                            u.days[id] = 0;
                        }
                    }
                });

                u.totalSeconds = total;
                u.penalized = isPenalized;
                return u;
            });

            // 4. Sort
            rankedUsers.sort((a, b) => a.totalSeconds - b.totalSeconds);

            // 5. Render
            if (rankedUsers.length === 0) {
                container.innerHTML = '<p style="text-align:center; padding:20px; color:#aaa;">No hay datos esta semana.</p>';
                return;
            }

            let html = '<div class="accordion-list">';
            rankedUsers.forEach((u, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                const timeStr = this.formatTime(u.totalSeconds);
                const color = u.penalized ? '#e53e3e' : '#2d3748';
                const warning = u.penalized ? '⚠️' : '';

                // Details HTML
                let details = '';
                ids.forEach((id, idx) => {
                    const dayName = dates[idx].toLocaleDateString('es-ES', { weekday: 'long' });
                    const val = u.days[id];

                    let valStr = '';
                    if (val > 0) {
                        // Played
                        valStr = this.formatTime(val);
                    } else if (val < 0) {
                        // Penalty (stored as negative)
                        valStr = `<span style="color:#e53e3e">No jugado (+${this.formatTime(-val)})</span>`;
                    } else {
                        // 0 => No one played
                        valStr = `<span style="color:#718096">Nadie jugó (0s)</span>`;
                    }

                    details += `<div style="display:flex; justify-content:space-between; font-size:0.9em; padding:2px 0;">
                        <span style="text-transform:capitalize">${dayName}</span>
                        <span>${valStr}</span>
                    </div>`;
                });

                html += `
                    <div class="accordion-item" style="border-bottom:1px solid #eee;">
                        <div class="accordion-header" style="display:flex; justify-content:space-between; padding:10px; cursor:pointer;" onclick="this.nextElementSibling.classList.toggle('hidden')">
                            <div style="display:flex; align-items:center;">
                                <span style="font-size:1.2em; margin-right:8px; width:25px;">${medal}</span>
                                <b>${u.nick}</b>
                            </div>
                            <div style="text-align:right;">
                                <span style="font-family:monospace; font-weight:bold; color:${color};">${timeStr}${warning}</span>
                            </div>
                        </div>
                        <div class="accordion-content hidden" style="padding:5px 10px 10px 45px; background:#f9f9f9; color:#666;">
                            ${details}
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;

        } catch (e) {
            console.error(e);
            container.innerHTML = `<p style="color:red; text-align:center;">Error: ${e.message}</p>`;
        }
    }

    formatTime(seconds) {
        const min = Math.floor(seconds / 60).toString().padStart(2, '0');
        const sec = (seconds % 60).toString().padStart(2, '0');
        return `${min}:${sec}`;
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
                if (btn.disabled) return; // Prevent clicking if already played

                const dailySeed = this.getDailySeed(diff);
                this.difficulty = diff;
                // Pass the dailySeed as the seed, and ALSO as the challengeCode (logic reused for ID)
                this.startNewGame(dailySeed, dailySeed);
                this.showGame();
                if (this.dom.difficultySelect) this.dom.difficultySelect.value = diff;
                if (this.dom.level) this.dom.level.textContent = diff === 'easy' ? 'Fácil' : diff === 'medium' ? 'Medio' : 'Difícil';
            });
        });

        // Free Play Difficulty Buttons
        const freePlayBtns = document.querySelectorAll('.menu-btn[data-action="free-play"]');
        if (freePlayBtns.length > 0) {
            freePlayBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const diff = btn.dataset.diff;
                    this.difficulty = diff;
                    // Pass NULL as seed to ensure random generation
                    this.startNewGame(null, null);
                    this.showGame();
                    // Update UI Labels
                    if (this.dom.difficultySelect) this.dom.difficultySelect.value = diff;
                    if (this.dom.level) this.dom.level.textContent = diff === 'easy' ? 'Fácil' : diff === 'medium' ? 'Medio' : 'Difícil';
                });
            });
        }

        // Old Free Play Button (Legacy check, creating if exists)
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

        const btnExplore = document.getElementById('btn-explore-challenges');
        if (btnExplore) {
            btnExplore.addEventListener('click', () => this.showChallengeExplorer());
        }

        const btnDailyRanking = document.getElementById('btn-daily-ranking');
        if (btnDailyRanking) {
            btnDailyRanking.addEventListener('click', () => this.showDailyLeaderboard());
        }

        // --- GAME VIEW LISTENERS ---

        // Back to Menu
        this.dom.btnBackHome.addEventListener('click', () => {
            if (this.isGameOver) {
                this.showHome();
                return;
            }
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
        // Sound Toggle (Home Footer)
        if (this.dom.soundToggle) {
            this.dom.soundToggle.addEventListener('click', (e) => {
                const isEnabled = this.soundManager.toggle();
                const icon = document.getElementById('sound-icon-display');
                if (icon) icon.textContent = isEnabled ? '🔊' : '🔇';
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

        // NEW: Week Selector Listener
        const weekSelect = document.getElementById('leaderboard-week-select');
        if (weekSelect) {
            weekSelect.addEventListener('change', (e) => {
                const offset = e.target.value === 'previous' ? 1 : 0;
                // Reload ranking with chosen week and current difficulty
                // We need to store current diff to reload correctly
                const currentDiff = this.currentLeaderboardDiff || 'easy';
                this.renderLeaderboardScores(currentDiff, offset);
            });
        }

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
        // Click outside to deselect
        document.addEventListener('click', (e) => {
            // Only if in game view
            if (this.dom.gameView.classList.contains('hidden')) return;

            // If clicking inside board or numpad or controls, ignore (handled by their own listeners)
            if (e.target.closest('.sudoku-board') ||
                e.target.closest('.numpad') ||
                e.target.closest('.controls-area') ||
                e.target.closest('.header') || // Header buttons like Toggle/Pause
                e.target.closest('.swal2-container')) { // SweetAlert
                return;
            }

            // Otherwise, deselect
            this.deselectAll();
        });

        // New Game Big Button
        if (this.dom.btnNewGameBig) {
            this.dom.btnNewGameBig.addEventListener('click', () => {
                Swal.fire({
                    title: '¿Nueva Partida?',
                    text: "Se perderá el progreso actual.",
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, empezar',
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: '#1cb0f6',
                }).then((result) => {
                    if (result.isConfirmed) {
                        this.startNewGame();
                    }
                });
            });
        }
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
    // Algoritmo de Hashing robusto (Convierte String -> Estado Numérico)
    xmur3(str) {
        let h = 1779033703 ^ str.length;
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
            h = h << 13 | h >>> 19;
        }
        return function () {
            h = Math.imul(h ^ (h >>> 16), 2246822507);
            h = Math.imul(h ^ (h >>> 13), 3266489909);
            return (h ^= h >>> 16) >>> 0;
        }
    }

    // Generador Mulberry32 (Estándar determinista)
    seededRandom(seedString) {
        // Usamos xmur3 para obtener una semilla numérica válida desde el string
        const seedFunc = this.xmur3(seedString);
        // Generamos el estado inicial
        let a = seedFunc();

        // Retornamos la función generadora
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

    startNewGame(seed = null, challengeCode = null) {
        this.isGameOver = false;
        this.mistakes = 0;
        this.updateMistakesDisplay();
        this.resetTimer();
        this.history = [];
        this.selectedCellIndex = -1;
        this.selectedNumber = null;
        this.notesMode = false;

        // Resetear botón de notas visualmente
        if (this.dom.notesBtn) {
            this.dom.notesBtn.querySelector('.toggle-indicator').textContent = 'OFF';
            this.dom.notesBtn.classList.remove('active');
        }

        // --- CAMBIO CLAVE AQUÍ ---
        this.currentSeed = seed;
        if (seed) {
            console.log(`Starting seeded game with robust hash: ${seed}`);
            // Ahora pasamos el string DIRECTAMENTE, el nuevo seededRandom se encarga del hash
            this.prng = this.seededRandom(seed);
        } else {
            console.log('Starting random game');
            this.prng = null;
        }
        // -------------------------

        // Handle Challenge Context
        this.currentChallengeCode = challengeCode;
        this.currentScoreId = null;
        if (this.currentChallengeCode) {
            this.registerParticipant();
        }

        // Lógica VISIBILIDAD Botón Nueva Partida
        const footer = document.getElementById('game-footer');
        if (footer) {
            // Solo mostrar si NO hay semilla (Juego Libre) y NO hay código de reto
            if (!seed && !challengeCode) {
                footer.classList.remove('hidden');
            } else {
                footer.classList.add('hidden');
            }
        }

        // Sync UI select
        if (this.dom.difficultySelect) {
            this.dom.difficultySelect.value = this.difficulty;
        }
        if (this.dom.level) {
            this.dom.level.textContent = this.difficulty === 'easy' ? 'Fácil' : this.difficulty === 'medium' ? 'Medio' : 'Difícil';
        }

        this.generateBoard();
        this.renderBoard();
        this.startTimer();

        // Botón Nueva Partida (Solo visible en juego libre)
        // OLD BUTTON LOGIC REMOVED/IGNORED in favor of Footer

        // Lógica de visibilidad del Footer de Nueva Partida
        if (this.dom.gameFooter) {
            if (!seed && !challengeCode) {
                // Es Juego Libre -> MOSTRAR footer
                this.dom.gameFooter.classList.remove('hidden');
            } else {
                // Es Competitivo -> OCULTAR footer
                this.dom.gameFooter.classList.add('hidden');
            }
        }
    }

    generateBoard() {
        let grid = Array(81).fill(0);
        this.fillDiagonalBoxes(grid);
        this.solveSudoku(grid);
        this.solution = [...grid];
        // Difficulty Adjustment V3:
        // Easy: Want 46 nums -> 81 - 46 = 35 holes.
        // Medium: Want 40 nums -> 81 - 40 = 41 holes.
        // Hard: Want 35 nums -> 81 - 35 = 46 holes.
        const attempts = this.difficulty === 'easy' ? 35 : this.difficulty === 'medium' ? 41 : 46;
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

    // Barajado Fisher-Yates (100% determinista con nuestra seed)
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    solveSudoku(grid) {
        for (let i = 0; i < 81; i++) {
            if (grid[i] === 0) {
                let row = Math.floor(i / 9);
                let col = i % 9;

                // CAMBIO AQUÍ: Usar shuffle en lugar de sort
                let nums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
                this.shuffle(nums);

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
            let row = Math.floor(this.random() * 9);
            let col = Math.floor(this.random() * 9);
            let idx = row * 9 + col;
            while (grid[idx] === 0) {
                row = Math.floor(this.random() * 9);
                col = Math.floor(this.random() * 9);
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
            // Toggle selection if clicking the same cell
            if (this.selectedCellIndex === index) {
                this.selectedCellIndex = -1;
            } else {
                this.selectedCellIndex = index;
            }
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

    async checkWin() {
        const isFull = this.board.every(cell => cell.value !== null);
        const noErrors = this.board.every(cell => !cell.error);

        if (isFull && noErrors) {
            this.isGameOver = true;
            this.stopTimer();
            this.soundManager.playWin();

            if (this.currentChallengeCode) {
                // CHALLENGE WIN FLOW
                await this.updateChallengeScore();
            } else {
                // VISUAL STUDIO CODE STANDARD FLOW
                this.dom.finalTime.textContent = this.dom.timer.textContent;
                this.dom.victoryModal.classList.remove('hidden');
            }
        }
    }

    checkAuth() {
        if (!auth) return;
        auth.onAuthStateChanged((user) => {
            const welcomeScreen = document.getElementById('welcome-screen');
            const homeView = document.getElementById('home-view');

            // Always show Home View (as background)
            if (homeView) homeView.classList.remove('hidden');

            if (user) {
                // LOGGED IN
                if (welcomeScreen) welcomeScreen.classList.add('hidden');

                // Get nick from profile or DB

                let nick = user.displayName;

                // Fallback to temporarily stored nick if available (for fresh Guest login)
                if (!nick && this.temporaryGuestNick) {
                    nick = this.temporaryGuestNick;
                }

                db.collection('users').doc(user.uid).get().then((doc) => {
                    if (doc.exists) {
                        nick = doc.data().nick || nick;
                        this.currentUserNick = nick;
                        this.updateUserDisplay();
                    } else {
                        // Create Basic User Doc if missing
                        const initialNick = nick || 'Anónimo';
                        db.collection('users').doc(user.uid).set({
                            uid: user.uid,
                            nick: initialNick,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        this.currentUserNick = initialNick;
                        this.updateUserDisplay();
                    }
                    // Clear temp nick
                    this.temporaryGuestNick = null;
                }).catch(e => {
                    console.log("Error checking user doc:", e);
                    this.currentUserNick = user.displayName || 'Anónimo';
                    this.updateUserDisplay();
                });

                this.checkDailyStatus();

            } else {
                // LOGGED OUT
                if (welcomeScreen) welcomeScreen.classList.remove('hidden');
                // Home view stays visible as background
            }
        });
    }

    initAuth() {
        // Google Login
        const btnGoogle = document.getElementById('btn-login-google');
        if (btnGoogle) {
            btnGoogle.addEventListener('click', () => {
                const provider = new firebase.auth.GoogleAuthProvider();
                auth.signInWithPopup(provider).catch(error => {
                    console.error("Google Sign Error:", error);
                    // Ignore popup closed by user
                    if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
                        Swal.fire("Error", "No se pudo entrar con Google", "error");
                    }
                });
            });
        }

        // Guest Login
        const btnGuest = document.getElementById('start-guest-btn');
        const inputGuest = document.getElementById('username-input');
        if (btnGuest) {
            btnGuest.addEventListener('click', async () => {
                const nick = inputGuest.value.trim();

                if (!nick) {
                    Swal.fire("Error", "Por favor escribe un nombre", "warning");
                    return;
                }

                // Check uniqueness BEFORE creating auth
                try {
                    const snapshot = await db.collection('users').where('nick', '==', nick).get();
                    if (!snapshot.empty) {
                        Swal.fire("Error", "Este nombre ya está en uso. Elige otro.", "error");
                        return;
                    }
                } catch (e) {
                    console.error("Error checking nick:", e);
                    // Continue? Or block? Better block to be safe or warn.
                }

                // Store nick temporarily for checkAuth to find it immediately
                if (nick) this.temporaryGuestNick = nick;

                auth.signInAnonymously().then((result) => {
                    if (nick) {
                        // Immediately update local UI to avoid "Anonymous" flash
                        this.currentUserNick = nick;
                        this.updateUserDisplay();

                        result.user.updateProfile({ displayName: nick }).then(() => {
                            // Also update 'users' collection
                            db.collection('users').doc(result.user.uid).set({
                                uid: result.user.uid,
                                nick: nick,
                                createdAt: firebase.firestore.FieldValue.serverTimestamp()
                            }, { merge: true });
                        });
                    }
                }).catch(error => {
                    console.error("Guest Sign Error:", error);
                    Swal.fire("Error", "No se pudo entrar como invitado", "error");
                });
            });
        }

        // Edit Nick
        const btnEdit = document.getElementById('btn-edit-nick');
        if (btnEdit) {
            btnEdit.addEventListener('click', () => {
                this.editNick();
            });
        }
    }

    async editNick() {
        if (!auth.currentUser) return;

        const { value: newNick } = await Swal.fire({
            title: 'Editar Nombre',
            input: 'text',
            inputValue: this.currentUserNick,
            showCancelButton: true,
            inputValidator: (value) => {
                if (!value) return '¡Escribe algo!';
            }
        });

        if (newNick) {
            try {
                // Check uniqueness
                const snapshot = await db.collection('users').where('nick', '==', newNick).get();
                const isTaken = snapshot.docs.some(doc => doc.id !== auth.currentUser.uid);

                if (isTaken) {
                    Swal.fire("Error", "Este nombre ya está en uso. Elige otro.", "error");
                    return;
                }

                await auth.currentUser.updateProfile({ displayName: newNick });
                await db.collection('users').doc(auth.currentUser.uid).set({
                    nick: newNick
                }, { merge: true });

                this.currentUserNick = newNick;
                this.updateUserDisplay();
                Swal.fire({
                    icon: 'success',
                    title: 'Nombre actualizado',
                    toast: true,
                    position: 'top-end',
                    timer: 2000,
                    showConfirmButton: false
                });
            } catch (e) {
                console.error("Update nick error:", e);
                Swal.fire("Error", "No se pudo actualizar el nombre", "error");
            }
        }
    }

    // Removed handleFirstLogin as it is replaced by welcome screen logic


    updateUserDisplay() {
        if (this.dom.userDisplay && this.currentUserNick) {
            this.dom.userDisplay.textContent = this.currentUserNick;
        }
        if (this.dom.playerName) {
            this.dom.playerName.value = this.currentUserNick;
            this.dom.playerName.disabled = true;
        }
    }

    getWeeklyChallengeIdsForDate(diff, date) {
        // Generates the 7 challenge IDs for the week containing 'date'
        const dates = this.getDatesForWeekOf(date);
        return dates.map(d => {
            const y = d.getFullYear();
            const m = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            return `DAILY-${diff}-${y}-${m}-${day}`;
        });
    }

    getDatesForWeekOf(date) {
        // Returns array of 7 Date objects (Mon-Sun) for the week of 'date'
        const d = new Date(date);
        const day = d.getDay(); // 0 is Sunday
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        const monday = new Date(d.setDate(diff));

        const weekDates = [];
        for (let i = 0; i < 7; i++) {
            const nextDay = new Date(monday);
            nextDay.setDate(monday.getDate() + i);
            weekDates.push(nextDay);
        }
        return weekDates;
    }

    getWeekId(date = new Date()) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const year = d.getUTCFullYear();
        const weekNo = Math.ceil((((d - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7);
        return `${year}-W${weekNo.toString().padStart(2, '0')}`;
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
                    date: date,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    weekId: this.getWeekId() // <--- NEW: Save Week ID
                };

                // If it's a daily challenge, add the ID
                if (this.currentChallengeCode && this.currentChallengeCode.startsWith('DAILY-')) {
                    scoreData.challengeId = this.currentChallengeCode;
                }

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

    async renderLeaderboardScores(difficulty, weekOffset = 0) {
        this.currentLeaderboardDiff = difficulty; // Store for reload

        // Toggle Period Selector (Only for Weekly Cup)
        const periodSelect = document.getElementById('leaderboard-week-select');
        const isWeekly = difficulty.includes('DAILY');
        if (periodSelect) {
            periodSelect.style.display = isWeekly ? 'block' : 'none';
        }

        this.dom.leaderboardList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-secondary)">Cargando...</div>';

        try {
            if (!db) throw new Error("Database not initialized");

            let query = db.collection("scores").where("difficulty", "==", difficulty);

            // Only filter by Week if it's a Weekly/Daily Cup. free-play should be all-time.
            // isWeekly already defined above

            if (isWeekly) {
                // Calculate Target Week ID
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() - (weekOffset * 7));
                const targetWeekId = this.getWeekId(targetDate);
                console.log(`Fetching scores for difficulty: ${difficulty}, week: ${targetWeekId}`);
                query = query.where("weekId", "==", targetWeekId);
            } else {
                console.log(`Fetching Global Free Play scores for difficulty: ${difficulty}`);
            }

            // Fetch all scores for this difficulty (Client-side sort to avoid complex index needs)
            const querySnapshot = await query.get();

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
        let selectedDiff = 'medium';

        const { value: finalDiff } = await Swal.fire({
            title: 'Crear Reto Fantasma',
            html: `
                <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
                    <button id="swal-diff-easy" class="swal-diff-btn" style="border: 2px solid #48bb78; color: #48bb78; background: white; padding: 12px; border-radius: 10px; font-weight: bold; font-size: 1.1rem; cursor: pointer; transition: all 0.2s;">Fácil</button>
                    <button id="swal-diff-medium" class="swal-diff-btn" style="border: 2px solid #ecc94b; color: #ecc94b; background: white; padding: 12px; border-radius: 10px; font-weight: bold; font-size: 1.1rem; cursor: pointer; transition: all 0.2s;">Medio</button>
                    <button id="swal-diff-hard" class="swal-diff-btn" style="border: 2px solid #f56565; color: #f56565; background: white; padding: 12px; border-radius: 10px; font-weight: bold; font-size: 1.1rem; cursor: pointer; transition: all 0.2s;">Difícil</button>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Generar Código',
            confirmButtonColor: '#4c6ef5',
            cancelButtonText: 'Cancelar',
            didOpen: () => {
                const popup = Swal.getPopup();
                const btns = {
                    easy: popup.querySelector('#swal-diff-easy'),
                    medium: popup.querySelector('#swal-diff-medium'),
                    hard: popup.querySelector('#swal-diff-hard')
                };

                const updateSelection = (diff) => {
                    selectedDiff = diff;
                    // Reset styles
                    Object.values(btns).forEach(btn => {
                        btn.style.background = 'white';
                        btn.style.color = btn.style.borderColor;
                        btn.style.transform = 'scale(1)';
                    });
                    // Highlight selected
                    const active = btns[diff];
                    active.style.background = active.style.borderColor;
                    active.style.color = 'white';
                    active.style.transform = 'scale(1.02)';
                };

                // Initial selection
                updateSelection('medium');

                // Click listeners
                btns.easy.onclick = () => updateSelection('easy');
                btns.medium.onclick = () => updateSelection('medium');
                btns.hard.onclick = () => updateSelection('hard');
            },
            preConfirm: () => {
                return selectedDiff;
            }
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
                createdByNick: this.currentUserNick || 'Anónimo', // Ensure fallback
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
                this.startNewGame(seed, code);
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
                    const creatorName = data.createdByNick || 'un Jugador Anónimo';

                    // LOBBY STEP: Show found challenge details and wait for confirmation
                    Swal.fire({
                        title: '¡Partida Encontrada!',
                        html: `
                            <p style="font-size: 1.1em; color: #4a5568;">Te unes al reto de <b>${creatorName}</b></p>
                            <div style="margin-top: 15px; font-weight: bold; color: #2d3748;">
                                Dificultad: <span style="color:#4c6ef5">${data.difficulty.toUpperCase()}</span>
                            </div>
                        `,
                        icon: 'success',
                        showCancelButton: true,
                        confirmButtonText: '¡JUGAR AHORA!',
                        cancelButtonText: 'Cancelar',
                        confirmButtonColor: '#48bb78', // Green for go
                        cancelButtonColor: '#e53e3e',
                        reverseButtons: true
                    }).then((result) => {
                        if (result.isConfirmed) {
                            this.difficulty = data.difficulty;
                            this.startNewGame(data.seed, code.toUpperCase().trim());
                            this.showGame();
                        }
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

    // --- CHALLENGE LEADERBOARD METHODS ---

    async registerParticipant() {
        if (!this.currentChallengeCode || !this.currentUserNick) return;
        try {
            const docRef = await db.collection('scores').add({
                challengeId: this.currentChallengeCode,
                nick: this.currentUserNick,
                uid: (auth.currentUser ? auth.currentUser.uid : null), // Fix: Save UID for daily check
                status: 'playing',
                time: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.currentScoreId = docRef.id;
            console.log("Participant registered:", this.currentScoreId);
        } catch (e) {
            console.error("Error registering participant:", e);
        }
    }

    async updateChallengeScore() {
        if (!this.currentScoreId) return;
        try {
            await db.collection('scores').doc(this.currentScoreId).update({
                status: 'finished',
                time: this.timer,
                seconds: this.timer, // Mirror for index compatibility
                timeStr: this.dom.timer.textContent,
                finishedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.showChallengeLeaderboard();
        } catch (e) {
            console.error("Error updating challenge score:", e);
            Swal.fire('Error', 'No se pudo guardar la puntuación', 'error');
        }
    }

    async checkWin() {
        const isFull = this.board.every(cell => cell.value !== null);
        const noErrors = this.board.every(cell => !cell.error);

        if (isFull && noErrors) {
            this.isGameOver = true;
            this.stopTimer();
            this.soundManager.playWin();

            if (this.currentChallengeCode) {
                // CHALLENGE WIN FLOW
                // Await save to prevent race condition
                await this.updateChallengeScore();
            } else {
                // VISUAL STUDIO CODE STANDARD FLOW
                this.dom.finalTime.textContent = this.dom.timer.textContent;
                this.dom.victoryModal.classList.remove('hidden');
            }
        }
    }

    // ...

    async showChallengeLeaderboard(codeArg = null) {
        const targetCode = codeArg || this.currentChallengeCode;
        if (!targetCode) return;

        const fetchAndRender = async () => {
            try {
                const snapshot = await db.collection('scores')
                    .where('challengeId', '==', targetCode)
                    .where('status', '==', 'finished')
                    .orderBy('seconds', 'asc')
                    .limit(50)
                    .get();

                if (snapshot.empty) {
                    return '<div style="text-align:center; padding:20px; color:#aaa;">Nadie ha terminado aún.</div>';
                }

                let html = '<div style="display:flex; flex-direction:column; gap:15px; text-align:left;">';
                html += `<div><h3 style="color:#38a169; border-bottom:2px solid #38a169; padding-bottom:5px; margin-bottom:10px;">🏆 Clasificación (${targetCode})</h3>`;

                snapshot.docs.forEach((doc, i) => {
                    const p = doc.data();
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                    html += `
                        <div style="display:flex; justify-content:space-between; padding:8px; background:#f7fafc; margin-bottom:5px; border-radius:8px; align-items:center;">
                            <div><span style="font-size:1.2em; margin-right:8px;">${medal}</span> <b>${p.nick}</b></div>
                            <span style="font-family:monospace; font-weight:bold; color:#4c6ef5;">${p.timeStr || '--:--'}</span>
                        </div>`;
                });

                html += '</div></div>';
                return html;

            } catch (e) {
                console.error("Leaderboard Error:", e);
                return '<p style="color:red; text-align:center;">Error cargando ranking.</p>';
            }
        };

        const htmlContent = await fetchAndRender();

        Swal.fire({
            title: '📊 Clasificación',
            html: htmlContent,
            showDenyButton: true,
            confirmButtonText: '🔄 Actualizar',
            denyButtonText: 'Cerrar',
            confirmButtonColor: '#4c6ef5',
            denyButtonColor: '#718096',
            allowOutsideClick: false,
        }).then((result) => {
            if (result.isConfirmed) {
                this.showChallengeLeaderboard(targetCode);
            } else if (result.isDenied) {
                if (!codeArg && this.currentChallengeCode && this.currentChallengeCode.startsWith('DAILY-')) {
                    this.showHome();
                } else if (!codeArg) {
                    this.showHome();
                }
            }
        });
    }

    async showChallengeExplorer() {
        Swal.fire({
            title: 'Niveles de Reto',
            html: `
                <div style="margin-bottom: 20px;">
                    <button class="menu-btn circle-btn circle-btn-small easy" onclick="window.gameInstance.renderChallengeGrid('easy')" style="display:inline-flex; width:40px; height:40px;">E</button>
                    <button class="menu-btn circle-btn circle-btn-small medium" onclick="window.gameInstance.renderChallengeGrid('medium')" style="display:inline-flex; width:40px; height:40px;">M</button>
                    <button class="menu-btn circle-btn circle-btn-small hard" onclick="window.gameInstance.renderChallengeGrid('hard')" style="display:inline-flex; width:40px; height:40px;">H</button>
                </div>
                <div id="challenge-grid-container" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; max-height: 400px; overflow-y: auto; padding: 10px;">
                    <p>Selecciona una dificultad...</p>
                </div>
            `,
            showCloseButton: true,
            showConfirmButton: false,
            didOpen: () => {
                // Default to Medium logic
                this.renderChallengeGrid('medium');
            }
        });
    }

    startChallengeFromExplorer(code, seed, diff) {
        Swal.close();
        this.difficulty = diff;
        this.startNewGame(seed, code);
        this.showGame();
    }




    getDailySeed(difficulty) {
        const d = new Date();
        // Usar UTC para garantizar que todos en el mundo tengan el mismo reto al mismo tiempo
        const year = d.getUTCFullYear();
        const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = d.getUTCDate().toString().padStart(2, '0');
        return `DAILY-${year}-${month}-${day}-${difficulty.toUpperCase()}`;
    }

    getDatesSinceMonday() {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day == 0 ? -6 : 1); // adjust when day is sunday
        const monday = new Date(d.setDate(diff));

        const dates = [];
        const today = new Date();
        // Reset hours to compare safely
        today.setHours(0, 0, 0, 0);
        monday.setHours(0, 0, 0, 0);

        let current = new Date(monday);
        while (current <= today) {
            dates.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }

    getWeeklyChallengeIds(difficulty) {
        const dates = this.getDatesSinceMonday();
        return dates.map(d => {
            const year = d.getFullYear();
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            return `DAILY-${year}-${month}-${day}-${difficulty.toUpperCase()}`;
        });
    }

    // --- LEVEL COMPLETION LOGIC ---

    async renderChallengeGrid(difficulty) {
        this.currentDifficulty = difficulty;
        const container = document.getElementById('challenge-grid-container');
        if (!container) return;

        container.innerHTML = 'Cargando...';

        // 1. Obtener completados
        const completedSet = new Set();
        if (this.currentUserNick && auth.currentUser) {
            try {
                // Assuming challengeId is CHALLENGE-DIFFICULTY-NUM
                const snapshot = await db.collection('scores')
                    .where('uid', '==', auth.currentUser.uid)
                    .where('difficulty', '==', difficulty)
                    .where('challengeId', '>=', 'CHALLENGE-' + difficulty.toUpperCase())
                    .get();
                snapshot.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.challengeId) completedSet.add(data.challengeId);
                });
            } catch (e) {
                console.error("Error fetching completed", e);
            }
        }

        container.innerHTML = '';

        // 2. Generar Botones
        for (let i = 1; i <= 50; i++) {
            const btn = document.createElement('button');
            btn.textContent = i;
            btn.className = 'level-btn'; // Clase base

            // ID del reto (Debe coincidir con como lo guardas)
            const challengeId = `CHALLENGE-${difficulty.toUpperCase()}-${i}`;

            // 3. Aplicar Check
            if (completedSet.has(challengeId)) {
                btn.classList.add('completed');
                btn.innerHTML += ' <span class="check-mark">✓</span>';
            }

            btn.onclick = () => {
                const seed = `SEED-${difficulty.toUpperCase()}-${i}`;
                this.startNewGame(seed, challengeId);
                this.showGame();
            };
            container.appendChild(btn);
        }
    }
}

// Start the game (Wait for DOM/Load)
window.addEventListener('load', () => {
    // Check if offline/persistence error happened first? No matter.
    console.log("App Loaded. Initializing Game...");
    window.gameInstance = new SudokuGame();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker Registered!', reg))
            .catch(err => console.error('Service Worker Failed', err));
    }
});
