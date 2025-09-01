document.getElementById('printBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('file');
    if (!fileInput.files.length) {
        alert('Select an image');
        return;
    }
    const media = document.getElementById('media').value;
    const lang = document.getElementById('lang').value;
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('media', media);
    formData.append('lang', lang);
    const res = await fetch('/print', { method: 'POST', body: formData });
    if (res.ok) {
        alert('Sent to printer');
    } else {
        alert('Error');
    }
});
