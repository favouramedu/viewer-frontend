(()=>{
  window.VIEWER_CONFIG = {
    apiBase: 'https://func-viewer-ecd3gpgfcxbwaqb3.eastus-01.azurewebsites.net/api'
  };

  let PRINCIPAL_B64 = null;
  (async ()=>{
    try{
      const r = await fetch('/.auth/me', { credentials:'include' });
      if(r.ok){
        const d = await r.json();
        const me = Array.isArray(d) ? d[0] : (d && d.clientPrincipal) || null;
        if(me) PRINCIPAL_B64 = btoa(JSON.stringify(me));
      }
    }catch{}
  })();

  const API = (p, opts={})=>{
    const base = (window.VIEWER_CONFIG && window.VIEWER_CONFIG.apiBase) || '/api';
    const headers = { 'Content-Type':'application/json', ...(opts.headers||{}) };
    if(PRINCIPAL_B64) headers['x-ms-client-principal'] = PRINCIPAL_B64;
    return fetch(base + p, {
      method: opts.method || 'GET',
      headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(async r=>{
      if(!r.ok) throw new Error(await r.text());
      const ct = r.headers.get('content-type')||'';
      return ct.includes('json') ? r.json() : r.text();
    });
  };

  const $ = s => document.querySelector(s);
  const byId = id => document.getElementById(id);

  async function me(){ try { return await API('/me'); } catch { return null; } }

  async function initIndex(){
    if (!$('#feed')) return;
    const pill = byId('user-pill');
    const user = await me();
    if (user){ pill.style.display='inline-block'; pill.textContent = `Signed in: ${user.name||user.userId}`; }

    const q = new URLSearchParams(location.search).get('q')||'';
    const list = await API(`/videos?search=${encodeURIComponent(q)}`);
    const feed = byId('feed'); feed.innerHTML='';
    list.forEach(v => {
      const card = document.createElement('article'); card.className='video-card';
      card.innerHTML = `
        <a href="watch.html?id=${encodeURIComponent(v.id)}">
          <img src="${v.thumbUrl||''}" alt="">
        </a>
        <header><h2><a href="watch.html?id=${encodeURIComponent(v.id)}">${v.title||'Untitled'}</a></h2></header>
        <p>${v.publisher||''} • ${v.genre||''} • ${v.ageRating||''}</p>
        <footer><a href="watch.html?id=${encodeURIComponent(v.id)}">Open</a></footer>`;
      feed.appendChild(card);
    });
  }

  async function initWatch(){
    const player = byId('player'); if(!player) return;
    const id = new URLSearchParams(location.search).get('id');
    if(!id){ location.href = '/'; return; }
    const v = await API(`/videos/${id}`);
    byId('video-title').textContent = v.title||'Video';
    [['publisher',v.publisher],['producer',v.producer],['genre',v.genre],['age-rating',v.ageRating]].forEach(([k,val])=>{
      const e = document.querySelector(`[data-field="${k}"]`); if(e) e.textContent = val||'';
    });
    player.querySelector('source').src = v.hlsUrl || v.blobUrl || '';
    player.load();

    const comments = await API(`/videos/${id}/comments`);
    const list = byId('comments-list'); list.innerHTML='';
    comments.forEach(c => {
      const li = document.createElement('li');
      li.textContent = `${c.user||'anon'}: ${c.text}`;
      list.appendChild(li);
    });
    byId('comment-form')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const text = byId('comment-text').value.trim(); if(!text) return;
      await API(`/videos/${id}/comments`, { method:'POST', body:{ text } });
      location.reload();
    });
    byId('rate-form')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      await API(`/videos/${id}/ratings`, { method:'POST', body:{ stars: Number(byId('stars').value||5) } });
      alert('Thanks!');
    });
  }

  async function initUpload(){
    const form = byId('upload-form'); if(!form) return;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const file = byId('file').files[0]; if(!file) return alert('Pick a file');
      const meta = {
        title: byId('title').value.trim(),
        publisher: byId('publisher').value.trim(),
        producer: byId('producer').value.trim(),
        genre: byId('genre').value,
        ageRating: byId('age-rating').value,
        ext: (file.name.split('.').pop()||'mp4').toLowerCase()
      };
      const init = await API('/videos/init', { method:'POST', body: meta });
      const put = await fetch(init.sasUrl, { method:'PUT', headers:{'x-ms-blob-type':'BlockBlob'}, body: file });
      if(!put.ok) throw new Error('Blob upload failed');
      await API(`/videos/${init.videoId}/finalize`, { method:'POST', body: meta });
      alert('Uploaded!'); location.href='dashboard.html';
    });
  }

  async function initDashboard(){
    const tbody = document.querySelector('table tbody'); if(!tbody) return;
    const list = await API('/videos');
    tbody.innerHTML='';
    list.forEach(v => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${v.title||''}</td><td>${v.status||''}</td><td>${(v.createdAt||'').slice(0,10)}</td><td>${v.views||0}</td><td>${v.ratingAvg||'—'}</td>
      <td><a href="watch.html?id=${encodeURIComponent(v.id)}">Open</a></td>`;
      tbody.appendChild(tr);
    });
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    initIndex(); initWatch(); initUpload(); initDashboard();
    document.querySelector('form[role="search"]')?.addEventListener('submit', (e)=>{
      e.preventDefault();
      const q = document.getElementById('q').value.trim();
      location.href = q ? `/?q=${encodeURIComponent(q)}` : '/';
    });
  });
})();
