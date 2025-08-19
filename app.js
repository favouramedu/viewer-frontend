// /app.js
(() => {
  // === CONFIG ===
  window.VIEWER_CONFIG = {
    // Your Function App base:
    apiBase: 'https://func-viewer-ecd3gpgfcxbwaqb3.eastus-01.azurewebsites.net/api',

    // For class/demo ONLY. In production do NOT ship keys to the browser.
    functionsKey: '<PUT_YOUR_FUNCTIONS_OR_HOST_KEY_HERE>',

    // Map front-end actions to your APIs. Change if your endpoints differ.
    endpoints: {
      feed:      '/feed',             // GET ?cursor=
      videos:    '/videos',           // GET list/search (fallback)
      me:        '/me',               // GET current principal (optional)
      like:      (id) => `/videos/${id}/like`,         // POST {like:true|false}
      follow:    (uid) => `/users/${uid}/follow`,      // POST {follow:true|false}
      comments:  (id) => `/videos/${id}/comments`,     // GET/POST
      finalize:  (id) => `/videos/${id}/finalize`,     // POST
      init:      '/videos/init'                          // POST
    }
  };

  // === Auth state (for forwarding identity to Functions) ===
  let PRINCIPAL_B64 = null;
  (async () => {
    try {
      const r = await fetch('/.auth/me', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        const me = Array.isArray(d) ? d[0] : (d && d.clientPrincipal) || null;
        if (me) {
          PRINCIPAL_B64 = btoa(JSON.stringify(me));
          // UI: show name + signout
          const pill = byId('user-pill');
          if (pill) { pill.style.display = 'inline-block'; pill.textContent = me.userDetails || me.userId; }
          const si = byId('signin'), so = byId('signout');
          if (si) si.style.display = 'none';
          if (so) so.style.display = 'inline';
        }
      }
    } catch {}
  })();

  // === Small helpers ===
  const $ = s => document.querySelector(s);
  const byId = id => document.getElementById(id);

  // Wrap fetch → attach identity + Functions key
  const API = (p, opts = {}) => {
    const base = window.VIEWER_CONFIG.apiBase.replace(/\/+$/,'');
    const url  = p.startsWith('http') ? p : `${base}${p}`;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

    if (window.VIEWER_CONFIG.functionsKey) headers['x-functions-key'] = window.VIEWER_CONFIG.functionsKey;
    if (PRINCIPAL_B64) headers['x-ms-client-principal'] = PRINCIPAL_B64;

    return fetch(url, {
      method: opts.method || 'GET',
      headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(async r => {
      if (!r.ok) throw new Error(await r.text().catch(()=>String(r.status)));
      const ct = r.headers.get('content-type') || '';
      return ct.includes('json') ? r.json() : r.text();
    });
  };

  // === FEED (TikTok style) ===
  let cursor = null;
  let loading = false;
  let feedEnd = false;

  async function loadMore() {
    if (loading || feedEnd) return;
    loading = true;
    const { endpoints } = window.VIEWER_CONFIG;

    // Try /feed first; if 404, fallback to /videos
    let items = [];
    try {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      items = await API(`${endpoints.feed}${qs}`);
    } catch {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      items = await API(`${endpoints.videos}${qs}`);
    }

    if (!items || !items.length) { feedEnd = true; loading = false; return; }

    const container = byId('feed');
    for (const v of items) {
      const card = renderCard(v);
      container.appendChild(card);
    }

    // Advance cursor if backend returns it; otherwise use last id
    cursor = items.nextCursor || (items.at(-1)?.id || null);
    loading = false;
  }

  function renderCard(v) {
    const el = document.createElement('section');
    el.className = 'card';
    el.dataset.id = v.id;
    el.innerHTML = `
      <div class="player">
        <video playsinline webkit-playsinline preload="metadata" muted></video>
      </div>

      <div class="meta">
        <h2>${escapeHTML(v.title || 'Untitled')}</h2>
        <p>${escapeHTML(v.publisher || '')} • ${escapeHTML(v.genre || '')} • ${escapeHTML(v.ageRating || '')}</p>
      </div>

      <div class="actions">
        <div class="action like ${v.liked ? 'active':''}" title="Like">
          ❤
          <div class="count">${v.likes ?? 0}</div>
        </div>
        <div class="action comment" title="Comments">💬</div>
        <div class="action follow ${v.following ? 'active':''}" title="Follow">＋</div>
        <div class="action share" title="Share">⤴</div>
      </div>
    `;

    // Wire video (HLS or MP4)
    const video = el.querySelector('video');
    const url = v.hlsUrl || v.m3u8 || v.blobUrl || v.mp4Url || '';
    attachVideo(video, url);

    // Wire actions
    const likeBtn = el.querySelector('.action.like');
    likeBtn?.addEventListener('click', async () => {
      const active = likeBtn.classList.toggle('active');
      try {
        const r = await API(window.VIEWER_CONFIG.endpoints.like(v.id), { method: 'POST', body: { like: active } });
        const c = likeBtn.querySelector('.count');
        if (c && r && typeof r.likes === 'number') c.textContent = r.likes;
      } catch { likeBtn.classList.toggle('active'); }
    });

    const followBtn = el.querySelector('.action.follow');
    followBtn?.addEventListener('click', async () => {
      const active = followBtn.classList.toggle('active');
      try {
        await API(window.VIEWER_CONFIG.endpoints.follow(v.publisherId || v.userId || v.ownerId), { method:'POST', body:{ follow: active } });
      } catch { followBtn.classList.toggle('active'); }
    });

    el.querySelector('.action.comment')?.addEventListener('click', () => openComments(v.id));
    el.querySelector('.action.share')?.addEventListener('click', () => {
      const link = `${location.origin}/watch.html?id=${encodeURIComponent(v.id)}`;
      navigator.clipboard?.writeText(link);
      alert('Link copied!');
    });

    return el;
  }

  function attachVideo(video, src) {
    if (!src) return;

    if (src.endsWith('.m3u8') && window.Hls && window.Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 30 });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
    }
  }

  // Auto play/pause one in view
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      const v = e.target.querySelector('video');
      if (!v) return;
      if (e.isIntersecting && e.intersectionRatio > 0.75) {
        v.play().catch(()=>{});
      } else {
        v.pause();
      }
    });
  }, { threshold: [0, .75, 1] });

  // Observe cards as they appear
  const feedEl = byId('feed');
  const mo = new MutationObserver(list => {
    for (const m of list) {
      m.addedNodes.forEach(node => {
        if (node.classList?.contains('card')) io.observe(node);
      });
    }
  });
  mo.observe(feedEl, { childList: true });

  // Infinite scroll
  feedEl.addEventListener('scroll', () => {
    const nearBottom = feedEl.scrollTop + feedEl.clientHeight > feedEl.scrollHeight - 800;
    if (nearBottom) loadMore();
  });

  // === Comments drawer ===
  let currentVideoId = null;
  const drawer = byId('comments-drawer');
  byId('comments-close')?.addEventListener('click', () => drawer.classList.remove('open'));

  async function openComments(videoId) {
    currentVideoId = videoId;
    drawer.classList.add('open');

    // Load comments
    const items = await API(window.VIEWER_CONFIG.endpoints.comments(videoId));
    const ul = byId('comments-list');
    ul.innerHTML = '';
    (items || []).forEach(c => {
      const li = document.createElement('li');
      li.textContent = `${c.user || 'anon'}: ${c.text}`;
      ul.appendChild(li);
    });
  }

  byId('comment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const txt = byId('comment-text').value.trim();
    if (!txt || !currentVideoId) return;
    await API(window.VIEWER_CONFIG.endpoints.comments(currentVideoId), { method: 'POST', body: { text: txt } });
    byId('comment-text').value = '';
    openComments(currentVideoId);
  });

  // === Upload page (unchanged behavior, nicer errors) ===
  async function initUpload() {
    const form = byId('upload-form'); if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const file = byId('file').files[0]; if (!file) return alert('Pick a file first');
        const meta = {
          title: byId('title').value.trim(),
          publisher: byId('publisher').value.trim(),
          producer: byId('producer').value.trim(),
          genre: byId('genre').value,
          ageRating: byId('age-rating').value,
          ext: (file.name.split('.').pop() || 'mp4').toLowerCase()
        };
        const init = await API(window.VIEWER_CONFIG.endpoints.init, { method: 'POST', body: meta });
        const put = await fetch(init.sasUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob' }, body: file });
        if (!put.ok) throw new Error('Blob upload failed');
        await API(window.VIEWER_CONFIG.endpoints.finalize(init.videoId), { method: 'POST', body: meta });
        alert('Uploaded!');
        location.href = '/dashboard.html';
      } catch (err) {
        alert('Upload failed: ' + (err?.message || err));
      }
    });
  }

  // === Watch page fallback ===
  async function initWatch() {
    const player = byId('player'); if (!player) return;
    const id = new URLSearchParams(location.search).get('id');
    const v = await API(`${window.VIEWER_CONFIG.endpoints.videos}/${id}`);
    const video = player.querySelector('video');
    attachVideo(video, v.hlsUrl || v.blobUrl || v.mp4Url || '');
    byId('video-title').textContent = v.title || 'Video';
  }

  // === Search redirect ===
  document.querySelector('form[role="search"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = byId('q').value.trim();
    location.href = q ? `/?q=${encodeURIComponent(q)}` : '/';
  });

  // === Small util ===
  function escapeHTML(s=''){ return s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  // === Page inits ===
  document.addEventListener('DOMContentLoaded', () => {
    // If we’re on index → load feed
    if (byId('feed')) loadMore();
    initUpload();
    initWatch();
  });
})();
