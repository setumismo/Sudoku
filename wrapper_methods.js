
    // --- CHALLENGE LOGIC ---

    async handleCreateChallenge() {
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

    const code = this.generateChallengeCode();
    const seed = Math.random().toString(36).substring(2, 15);
    const userId = (firebase.auth().currentUser && firebase.auth().currentUser.uid) || 'anon';

    Swal.fire({
        title: 'Generando Reto...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        await db.collection('challenges').doc(code).set({
            code: code,
            seed: seed,
            difficulty: finalDiff,
            createdBy: userId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

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
