// Parse the JSON from the textarea and visualize the sequence
function parseSequence() {
    try {
        window.sequence = JSON.parse(document.getElementById('seqJson').value).steps || [];
        if (typeof renderSteps === 'function') renderSteps();
    } catch (e) {
        alert('Invalid JSON');
    }
}
