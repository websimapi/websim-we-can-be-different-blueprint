/**
 * RE-DESIGNED MAIN GAME LOGIC
 * Reliable Split-Screen & Physics Engine
 */

import * as THREE from 'three';
import nipplejs from 'nipplejs';

// --- CONFIGURATION ---

const CONF = {
    moveSpeed: 0.25,
    jumpForce: 0.45,
    gravity: 0.02,
    friction: 0.82,
    camOffset: new THREE.Vector3(0, 8, 16),
    splitThreshold: 25,
    mergeThreshold: 15
};

// --- GLOBAL STATE ---

const clock = new THREE.Clock();
const TIME_STEP = 1/60;
let timeAccumulator = 0;

const state = {
    keys: {},
    // P1 starts on Left (AI World), P2 starts on Right (Human World)
    p1: { pos: new THREE.Vector3(-8, 5, 0), vel: new THREE.Vector3(), onGround: false, isAI: true },
    p2: { pos: new THREE.Vector3(8, 5, 0), vel: new THREE.Vector3(), onGround: false, isAI: false },
    platforms: [], 
    joystickL: null,
    joystickR: null,
    joyLData: { x: 0, y: 0 },
    joyRData: { x: 0, y: 0 },
    
    // Camera State
    isMerged: false,
    camLeftPos: new THREE.Vector3(),
    camLeftLook: new THREE.Vector3(),
    camRightPos: new THREE.Vector3(),
    camRightLook: new THREE.Vector3()
};

// --- THREE.JS SETUP ---

const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setScissorTest(true); // Crucial for reliable split screen
container.appendChild(renderer.domElement);

const loader = new THREE.TextureLoader();

// Load Assets
const texAI = loader.load('./ai_blueprint_bg.png');
texAI.colorSpace = THREE.SRGBColorSpace;

const texHuman = loader.load('./human_blueprint_bg.png');
texHuman.colorSpace = THREE.SRGBColorSpace;

const texCharAI = loader.load('./char_ai.png');
texCharAI.colorSpace = THREE.SRGBColorSpace;

const texCharHuman = loader.load('./char_human.png');
texCharHuman.colorSpace = THREE.SRGBColorSpace;

const texPlat = loader.load('./platform_texture.png');
texPlat.colorSpace = THREE.SRGBColorSpace;
texPlat.wrapS = texPlat.wrapT = THREE.RepeatWrapping;

// Scenes
// We use TWO completely separate scenes to guarantee 100% style separation
// They will share geometry data (collider boxes) but have different meshes.
const sceneLeft = new THREE.Scene();
sceneLeft.background = texAI;
sceneLeft.fog = new THREE.FogExp2(0x001133, 0.015);

const sceneRight = new THREE.Scene();
sceneRight.background = texHuman;
sceneRight.fog = new THREE.FogExp2(0xeeddcc, 0.015);

// Cameras
const aspect = (window.innerWidth / 2) / window.innerHeight; // Half screen aspect
const cameraLeft = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
const cameraRight = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);

// Lighting
// AI Lighting
const lightAI = new THREE.DirectionalLight(0x00ffff, 2);
lightAI.position.set(10, 50, 20);
sceneLeft.add(lightAI);
sceneLeft.add(new THREE.AmbientLight(0x002244, 1.5));

// Human Lighting
const lightHuman = new THREE.DirectionalLight(0xffaa55, 2);
lightHuman.position.set(-10, 50, 20);
sceneRight.add(lightHuman);
sceneRight.add(new THREE.AmbientLight(0x665544, 1.5));

// --- ASSET FACTORIES ---

function createPlayerMesh(isAI) {
    const geo = new THREE.PlaneGeometry(2, 3);
    const mat = new THREE.MeshStandardMaterial({
        map: isAI ? texCharAI : texCharHuman,
        transparent: true,
        side: THREE.DoubleSide,
        alphaTest: 0.5
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Add a shadow blob
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.8, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.4, transparent: true })
    );
    shadow.rotation.x = -Math.PI/2;
    shadow.position.y = -1.45;
    mesh.add(shadow);
    return mesh;
}

// Player objects
const p1MeshL = createPlayerMesh(true); // P1 seen in AI world
const p1MeshR = createPlayerMesh(true); // P1 seen in Human world
sceneLeft.add(p1MeshL);
sceneRight.add(p1MeshR);

