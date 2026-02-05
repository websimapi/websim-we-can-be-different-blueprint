/**
 * Main Game Logic
 * "We Can Be Different" - 3D Co-op Prototype
 */

import * as THREE from 'three';
import nipplejs from 'nipplejs';

// --- Configuration ---

const CONF = {
    moveSpeed: 0.15,
    jumpForce: 0.3,
    gravity: 0.015,
    friction: 0.85,
    camOffset: new THREE.Vector3(0, 6, 14),
    splitThreshold: 18, // Distance to trigger split screen
    mergeThreshold: 12  // Distance to trigger merge
};

// --- Global State ---

const clock = new THREE.Clock();
const TIME_STEP = 1/60;
let timeAccumulator = 0;

const state = {
    keys: {},
    p1: { pos: new THREE.Vector3(-7, 5, 0), vel: new THREE.Vector3(), onGround: false },
    p2: { pos: new THREE.Vector3(7, 5, 0), vel: new THREE.Vector3(), onGround: false },
    platforms: [], // { mesh, box }
    joystickL: null,
    joystickR: null,
    joyLData: { x: 0, y: 0 },
    joyRData: { x: 0, y: 0 },
    isSplit: false
};

// --- Three.js Setup ---

const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.autoClear = false; // We manage clearing manually
container.appendChild(renderer.domElement);

const loader = new THREE.TextureLoader();

// Materials & Textures
const texAI = loader.load('./ai_blueprint_bg.png');
const texHuman = loader.load('./human_blueprint_bg.png');
const texCharAI = loader.load('./char_ai.png');
const texCharHuman = loader.load('./char_human.png');
const texPlatHuman = loader.load('./platform_texture.png');

// Ensure correct color space for textures
texAI.colorSpace = THREE.SRGBColorSpace;
texHuman.colorSpace = THREE.SRGBColorSpace;
texCharAI.colorSpace = THREE.SRGBColorSpace;
texCharHuman.colorSpace = THREE.SRGBColorSpace;
texPlatHuman.colorSpace = THREE.SRGBColorSpace;
texPlatHuman.wrapS = texPlatHuman.wrapT = THREE.RepeatWrapping;

// Scenes
const sceneAI = new THREE.Scene();
sceneAI.background = texAI;
const sceneHuman = new THREE.Scene();
sceneHuman.background = texHuman;
const sceneMask = new THREE.Scene();
sceneMask.background = new THREE.Color(0x000000); // Default black (Human)

// Cameras
const ASPECT = window.innerWidth / window.innerHeight;
const camShared = new THREE.PerspectiveCamera(60, ASPECT, 0.1, 100);
const camP1 = new THREE.PerspectiveCamera(60, ASPECT * 0.5, 0.1, 100); // Half aspect for split
const camP2 = new THREE.PerspectiveCamera(60, ASPECT * 0.5, 0.1, 100);

// Render Targets
const rtAI = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
const rtHuman = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
const rtMask = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

// --- Mask Scene Setup ---
// 1. Base World Logic: Left (<0) is AI (White), Right (>0) is Human (Black)
const maskGeo = new THREE.PlaneGeometry(10000, 10000);
const maskMat = new THREE.ShaderMaterial({
    vertexShader: `
        varying float vX;
        void main() {
            vX = (modelMatrix * vec4(position, 1.0)).x;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying float vX;
        void main() {
            // x < 0 = 1.0 (AI), x > 0 = 0.0 (Human)
            float val = step(0.0, -vX); 
            gl_FragColor = vec4(vec3(val), 1.0);
        }
    `
});
const maskPlane = new THREE.Mesh(maskGeo, maskMat);
maskPlane.rotation.x = -Math.PI/2;
maskPlane.position.y = -2; // Below players
sceneMask.add(maskPlane);

// 2. Player Bubbles (Lenses)
// P1 (AI) carries an AI bubble (White)
const bubbleGeo = new THREE.CircleGeometry(8, 32); // Larger lens for better visibility
const bubbleMatAI = new THREE.MeshBasicMaterial({ color: 1.0 }); // White
const bubbleP1 = new THREE.Mesh(bubbleGeo, bubbleMatAI);
bubbleP1.rotation.x = -Math.PI/2;
bubbleP1.position.y = -1; // Above mask plane
sceneMask.add(bubbleP1);

