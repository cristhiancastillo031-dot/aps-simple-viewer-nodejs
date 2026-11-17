import { initViewer, loadModel } from './viewer.js';

initViewer(document.getElementById('preview')).then(viewer => {
    const urn = window.location.hash?.substring(1);
    setupModelSelection(viewer, urn);
    setupModelUpload(viewer);
});

async function setupModelSelection(viewer, selectedUrn) {
    const dropdown = document.getElementById('models');
    dropdown.replaceChildren();
    try {
        const resp = await fetch('/api/models');
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const models = await resp.json();
        dropdown.replaceChildren(...models.map(model => new Option(model.name, model.urn, false, model.urn === selectedUrn)));
        dropdown.onchange = () => onModelSelected(viewer, dropdown.value);
        if (dropdown.value) {
            onModelSelected(viewer, dropdown.value);
        }
    } catch (err) {
        alert('Could not list models. See the console for more details.');
        console.error(err);
    }
}

async function setupModelUpload(viewer) {
    const upload = document.getElementById('upload');
    const input = document.getElementById('input');
    const models = document.getElementById('models');
    upload.onclick = () => input.click();
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        upload.setAttribute('disabled', 'true');
        models.setAttribute('disabled', 'true');
        const filename = document.createElement('em');
        filename.textContent = file.name;
        showNotification('Uploading model ', filename, ' directly to Autodesk S3...');
        try {
            // 1. Pedir URL firmada de S3 al backend (solo envía el nombre)
            const urlResp = await fetch('/api/models/upload-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name })
            });
            if (!urlResp.ok) throw new Error(await urlResp.text());
            const { uploadKey, url } = await urlResp.json();

            // 2. Subir el archivo pesado DIRECTO a Amazon S3 (evita el límite de Codespaces)
            const s3Resp = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file
            });

            // 3. Avisar al backend que terminó e iniciar traducción
            const compResp = await fetch('/api/models/complete-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, uploadKey })
            });
            if (!compResp.ok) throw new Error(await compResp.text());
            const model = await compResp.json();

            setupModelSelection(viewer, model.urn);
        } catch (err) {
            alert(`Could not upload model ${file.name}. See the console for more details.`);
            console.error(err);
        } finally {
            clearNotification();
            upload.removeAttribute('disabled');
            models.removeAttribute('disabled');
            input.value = '';
        }
    };
}

async function onModelSelected(viewer, urn) {
    if (window.onModelSelectedTimeout) {
        clearTimeout(window.onModelSelectedTimeout);
        delete window.onModelSelectedTimeout;
    }
    window.location.hash = urn;
    try {
        const resp = await fetch(`/api/models/${urn}/status`);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const status = await resp.json();
        switch (status.status) {
            case 'n/a':
                showNotification(`Model has not been translated.`);
                break;
            case 'inprogress':
                showNotification(`Model is being translated (${status.progress})...`);
                window.onModelSelectedTimeout = setTimeout(onModelSelected, 5000, viewer, urn);
                break;
            case 'failed': {
                const list = document.createElement('ul');
                for (const msg of status.messages) {
                    const item = document.createElement('li');
                    item.textContent = JSON.stringify(msg);
                    list.append(item);
                }
                showNotification('Translation failed. ', list);
                break;
            }
            default:
                clearNotification();
                loadModel(viewer, urn);
                break; 
        }
    } catch (err) {
        alert('Could not load model. See the console for more details.');
        console.error(err);
    }
}

function showNotification(...content) {
    const overlay = document.getElementById('overlay');
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.append(...content);
    overlay.replaceChildren(notification);
    overlay.style.display = 'flex';
}

function clearNotification() {
    const overlay = document.getElementById('overlay');
    overlay.replaceChildren();
    overlay.style.display = 'none';
}
