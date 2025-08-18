((() => {
  'use strict';

  /**********************
   * CONFIG
   **********************/
  // Point the frontend at your Azure Function App
  window.VIEWER_CONFIG = {
    apiBase:
      'https://func-viewer-ecd3gpgfcxbwaqb3.eastus-01.azurewebsites.net/api',
  };

  /**********************
   * AUTH BRIDGE (optional)
   * Pull the SWA identity and pass it to Functions so
   * your backend can know who the user is.
   **********************/
  let PRINCIPAL_B64 = null;
  (async () => {
    try {
      const r = await fetch('/.auth/me', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        const me = Array.isArray(d) ? d[0] : d?.clientPrincipal || null;
        if (me) PRINCIPAL_B64 = btoa(JSON.stringify(me));
      }
    } catch {
      /* ignore */
    }
  })();

  /**********************
   * UTILITIES
   **********************/
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  const byId = (id) => document.getElementById(id);

  // Generic API caller
  const API = (path, opts = {}) => {
    const base = window.VIEWER_CONFIG?.apiBase || '/api';
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (PRINCIPAL_B64) headers['x-ms-client-principal'] = PRINCIPAL_B64;

    return fetch(base + path, {
      method: opts.method || 'GET',
      headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(async (r) => {
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || `HTTP ${r.status}`);
      }
      const ct = r.headers.get('content-type') || '';
      return ct.includes('json') ? r.json() : r.text();
    });
  };

  const safeText = (v, d = '') => (v == null ? d : String(v));
  const fmtDate = (s) => (s ? s.slice(0, 10) : '');

  /**********************
   * BACKEND HELPERS
   **********************/
  async function me() {
    try {
      return await API('/me');
    } catch {
      return null;
    }
  }

  /**********************
   * PAGES
   **********************/
  // Home / listing page
  async function initIndex() {
    const feed = byId('feed');
    if (!feed) return;

    // Top-right pill
    const pill = byId('user-pill');
    try {
      const user = await me();
      if (user && pill) {
        pill.style.display = 'inline-block';
        pill.textContent = `Signed in: ${user.name || user.userId}`;
      }
    } catch {}

    // Search
    const q = new URLSearchParams(location.search).get('q') || '';
    let list = [];
    try {
      list = await API(`/videos?search=${encodeURIComponent(q)}`);
    } catch (e) {
      feed.innerHTML = `<p class="muted">Couldn’t load videos: ${safeText(e.message)}</p>`;
      return;
    }

    feed.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0) {
      feed.innerHTML = `<p class="muted">No videos found.</p>`;
      return;
    }

    list.forEach((v) => {
      const el = document.createElement('article');
      el.className = 'video-card';
      el.innerHTML = `
        <a href="watch.html?id=${encodeURIComponent(v.id)}">
          <img src="${safeText(v.thumbUrl)}" alt="">
        </a>
        <header>
          <h2><a href="watch.html?id=${encodeURIComponent(v.id)}">${safeText(v.title, 'Untitled')}</a></h2>
        </header>
        <p>${safeText(v.publisher)} • ${safeText(v.genre)} • ${safeText(v.ageRating)}</p>
        <footer>
          <a href="watch.html?id=${encodeURIComponent(v.id)}">Open</a>
        </footer>
      `;
      feed.appendChild(el);
    });
  }

  // Watch page
  async function initWatch() {
    const player = byId('player');
    if (!player) return;

    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
      location.href = '/';
      return;
    }

    let v;
    try {
      v = await API(`/videos/${encodeURIComponent(id)}`);
    } catch (e) {
      byId('watch-container')?.insertAdjacentHTML(
        'afterbegin',
        `<p class="error">Couldn’t load video: ${safeText(e.message)}</p>`
      );
      return;
    }

    byId('video-title').textContent = safeText(v.title, 'Video');

    // Fill metadata fields
    [
      ['publisher', v.publisher],
      ['producer', v.producer],
      ['genre', v.genre],
      ['age-rating', v.ageRating],
    ].forEach(([k, val]) => {
      const el = document.querySelector(`[data-field="${k}"]`);
      if (el) el.textContent = safeText(val);
    });

    // Load source
    const src = v.hlsUrl || v.blobUrl || '';
    player.querySelector('source').src = src;
    player.load();

    // Comments
    const list = byId('comments-list');
    try {
      const comments = await API(`/videos/${encodeURIComponent(id)}/comments`);
      list.innerHTML = '';
      (comments || []).forEach((c) => {
        const li = document.createElement('li');
        li.textContent = `${safeText(c.user, 'anon')}: ${safeText(c.text)}`;
        list.appendChild(li);
      });
    } catch {
      list.innerHTML = '<li class="muted">No comments</li>';
    }

    // Add comment
    const commentForm = byId('comment-form');
    commentForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = byId('comment-text')?.value?.trim();
      if (!text) return;
      await API(`/videos/${encodeURIComponent(id)}/comments`, {
        method: 'POST',
        body: { text },
      });
      location.reload();
    });

    // Rate
    const rateForm = byId('rate-form');
    rateForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const stars = Number(byId('stars')?.value || 5);
      await API(`/videos/${encodeURIComponent(id)}/ratings`, {
        method: 'POST',
        body: { stars },
      });
      alert('Thanks!');
    });
  }

  // Upload page
  async function initUpload() {
    const form = byId('upload-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const file = byId('file')?.files?.[0];
      if (!file) return alert('Pick a file');

      const meta = {
        title: byId('title')?.value?.trim(),
        publisher: byId('publisher')?.value?.trim(),
        producer: byId('producer')?.value?.trim(),
        genre: byId('genre')?.value,
        ageRating: byId('age-rating')?.value,
        ext: (file.name.split('.').pop() || 'mp4').toLowerCase(),
      };

      try {
        // 1) Ask backend for SAS and a videoId
        const init = await API('/videos/init', { method: 'POST', body: meta });

        // 2) Upload blob directly to Storage
        const put = await fetch(init.sasUrl, {
          method: 'PUT',
          headers: { 'x-ms-blob-type': 'BlockBlob' },
          body: file,
        });
        if (!put.ok) throw new Error('Blob upload failed');

        // 3) Finalize on backend
        await API(`/videos/${encodeURIComponent(init.videoId)}/finalize`, {
          method: 'POST',
          body: meta,
        });

        alert('Uploaded!');
        location.href = 'dashboard.html';
      } catch (err) {
        alert(`Upload failed: ${safeText(err.message)}`);
      }
    });
  }

  // Dashboard page
  async function initDashboard() {
    const tbody = qs('table tbody');
    if (!tbody) return;

    let list = [];
    try {
      list = await API('/videos');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="error">Couldn’t load list: ${safeText(
        e.message
      )}</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No videos yet.</td></tr>`;
      return;
    }

    list.forEach((v) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${safeText(v.title)}</td>
        <td>${safeText(v.status)}</td>
        <td>${fmtDate(v.createdAt)}</td>
        <td>${safeText(v.views, 0)}</td>
        <td>${safeText(v.ratingAvg, '—')}</td>
        <td><a href="watch.html?id=${encodeURIComponent(v.id)}">Open</a></td>
      `;
      tbody.appendChild(tr);
    });
  }

  /**********************
   * WIRE-UP
   **********************/
  document.addEventListener('DOMContentLoaded', () => {
    // Run the right initializer(s) depending on which elements exist
    initIndex();
    initWatch();
    initUpload();
    initDashboard();

    // Search form (if present)
    const searchForm = qs('form[role="search"]');
    searchForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = byId('q')?.value?.trim() || '';
      location.href = q ? `/?q=${encodeURIComponent(q)}` : '/';
    });
  });
})();