const p2MeshL = createPlayerMesh(false); // P2 seen in AI world
const p2MeshR = createPlayerMesh(false); // P2 seen in Human world
sceneLeft.add(p2MeshL);
sceneRight.add(p2MeshR);

// --- CHUNK SYSTEM ---

const CHUNK_SIZE = 40;
const loadedChunks = new Map();

function createChunk(cx, cz) {
    const xBase = cx * CHUNK_SIZE;
    const zBase = cz * CHUNK_SIZE;
    
    const chunkData = {
        meshes: [],
        colliders: []
    };

    // 1. Floor
    // Floor is physically continuous but visually styled
    const floorW = CHUNK_SIZE;
    const floorD = CHUNK_SIZE;
    
    // AI Floor Mesh (Grid)
    const grid = new THREE.GridHelper(CHUNK_SIZE, 8, 0x00ffff, 0x003333);
    grid.position.set(xBase, -0.1, zBase);
    sceneLeft.add(grid);
    chunkData.meshes.push({ s: sceneLeft, m: grid });

    // AI Floor Solid (transparent dark)
    const aiFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE),
        new THREE.MeshBasicMaterial({ color: 0x000505 })
    );
    aiFloor.rotation.x = -Math.PI/2;
    aiFloor.position.set(xBase, -0.2, zBase);
    sceneLeft.add(aiFloor);
    chunkData.meshes.push({ s: sceneLeft, m: aiFloor });

    // Human Floor Mesh (Paper)
    const humanFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE),
        new THREE.MeshStandardMaterial({ map: texPlat, roughness: 1 })
    );
    humanFloor.rotation.x = -Math.PI/2;
    humanFloor.position.set(xBase, -0.1, zBase);
    sceneRight.add(humanFloor);
    chunkData.meshes.push({ s: sceneRight, m: humanFloor });

    // Collider for Floor (Safe Zone)
    const floorCol = {
        box: new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(xBase, -5, zBase),
            new THREE.Vector3(CHUNK_SIZE, 10, CHUNK_SIZE)
        )
    };
    state.platforms.push(floorCol);
    chunkData.colliders.push(floorCol);

    // 2. Obstacles
    // Procedurally placed boxes
    const seed = Math.abs((cx * 54321) ^ (cz * 98765));
    const count = 3 + (seed % 5);

    for(let i=0; i<count; i++) {
        const r1 = ((seed + i*10) % 100) / 100;
        const r2 = ((seed + i*20) % 100) / 100;
        const r3 = ((seed + i*30) % 100) / 100;

        const px = xBase + (r1 - 0.5) * (CHUNK_SIZE * 0.8);
        const pz = zBase + (r2 - 0.5) * (CHUNK_SIZE * 0.8);
        
        // Safe zone around spawns
        if (Math.abs(px) < 10 && Math.abs(pz) < 5) continue;

        const w = 3 + r1 * 5;
        const h = 1 + r3 * 4;
        const d = 3 + r2 * 5;
        const py = h / 2; // Sit on floor

        const geo = new THREE.BoxGeometry(w, h, d);
        
        // AI Style (Wireframe box)
        const matAI = new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true });
        const meshAI = new THREE.Mesh(geo, matAI);
        meshAI.position.set(px, py, pz);
        // Inner Core
        const coreAI = new THREE.Mesh(new THREE.BoxGeometry(w-0.2, h-0.2, d-0.2), new THREE.MeshBasicMaterial({ color: 0x001111 }));
        meshAI.add(coreAI);
        sceneLeft.add(meshAI);
        chunkData.meshes.push({ s: sceneLeft, m: meshAI });

        // Human Style (Cardboard box)
        const matHuman = new THREE.MeshStandardMaterial({ map: texPlat, color: 0xdddddd });
        const meshHuman = new THREE.Mesh(geo, matHuman);
        meshHuman.position.set(px, py, pz);
        // Pencil Edges
        const edgeHuman = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x221100 }));
        meshHuman.add(edgeHuman);
        sceneRight.add(meshHuman);
        chunkData.meshes.push({ s: sceneRight, m: meshHuman });

        // Collider
        const col = {
            box: new THREE.Box3().setFromCenterAndSize(
                new THREE.Vector3(px, py, pz),
                new THREE.Vector3(w, h, d)
            )
        };
        state.platforms.push(col);
        chunkData.colliders.push(col);
    }

    loadedChunks.set(`${cx},${cz}`, chunkData);
}

