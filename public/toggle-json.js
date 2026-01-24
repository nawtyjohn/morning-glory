// Toggle the visibility of the advanced JSON editor
function toggleJson() {
    const editor = document.getElementById('jsonEditor');
    const btn = document.getElementById('toggleJsonBtn');
    if (!editor || !btn) return;
    if (editor.style.display === 'none' || editor.style.display === '') {
        editor.style.display = 'block';
        btn.textContent = 'Hide Advanced JSON Editor';
    } else {
        editor.style.display = 'none';
        btn.textContent = 'Show Advanced JSON Editor';
    }
}
