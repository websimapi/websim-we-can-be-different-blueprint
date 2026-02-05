/**
 * Main Game Logic
 * "We Can Be Different" Prototype
 * 
 * Concept: Two rendering layers (AI vs Human) sharing the same state.
 */

// --- Game State ---

const gameState = {
    players: [
        { id: 1, x: 100, y: 300, vx: 0, vy: 0, width: 40, height: 60, color: 'blue', type: 'drone', onGround: false },
        { id: 2, x: 200, y: 300, vx: 0, vy: 0, width: 40, height: 60, color: 'red', type: 'human', onGround: false }
    ],
    platforms: [
        { x: 50, y: 400, w: 200, h: 20 },
        { x: 300, y: 350, w: 150, h: 20 },
        { x: 500, y: 250, w: 100, h: 20 },
        { x: 100, y: 200, w: 100, h: 20 },
        { x: 0, y: 550, w: 800, h: 50 } // Floor
    ],
    keys: {},
    gravity: 0.8,
    friction: 0.85,
    speed: 1,
    jump: -15,
    cameraMode: 'manual', // 'manual' | 'follow-p1' | 'center'
    splitPos: 50, // Percentage
    isPortrait: false
};

// --- DOM References ---

const root = document.getElementById('game-root');
const aiLayer = document.querySelector('.ai-layer .game-content');
const humanLayer = document.querySelector('.human-layer .game-content');

// --- Initialization ---

function init() {
    // Generate DOM elements for both layers
    [aiLayer, humanLayer].forEach(layer => {
        // Create Platforms
        gameState.platforms.forEach(p => {
            const el = document.createElement('div');
            el.className = 'platform';
            el.style.left = p.x + 'px';
            el.style.top = p.y + 'px';
            el.style.width = p.w + 'px';
            el.style.height = p.h + 'px';
            layer.appendChild(el);
        });

        // Create Players
        gameState.players.forEach(p => {
            const el = document.createElement('div');
            el.className = `player player-${p.id}`;
            el.id = `p${p.id}-${layer.parentElement.classList.contains('ai-layer') ? 'ai' : 'human'}`;
            el.style.width = p.width + 'px';
            el.style.height = p.height + 'px';
            layer.appendChild(el);
        });
    });

    setupInput();
    setupSplitter();
    
    // Check orientation
    checkOrientation();
    window.addEventListener('resize', checkOrientation);

    // Start Loop
    requestAnimationFrame(gameLoop);
}

function checkOrientation() {
    gameState.isPortrait = window.innerHeight > window.innerWidth;
}

// --- Input Handling ---

function setupInput() {
    window.addEventListener('keydown', (e) => {
        gameState.keys[e.key] = true;
    });
    window.addEventListener('keyup', (e) => {
        gameState.keys[e.key] = false;
    });

    document.getElementById('toggle-cam').onclick = () => {
        const modes = ['manual', 'follow-p1'];
        const currentIdx = modes.indexOf(gameState.cameraMode);
        gameState.cameraMode = modes[(currentIdx + 1) % modes.length];
        
        const btn = document.getElementById('toggle-cam');
        if (gameState.cameraMode === 'manual') btn.textContent = "Toggle Camera: Manual";
        if (gameState.cameraMode === 'follow-p1') btn.textContent = "Toggle Camera: Auto-Split";
    };
}

function setupSplitter() {
    const slider = document.getElementById('split-bar');
    let isDragging = false;

    const onMove = (e) => {
        if (!isDragging || gameState.cameraMode !== 'manual') return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = root.getBoundingClientRect();

        if (gameState.isPortrait) {
            let y = clientY - rect.top;
            let pct = (y / rect.height) * 100;
            gameState.splitPos = Math.max(0, Math.min(100, pct));
        } else {
            let x = clientX - rect.left;
            let pct = (x / rect.width) * 100;
            gameState.splitPos = Math.max(0, Math.min(100, pct));
        }
        updateSplitVisual();
    };

    slider.addEventListener('mousedown', () => isDragging = true);
    slider.addEventListener('touchstart', () => isDragging = true);
    window.addEventListener('mouseup', () => isDragging = false);
    window.addEventListener('touchend', () => isDragging = false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove);
}

