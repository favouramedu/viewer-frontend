(() => {
  // === EDIT THIS if your Function App host differs ===
  window.VIEWER_CONFIG = {
    apiBase: 'https://func-viewer-ecd3gpgfcxbwaqb3.eastus-01.azurewebsites.net/api'
  };

  // Carry the signed-in user to Functions (SWA -> Functions header)
  let PRINCIPAL_B64 = null;
  (async () => {
    try {
      const r = await fetch('/.auth/me', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        const me = Array.isArray(d) ? d[0] : (d && d.clientPrincipal) || null;
        if (me) PRINCIPAL_B64 = btoa(JSON.stringify(me));
        // UI hint
        const pill = document.getElementById('user-pill');
        if (pill && me) { pill.style.display = 'inline-block'; pill.textContent = me.userDetails || me.userId; }
      }
    } catch {}
  })();

  // Fetch wrapper
  const API = (path, opts = {}) => {
    const base = (window.VIEWER_CONFIG && window.VIEWER_CONFIG.apiBase) || '/api';
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (PRINCIPAL_B64) headers['x-ms-client-principal'] = PRINCIPAL_B64;

    return fetch(base + path, {
      method: opts.method || 'GET',
      headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text().catch(() => r.statusText);
        throw new Error(text || `HTTP ${r.status}`);
      }
      const ct = r.headers.get('content-type') || '';
      return ct.includes('json') ? r.json() : r.text();
    });
  };

  const $ = s => document.querySelector(s);
  const byId = id => document.getElementById(id);

  async function me() {
    try { return await API('/me'); } catch { return null; }
  }

  // Home feed
  async function initIndex() {
    const feed = byId('feed');
    if (!feed) return;

    const q = new URLSearchParams(location.search).get('q') || '';
    let items = [];
    try { items = await API(`/videos?search=${encodeURIComponent(q)}`); }
    catch (e) { console.warn('videos', e); }

    feed.innerHTML = '';
    (items || []).forEach(v => {
      const card = document.createElement('article');
      card.className = 'video-card';
      const thumb = v.thumbUrl || '';
      const title = v.title || 'Untitled';
      card.innerHTML = `
        <a href="watch.html?id=${encodeURIComponent(v.id)}">
          <img src="${thumb}" alt="">
        </a>
        <header><h3 style="margin:.25rem 0 .25rem .1rem"><a href="watch.html?id=${encodeURIComponent(v.id)}">${title}</a></h3></header>
        <p>${(v.publisher||'')}&nbsp;•&nbsp;${(v.genre||'')}&nbsp;•&nbsp;${(v.ageRating||'')}</p>
        <footer><a href="watch.html?id=${encodeURIComponent(v.id)}">Open</a></footer>`;
      feed.appendChild(card);
    });
  }

  // Watch page
  async function initWatch() {
    const player = byId('player');
    if (!player) return;

    const id = new URLSearchParams(location.search).get('id');
    if (!id) { location.replace('/'); return; }

    const v = await API(`/videos/${id}`);
    byId('video-title').textContent = v.title || 'Video';
    [['publisher', v.publisher], ['producer', v.producer], ['genre', v.genre], ['age-rating', v.ageRating]]
      .forEach(([k, val]) => { const el = document.querySelector(`[data-field="${k}"]`); if (el) el.textContent = val || ''; });

    const src = v.hlsUrl || v.blobUrl || '';
    player.querySelector('source').src = src;
    player.load();

    // comments
    const list = byId('comments-list');
    if (list) {
      const comments = await API(`/videos/${id}/comments`).catch(() => []);
      list.innerHTML = '';
      comments.forEach(c => {
        const li = document.createElement('li');
        li.textContent = `${c.user || 'anon'}: ${c.text}`;
        list.appendChild(li);
      });
    }

    byId('comment-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const text = (byId('comment-text')?.value || '').trim();
      if (!text) return;
      await API(`/videos/${id}/comments`, { method: 'POST', body: { text } });
      location.reload();
    });

    byId('rate-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      await API(`/videos/${id}/ratings`, { method: 'POST', body: { stars: Number(byId('stars').value || 5) } });
      alert('Thanks!');
    });
  }

  // Upload page
  async function initUpload() {
    const form = byId('upload-form');
    if (!form) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const file = byId('file').files[0];
        if (!file) return alert('Pick a video file first.');
        const meta = {
          title: byId('title').value.trim(),
          publisher: byId('publisher').value.trim(),
          producer: byId('producer').value.trim(),
          genre: byId('genre').value,
          ageRating: byId('age-rating').value,
          ext: (file.name.split('.').pop() || 'mp4').toLowerCase()
        };

        // 1) init
        const init = await API('/videos/init', { method: 'POST', body: meta });

        // 2) PUT to Blob SAS
        const put = await fetch(init.sasUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob' }, body: file });
        if (!put.ok) throw new Error('Blob upload failed: ' + put.status);

        // 3) finalize
        await API(`/videos/${init.videoId}/finalize`, { method: 'POST', body: meta });

        alert('Uploaded!');
        location.href = 'dashboard.html';
      } catch (err) {
        console.error(err);
        alert('Upload failed: ' + err.message);
      }
    });
  }

  // Dashboard page
  async function initDashboard() {
    const tbody = document.querySelector('table tbody');
    if (!tbody) return;

    let list = [];
    try { list = await API('/videos'); }
    catch (e) { console.warn('dash videos', e); }

    tbody.innerHTML = '';
    (list || []).forEach(v => {
      const tr = document.createElement('tr');
      const created = (v.createdAt || '').slice(0, 10);
      tr.innerHTML = `
        <td>${v.title || ''}</td>
        <td>${v.status || ''}</td>
        <td>${created}</td>
        <td>${v.views || 0}</td>
        <td>${v.ratingAvg || '—'}</td>
        <td><a href="watch.html?id=${encodeURIComponent(v.id)}">Open</a></td>`;
      tbody.appendChild(tr);
    });
  }

  // Wire up page behaviors
  document.addEventListener('DOMContentLoaded', () => {
    initIndex(); initWatch(); initUpload(); initDashboard();

    // search
    document.querySelector('form[role="search"]')?.addEventListener('submit', e => {
      e.preventDefault();
      const q = document.getElementById('q').value.trim();
      location.href = q ? `/?q=${encodeURIComponent(q)}` : '/';
    });
  });
})();
