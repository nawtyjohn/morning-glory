
// --- ADVANCED UI LOGIC RESTORED ---
window.sequence = window.sequence || [];
window.liveSyncEnabled = window.liveSyncEnabled || false;
window.bulbIsOn = window.bulbIsOn || false;
let currentColorStep = null;
let whiteSliderStep = null;

// Load sequence from backend on page load
async function loadSequenceFromBackend() {
    try {
        const res = await fetch('/get-sequence');
        const data = await res.json();
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
        } else {
            window.sequence = [];
        }
        renderSteps();
    } catch (e) {
        window.sequence = [];
        renderSteps();
    }
}

function setupTimeInputsRerender() {
    const startTimeInput = document.getElementById('startTime');
    const durationInput = document.getElementById('duration');
    if (startTimeInput) startTimeInput.addEventListener('input', renderSteps);
    if (durationInput) durationInput.addEventListener('input', renderSteps);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        loadSequenceFromBackend();
        setupTimeInputsRerender();
    });
} else {
    loadSequenceFromBackend();
    setupTimeInputsRerender();
}

function addStep() {
    window.sequence.push({ work_mode: 'colour', hue: 0, saturation: 0, brightness: 0, on: true });
    renderSteps();
}

function getStepTimes() {
    const startTimeStr = document.getElementById('startTime')?.value;
    const duration = Number(document.getElementById('duration')?.value) || 60;
    let times = [];
    if (!startTimeStr || !/^\d{2}:\d{2}$/.test(startTimeStr)) {
        for (let i = 0; i < window.sequence.length; ++i) times.push('--:--');
        return times;
    }
    const [h, m] = startTimeStr.split(':').map(Number);
    let totalMinutes = h * 60 + m;
    for (let i = 0; i < window.sequence.length; ++i) {
        let stepH = Math.floor(totalMinutes / 60) % 24;
        let stepM = totalMinutes % 60;
        times.push((stepH < 10 ? '0' : '') + stepH + ':' + (stepM < 10 ? '0' : '') + stepM);
        totalMinutes += duration;
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
        let html = '<div data-index="' + i + '">';
        html += '<span style="font-size:0.95em; color:#555; margin-right:8px; min-width:56px; display:inline-block;">' + stepTimes[i] + '</span>';
        if (step.work_mode === 'colour') {
            let previewColor = color;
            if (currentColorStep === i && window.iroPicker) {
                const c = window.iroPicker.color;
                previewColor = c.hexString;
            }
            html += '<span class="color-preview" style="background:' + previewColor + '; cursor:pointer;" onclick="openColorPicker(' + i + ')"></span>';
            html += 'Mode: <select class="mode-select" data-index="' + i + '">';
            html += '<option value="colour"' + (step.work_mode === 'colour' ? ' selected' : '') + '>Colour</option>';
            html += '<option value="white"' + (step.work_mode === 'white' ? ' selected' : '') + '>White</option>';
            html += '</select>';
        } else {
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
            html += '<span class="color-preview" style="background:' + white + '; margin-right:8px; border:2px solid #888; cursor:pointer;" title="Click to edit with sliders" onclick="showWhiteSliders(' + i + ')"></span>';
            html += 'Mode: <select class="mode-select" data-index="' + i + '">';
            html += '<option value="colour"' + (step.work_mode === 'colour' ? ' selected' : '') + '>Colour</option>';
            html += '<option value="white"' + (step.work_mode === 'white' ? ' selected' : '') + '>White</option>';
            html += '</select>';
            if (whiteSliderStep == i) {
                html += '<div style="display:inline-block; margin-left:10px; vertical-align:middle;">';
                html += '<label>Brightness: <input type="range" min="0" max="255" class="bright-slider" data-index="' + i + '" value="' + bright + '"></label>';
                html += '<label style="margin-left:8px;">Temperature: <input type="range" min="0" max="255" class="temp-slider" data-index="' + i + '" value="' + temp + '"></label>';
                html += '</div>';
            }
        }
        window.showWhiteSliders = function (i) {
            whiteSliderStep = Number(i);
            currentColorStep = null;
            renderSteps();
        }
        html += ' On: <input type="checkbox" class="on-checkbox" data-index="' + i + '"' + (step.on ? ' checked' : '') + '>';
        html += ' <button class="del-btn" data-index="' + i + '">Delete</button>';
        html += '</div>';
        stepsDiv.innerHTML += html;
    });
    // Add event listeners (event delegation)
    stepsDiv.querySelectorAll('.mode-select').forEach(el => {
        el.onchange = function () {
            updateStep(this.dataset.index, 'work_mode', this.value);
            whiteSliderStep = null;
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
    function updateLivePreview() {
        renderSteps();
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
        document.getElementById('applyColorBtn').onclick = function (e) {
            e.preventDefault();
            if (currentColorStep !== null) {
                const color = window.iroPicker.color;
                window.sequence[currentColorStep].hue = color.hue;
                window.sequence[currentColorStep].saturation = Math.round(color.saturation * 2.55);
                window.sequence[currentColorStep].brightness = Math.round(color.value * 2.55);
                renderSteps();
            }
            closeColorPicker();
        };
        document.getElementById('cancelColorBtn').onclick = function (e) {
            e.preventDefault();
            if (currentColorStep !== null && window._originalColor) {
                window.sequence[currentColorStep].hue = window._originalColor.h;
                window.sequence[currentColorStep].saturation = window._originalColor.s;
                window.sequence[currentColorStep].brightness = window._originalColor.v;
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
    else value = key === 'work_mode' ? value : Number(value);
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
    const payload = {
        steps: window.sequence,
        startTime,
        duration
    };
    const res = await fetch('/save-sequence', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
    });
    document.getElementById('result').innerText = await res.text();
}
