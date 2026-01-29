
// --- ADVANCED UI LOGIC RESTORED + BULB CONTROL/REPLAY ---
// Helper: send color to bulb (live sync)
async function sendColorToBulb(hue, saturation, brightness) {
    if (!window.bulbIsOn) return;
    await fetch('/bulb/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hue, saturation, brightness })
    });
}

// Helper: turn bulb on/off
async function setBulbOn(on) {
    window.bulbIsOn = on;
    const statusEl = document.getElementById('bulbStatus');
    if (statusEl) statusEl.innerText = on ? 'Bulb is ON' : 'Bulb is OFF';
    await fetch('/bulb/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on })
    });
}

// Setup event listeners for controls (on DOMContentLoaded)
window.addEventListener('DOMContentLoaded', () => {
    const liveSyncCheckbox = document.getElementById('liveSyncCheckbox');
    if (liveSyncCheckbox) {
        window.liveSyncEnabled = liveSyncCheckbox.checked;
        liveSyncCheckbox.addEventListener('change', function() {
            window.liveSyncEnabled = this.checked;
        });
    }
    const bulbOnBtn = document.getElementById('bulbOnBtn');
    if (bulbOnBtn) bulbOnBtn.addEventListener('click', () => setBulbOn(true));
    const bulbOffBtn = document.getElementById('bulbOffBtn');
    if (bulbOffBtn) bulbOffBtn.addEventListener('click', () => setBulbOn(false));
});

// --- Live Step Replay Logic ---
let playingStepIdx = null;
function highlightStep(idx) {
    document.querySelectorAll('#steps > div').forEach((el, i) => {
        el.style.background = (i === idx) ? '#ffe066' : '';
    });
}

async function playStep(idx) {
    if (idx < 0 || idx >= window.sequence.length) return;
    playingStepIdx = idx;
    highlightStep(idx);
    const step = window.sequence[idx];
    if (window.liveSyncEnabled) {
        if (step.work_mode === 'white') {
            await fetch('/bulb/color', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    work_mode: 'white',
                    brightness: step.brightness,
                    temperature: step.temperature
                })
            });
        } else {
            await fetch('/bulb/color', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hue: step.hue,
                    saturation: step.saturation,
                    brightness: step.brightness
                })
            });
        }
    }
}