function updateChunks() {
    const centers = [state.p1.pos, state.p2.pos];
    const needed = new Set();
    
    centers.forEach(p => {
        const cx = Math.floor(p.x / CHUNK_SIZE + 0.5);
        const cz = Math.floor(p.z / CHUNK_SIZE + 0.5);
        for(let x=-1; x<=1; x++) {
            for(let z=-1; z<=1; z++) {
                needed.add(`${cx+x},${cz+z}`);
            }
        }
    });

    // Create new
    needed.forEach(k => {
        if(!loadedChunks.has(k)) {
            const [cx, cz] = k.split(',').map(Number);
            createChunk(cx, cz);
        }
    });

    // Destroy old
    for(const [k, v] of loadedChunks) {
        if(!needed.has(k)) {
            v.meshes.forEach(item => item.s.remove(item.m));
            v.colliders.forEach(c => {
                const idx = state.platforms.indexOf(c);
                if(idx > -1) state.platforms.splice(idx, 1);
            });
            loadedChunks.delete(k);
        }
    }
}

// --- PHYSICS & INPUT ---

function handleInputs() {
    // P1 (WASD / Left Stick)
    let p1x = 0, p1z = 0;
    if(state.keys['KeyW']) p1z -= 1;
    if(state.keys['KeyS']) p1z += 1;
    if(state.keys['KeyA']) p1x -= 1;
    if(state.keys['KeyD']) p1x += 1;
    
    if(state.joyLData.x !== 0 || state.joyLData.y !== 0) {
        p1x = state.joyLData.x;
        p1z = -state.joyLData.y;
    }

    if(state.keys['Space']) doJump(state.p1);

    // P2 (Arrows / Right Stick)
    let p2x = 0, p2z = 0;
    if(state.keys['ArrowUp']) p2z -= 1;
    if(state.keys['ArrowDown']) p2z += 1;
    if(state.keys['ArrowLeft']) p2x -= 1;
    if(state.keys['ArrowRight']) p2x += 1;

    if(state.joyRData.x !== 0 || state.joyRData.y !== 0) {
        p2x = state.joyRData.x;
        p2z = -state.joyRData.y;
    }

    if(state.keys['ShiftRight'] || state.keys['Enter']) doJump(state.p2);

    // Apply
    applyMove(state.p1, p1x, p1z);
    applyMove(state.p2, p2x, p2z);
}

function doJump(p) {
    if(p.onGround) {
        p.vel.y = CONF.jumpForce;
        p.onGround = false;
    }
}

function applyMove(p, dx, dz) {
    // Accelerate
    p.vel.x += dx * CONF.moveSpeed * 0.2;
    p.vel.z += dz * CONF.moveSpeed * 0.2;
}

function updatePhysics() {
    [state.p1, state.p2].forEach(p => {
        // Gravity
        p.vel.y -= CONF.gravity;
        // Friction
        p.vel.x *= CONF.friction;
        p.vel.z *= CONF.friction;

        // Apply Velocity & Collide
        // X
        p.pos.x += p.vel.x;
        solveCollision(p, 'x');
        // Z
        p.pos.z += p.vel.z;
        solveCollision(p, 'z');
        // Y
        p.pos.y += p.vel.y;
        p.onGround = false; // assume air until proven grounded
        solveCollision(p, 'y');

        // Kill plane
        if(p.pos.y < -30) {
            p.pos.y = 10;
            p.pos.x = 0;
            p.pos.z = 0;
            p.vel.set(0,0,0);
        }
    });
}

function solveCollision(p, axis) {
    const pBox = new THREE.Box3();
    const size = new THREE.Vector3(0.6, 1.5, 0.6); // Slightly smaller than visual
    pBox.setFromCenterAndSize(p.pos, size);

    for(const plat of state.platforms) {
        if(pBox.intersectsBox(plat.box)) {
            const b = plat.box;
            if(axis === 'y') {
                if(p.vel.y < 0) { // Falling
                    // Land on top?
                    if(p.pos.y - p.vel.y >= b.max.y + size.y/2 - 0.5) {
                        p.pos.y = b.max.y + size.y/2;
                        p.vel.y = 0;
                        p.onGround = true;
                    }
                } else { // Jumping
                    // Hit head?
                    if(p.pos.y - p.vel.y <= b.min.y - size.y/2 + 0.5) {
                        p.pos.y = b.min.y - size.y/2;
                        p.vel.y = 0;
                    }
                }
            } else if (axis === 'x') {
                if(p.vel.x > 0) p.pos.x = b.min.x - size.x/2;
                else p.pos.x = b.max.x + size.x/2;
                p.vel.x = 0;
            } else if (axis === 'z') {
                if(p.vel.z > 0) p.pos.z = b.min.z - size.z/2;
                else p.pos.z = b.max.z + size.z/2;
                p.vel.z = 0;
            }
        }
    }
}