function updateSplitVisual() {
    root.style.setProperty('--split-pos', `${gameState.splitPos}%`);
}

// --- Physics & Logic ---

function updatePhysics() {
    // Player 1 (AI) - WASD
    const p1 = gameState.players[0];
    if (gameState.keys['a']) p1.vx -= gameState.speed;
    if (gameState.keys['d']) p1.vx += gameState.speed;
    if (gameState.keys['w'] && p1.onGround) { p1.vy = gameState.jump; p1.onGround = false; }

    // Player 2 (Human) - Arrows
    const p2 = gameState.players[1];
    if (gameState.keys['ArrowLeft']) p2.vx -= gameState.speed;
    if (gameState.keys['ArrowRight']) p2.vx += gameState.speed;
    if (gameState.keys['ArrowUp'] && p2.onGround) { p2.vy = gameState.jump; p2.onGround = false; }

    // Apply Physics to all players
    gameState.players.forEach(p => {
        p.vy += gameState.gravity;
        p.vx *= gameState.friction;
        
        // Horizontal Move
        p.x += p.vx;
        checkCollision(p, 'x');

        // Vertical Move
        p.y += p.vy;
        p.onGround = false; // Assume falling until collision proves otherwise
        checkCollision(p, 'y');

        // Screen Boundaries
        const maxX = window.innerWidth - p.width;
        const maxY = window.innerHeight; // Pit
        if (p.x < 0) { p.x = 0; p.vx = 0; }
        if (p.x > maxX) { p.x = maxX; p.vx = 0; }
        
        // Respawn if fall
        if (p.y > maxY) {
            p.y = 0;
            p.vy = 0;
        }
    });

    // Auto Split Logic
    if (gameState.cameraMode === 'follow-p1') {
        const p1 = gameState.players[0];
        // Calculate percentage of screen width P1 is at
        let targetPct = 50;
        if (gameState.isPortrait) {
            targetPct = ((p1.y + p1.height/2) / window.innerHeight) * 100;
        } else {
            targetPct = ((p1.x + p1.width/2) / window.innerWidth) * 100;
        }
        // Smooth lerp
        gameState.splitPos += (targetPct - gameState.splitPos) * 0.1;
        updateSplitVisual();
    }
}

function checkCollision(p, axis) {
    for (let plat of gameState.platforms) {
        if (p.x < plat.x + plat.w &&
            p.x + p.width > plat.x &&
            p.y < plat.y + plat.h &&
            p.y + p.height > plat.y) {
            
            if (axis === 'y') {
                if (p.vy > 0) { // Falling down
                    p.y = plat.y - p.height;
                    p.vy = 0;
                    p.onGround = true;
                } else if (p.vy < 0) { // Hitting head
                    p.y = plat.y + plat.h;
                    p.vy = 0;
                }
            } else if (axis === 'x') {
                if (p.vx > 0) { // Moving right
                    p.x = plat.x - p.width;
                    p.vx = 0;
                } else if (p.vx < 0) { // Moving left
                    p.x = plat.x + plat.w;
                    p.vx = 0;
                }
            }
        }
    }
}

// --- Render Loop ---

function gameLoop() {
    updatePhysics();

    // Sync DOM positions
    gameState.players.forEach(p => {
        const id = p.id;
        const pAi = document.getElementById(`p${id}-ai`);
        const pHuman = document.getElementById(`p${id}-human`);

        if (pAi && pHuman) {
            const transform = `translate(${p.x}px, ${p.y}px)`;
            pAi.style.transform = transform;
            pHuman.style.transform = transform;
            
            // Flip sprite based on direction
            const scaleX = p.vx < -0.1 ? -1 : 1;
            // Apply scale inside transform or via separate property?
            // Since we set transform above, let's append scale
            // Note: simple assignment overwrites.
            // Better:
            pAi.style.transform = `translate(${p.x}px, ${p.y}px) scaleX(${scaleX})`;
            pHuman.style.transform = `translate(${p.x}px, ${p.y}px) scaleX(${scaleX})`;
        }
    });

    requestAnimationFrame(gameLoop);
}

// Boot
init();