function resetPlaySequence() {
    playingStepIdx = null;
    highlightStep(-1);
    const playBtn = document.getElementById('playSequenceBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    if (playBtn) playBtn.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
}

window.addEventListener('DOMContentLoaded', () => {
    const playBtn = document.getElementById('playSequenceBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    if (playBtn && nextBtn) {
        nextBtn.classList.add('hidden');
        playBtn.addEventListener('click', async () => {
            if (!window.sequence.length) return;
            await playStep(0);
            playBtn.classList.add('hidden');
            nextBtn.classList.remove('hidden');
        });
        nextBtn.addEventListener('click', async () => {
            if (playingStepIdx === null) return;
            if (playingStepIdx < window.sequence.length - 1) {
                await playStep(playingStepIdx + 1);
            } else {
                resetPlaySequence();
            }
        });
    }
});

// Patch renderSteps to highlight playing step
const origRenderSteps = renderSteps;
renderSteps = function() {
    origRenderSteps();
    if (playingStepIdx !== null) highlightStep(playingStepIdx);
}
window.sequence = window.sequence || [];
window.liveSyncEnabled = window.liveSyncEnabled || false;
window.bulbIsOn = window.bulbIsOn || false;
window.currentSequenceName = 'morning'; // Default sequence name
let currentColorStep = null;
let whiteSliderStep = null;

// Load list of sequences and populate dropdown
async function loadSequenceList(skipLoadingSequence = false) {
    try {
        const res = await fetch('/list-sequences');
        const sequences = await res.json();
        const selector = document.getElementById('sequenceSelector');
        const editorUI = document.getElementById('editorUI');
        if (!selector) return;
        
        selector.innerHTML = '';
        if (sequences.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '-- Create a new sequence --';
            selector.appendChild(opt);
            window.currentSequenceName = null;
            if (editorUI) editorUI.style.display = 'none';
        } else {
            sequences.forEach(seq => {
                const opt = document.createElement('option');
                opt.value = seq.name;
                opt.textContent = `${seq.name} (${seq.stepCount} steps${seq.enabled ? ', enabled' : ''})`;
                selector.appendChild(opt);
            });
            // If not skipping and no current sequence, load first one
            if (!skipLoadingSequence && !window.currentSequenceName) {
                window.currentSequenceName = sequences[0].name;
                selector.value = window.currentSequenceName;
                if (editorUI) editorUI.style.display = 'block';
                await loadSequence(window.currentSequenceName);
            } else if (!skipLoadingSequence && window.currentSequenceName) {
                // Set selector to current sequence if it exists in the list
                const exists = sequences.find(s => s.name === window.currentSequenceName);
                if (exists) {
                    selector.value = window.currentSequenceName;
                    // Reload the current sequence to make sure it's displayed
                    await loadSequence(window.currentSequenceName);
                }
            }
        }
    } catch (e) {
        console.error('Error loading sequence list:', e);
        window.currentSequenceName = null;
        window.sequence = [];
        const editorUI = document.getElementById('editorUI');
        if (editorUI) editorUI.style.display = 'none';
        renderSteps();
    }
}

// Load a specific sequence
async function loadSequence(name) {
    try {
        const res = await fetch(`/get-sequence/${name}`);
        const data = await res.json();
        window.currentSequenceName = name;
        const editorUI = document.getElementById('editorUI');
        
        if (data && Array.isArray(data.steps)) {
            window.sequence = data.steps;
            if (data.startTime) {
                const startTimeInput = document.getElementById('startTime');
                if (startTimeInput) startTimeInput.value = String(data.startTime);
            }
            if (data.duration) {
                const durationInput = document.getElementById('duration');
                let durationVal = data.duration;
                if (typeof durationVal === 'string') durationVal = Number(durationVal);
                if (durationInput) durationInput.value = durationVal;
            }
            // Update enabled checkbox
            const enabledCheckbox = document.getElementById('sequenceEnabledCheckbox');
            if (enabledCheckbox) enabledCheckbox.checked = data.enabled ?? false;
            if (editorUI) editorUI.style.display = 'block';
        } else {
            window.sequence = [];
            const enabledCheckbox = document.getElementById('sequenceEnabledCheckbox');
            if (enabledCheckbox) enabledCheckbox.checked = false;
            if (editorUI) editorUI.style.display = 'block';
        }
        renderSteps();
    } catch (e) {
        console.error('Error loading sequence:', e);
        window.sequence = [];
        const editorUI = document.getElementById('editorUI');
        if (editorUI) editorUI.style.display = 'none';
        renderSteps();
    }
}

function setupTimeInputsRerender() {
    const startTimeInput = document.getElementById('startTime');
    const durationInput = document.getElementById('duration');
    if (startTimeInput) startTimeInput.addEventListener('input', renderSteps);
    if (durationInput) durationInput.addEventListener('input', renderSteps);
}

function setupSequenceControls() {
    // Sequence selector
    const selector = document.getElementById('sequenceSelector');
    if (selector) {
        selector.addEventListener('change', async function() {
            const editorUI = document.getElementById('editorUI');
            if (!this.value) {
                // No sequence selected
                if (editorUI) editorUI.style.display = 'none';
                window.currentSequenceName = null;
                window.sequence = [];
            } else {
                if (editorUI) editorUI.style.display = 'block';
                await loadSequence(this.value);
            }
        });
    }
    
    // New sequence button
    const newBtn = document.getElementById('newSequenceBtn');
    if (newBtn) {
        newBtn.addEventListener('click', async function() {
            const name = prompt('Enter new sequence name:');
            if (!name) return;
            // Create new empty sequence
            window.currentSequenceName = name;
            window.sequence = [];
            const startTimeInput = document.getElementById('startTime');
            const durationInput = document.getElementById('duration');
            if (startTimeInput) startTimeInput.value = '06:00';
            if (durationInput) durationInput.value = '60';
            const enabledCheckbox = document.getElementById('sequenceEnabledCheckbox');
            if (enabledCheckbox) enabledCheckbox.checked = false;
            const editorUI = document.getElementById('editorUI');
            if (editorUI) editorUI.style.display = 'block';
            renderSteps();
            // Add to dropdown temporarily
            if (selector) {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = `${name} (0 steps)`;
                selector.appendChild(opt);
                selector.value = name;
            }
        });
    }
    
    // Delete sequence button
    const deleteBtn = document.getElementById('deleteSequenceBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async function() {
            if (!confirm(`Delete sequence "${window.currentSequenceName}"?`)) return;
            try {
                await fetch(`/delete-sequence/${window.currentSequenceName}`, { method: 'DELETE' });
                window.currentSequenceName = null; // Reset so next sequence will be loaded
                await loadSequenceList();
            } catch (e) {
                alert('Error deleting sequence: ' + e.message);
            }
        });
    }
    
    // Enabled checkbox
    const enabledCheckbox = document.getElementById('sequenceEnabledCheckbox');
    if (enabledCheckbox) {
        enabledCheckbox.addEventListener('change', async function() {
            // Enabled status is saved with the sequence when user clicks Save
            // No immediate backend call needed - just update the UI state
            console.log('Enabled status will be saved when sequence is saved');
        });
    }
}

