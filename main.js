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
    camOffset: new THREE.Vector3(0, 6, 12),
    bubbleRadius: 0.2
};

// --- Global State ---

const state = {
    keys: {},
    p1: { pos: new THREE.Vector3(-2, 1, 0), vel: new THREE.Vector3(), onGround: false },
    p2: { pos: new THREE.Vector3(2, 1, 0), vel: new THREE.Vector3(), onGround: false },
    platforms: [], // { mesh, box }
    joystickL: null,
    joystickR: null,
    joyLData: { x: 0, y: 0 },
    joyRData: { x: 0, y: 0 }
};

// --- Three.js Setup ---

const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const loader = new THREE.TextureLoader();

// Materials & Textures
const texAI = loader.load('./ai_blueprint_bg.png');
const texHuman = loader.load('./human_blueprint_bg.png');
const texCharAI = loader.load('./char_ai.png');
const texCharHuman = loader.load('./char_human.png');
const texPlatHuman = loader.load('./platform_texture.png');
texPlatHuman.wrapS = texPlatHuman.wrapT = THREE.RepeatWrapping;

// Scenes
const sceneAI = new THREE.Scene();
sceneAI.background = texAI;
const sceneHuman = new THREE.Scene();
sceneHuman.background = texHuman;

// Camera (Shared)
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);

// Render Targets
const rtAI = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
const rtHuman = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);