// --- RENDER LOGIC ---

function updateCameras() {
    const dist = state.p1.pos.distanceTo(state.p2.pos);
    
    // State Hysteresis
    if(state.isMerged) {
        if(dist > CONF.splitThreshold) state.isMerged = false;
    } else {
        if(dist < CONF.mergeThreshold) state.isMerged = true;
    }

    // Determine targets
    let targetL, targetR, lookL, lookR;

    if(state.isMerged) {
        // Both cameras look at the midpoint
        const mid = new THREE.Vector3().lerpVectors(state.p1.pos, state.p2.pos, 0.5);
        const camPos = mid.clone().add(CONF.camOffset);
        
        targetL = camPos;
        targetR = camPos;
        lookL = mid;
        lookR = mid;
    } else {
        // Independent tracking
        targetL = state.p1.pos.clone().add(CONF.camOffset);
        targetR = state.p2.pos.clone().add(CONF.camOffset);
        lookL = state.p1.pos;
        lookR = state.p2.pos;
    }

    // Lerp Current Positions (Smooth Camera)
    const lerpSpeed = 0.08;
    state.camLeftPos.lerp(targetL, lerpSpeed);
    state.camRightPos.lerp(targetR, lerpSpeed);
    state.camLeftLook.lerp(lookL, lerpSpeed);
    state.camRightLook.lerp(lookR, lerpSpeed);

    // Apply
    cameraLeft.position.copy(state.camLeftPos);
    cameraLeft.lookAt(state.camLeftLook);

    cameraRight.position.copy(state.camRightPos);
    cameraRight.lookAt(state.camRightLook);

    // Sync Player Visuals
    p1MeshL.position.copy(state.p1.pos);
    p1MeshR.position.copy(state.p1.pos);
    p2MeshL.position.copy(state.p2.pos);
    p2MeshR.position.copy(state.p2.pos);
}

function render() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const halfW = Math.floor(w / 2);

    // Update Aspect Ratios
    // Both cameras render to half-width viewports ALWAYS
    // This simplifies the logic significantly.
    // When merged, they just happen to be in the same place looking at the same thing.
    // Left Screen -> AI World
    // Right Screen -> Human World
    
    cameraLeft.aspect = (w/2) / h;
    cameraLeft.updateProjectionMatrix();
    cameraRight.aspect = (w/2) / h;
    cameraRight.updateProjectionMatrix();

    // 1. Render Left Side (AI Scene)
    renderer.setViewport(0, 0, halfW, h);
    renderer.setScissor(0, 0, halfW, h);
    renderer.render(sceneLeft, cameraLeft);

    // 2. Render Right Side (Human Scene)
    renderer.setViewport(halfW, 0, w - halfW, h);
    renderer.setScissor(halfW, 0, w - halfW, h);
    renderer.render(sceneRight, cameraRight);

    // 3. Draw Split Line (Optional UI overlay logic could go here)
    // For now, the distinct visual styles create the line naturally
}

function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.1);
    timeAccumulator += dt;

    while(timeAccumulator >= TIME_STEP) {
        handleInputs();
        updatePhysics();
        timeAccumulator -= TIME_STEP;
    }

    updateChunks();
    updateCameras();
    render();
}

// --- INITIALIZATION ---

// Input Listeners
window.addEventListener('keydown', e => state.keys[e.code] = true);
window.addEventListener('keyup', e => state.keys[e.code] = false);

// Init Camera positions
state.camLeftPos.copy(state.p1.pos).add(CONF.camOffset);
state.camRightPos.copy(state.p2.pos).add(CONF.camOffset);

// NippleJS
if (window.matchMedia("(max-width: 768px)").matches) {
    const zoneL = document.getElementById('zone-left');
    const zoneR = document.getElementById('zone-right');
    if(zoneL && zoneR) {
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
        
        document.getElementById('btn-jump-p1').addEventListener('touchstart', (e) => { e.preventDefault(); doJump(state.p1); });
        document.getElementById('btn-jump-p2').addEventListener('touchstart', (e) => { e.preventDefault(); doJump(state.p2); });
    }
}

// Resize
window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start
animate();