// Fetch available scenes from the bulb
async function loadAvailableScenes() {
    try {
        const res = await fetch('/bulb/scenes');
        const data = await res.json();
        // Store scenes - data structure depends on what Tuya returns
        window.availableScenes = data;
    } catch (e) {
        console.error('Error loading scenes:', e);
        window.availableScenes = [];
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        await loadAvailableScenes();
        loadSequenceList();
        setupTimeInputsRerender();
        setupSequenceControls();
    });
} else {
    (async () => {
        await loadAvailableScenes();
        loadSequenceList();
        setupTimeInputsRerender();
        setupSequenceControls();
    })();
}

function addStep() {
    window.sequence.push({ work_mode: 'colour', hue: 0, saturation: 0, brightness: 0, on: true });
    renderSteps();
}

function getStepTimes() {
    const startTimeStr = document.getElementById('startTime')?.value;
    const duration = Number(document.getElementById('duration')?.value) || 60;
    let times = [];
    const stepCount = window.sequence.length;
    if (!startTimeStr || !/^\d{2}:\d{2}$/.test(startTimeStr) || stepCount === 0) {
        for (let i = 0; i < stepCount; ++i) times.push('--:--');
        return times;
    }
    const [h, m] = startTimeStr.split(':').map(Number);
    let totalMinutes = h * 60 + m;
    const stepDuration = duration / stepCount;
    for (let i = 0; i < stepCount; ++i) {
        let stepH = Math.floor(totalMinutes / 60) % 24;
        let stepM = Math.round(totalMinutes % 60);
        times.push((stepH < 10 ? '0' : '') + stepH + ':' + (stepM < 10 ? '0' : '') + stepM);
        totalMinutes += stepDuration;
    }
    return times;
}

