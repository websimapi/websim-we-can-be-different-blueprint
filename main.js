import { blueprintData } from './data.js';

const container = document.getElementById('app');
let currentIndex = 0;

function render() {
  const data = blueprintData[currentIndex];
  
  // Update text content
  document.getElementById('ai-title').textContent = data.ai.title;
  document.getElementById('ai-desc').textContent = data.ai.desc;
  document.getElementById('ai-vis').textContent = `Visuals: ${data.ai.visuals}`;
  
  document.getElementById('human-title').textContent = data.human.title;
  document.getElementById('human-desc').textContent = data.human.desc;
  document.getElementById('human-vis').textContent = `Visuals: ${data.human.visuals}`;
  
  document.getElementById('category-label').textContent = data.category.toUpperCase();
  
  // Update pagination dots
  updateDots();
}

function updateDots() {
  const dotsContainer = document.getElementById('dots');
  dotsContainer.innerHTML = '';
  blueprintData.forEach((_, idx) => {
    const dot = document.createElement('div');
    dot.className = `dot ${idx === currentIndex ? 'active' : ''}`;
    dot.onclick = () => {
      currentIndex = idx;
      render();
    };
    dotsContainer.appendChild(dot);
  });
}

function setupInteractions() {
  // Navigation
  document.getElementById('prev-btn').onclick = () => {
    currentIndex = (currentIndex - 1 + blueprintData.length) % blueprintData.length;
    render();
  };
  
  document.getElementById('next-btn').onclick = () => {
    currentIndex = (currentIndex + 1) % blueprintData.length;
    render();
  };

  // Slider Logic
  const slider = document.querySelector('.slider-handle');
  const topLayer = document.querySelector('.split-layer.top');
  const app = document.getElementById('app');
  let isDragging = false;

  const move = (e) => {
    if (!isDragging) return;
    
    const rect = app.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // Check orientation via CSS variable or window aspect
    const isPortrait = window.innerHeight > window.innerWidth;
    
    if (isPortrait) {
        // Vertical split (Top/Bottom) logic for mobile portrait
        let y = clientY - rect.top;
        let percentage = (y / rect.height) * 100;
        percentage = Math.max(10, Math.min(90, percentage));
        
        // Update CSS variables for clip path
        app.style.setProperty('--split-pos', `${percentage}%`);
    } else {
        // Horizontal split (Left/Right) logic for landscape/desktop
        let x = clientX - rect.left;
        let percentage = (x / rect.width) * 100;
        percentage = Math.max(10, Math.min(90, percentage));
        
        app.style.setProperty('--split-pos', `${percentage}%`);
    }
  };

  slider.addEventListener('mousedown', () => isDragging = true);
  slider.addEventListener('touchstart', () => isDragging = true);

  window.addEventListener('mouseup', () => isDragging = false);
  window.addEventListener('touchend', () => isDragging = false);

  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move);
}

// Initial Init
setupInteractions();
render();