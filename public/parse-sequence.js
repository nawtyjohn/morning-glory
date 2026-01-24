// Parse the JSON from the textarea and visualize the sequence
function parseSequence() {
    try {
        const json = JSON.parse(document.getElementById('seqJson').value);
        window.sequence = json.steps || [];
        if (json.startTime) {
            const startTimeInput = document.getElementById('startTime');
            if (startTimeInput) startTimeInput.value = String(json.startTime);
        }
        if (json.duration) {
            const durationInput = document.getElementById('duration');
            let durationVal = json.duration;
            if (typeof durationVal === 'string') durationVal = Number(durationVal);
            if (durationInput) durationInput.value = durationVal;
        }
        if (typeof renderSteps === 'function') renderSteps();
    } catch (e) {
        alert('Invalid JSON');
    }
}