function renderSteps() {
    const stepsDiv = document.getElementById('steps');
    stepsDiv.innerHTML = '';
    const stepTimes = getStepTimes();
    window.sequence.forEach((step, i) => {
        let color = '#fff';
        if (step.work_mode === 'colour') {
            let h = step.hue || 0;
            let s = ((step.saturation || 0) / 255) * 100;
            let v = ((step.brightness || 0) / 255) * 100;
            if (window.iro && window.iro.Color) {
                const c = new window.iro.Color({ h, s, v });
                color = c.hexString;
            } else {
                color = hsvToRgb(step.hue, step.saturation, step.brightness);
            }
        }
        let html = '<div data-index="' + i + '" class="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition">';
        html += '<span class="text-sm text-gray-600 dark:text-gray-400 font-mono min-w-[60px]">' + stepTimes[i] + '</span>';
        
        // Color/White preview first (before mode dropdown)
        if (step.work_mode === 'colour') {
            let previewColor = color;
            if (currentColorStep === i && window.iroPicker) {
                const c = window.iroPicker.color;
                previewColor = c.hexString;
            }
            html += '<span class="color-preview cursor-pointer" style="background:' + previewColor + ';" onclick="openColorPicker(' + i + ')"></span>';
        } else if (step.work_mode === 'white') {
            let bright = typeof step.brightness === 'number' ? step.brightness : 255;
            let temp = typeof step.temperature === 'number' ? step.temperature : 255;
            function tempToRGB(temp, bright) {
                let t = temp / 255;
                let r = Math.round((1 - t) * 255 + t * 201);
                let g = Math.round((1 - t) * 197 + t * 226);
                let b = Math.round((1 - t) * 143 + t * 255);
                let scale = bright / 255;
                r = Math.round(r * scale);
                g = Math.round(g * scale);
                b = Math.round(b * scale);
                return `rgb(${r},${g},${b})`;
            }
            let white = tempToRGB(temp, bright);
            html += '<span class="color-preview cursor-pointer" style="background:' + white + ';" title="Click to edit with sliders" onclick="showWhiteSliders(' + i + ')"></span>';
        }
        
        // Mode dropdown (without "Mode:" prefix)
        html += '<select class="mode-select px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" data-index="' + i + '">';
        html += '<option value="colour"' + (step.work_mode === 'colour' ? ' selected' : '') + '>Colour</option>';
        html += '<option value="white"' + (step.work_mode === 'white' ? ' selected' : '') + '>White</option>';
        html += '<option value="scene"' + (step.work_mode === 'scene' ? ' selected' : '') + '>Scene</option>';
        html += '</select>';
        
        // Mode-specific UI (sliders/scene selector)
        if (step.work_mode === 'white') {
            if (whiteSliderStep == i) {
                html += '<div class="flex items-center gap-3 ml-2">';
                html += '<label class="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">Brightness: <input type="range" min="0" max="255" class="bright-slider w-32" data-index="' + i + '" value="' + (typeof step.brightness === 'number' ? step.brightness : 255) + '"></label>';
                html += '<label class="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">Temperature: <input type="range" min="0" max="255" class="temp-slider w-32" data-index="' + i + '" value="' + (typeof step.temperature === 'number' ? step.temperature : 255) + '"></label>';
                html += '</div>';
            }
        } else if (step.work_mode === 'scene') {
            let sceneId = step.sceneId || '';
            let sceneHue = step.sceneHue || 240;
            html += '<select class="scene-select px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent ml-2" data-index="' + i + '" title="Flash scenes with color effect">';
            html += '<option value="">-- Select Scene --</option>';
            // Add flash_scene options
            if (window.availableScenes && Array.isArray(window.availableScenes)) {
                window.availableScenes.forEach(scene => {
                    if (scene.code && scene.code.startsWith('flash_scene_')) {
                        const name = scene.code.replace('flash_scene_', 'Flash Scene ');
                        html += '<option value="' + scene.code + '"' + (sceneId === scene.code ? ' selected' : '') + '>' + name + '</option>';
                    }
                });
            }
            html += '</select>';
            html += ' <label class="text-sm text-gray-700 dark:text-gray-300 ml-2">Color: <input type="number" min="0" max="360" class="scene-hue-input w-16 px-2 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white rounded" data-index="' + i + '" value="' + sceneHue + '" title="Hue (0-360)"></label>';
        }
        window.showWhiteSliders = function (i) {
            whiteSliderStep = Number(i);
            currentColorStep = null;
            renderSteps();
        }
        html += '<label class="flex items-center gap-1 ml-auto"><input type="checkbox" class="on-checkbox w-4 h-4 text-blue-600 rounded" data-index="' + i + '"' + (step.on ? ' checked' : '') + '> <span class="text-sm text-gray-700 dark:text-gray-300">On</span></label>';
        html += '<button class="del-btn px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-md transition" data-index="' + i + '">Delete</button>';
        html += '</div>';
        stepsDiv.innerHTML += html;
    });
    // Add event listeners (event delegation)
    stepsDiv.querySelectorAll('.mode-select').forEach(el => {
        el.onchange = function () {
            const idx = this.dataset.index;
            updateStep(idx, 'work_mode', this.value);
            // If switching to white mode, show sliders
            if (this.value === 'white') {
                whiteSliderStep = Number(idx);
                renderSteps();
            } else {
                whiteSliderStep = null;
                // Close color picker if it's open
                closeColorPicker();
            }
        };
    });
    stepsDiv.querySelectorAll('.hue-input').forEach(el => {
        el.oninput = function () {
            updateStep(this.dataset.index, 'hue', this.value, true);
        };
        el.onchange = function () {
            updateStep(this.dataset.index, 'hue', this.value);
        };
    });
    stepsDiv.querySelectorAll('.sat-input').forEach(el => {
        el.oninput = function () {
            updateStep(this.dataset.index, 'saturation', this.value, true);
        };
        el.onchange = function () {
            updateStep(this.dataset.index, 'saturation', this.value);
        };
    });
    stepsDiv.querySelectorAll('.bright-input').forEach(el => {
        el.oninput = function () {
            updateStep(this.dataset.index, 'brightness', this.value, true);
        };
        el.onchange = function () {
            updateStep(this.dataset.index, 'brightness', this.value);
        };
    });
    stepsDiv.querySelectorAll('.bright-slider').forEach(el => {
        const idx = el.dataset.index;
        const tempEl = stepsDiv.querySelector('.temp-slider[data-index="' + idx + '"]');
        const preview = stepsDiv.querySelector('div[data-index="' + idx + '"] .color-preview');
        function tempToRGB(temp, bright) {
            let t = temp / 255;
            let r = Math.round((1 - t) * 255 + t * 201);
            let g = Math.round((1 - t) * 197 + t * 226);
            let b = Math.round((1 - t) * 143 + t * 255);
            let scale = bright / 255;
            r = Math.round(r * scale);
            g = Math.round(g * scale);
            b = Math.round(b * scale);
            return `rgb(${r},${g},${b})`;
        }
        el.oninput = function () {
            window.sequence[idx].brightness = Number(this.value);
            if (preview && tempEl) preview.style.background = tempToRGB(Number(tempEl.value), Number(this.value));
            if (window.liveSyncEnabled) {
                const step = window.sequence[idx];
                fetch('/bulb/color', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        work_mode: 'white',
                        brightness: step.brightness,
                        temperature: step.temperature
                    })
                });
            }
        };
        el.onchange = function () {
            renderSteps();
        };
    });
    stepsDiv.querySelectorAll('.temp-slider').forEach(el => {
        const idx = el.dataset.index;
        const brightEl = stepsDiv.querySelector('.bright-slider[data-index="' + idx + '"]');
        const preview = stepsDiv.querySelector('div[data-index="' + idx + '"] .color-preview');
        function tempToRGB(temp, bright) {
            let t = temp / 255;
            let r = Math.round((1 - t) * 255 + t * 201);
            let g = Math.round((1 - t) * 197 + t * 226);
            let b = Math.round((1 - t) * 143 + t * 255);
            let scale = bright / 255;
            r = Math.round(r * scale);
            g = Math.round(g * scale);
            b = Math.round(b * scale);
            return `rgb(${r},${g},${b})`;
        }
        el.oninput = function () {
            window.sequence[idx].temperature = Number(this.value);
            if (preview && brightEl) preview.style.background = tempToRGB(Number(this.value), Number(brightEl.value));
            if (window.liveSyncEnabled) {
                const step = window.sequence[idx];
                fetch('/bulb/color', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        work_mode: 'white',
                        brightness: step.brightness,
                        temperature: step.temperature
                    })
                });
            }
        };
        el.onchange = function () {
            renderSteps();
        };
    });
    stepsDiv.querySelectorAll('.temp-input').forEach(el => {
        el.onchange = function () { updateStep(this.dataset.index, 'temperature', this.value); };
    });
    stepsDiv.querySelectorAll('.on-checkbox').forEach(el => {
        el.onchange = function () { updateStep(this.dataset.index, 'on', this.checked); };
    });
    stepsDiv.querySelectorAll('.scene-select').forEach(el => {
        el.onchange = function () {
            const idx = this.dataset.index;
            updateStep(idx, 'sceneId', this.value);
            // Live sync
            if (window.liveSyncEnabled && this.value) {
                const hue = parseInt(document.querySelector(`.scene-hue-input[data-index="${idx}"]`)?.value || '240');
                fetch('/bulb/color', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        work_mode: 'scene',
                        sceneId: this.value,
                        sceneValue: { h: hue, s: 255, v: 255 }
                    })
                });
            }
        };
    });
    stepsDiv.querySelectorAll('.scene-hue-input').forEach(el => {
        el.onchange = function () {
            updateStep(this.dataset.index, 'sceneHue', this.value);
        };
    });
    stepsDiv.querySelectorAll('.del-btn').forEach(el => {
        el.onclick = function () { removeStep(this.dataset.index); };
    });
}

