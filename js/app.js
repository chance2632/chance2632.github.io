/* 前台展示逻辑 */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const urlCache = new Map();
  let state = null;
  let currentPostId = null;

  /* 把文件 ID 转成可访问的 URL（同一 ID 复用，避免重复创建对象 URL） */
  async function fileUrl(id) {
    if (!id) return '';
    if (urlCache.has(id)) return urlCache.get(id);
    const blob = await Store.getFile(id);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  }

  function invalidateUrl(id) {
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  }

  function isImage(type, name) { return /^image\//.test(type || '') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name || ''); }
  function isVideo(type, name) { return /^video\//.test(type || '') || /\.(mp4|webm|mov|m4v)$/i.test(name || ''); }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 主页文字 ---------- */
  function renderProfile() {
    const p = state.profile || {};
    const brandEl = $('#brandName');
    if (brandEl) brandEl.textContent = p.name || '我的小宇宙';
    $('#heroName').textContent = p.name || '你好';
    const subEl = $('#heroSubtitle');
    if (subEl) subEl.textContent = p.subtitle || '';
    $('#heroQuote').textContent = p.quote ? '「 ' + p.quote + ' 」' : '';
    document.title = (p.name || '我的小宇宙') + ' · 个人主页';
  }

  /* ---------- 简历 ---------- */
  async function renderResume() {
    const r = state.resume || {};
    const frame = $('#resumeFrame');
    const img = $('#resumeImage');
    const empty = $('#resumeEmpty');
    $('#resumeFileName').textContent = r.fileName || '';

    const uploaded = r.fileId ? await fileUrl(r.fileId) : '';
    if (uploaded) {
      // 用户上传的 PDF：内嵌 iframe
      img.hidden = true;
      if (frame.src !== new URL(uploaded, location.href).href) frame.src = uploaded;
      frame.hidden = false; empty.hidden = true;
      return;
    }
    frame.hidden = true; frame.removeAttribute('src');
    if (r.builtinImage) {
      // 内置简历：直接显示图片，任何浏览器/预览环境都能看
      if (img.getAttribute('src') !== r.builtinImage) img.src = r.builtinImage;
      img.hidden = false; empty.hidden = true;
      return;
    }
    if (r.builtin) {
      if (frame.src !== new URL(r.builtin, location.href).href) frame.src = r.builtin;
      frame.hidden = false; empty.hidden = true;
      return;
    }
    img.hidden = true; empty.hidden = false;
  }

  /* ---------- 滚动列表（策划 / 更多 / 看板 / Vibe） ---------- */
  async function renderList(key, elId) {
    const el = document.getElementById(elId);
    const items = state[key] || [];
    if (!items.length) {
      // 策划页：无自定义内容时，直接展示内置的完整策划方案（高清逐页）
      if (key === 'planning') {
        const doc = state.planningDoc || {};
        const count = Number(doc.count) || 0;
        if (count > 0 && doc.dir) {
          let html = `<div class="doc-intro"><h3>${esc(doc.title || '策划方案')}</h3><p>向下滚动，逐页浏览完整方案 · 共 ${count} 页</p></div>`;
          for (let i = 1; i <= count; i++) {
            const src = `${doc.dir}p${String(i).padStart(2, '0')}.png`;
            html += `<figure class="doc-page"><img src="${esc(src)}" alt="策划方案 第 ${i} 页" loading="lazy" /><figcaption>${i} / ${count}</figcaption></figure>`;
          }
          el.innerHTML = html;
          return;
        }
      }
      el.innerHTML = '<div class="car-empty">这里还空着 ✎<br><small>点击右上角「编辑」添加内容</small></div>';
      return;
    }
    const html = await Promise.all(items.map(async (it) => {
      const cover = await fileUrl(it.fileId);
      const gallery = await Promise.all((it.gallery || []).map(async (g) => ({
        ...g, url: await fileUrl(g.fileId)
      })));
      const galleryHtml = gallery.filter((g) => g.url).map((g) => {
        const tag = isVideo(g.type, g.name)
          ? `<video src="${esc(g.url)}" controls playsinline></video>`
          : `<img src="${esc(g.url)}" alt="${esc(g.name)}" loading="lazy" />`;
        return `<div class="gm-item">${tag}</div>`;
      }).join('');
      return `<article class="card">
        ${cover ? `<img class="card-cover" src="${esc(cover)}" alt="${esc(it.title)}" loading="lazy" />` : ''}
        ${it.tag ? `<span class="card-tag">${esc(it.tag)}</span>` : ''}
        <h3>${esc(it.title)}</h3>
        ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
        ${galleryHtml ? `<div class="card-gallery">${galleryHtml}</div>` : ''}
        ${it.date ? `<div class="card-meta">${esc(it.date)}</div>` : ''}
        ${it.link ? `<a class="card-link" href="${esc(it.link)}" target="_blank" rel="noopener">查看项目 ↗</a>` : ''}
      </article>`;
    }));
    el.innerHTML = html.join('');
  }

  /* ---------- AI 视频图片：上下滑动纯图片（无文字） ---------- */
  async function renderMediaStack() {
    const el = document.getElementById('mediaList');
    let items = state.media || [];
    let builtinMode = false;
    if (!items.length && (state.mediaBuiltin || []).length) {
      items = state.mediaBuiltin;
      builtinMode = true;
    }
    if (!items.length) {
      el.innerHTML = '<div class="car-empty">这里还空着 ✎<br><small>点击右上角「编辑」添加内容</small></div>';
      return;
    }
    const html = await Promise.all(items.map(async (it) => {
      if (builtinMode) {
        if (it.video) {
          return `<figure class="media-shot"><video src="${esc(it.video)}" ${it.poster ? `poster="${esc(it.poster)}"` : ''} controls playsinline preload="metadata"></video></figure>`;
        }
        return `<figure class="media-shot"><img src="${esc(it.cover)}" alt="" loading="lazy" /></figure>`;
      }
      const url = await fileUrl(it.fileId);
      const gallery = await Promise.all((it.gallery || []).map(async (g) => ({ ...g, url: await fileUrl(g.fileId) })));
      let main = '';
      if (url && isVideo(it.type, it.fileName)) {
        main = `<video src="${esc(url)}" controls playsinline preload="metadata"></video>`;
      } else if (url) {
        main = `<img src="${esc(url)}" alt="" loading="lazy" />`;
      }
      const rest = gallery.filter((g) => g.url).map((g) => isVideo(g.type, g.name)
        ? `<video src="${esc(g.url)}" controls playsinline></video>`
        : `<img src="${esc(g.url)}" alt="" loading="lazy" />`).join('');
      return `<figure class="media-shot">${main}${rest}</figure>`;
    }));
    el.innerHTML = html.join('');
  }

  /* ---------- 推文：上下滑动卡片（点击进入详情） ---------- */
  async function renderPostStack() {
    const el = document.getElementById('postsList');
    let items = state.posts || [];
    let builtinMode = false;
    if (!items.length && (state.postsBuiltin || []).length) {
      items = state.postsBuiltin;
      builtinMode = true;
    }
    if (!items.length) {
      el.innerHTML = '<div class="car-empty">这里还空着 ✎<br><small>点击右上角「编辑」添加内容</small></div>';
      return;
    }
    const html = await Promise.all(items.map(async (it, i) => {
      let media;
      if (builtinMode) {
        media = `<img class="vcard-media" src="${esc(it.cover)}" alt="${esc(it.title)}" loading="lazy" />`;
      } else {
        const url = await fileUrl(it.fileId);
        if (url && isVideo(it.type, it.fileName)) {
          media = `<video class="vcard-media" src="${esc(url)}" controls playsinline preload="metadata"></video>`;
        } else if (url) {
          media = `<img class="vcard-media" src="${esc(url)}" alt="${esc(it.title)}" loading="lazy" />`;
        } else {
          media = `<div class="vcard-media vcard-placeholder">✦</div>`;
        }
      }
      const desc = builtinMode ? '公众号推文作品 · 点击进入看全文' : it.desc;
      return `<article class="vcard vcard-click" data-idx="${i}">
        <div class="vcard-cover">${media}<span class="vcard-enter">点击进入详情 ›</span></div>
        <div class="vcard-body">
          ${it.tag ? `<span class="card-tag">${esc(it.tag)}</span>` : ''}
          <h3>${esc(it.title)}</h3>
          ${desc ? `<p>${esc(desc)}</p>` : ''}
        </div>
      </article>`;
    }));
    el.innerHTML = html.join('');
    $$('.vcard-click', el).forEach((el2) => el2.addEventListener('click', (e) => {
      if (e.target.closest('video,a,button')) return;
      openPostDetail(Number(el2.dataset.idx));
    }));
  }

  /* ---------- 视频剪辑：上下滑动卡片（推文卡片风格） ---------- */
  async function renderVideoStack() {
    const el = document.getElementById('extraList');
    let items = state.extra || [];
    let builtinMode = false;
    if (!items.length && (state.videosBuiltin || []).length) {
      // 无自定义内容时，展示内置的三个视频剪辑作品
      items = state.videosBuiltin;
      builtinMode = true;
    }
    if (!items.length) {
      el.innerHTML = '<div class="car-empty">这里还空着 ✎<br><small>点击右上角「编辑」添加内容</small></div>';
      return;
    }
    const html = await Promise.all(items.map(async (it) => {
      let media;
      if (builtinMode) {
        media = `<img class="vcard-media" src="${esc(it.cover)}" alt="${esc(it.title)}" loading="lazy" />`;
      } else {
        const url = await fileUrl(it.fileId);
        if (url && isVideo(it.type, it.fileName)) {
          media = `<video class="vcard-media" src="${esc(url)}" controls playsinline preload="metadata"></video>`;
        } else if (url) {
          media = `<img class="vcard-media" src="${esc(url)}" alt="${esc(it.title)}" loading="lazy" />`;
        } else {
          media = `<div class="vcard-media vcard-placeholder">✦</div>`;
        }
      }
      const gallery = builtinMode ? [] : await Promise.all((it.gallery || []).map(async (g) => ({
        ...g, url: await fileUrl(g.fileId)
      })));
      const galleryHtml = gallery.filter((g) => g.url).map((g) => isVideo(g.type, g.name)
        ? `<video src="${esc(g.url)}" controls playsinline></video>`
        : `<img src="${esc(g.url)}" alt="${esc(g.name)}" loading="lazy" />`).join('');
      return `<article class="vcard">
        ${media}
        <div class="vcard-body">
          ${it.tag ? `<span class="card-tag">${esc(it.tag)}</span>` : ''}
          <h3>${esc(it.title)}</h3>
          ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
          ${galleryHtml ? `<div class="card-gallery">${galleryHtml}</div>` : ''}
          ${it.link ? `<a class="card-link" href="${esc(it.link)}" target="_blank" rel="noopener">查看作品 ↗</a>` : ''}
        </div>
      </article>`;
    }));
    el.innerHTML = html.join('');
  }

  /* ---------- AI coding：上下滑动卡片（推文卡片风格） ---------- */
  async function renderCodingStack() {
    const el = document.getElementById('vibeList');
    let items = state.vibe || [];
    let builtinMode = false;
    if (!items.length && (state.aiCodingBuiltin || []).length) {
      items = state.aiCodingBuiltin;
      builtinMode = true;
    }
    if (!items.length) {
      el.innerHTML = '<div class="car-empty">这里还空着 ✎<br><small>点击右上角「编辑」添加内容</small></div>';
      return;
    }
    const html = await Promise.all(items.map(async (it, i) => {
      // 内置第一张（小红书小工具）保持完整图展示，不点击进详情；其余仍用缩略图+详情
      const plain = builtinMode && i === 0;
      let media;
      if (builtinMode) {
        media = `<img class="vcard-media${plain ? '' : ' vcard-thumb'}" src="${esc(it.cover)}" alt="${esc(it.title)}" loading="lazy" />`;
      } else {
        const url = await fileUrl(it.fileId);
        if (url && isVideo(it.type, it.fileName)) {
          media = `<video class="vcard-media vcard-thumb" src="${esc(url)}" controls playsinline preload="metadata"></video>`;
        } else if (url) {
          media = `<img class="vcard-media vcard-thumb" src="${esc(url)}" alt="${esc(it.title)}" loading="lazy" />`;
        } else {
          media = `<div class="vcard-media vcard-thumb vcard-placeholder">✦</div>`;
        }
      }
      const body = `<div class="vcard-body">
          ${it.tag ? `<span class="card-tag">${esc(it.tag)}</span>` : ''}
          ${it.title ? `<h3>${esc(it.title)}</h3>` : ''}
          ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
        </div>`;
      if (plain) {
        return `<article class="vcard">${media}${body}</article>`;
      }
      return `<article class="vcard vcard-click" data-idx="${i}">
        <div class="vcard-cover">${media}<span class="vcard-enter">点击进入详情 ›</span></div>
        ${body}
      </article>`;
    }));
    el.innerHTML = html.join('');
    $$('.vcard-click', el).forEach((el2) => el2.addEventListener('click', (e) => {
      if (e.target.closest('video,a,button')) return;
      openCodingDetail(Number(el2.dataset.idx));
    }));
  }

  async function openCodingDetail(idx) {
    const custom = state.vibe || [];
    const isBuiltin = !custom.length && (state.aiCodingBuiltin || []).length;
    const it = isBuiltin ? state.aiCodingBuiltin[idx] : custom[idx];
    if (!it) return;
    $('#codingDetailTitle').textContent = it.title || '作品';
    if (isBuiltin) {
      $('#codingDetailBody').innerHTML = `<figure class="detail-longimg"><img src="${esc(it.cover)}" alt="${esc(it.title)}" /></figure>`;
    } else {
      const cover = await fileUrl(it.fileId);
      const gallery = await Promise.all((it.gallery || []).map(async (g) => ({ ...g, url: await fileUrl(g.fileId) })));
      const media = gallery.filter((g) => g.url).map((g) => isVideo(g.type, g.name)
        ? `<video src="${esc(g.url)}" controls playsinline></video>`
        : `<img src="${esc(g.url)}" alt="${esc(g.name)}" />`).join('');
      $('#codingDetailBody').innerHTML =
        (cover ? `<img src="${esc(cover)}" alt="" />` : '') +
        (it.desc ? `<p>${esc(it.desc)}</p>` : '') + media;
    }
    location.hash = '#ai-coding-detail';
  }

  /* ---------- 轮播（推文 / 视频图片） ---------- */
  async function renderCarousel(key, trackId, dotsId) {
    const track = document.getElementById(trackId);
    const dots = document.getElementById(dotsId);
    let items = state[key] || [];
    let builtinMode = false;
    const parent = track.parentNode;
    $$('.car-empty', parent).forEach((n) => n.remove());
    if (!items.length && key === 'posts' && (state.postsBuiltin || []).length) {
      // 无自定义推文时，展示内置的推文作品
      items = state.postsBuiltin;
      builtinMode = true;
    }
    if (!items.length) {
      track.innerHTML = '';
      dots.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'car-empty';
      empty.innerHTML = '这里还空着 ✎<br><small>点击右上角「编辑」添加内容</small>';
      parent.insertBefore(empty, track.nextSibling);
      return;
    }
    const html = await Promise.all(items.map(async (it, i) => {
      let media;
      if (builtinMode) {
        // 内置推文：轮播显示清晰封面，点击进入详情看完整长图
        media = `<img class="car-media" src="${esc(it.cover)}" alt="${esc(it.title)}" loading="lazy" />`;
      } else {
        const url = await fileUrl(it.fileId);
        if (url && isVideo(it.type, it.fileName)) {
          media = `<video class="car-media" src="${esc(url)}" controls playsinline preload="metadata"></video>`;
        } else if (url) {
          media = `<img class="car-media" src="${esc(url)}" alt="${esc(it.title)}" loading="lazy" />`;
        } else {
          media = `<div class="car-media" style="display:flex;align-items:center;justify-content:center;color:#a89cb8;font-size:32px">✦</div>`;
        }
      }
      const desc = builtinMode ? '公众号推文作品 · 点击进入，上下滑动看全文' : it.desc;
      return `<div class="car-item" data-idx="${i}" data-id="${esc(it.id || '')}">
        ${media}
        <div class="car-body">
          ${it.tag ? `<span class="card-tag">${esc(it.tag)}</span>` : ''}
          <h3>${esc(it.title)}</h3>
          ${desc ? `<p>${esc(desc)}</p>` : ''}
        </div>
      </div>`;
    }));
    track.innerHTML = html.join('');
    dots.innerHTML = items.map((_, i) => `<button data-idx="${i}" aria-label="第 ${i + 1} 个"></button>`).join('');
    updateDots(key, 0);

    // 推文点击详情（内置与自定义都可点击进入看完整长图）
    if (key === 'posts') {
      $$('.car-item', track).forEach((el) => el.addEventListener('click', (e) => {
        if (e.target.closest('a,button')) return;
        const idx = Number(el.dataset.idx);
        openPostDetail(idx);
      }));
    }
  }

  function updateDots(key, idx) {
    const dotsId = key === 'posts' ? '#postsDots' : '#mediaDots';
    const btns = $$(dotsId + ' button');
    btns.forEach((b, i) => b.classList.toggle('active', i === idx));
  }

  function setupCarousel() {
    $$('.car-arrow').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.car;
        const track = key === 'posts' ? $('#postsTrack') : $('#mediaTrack');
        const step = track.querySelector('.car-item')?.getBoundingClientRect().width || 400;
        track.scrollBy({ left: (btn.classList.contains('next') ? 1 : -1) * (step + 20), behavior: 'smooth' });
      });
    });
    [['media', '#mediaTrack', '#mediaDots']].forEach(([key, sel, dSel]) => {
      const track = $(sel);
      if (!track) return;
      let ticking = false;
      track.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const items = $$(sel + ' .car-item');
          if (items.length) {
            const center = track.scrollLeft + track.clientWidth / 2;
            let best = 0, bestDist = Infinity;
            items.forEach((it, i) => {
              const d = Math.abs(it.offsetLeft + it.offsetWidth / 2 - center);
              if (d < bestDist) { bestDist = d; best = i; }
            });
            updateDots(key, best);
          }
          ticking = false;
        });
      });
      $(dSel).addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const item = $$(sel + ' .car-item')[Number(b.dataset.idx)];
        if (item) track.scrollTo({ left: item.offsetLeft - track.offsetLeft - (track.clientWidth - item.offsetWidth) / 2, behavior: 'smooth' });
      });
      // 触屏左右滑动
      let sx = 0;
      track.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
      track.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - sx;
        if (Math.abs(dx) > 50) {
          const step = (track.querySelector('.car-item')?.getBoundingClientRect().width || 400) + 20;
          track.scrollBy({ left: dx < 0 ? step : -step, behavior: 'smooth' });
        }
      }, { passive: true });
    });
  }

  async function openPostDetail(idx) {
    const custom = state.posts || [];
    const isBuiltin = !custom.length && (state.postsBuiltin || []).length;
    const it = isBuiltin ? state.postsBuiltin[idx] : custom[idx];
    if (!it) return;
    currentPostId = it.id || '';
    $('#postDetailTitle').textContent = it.title || '推文';
    if (isBuiltin) {
      // 内置推文：整张长图完整展示，可上下滚动阅读
      $('#postDetailBody').innerHTML = `<figure class="detail-longimg"><img src="${esc(it.image)}" alt="${esc(it.title)}" /></figure>`;
    } else {
      const cover = await fileUrl(it.fileId);
      const gallery = await Promise.all((it.gallery || []).map(async (g) => ({ ...g, url: await fileUrl(g.fileId) })));
      const media = gallery.filter((g) => g.url).map((g) => isVideo(g.type, g.name)
        ? `<video src="${esc(g.url)}" controls playsinline></video>`
        : `<img src="${esc(g.url)}" alt="${esc(g.name)}" />`).join('');
      $('#postDetailBody').innerHTML =
        (cover ? `<img src="${esc(cover)}" alt="" />` : '') +
        (it.desc ? `<p>${esc(it.desc)}</p>` : '') + media +
        (it.link ? `<p><a class="card-link" href="${esc(it.link)}" target="_blank" rel="noopener">查看原文 ↗</a></p>` : '');
    }
    location.hash = '#post-detail';
  }

  /* ---------- 路由 ---------- */
  const routeMap = {
    '#home': 'home', '#resume': 'resume', '#works': 'works',
    '#works/planning': 'works-planning', '#works/posts': 'works-posts',
    '#works/videos': 'works-extra', '#works/extra': 'works-extra',
    '#ai': 'ai', '#ai/board': 'ai-board', '#ai/media': 'ai-media', '#ai/vibe': 'ai-vibe',
    '#ai-coding-detail': 'ai-coding-detail', '#post-detail': 'post-detail'
  };

  function route() {
    const hash = location.hash || '#home';
    const id = routeMap[hash] || 'home';
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === id));
    $$('.nav a').forEach((a) => {
      const h = a.getAttribute('href');
      const active = h === hash || (hash.startsWith('#works') && h === '#works') || (hash.startsWith('#ai') && h === '#ai');
      a.classList.toggle('current', active);
    });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (id !== 'home') refreshPage(id);
  }

  async function refreshPage(id) {
    if (!state) return;
    if (id === 'resume') await renderResume();
    if (id === 'works-planning') await renderList('planning', 'planningList');
    if (id === 'works-extra') await renderVideoStack();
    // 看板：无自定义内容时展示内置 KPL 奇妙日看板（iframe 保留交互）
    if (id === 'ai-board') {
      const builtinBoard = document.getElementById('boardBuiltin');
      const hasCustom = (state.board || []).length > 0;
      if (builtinBoard) builtinBoard.hidden = hasCustom;
      if (hasCustom) await renderList('board', 'boardList');
      else document.getElementById('boardList').innerHTML = '';
    }
    if (id === 'ai-vibe') await renderCodingStack();
    if (id === 'works-posts') await renderPostStack();
    if (id === 'ai-media') await renderMediaStack();
  }

  async function refreshAll() {
    if (!state) state = await Store.getState();
    renderProfile();
    await Promise.all(['resume', 'works-planning', 'works-extra', 'ai-board', 'ai-vibe', 'works-posts', 'ai-media']
      .map((id) => refreshPage(id)));
  }

  /* 编辑保存后由 editor.js 调用 */
  function updateState(next) {
    state = next;
    Object.keys(urlCache).forEach((id) => invalidateUrl(id));
    refreshAll();
  }

  window.SiteApp = {
    init: async () => {
      // 先切页面再取数据，避免存储初始化慢导致白屏
      setupCarousel();
      window.addEventListener('hashchange', route);
      route();
      try { state = await Store.getState(); }
      catch (e) { state = JSON.parse(JSON.stringify(Store.defaults)); }
      renderProfile();
      refreshAll();
    },
    getState: () => state,
    updateState,
    fileUrl,
    invalidateUrl,
    refreshAll
  };
})();