// Post-Processing Quad
const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blendUniforms = {
    tAI: { value: null },
    tHuman: { value: null },
    uP1: { value: new THREE.Vector2(0.5, 0.5) },
    uP2: { value: new THREE.Vector2(0.5, 0.5) },
    uRatio: { value: window.innerWidth / window.innerHeight },
    uTime: { value: 0 }
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
        uniform vec2 uP1;
        uniform vec2 uP2;
        uniform float uRatio;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
            vec4 colAI = texture2D(tAI, vUv);
            vec4 colHuman = texture2D(tHuman, vUv);
            
            // Correct for aspect ratio
            vec2 aspect = vec2(uRatio, 1.0);
            vec2 uvC = vUv * aspect;
            vec2 p1C = uP1 * aspect;
            vec2 p2C = uP2 * aspect;

            // Base split: Left is AI (1.0), Right is Human (0.0)
            float split = smoothstep(0.498, 0.502, 1.0 - vUv.x);
            
            // Bubbles
            float r = 0.2; // Bubble radius
            float d1 = length(uvC - p1C);
            float d2 = length(uvC - p2C);
            
            float b1 = 1.0 - smoothstep(r, r + 0.05, d1); // AI Bubble
            float b2 = 1.0 - smoothstep(r, r + 0.05, d2); // Human Bubble
            
            // Logic: Split + AI Bubble - Human Bubble
            float mask = clamp(split + b1 - b2, 0.0, 1.0);
            
            // Glitch effect on blend edge
            if (mask > 0.01 && mask < 0.99) {
                float noise = fract(sin(dot(vUv * uTime, vec2(12.9898, 78.233))) * 43758.5453);
                mask += (noise - 0.5) * 0.1;
            }

            gl_FragColor = mix(colHuman, colAI, clamp(mask, 0.0, 1.0));
        }
    `
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blendMaterial);
postScene.add(quad);

// --- Game Object Factories ---

function createPlatform(x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    
    // AI Version: Neon Wireframe / Grid
    const matAI = new THREE.MeshBasicMaterial({ 
        color: 0x00ffcc, 
        wireframe: true,
        transparent: true,
        opacity: 0.5
    });
    const meshAI = new THREE.Mesh(geo, matAI);
    meshAI.position.set(x, y, z);
    
    // Solid core for AI so it's not totally invisible
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
    
    // Scribble edges for Human (simulated with wireframe overlay)
    const edgesHuman = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true })
    );
    meshHuman.add(edgesHuman);

    sceneHuman.add(meshHuman);

    // Physics Collider
    state.platforms.push({
        box: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x,y,z), new THREE.Vector3(w, h, d))
    });
}

function createPlayer(isAI) {
    // Both scenes contain both players, but rendered slightly differently?
    // For now, same geometry, just ensuring they exist in both scenes.
    
    const texture = isAI ? texCharAI : texCharHuman;
    const mat = new THREE.MeshBasicMaterial({ 
        map: texture, 
        transparent: true, 
        side: THREE.DoubleSide
    });
    const geo = new THREE.PlaneGeometry(1.2, 1.8);
    
    const meshAI = new THREE.Mesh(geo, mat);
    const meshHuman = new THREE.Mesh(geo, mat);
    
    // In AI scene, Human player is glitched?
    if (!isAI) {
        // Human in AI scene
        meshAI.material = mat.clone();
        meshAI.material.color.setHex(0xffaaaa); // Tinted red
    } else {
        // AI in AI scene
        meshAI.material = mat.clone();
        meshAI.material.emissive = new THREE.Color(0x00ffff);
    }
    
    sceneAI.add(meshAI);
    sceneHuman.add(meshHuman);
    
    return { meshAI, meshHuman };
}

// --- Level Generation ---

// Floor
createPlatform(0, -1, 0, 40, 2, 20);
// Steps
createPlatform(-5, 1, 0, 4, 1, 4);
createPlatform(-10, 3, 0, 4, 1, 4);
createPlatform(5, 1, 0, 4, 1, 4);
createPlatform(10, 3, 0, 4, 1, 4);
// Central Bridge
createPlatform(0, 5, -5, 10, 1, 4);

// Players
const player1Obj = createPlayer(true);
const player2Obj = createPlayer(false);

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
    
    state.joystickL = nipplejs.create({ zone: zoneL, mode: 'static', position: { left: '50%', top: '50%' }, color: 'cyan' });
    state.joystickR = nipplejs.create({ zone: zoneR, mode: 'static', position: { left: '50%', top: '50%' }, color: 'orange' });
    
    state.joystickL.on('move', (evt, data) => {
        state.joyLData.x = Math.cos(data.angle.radian) * Math.min(data.distance/50, 1);
        state.joyLData.y = Math.sin(data.angle.radian) * Math.min(data.distance/50, 1);
    });
    state.joystickL.on('end', () => { state.joyLData.x = 0; state.joyLData.y = 0; });

    state.joystickR.on('move', (evt, data) => {
        state.joyRData.x = Math.cos(data.angle.radian) * Math.min(data.distance/50, 1);
        state.joyRData.y = Math.sin(data.angle.radian) * Math.min(data.distance/50, 1);
    });
    state.joystickR.on('end', () => { state.joyRData.x = 0; state.joyRData.y = 0; });
    
    // Touch buttons
    document.getElementById('btn-jump-p1').addEventListener('touchstart', (e) => { e.preventDefault(); doJump(state.p1); });
    document.getElementById('btn-jump-p2').addEventListener('touchstart', (e) => { e.preventDefault(); doJump(state.p2); });
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
        
        // Floor clamp
        if (p.pos.y < -5) {
            p.pos.set(p === state.p1 ? -2 : 2, 5, 0);
            p.vel.set(0,0,0);
        }
    });
}

function checkCollisions(p, axis) {
    // Simple AABB
    const playerBox = new THREE.Box3();
    const size = new THREE.Vector3(0.6, 1.8, 0.2); // Thin collider for 2.5D feel
    playerBox.setFromCenterAndSize(p.pos, size);

    for (let plat of state.platforms) {
        if (playerBox.intersectsBox(plat.box)) {
            if (axis === 'y') {
                if (p.vel.y < 0) { // Landing
                    p.pos.y = plat.box.max.y + size.y/2;
                    p.vel.y = 0;
                    p.onGround = true;
                } else { // Head hit
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

function updateMeshes() {
    // Sync P1
    player1Obj.meshAI.position.copy(state.p1.pos);
    player1Obj.meshHuman.position.copy(state.p1.pos);
    
    // Sync P2
    player2Obj.meshAI.position.copy(state.p2.pos);
    player2Obj.meshHuman.position.copy(state.p2.pos);
    
    // Camera Follow (Average of P1 and P2)
    const mid = new THREE.Vector3().addVectors(state.p1.pos, state.p2.pos).multiplyScalar(0.5);
    camera.position.lerp(new THREE.Vector3(mid.x, mid.y, mid.z).add(CONF.camOffset), 0.1);
    camera.lookAt(mid);
}

function getScreenPos(pos) {
    const v = pos.clone().project(camera); // -1 to 1
    return new THREE.Vector2((v.x + 1) / 2, (v.y + 1) / 2); // 0 to 1
}

function animate(t) {
    requestAnimationFrame(animate);
    
    updatePhysics();
    updateMeshes();
    
    // 1. Render AI Scene to Texture
    renderer.setRenderTarget(rtAI);
    renderer.render(sceneAI, camera);
    
    // 2. Render Human Scene to Texture
    renderer.setRenderTarget(rtHuman);
    renderer.render(sceneHuman, camera);
    
    // 3. Render Blend to Screen
    renderer.setRenderTarget(null);
    
    // Update Uniforms
    blendUniforms.tAI.value = rtAI.texture;
    blendUniforms.tHuman.value = rtHuman.texture;
    blendUniforms.uP1.value = getScreenPos(state.p1.pos);
    blendUniforms.uP2.value = getScreenPos(state.p2.pos);
    blendUniforms.uRatio.value = window.innerWidth / window.innerHeight;
    blendUniforms.uTime.value = t * 0.001;
    
    renderer.render(postScene, postCamera);
}

// Resize handler
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    rtAI.setSize(w, h);
    rtHuman.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    blendUniforms.uRatio.value = w / h;
});

// Start
animate(0);