function openColorPicker(i) {
    currentColorStep = i;
    whiteSliderStep = null;
    const step = window.sequence[i];
    document.getElementById('colorPickerModal').style.display = 'block';
    window._originalColor = { h: step.hue, s: step.saturation, v: step.brightness };
    async function updateLivePreview() {
        renderSteps();
        if (window.liveSyncEnabled && window.iroPicker) {
            const color = window.iroPicker.color;
            await fetch('/bulb/color', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hue: color.hue,
                    saturation: Math.round(color.saturation * 2.55),
                    brightness: Math.round(color.value * 2.55)
                })
            });
        }
    }
    function setupPicker() {
        const h = step.hue || 0;
        const s = ((step.saturation || 0) / 255) * 100;
        const v = ((step.brightness || 0) / 255) * 100;
        if (!window.iroPicker) {
            window.iroPicker = new window.iro.ColorPicker('#colorPicker', {
                width: 250,
                color: { h, s, v },
                layout: [
                    { component: window.iro.ui.Wheel },
                    { component: window.iro.ui.Slider, options: { sliderType: 'value' } }
                ]
            });
            window.iroPicker.on('color:change', updateLivePreview);
        } else {
            window.iroPicker.color.hue = h;
            window.iroPicker.color.saturation = s;
            window.iroPicker.color.value = v;
            window.iroPicker.off('color:change', updateLivePreview);
            window.iroPicker.on('color:change', updateLivePreview);
        }
    }
    if (typeof window.iro === 'undefined') {
        const checkIro = setInterval(() => {
            if (typeof window.iro !== 'undefined') {
                clearInterval(checkIro);
                setupPicker();
            }
        }, 50);
    } else {
        setupPicker();
    }
    setTimeout(() => {
        document.getElementById('applyColorBtn').onclick = async function (e) {
            e.preventDefault();
            if (currentColorStep !== null) {
                const color = window.iroPicker.color;
                window.sequence[currentColorStep].hue = color.hue;
                window.sequence[currentColorStep].saturation = Math.round(color.saturation * 2.55);
                window.sequence[currentColorStep].brightness = Math.round(color.value * 2.55);
                renderSteps();
                // Return bulb to original color
                if (window.liveSyncEnabled && window._originalColor) {
                    await fetch('/bulb/color', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            hue: window._originalColor.h,
                            saturation: window._originalColor.s,
                            brightness: window._originalColor.v
                        })
                    });
                }
            }
            closeColorPicker();
        };
        document.getElementById('cancelColorBtn').onclick = async function (e) {
            e.preventDefault();
            if (currentColorStep !== null && window._originalColor) {
                window.sequence[currentColorStep].hue = window._originalColor.h;
                window.sequence[currentColorStep].saturation = window._originalColor.s;
                window.sequence[currentColorStep].brightness = window._originalColor.v;
                // Return bulb to original color
                if (window.liveSyncEnabled) {
                    await fetch('/bulb/color', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            hue: window._originalColor.h,
                            saturation: window._originalColor.s,
                            brightness: window._originalColor.v
                        })
                    });
                }
            }
            closeColorPicker();
            renderSteps();
        };
    }, 0);
}

