window.sequence = window.sequence || [];
window.liveSyncEnabled = window.liveSyncEnabled || false;
window.bulbIsOn = window.bulbIsOn || false;
let currentColorStep = null;

function addStep() {
    window.sequence.push({ work_mode: 'colour', hue: 0, saturation: 0, brightness: 0, on: true });
    renderSteps();
}

function renderSteps() {
    const stepsDiv = document.getElementById('steps');
    stepsDiv.innerHTML = '';
    window.sequence.forEach((step, i) => {
        let color = '#fff';
        if (step.work_mode === 'colour') {
            color = hsvToRgb(step.hue, step.saturation, step.brightness);
        }
        let html = '<div data-index="' + i + '">';
        html += '<span class="color-preview" style="background:' + color + '" onclick="openColorPicker(' + i + ')"></span>';
        html += 'Mode: <select class="mode-select" data-index="' + i + '">';
        html += '<option value="colour"' + (step.work_mode==='colour'?' selected':'') + '>Colour</option>';
        html += '<option value="white"' + (step.work_mode==='white'?' selected':'') + '>White</option>';
        html += '</select>';
        if (step.work_mode==='colour') {
            html += ' Hue: <input type="number" min="0" max="360" class="hue-input" data-index="' + i + '" value="' + step.hue + '">';
            html += ' Saturation: <input type="number" min="0" max="255" class="sat-input" data-index="' + i + '" value="' + step.saturation + '">';
            html += ' Brightness: <input type="number" min="0" max="255" class="bright-input" data-index="' + i + '" value="' + step.brightness + '">';
        } else {
            html += ' Brightness: <input type="number" min="0" max="255" class="bright-input" data-index="' + i + '" value="' + step.brightness + '">';
            html += ' Temperature: <input type="number" min="0" max="255" class="temp-input" data-index="' + i + '" value="' + (step.temperature||255) + '">';
        }
        html += ' On: <input type="checkbox" class="on-checkbox" data-index="' + i + '"' + (step.on?' checked':'') + '>';
        html += ' <button class="del-btn" data-index="' + i + '">Delete</button>';
        html += '</div>';
        stepsDiv.innerHTML += html;
    });
    // Add event listeners (event delegation)
    stepsDiv.querySelectorAll('.mode-select').forEach(el => {
        el.onchange = function() { updateStep(this.dataset.index, 'work_mode', this.value); };
    });
    stepsDiv.querySelectorAll('.hue-input').forEach(el => {
        el.onchange = function() { updateStep(this.dataset.index, 'hue', this.value); };
    });
    stepsDiv.querySelectorAll('.sat-input').forEach(el => {
        el.onchange = function() { updateStep(this.dataset.index, 'saturation', this.value); };
    });
    stepsDiv.querySelectorAll('.bright-input').forEach(el => {
        el.onchange = function() { updateStep(this.dataset.index, 'brightness', this.value); };
    });
    stepsDiv.querySelectorAll('.temp-input').forEach(el => {
        el.onchange = function() { updateStep(this.dataset.index, 'temperature', this.value); };
    });
    stepsDiv.querySelectorAll('.on-checkbox').forEach(el => {
        el.onchange = function() { updateStep(this.dataset.index, 'on', this.checked); };
    });
    stepsDiv.querySelectorAll('.del-btn').forEach(el => {
        el.onclick = function() { removeStep(this.dataset.index); };
    });
}

function openColorPicker(i) {
    currentColorStep = i;
    const step = window.sequence[i];
    document.getElementById('colorPickerModal').style.display = 'block';
    function setupPicker() {
        if (!window.iroPicker) {
            window.iroPicker = new window.iro.ColorPicker('#colorPicker', {
                width: 250,
                color: { h: step.hue || 0, s: (step.saturation || 0) / 255, v: (step.brightness || 0) / 255 },
                layout: [
                    { component: window.iro.ui.Wheel },
                    { component: window.iro.ui.Slider, options: { sliderType: 'value' } }
                ]
            });
            window.iroPicker.on('color:change', function(color) {
                if (currentColorStep !== null) {
                    window.sequence[currentColorStep].hue = color.hue;
                    window.sequence[currentColorStep].saturation = Math.round(color.saturation * 2.55);
                    window.sequence[currentColorStep].brightness = Math.round(color.value * 2.55);
                    renderSteps();
                    if (window.liveSyncEnabled && window.bulbIsOn) {
                        sendColorToBulb(color.hue, Math.round(color.saturation * 2.55), Math.round(color.value * 2.55));
                    }
                }
            });
        } else {
            window.iroPicker.color.hue = step.hue || 0;
            window.iroPicker.color.saturation = (step.saturation || 0) / 2.55;
            window.iroPicker.color.value = (step.brightness || 0) / 2.55;
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
}

function closeColorPicker() {
    document.getElementById('colorPickerModal').style.display = 'none';
    currentColorStep = null;
}

function updateStep(i, key, value) {
    if (key === 'on') value = value ? true : false;
    else value = key === 'work_mode' ? value : Number(value);
    window.sequence[i][key] = value;
    renderSteps();
}

function removeStep(i) {
    window.sequence.splice(i,1);
    renderSteps();
}

function hsvToRgb(h,s,v) {
    s /= 255; v /= 255;
    let c = v * s, x = c * (1 - Math.abs((h/60)%2-1)), m = v-c;
    let r=0,g=0,b=0;
    if (h<60) {r=c;g=x;} else if (h<120) {r=x;g=c;} else if (h<180) {g=c;b=x;} else if (h<240) {g=x;b=c;} else if (h<300) {r=x;b=c;} else {r=c; b=x;}
    r=Math.round((r+m)*255);g=Math.round((g+m)*255);b=Math.round((b+m)*255);
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