// P2 (Human) carries a Human bubble (Black)
const bubbleMatHuman = new THREE.MeshBasicMaterial({ color: 0.0 }); // Black
const bubbleP2 = new THREE.Mesh(bubbleGeo, bubbleMatHuman);
bubbleP2.rotation.x = -Math.PI/2;
bubbleP2.position.y = -1;
sceneMask.add(bubbleP2);

// Post-Processing Quad
const postScene = new THREE.Scene();
// Use a distinct camera for post processing to avoid confusion
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blendUniforms = {
    tAI: { value: null },
    tHuman: { value: null },
    tMask: { value: null },
    uTime: { value: 0 },
    uSplit: { value: 0.0 } // 0 = merged, 1 = split
};

const blendMaterial = new THREE.ShaderMaterial({
    uniforms: blendUniforms,
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tAI;
        uniform sampler2D tHuman;
        uniform sampler2D tMask;
        uniform float uTime;
        uniform float uSplit;
        varying vec2 vUv;

        void main() {
            vec4 colAI = texture2D(tAI, vUv);
            vec4 colHuman = texture2D(tHuman, vUv);
            float maskVal = texture2D(tMask, vUv).r;

            // Glitch effect on mask edges
            // Simple edge detection on mask
            float e = 0.005;
            float mLeft = texture2D(tMask, vUv + vec2(-e, 0)).r;
            float mRight = texture2D(tMask, vUv + vec2(e, 0)).r;
            float edge = abs(mLeft - mRight);

            if (edge > 0.1) {
                float noise = fract(sin(dot(vUv * uTime, vec2(12.9898, 78.233))) * 43758.5453);
                maskVal += (noise - 0.5) * 0.5;
            }

            vec3 finalCol = mix(colHuman.rgb, colAI.rgb, clamp(maskVal, 0.0, 1.0));

            // Split Screen Border Line
            if (uSplit > 0.5) {
                float distToCenter = abs(vUv.x - 0.5);
                if (distToCenter < 0.002) {
                    finalCol = vec3(0.0);
                }
            }

            gl_FragColor = vec4(finalCol, 1.0);
        }
    `
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blendMaterial);
postScene.add(quad);

// --- Game Object Factories ---

function createPlatform(x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    
    // AI Version: Neon Wireframe
    const matAI = new THREE.MeshBasicMaterial({ 
        color: 0x00ffcc, 
        wireframe: true,
        transparent: true,
        opacity: 0.5
    });
    const meshAI = new THREE.Mesh(geo, matAI);
    meshAI.position.set(x, y, z);
    
    // Solid core for AI
    const coreAI = new THREE.Mesh(
        new THREE.BoxGeometry(w*0.9, h*0.9, d*0.9),
        new THREE.MeshBasicMaterial({ color: 0x001111 })
    );
    meshAI.add(coreAI);
    
    sceneAI.add(meshAI);

    // Human Version: Textured
    const matHuman = new THREE.MeshStandardMaterial({ 
        map: texPlatHuman,
        color: 0xffffff,
        roughness: 1,
    });
    const meshHuman = new THREE.Mesh(geo, matHuman);
    meshHuman.position.set(x, y, z);
    
    // Scribble edges for Human
    const edgesHuman = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true })
    );
    meshHuman.add(edgesHuman);

    sceneHuman.add(meshHuman);

    // Physics Collider
    const collider = {
        box: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x,y,z), new THREE.Vector3(w, h, d))
    };

    return { meshAI, meshHuman, collider };
}

function createPlayer(isAI) {
    const texture = isAI ? texCharAI : texCharHuman;
    const geo = new THREE.PlaneGeometry(1.2, 1.8);
    
    // --- AI Scene Mesh ---
    // If it's the AI character, it should glow (Basic Material + Color)
    // If it's the Human character, it looks glitched (Basic Material + Red Tint)
    const matAI = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        color: isAI ? 0x00ffff : 0xff4444 // Cyan for AI, Red for Human intruder
    });
    const meshAI = new THREE.Mesh(geo, matAI);
    
    // --- Human Scene Mesh ---
    // Standard materials react to light
    const matHuman = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.8,
        color: !isAI ? 0xffffff : 0xaaaaaa // White for Human, Greyish for AI intruder
    });
    const meshHuman = new THREE.Mesh(geo, matHuman);
    
    sceneAI.add(meshAI);
    sceneHuman.add(meshHuman);
    
    return { meshAI, meshHuman };
}

// --- Level Generation (Chunk System) ---

const CHUNK_SIZE = 40;
const chunks = new Map(); // "x,z" -> { meshes: [], colliders: [] }

// Shared Assets for Chunks
// Slightly larger geometry to prevent visual seams between chunks
const floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE + 0.5, CHUNK_SIZE + 0.5);
const fUv = floorGeo.attributes.uv;
for(let i=0; i<fUv.count; i++) fUv.setXY(i, fUv.getX(i)*4, fUv.getY(i)*4);

const floorMatHuman = new THREE.MeshStandardMaterial({ map: texPlatHuman, roughness: 1.0 });
const floorMatAI = new THREE.MeshBasicMaterial({ color: 0x0a0a0a }); // Slightly lighter to see silhouette

function createChunk(cx, cz) {
    const objects = { meshes: [], colliders: [] };
    const xOff = cx * CHUNK_SIZE;
    const zOff = cz * CHUNK_SIZE;

    // 1. Floor AI
    // Grid
    const gridHelper = new THREE.GridHelper(CHUNK_SIZE, 10, 0x00ffcc, 0x003333);
    gridHelper.position.set(xOff, 0, zOff);
    sceneAI.add(gridHelper);
    objects.meshes.push({ scene: sceneAI, mesh: gridHelper });
    
    // Solid backing
    const planeAI = new THREE.Mesh(floorGeo, floorMatAI);
    planeAI.rotation.x = -Math.PI / 2;
    planeAI.position.set(xOff, -0.01, zOff);
    sceneAI.add(planeAI);
    objects.meshes.push({ scene: sceneAI, mesh: planeAI });

    // 2. Floor Human
    const planeHuman = new THREE.Mesh(floorGeo, floorMatHuman);
    planeHuman.rotation.x = -Math.PI / 2;
    planeHuman.position.set(xOff, 0, zOff);
    sceneHuman.add(planeHuman);
    objects.meshes.push({ scene: sceneHuman, mesh: planeHuman });

    // Floor Collider
    // Overlap chunk colliders (size + 2) to physically seal gaps and prevent falling through
    const floorCol = {
        box: new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(xOff, -5, zOff), 
            new THREE.Vector3(CHUNK_SIZE + 2, 10, CHUNK_SIZE + 2)
        )
    };
    state.platforms.push(floorCol);
    objects.colliders.push(floorCol);

    // 3. Procedural Obstacles
    // Deterministic random
    const seed = Math.abs((cx * 73856093) ^ (cz * 19349663));
    const count = 3 + (seed % 4); 

    for(let i=0; i<count; i++) {
        const r1 = ((seed + i*123) % 100) / 100; 
        const r2 = ((seed + i*456) % 100) / 100;
        const r3 = ((seed + i*789) % 100) / 100;
        
        // Keep away from center of chunk to allow walking paths
        const ox = (r1 - 0.5) * (CHUNK_SIZE * 0.8);
        const oz = (r2 - 0.5) * (CHUNK_SIZE * 0.8);
        
        // Don't block spawn areas
        if (cx === 0 && cz === 0) {
            if (Math.abs(ox) < 3 && Math.abs(oz) < 3) continue; // Center
            if (Math.abs(ox - (-7)) < 4 && Math.abs(oz) < 4) continue; // P1 Spawn
            if (Math.abs(ox - 7) < 4 && Math.abs(oz) < 4) continue; // P2 Spawn
        }

        const px = xOff + ox;
        const pz = zOff + oz;
        const py = 1 + r3 * 3;
        const w = 2 + r1 * 4;
        const d = 2 + r2 * 4;

        const obj = createPlatform(px, py, pz, w, 0.5, d);
        objects.meshes.push({ scene: sceneAI, mesh: obj.meshAI });
        objects.meshes.push({ scene: sceneHuman, mesh: obj.meshHuman });
        objects.colliders.push(obj.collider);
        state.platforms.push(obj.collider);
    }

    chunks.set(`${cx},${cz}`, objects);
}

function updateWorld() {
    // Need chunks around P1 AND P2
    const needed = new Set();
    
    [state.p1.pos, state.p2.pos].forEach(pos => {
        const cx = Math.round(pos.x / CHUNK_SIZE);
        const cz = Math.round(pos.z / CHUNK_SIZE);
        for(let x = -1; x <= 1; x++) {
            for(let z = -1; z <= 1; z++) {
                needed.add(`${cx+x},${cz+z}`);
            }
        }
    });

    // Create missing
    needed.forEach(key => {
        if(!chunks.has(key)) {
            const [cx, cz] = key.split(',').map(Number);
            createChunk(cx, cz);
        }
    });

    // Remove unneeded
    for(const [key, val] of chunks) {
        if(!needed.has(key)) {
            val.meshes.forEach(item => item.scene.remove(item.mesh));
            val.colliders.forEach(c => {
                const idx = state.platforms.indexOf(c);
                if(idx > -1) state.platforms.splice(idx, 1);
            });
            chunks.delete(key);
        }
    }
}

// Players
const player1Obj = createPlayer(true); // AI
const player2Obj = createPlayer(false); // Human

// Lighting
const ambAI = new THREE.AmbientLight(0x00ffcc, 0.5);
sceneAI.add(ambAI);
const dirAI = new THREE.DirectionalLight(0xffffff, 1);
dirAI.position.set(10, 20, 10);
sceneAI.add(dirAI);

const ambHuman = new THREE.AmbientLight(0xffffff, 0.8);
sceneHuman.add(ambHuman);
const dirHuman = new THREE.DirectionalLight(0xffddaa, 1);
dirHuman.position.set(-10, 20, 10);
sceneHuman.add(dirHuman);

// --- Inputs ---

window.addEventListener('keydown', e => {
    state.keys[e.key] = true;
    state.keys[e.code] = true;
});
window.addEventListener('keyup', e => {
    state.keys[e.key] = false;
    state.keys[e.code] = false;
});

// Mobile Nipple.js
if (window.matchMedia("(max-width: 768px)").matches) {
    const zoneL = document.getElementById('zone-left');
    const zoneR = document.getElementById('zone-right');
    
    try {
        state.joystickL = nipplejs.create({ zone: zoneL, mode: 'static', position: { left: '50%', top: '50%' }, color: 'cyan' });
        state.joystickR = nipplejs.create({ zone: zoneR, mode: 'static', position: { left: '50%', top: '50%' }, color: 'orange' });
        
        state.joystickL.on('move', (evt, data) => {
            if(data.angle) {
                state.joyLData.x = Math.cos(data.angle.radian) * Math.min(data.distance/50, 1);
                state.joyLData.y = Math.sin(data.angle.radian) * Math.min(data.distance/50, 1);
            }
        });
        state.joystickL.on('end', () => { state.joyLData.x = 0; state.joyLData.y = 0; });

        state.joystickR.on('move', (evt, data) => {
            if(data.angle) {
                state.joyRData.x = Math.cos(data.angle.radian) * Math.min(data.distance/50, 1);
                state.joyRData.y = Math.sin(data.angle.radian) * Math.min(data.distance/50, 1);
            }
        });
        state.joystickR.on('end', () => { state.joyRData.x = 0; state.joyRData.y = 0; });
        
        // Touch buttons
        const btnP1 = document.getElementById('btn-jump-p1');
        const btnP2 = document.getElementById('btn-jump-p2');
        if(btnP1) btnP1.addEventListener('touchstart', (e) => { e.preventDefault(); doJump(state.p1); });
        if(btnP2) btnP2.addEventListener('touchstart', (e) => { e.preventDefault(); doJump(state.p2); });
    } catch (err) {
        console.error("NippleJS init failed:", err);
    }
}

function doJump(p) {
    if (p.onGround) {
        p.vel.y = CONF.jumpForce;
        p.onGround = false;
    }
}

// --- Physics Engine ---

function updatePhysics() {
    // Input Handling P1 (AI) - WASD or Joystick L
    let p1x = 0, p1z = 0;
    if (state.keys['w'] || state.keys['W']) p1z = -1;
    if (state.keys['s'] || state.keys['S']) p1z = 1;
    if (state.keys['a'] || state.keys['A']) p1x = -1;
    if (state.keys['d'] || state.keys['D']) p1x = 1;
    if (state.keys[' ']) doJump(state.p1);

    if (Math.abs(state.joyLData.x) > 0.1 || Math.abs(state.joyLData.y) > 0.1) {
        p1x = state.joyLData.x;
        p1z = -state.joyLData.y; // Joystick up is negative Y usually
    }

    // Apply movement
    state.p1.vel.x += p1x * CONF.moveSpeed * 0.2; // Accel
    state.p1.vel.z += p1z * CONF.moveSpeed * 0.2;

    // Input P2 (Human) - Arrows or Joystick R
    let p2x = 0, p2z = 0;
    if (state.keys['ArrowUp']) p2z = -1;
    if (state.keys['ArrowDown']) p2z = 1;
    if (state.keys['ArrowLeft']) p2x = -1;
    if (state.keys['ArrowRight']) p2x = 1;
    if (state.keys['Shift'] || state.keys['Enter']) doJump(state.p2);

    if (Math.abs(state.joyRData.x) > 0.1 || Math.abs(state.joyRData.y) > 0.1) {
        p2x = state.joyRData.x;
        p2z = -state.joyRData.y;
    }

    state.p2.vel.x += p2x * CONF.moveSpeed * 0.2;
    state.p2.vel.z += p2z * CONF.moveSpeed * 0.2;

    // Physics Step
    [state.p1, state.p2].forEach(p => {
        p.vel.y -= CONF.gravity;
        p.vel.y = Math.max(p.vel.y, -0.9); // Cap terminal velocity
        p.vel.x *= CONF.friction;
        p.vel.z *= CONF.friction;

        // X Movement
        p.pos.x += p.vel.x;
        checkCollisions(p, 'x');
        
        // Z Movement
        p.pos.z += p.vel.z;
        checkCollisions(p, 'z');
        
        // Y Movement
        p.pos.y += p.vel.y;
        p.onGround = false;
        checkCollisions(p, 'y');
        
        // Respawn Logic
        if (p.pos.y < -30) {
            // Respawn at default spawns
            const safeX = p === state.p1 ? -7 : 7;
            p.pos.set(safeX, 8, 0);
            p.vel.set(0,0,0);
        }
    });
}

function checkCollisions(p, axis) {
    const size = new THREE.Vector3(0.7, 1.8, 0.7); // Slightly simpler box
    const playerBox = new THREE.Box3();
    playerBox.setFromCenterAndSize(p.pos, size);

    for (let plat of state.platforms) {
        if (playerBox.intersectsBox(plat.box)) {
            if (axis === 'y') {
                // If we are intersecting in Y, decide if we land or hit head
                if (p.vel.y <= 0) {
                    // Falling or standing.
                    // We land if our feet are not significantly below the platform's bottom.
                    // This allows landing even if we fell "into" the box during this frame.
                    if ((p.pos.y - size.y/2) > plat.box.min.y - 0.2) {
                        p.pos.y = plat.box.max.y + size.y/2;
                        p.vel.y = 0;
                        p.onGround = true;
                    }
                } else {
                    // Jumping up
                    p.pos.y = plat.box.min.y - size.y/2;
                    p.vel.y = 0;
                }
            } else if (axis === 'x') {
                if (p.vel.x > 0) p.pos.x = plat.box.min.x - size.x/2;
                else p.pos.x = plat.box.max.x + size.x/2;
                p.vel.x = 0;
            } else if (axis === 'z') {
                if (p.vel.z > 0) p.pos.z = plat.box.min.z - size.z/2;
                else p.pos.z = plat.box.max.z + size.z/2;
                p.vel.z = 0;
            }
        }
    }
}

// --- Main Loop ---

function updateCameraLogic() {
    const dist = state.p1.pos.distanceTo(state.p2.pos);

    // Hysteresis for split/merge
    if (state.isSplit) {
        if (dist < CONF.mergeThreshold) state.isSplit = false;
    } else {
        if (dist > CONF.splitThreshold) state.isSplit = true;
    }

    // Sync Meshes
    player1Obj.meshAI.position.copy(state.p1.pos);
    player1Obj.meshHuman.position.copy(state.p1.pos);
    bubbleP1.position.set(state.p1.pos.x, -1, state.p1.pos.z);

    player2Obj.meshAI.position.copy(state.p2.pos);
    player2Obj.meshHuman.position.copy(state.p2.pos);
    bubbleP2.position.set(state.p2.pos.x, -1, state.p2.pos.z);

    // Update Cameras
    if (!state.isSplit) {
        // Shared Camera
        const mid = new THREE.Vector3().addVectors(state.p1.pos, state.p2.pos).multiplyScalar(0.5);
        const zoom = Math.max(CONF.camOffset.z, dist * 0.8 + 5);
        const target = new THREE.Vector3(mid.x, mid.y + CONF.camOffset.y, mid.z + zoom);
        camShared.position.lerp(target, 0.1);
        camShared.lookAt(mid);
    } else {
        // Independent Cameras
        // P1
        const t1 = new THREE.Vector3(state.p1.pos.x, state.p1.pos.y + CONF.camOffset.y, state.p1.pos.z + CONF.camOffset.z);
        camP1.position.lerp(t1, 0.1);
        camP1.lookAt(state.p1.pos);

        // P2
        const t2 = new THREE.Vector3(state.p2.pos.x, state.p2.pos.y + CONF.camOffset.y, state.p2.pos.z + CONF.camOffset.z);
        camP2.position.lerp(t2, 0.1);
        camP2.lookAt(state.p2.pos);
    }
}

function renderScene(camera, viewport) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    // If viewport is defined, set scissor
    if (viewport) {
        renderer.setScissor(viewport.x, viewport.y, viewport.w, viewport.h);
        renderer.setViewport(viewport.x, viewport.y, viewport.w, viewport.h);
        renderer.setScissorTest(true);
    } else {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
    }

    // Render Masks
    renderer.setRenderTarget(rtMask);
    renderer.render(sceneMask, camera);

    // Render AI
    renderer.setRenderTarget(rtAI);
    renderer.render(sceneAI, camera);

    // Render Human
    renderer.setRenderTarget(rtHuman);
    renderer.render(sceneHuman, camera);
}

function animate(t) {
    requestAnimationFrame(animate);
    
    const dt = Math.min(clock.getDelta(), 0.1);
    timeAccumulator += dt;

    updateWorld();

    while (timeAccumulator >= TIME_STEP) {
        updatePhysics();
        timeAccumulator -= TIME_STEP;
    }
    
    updateCameraLogic();
    
    // Clearing Render Targets manually since we might render multiple times
    renderer.setRenderTarget(rtMask); renderer.clear();
    renderer.setRenderTarget(rtAI); renderer.clear();
    renderer.setRenderTarget(rtHuman); renderer.clear();

    const w = window.innerWidth;
    const h = window.innerHeight;

    if (!state.isSplit) {
        // Merged View
        renderScene(camShared, null);
        blendUniforms.uSplit.value = 0.0;
    } else {
        // Split View
        // Left: P1
        renderScene(camP1, { x: 0, y: 0, w: w/2, h: h });
        // Right: P2
        renderScene(camP2, { x: w/2, y: 0, w: w/2, h: h });
        blendUniforms.uSplit.value = 1.0;
    }
    
    // Final Composite
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();

    blendUniforms.tAI.value = rtAI.texture;
    blendUniforms.tHuman.value = rtHuman.texture;
    blendUniforms.tMask.value = rtMask.texture;
    blendUniforms.uTime.value = t * 0.001;
    
    renderer.render(postScene, orthoCamera);
}

// Resize handler
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    rtAI.setSize(w, h);
    rtHuman.setSize(w, h);
    rtMask.setSize(w, h);
    
    const aspect = w / h;
    camShared.aspect = aspect;
    camShared.updateProjectionMatrix();
    
    camP1.aspect = aspect * 0.5;
    camP1.updateProjectionMatrix();
    
    camP2.aspect = aspect * 0.5;
    camP2.updateProjectionMatrix();
});

// Start
animate(0);