function closeColorPicker() {
    document.getElementById('colorPickerModal').style.display = 'none';
    currentColorStep = null;
}

function updateStep(i, key, value, skipRender) {
    if (key === 'on') value = value ? true : false;
    else if (key === 'work_mode' || key === 'sceneId') value = value; // Keep as string
    else if (key === 'sceneNum') value = value === null ? null : (typeof value === 'number' ? value : parseInt(value)); // Parse as number or null
    else value = Number(value);
    window.sequence[i][key] = value;
    if (!skipRender) renderSteps();
}

function removeStep(i) {
    window.sequence.splice(i, 1);
    renderSteps();
}

function hsvToRgb(h, s, v) {
    s /= 255; v /= 255;
    let c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    r = Math.round((r + m) * 255); g = Math.round((g + m) * 255); b = Math.round((b + m) * 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

async function saveSequence() {
    const startTime = document.getElementById('startTime').value;
    const duration = Number(document.getElementById('duration').value);
    const enabledCheckbox = document.getElementById('sequenceEnabledCheckbox');
    const enabled = enabledCheckbox ? enabledCheckbox.checked : false;
    
    const payload = {
        name: window.currentSequenceName,
        enabled: enabled,
        steps: window.sequence,
        startTime,
        duration
    };
    const res = await fetch('/save-sequence', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    document.getElementById('result').innerText = result.success ? `Saved sequence "${result.name}"` : 'Error saving sequence';
    await loadSequenceList();
}
