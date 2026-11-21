/* 本地编辑模式：密码保护 + 文件上传（文件仅存本机 IndexedDB） */
(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let draft = null;
  let activeTab = 'profile';
  let unlocked = false;

  /* 简单哈希：避免明文存密码（本地防护，非高安全场景） */
  function hashPin(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return 'h_' + h.toString(16);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---------- 密码框 ---------- */
  function openAuth() {
    const modal = $('#authModal');
    modal.hidden = false;
    $('#pinInput').value = '';
    $('#authErr').textContent = '';
    $('#authConfirm').focus();
  }
  function closeAuth() { $('#authModal').hidden = true; }

  async function confirmAuth() {
    const val = $('#pinInput').value.trim();
    if (val.length < 4) { $('#authErr').textContent = '密码至少 4 位'; return; }
    const saved = await Store.getMeta('pin');
    if (!saved) {
      await Store.setMeta('pin', hashPin(val));
      toast('密码已设置，记住它哦');
      closeAuth(); enterEditor();
      return;
    }
    if (saved !== hashPin(val)) {
      $('#authErr').textContent = '密码不对，再想想？';
      $('#pinInput').select();
      return;
    }
    closeAuth(); enterEditor();
  }

  async function enterEditor() {
    unlocked = true;
    draft = await Store.getState();
    $('#editor').hidden = false;
    $('#editorScrim').hidden = false;
    renderTab();
  }
  function exitEditor() {
    unlocked = false; draft = null;
    $('#editor').hidden = true;
    $('#editorScrim').hidden = true;
  }

  /* ---------- 表单构建 ---------- */
  function field(label, key, value, opts = {}) {
    const id = 'f_' + key;
    if (opts.type === 'textarea') {
      return `<div class="field"><label for="${id}">${label}</label><textarea id="${id}" data-key="${key}" placeholder="${opts.placeholder || ''}">${esc(value)}</textarea></div>`;
    }
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-key="${key}" type="${opts.type || 'text'}" value="${esc(value)}" placeholder="${opts.placeholder || ''}" /></div>`;
  }

  function saveBar(label = '保存修改') {
    return `<div class="save-bar"><button class="btn btn-primary" data-save>${label}</button></div>`;
  }

  /* ---------- 各标签页 ---------- */
  async function renderTab() {
    if (!draft) return;
    const body = $('#editorBody');
    $$('.editor-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
    if (activeTab === 'profile') {
      const p = draft.profile;
      const avatarUrl = p.avatar ? await SiteApp.fileUrl(p.avatar) : '';
      body.innerHTML = `
        <h4>基本信息</h4>
        ${field('名字 / 昵称', 'p.name', p.name)}
        ${field('一句话标签', 'p.subtitle', p.subtitle)}
        ${field('自我介绍', 'p.intro', p.intro, { type: 'textarea' })}
        ${field('喜欢的句子', 'p.quote', p.quote)}
        <div class="field"><label>头像（可选，用你自己的图片替换虚拟形象）</label>
          ${avatarUrl ? `<div class="gallery-mini"><div class="gm"><img src="${esc(avatarUrl)}" alt="当前头像"><button data-del-avatar title="删除">✕</button></div></div>` : ''}
          <div class="file-pick"><input type="file" id="avatarInput" accept="image/*" /></div>
        </div>
        ${saveBar()}`;
    } else if (activeTab === 'resume') {
      const r = draft.resume;
      const url = r.fileId ? await SiteApp.fileUrl(r.fileId) : '';
      const status = url
        ? `✓ 已上传：${esc(r.fileName)}`
        : (r.builtin ? `✓ 当前使用内置简历：${esc(r.fileName)}` : '<span style="color:#a49bb1">尚未上传</span>');
      body.innerHTML = `
        <h4>PDF 简历</h4>
        ${field('显示的文件名', 'r.fileName', r.fileName)}
        <div class="field"><label>上传 PDF 文件${r.builtin ? '（上传后将替换内置简历）' : ''}</label>
          <p class="picked">${status}</p>
          <div class="file-pick"><input type="file" id="resumeInput" accept="application/pdf,.pdf" /></div>
        </div>
        ${saveBar()}`;
    } else if (activeTab === 'media') {
      const tip = !draft.media.length
        ? '<p class="picked" style="color:#8a7fa0;margin:0 0 14px;line-height:1.7">当前展示内置的 1 个 AI 视频 + 4 张图片（上下滑动，无文字）。添加下方内容后，将改为显示你添加的内容；清空后可恢复内置内容。</p>'
        : '';
      body.innerHTML = `<h4>视觉创作（上下滑动，仅展示图片/视频）</h4>${tip}<div id="listRoot"></div><button class="add-btn" data-add>+ 添加一项</button>${saveBar()}`;
      renderListItems('media');
    } else {
      const titleMap = { planning: '策划（上下滑浏览）', posts: '推文（上下滑浏览，可点进详情）', extra: '视频剪辑（上下滑浏览）', board: 'AI 看板', vibe: 'AI coding' };
      let tip = '';
      if (activeTab === 'planning') {
        tip = '<p class="picked" style="color:#8a7fa0;margin:0 0 14px;line-height:1.7">当前策划页展示内置的完整策划方案（36 页高清图）。添加下方内容后，将改为显示你添加的内容；清空后可恢复内置方案。</p>';
      } else if (activeTab === 'posts' && !draft.posts.length) {
        tip = '<p class="picked" style="color:#8a7fa0;margin:0 0 14px;line-height:1.7">当前推文页展示内置的 3 篇推文作品。添加下方内容后，将改为显示你添加的内容；清空后可恢复内置推文。</p>';
      } else if (activeTab === 'extra' && !draft.extra.length) {
        tip = '<p class="picked" style="color:#8a7fa0;margin:0 0 14px;line-height:1.7">当前视频剪辑页展示内置的 3 个作品。添加下方内容后，将改为显示你添加的内容；清空后可恢复内置作品。</p>';
      } else if (activeTab === 'board' && !draft.board.length) {
        tip = '<p class="picked" style="color:#8a7fa0;margin:0 0 14px;line-height:1.7">当前看板页展示内置的「深圳 KPL 奇妙日现场活动看板」（可交互）。添加下方内容后，将改为显示你添加的内容；清空后可恢复内置看板。</p>';
      } else if (activeTab === 'vibe' && !(draft.vibe || []).length) {
        tip = '<p class="picked" style="color:#8a7fa0;margin:0 0 14px;line-height:1.7">当前 AI coding 页展示内置的 2 个作品（上下滑动卡片，点击进入详情看完整图）。添加下方内容后，将改为显示你添加的内容；清空后可恢复内置作品。</p>';
      }
      body.innerHTML = `<h4>${titleMap[activeTab] || activeTab}</h4>${tip}<div id="listRoot"></div><button class="add-btn" data-add>+ 添加一项</button>${saveBar()}`;
      renderListItems(activeTab);
    }

    bindTab();
  }

  /* 列表项编辑卡 */
  async function renderListItems(key) {
    const root = $('#listRoot');
    if (!root) return;
    const items = draft[key] || (draft[key] = []);
    if (!items.length) { root.innerHTML = '<p class="picked" style="color:#a49bb1;padding:16px 0">还没有内容，点下方按钮添加。</p>'; return; }
    const html = await Promise.all(items.map(async (it, i) => {
      const cover = it.fileId ? (await SiteApp.fileUrl(it.fileId) || '') : '';
      const gallery = await Promise.all((it.gallery || []).map(async (g) => ({ ...g, url: g.fileId ? (await SiteApp.fileUrl(g.fileId) || '') : '' })));
      const isPost = key === 'posts';
      return `<div class="editor-item" data-i="${i}">
        <div class="editor-item-head"><strong>#${i + 1} ${esc(it.title || '未命名')}</strong>
          <div>
            <button class="mini-btn" data-move="up" title="上移">↑</button>
            <button class="mini-btn" data-move="down" title="下移">↓</button>
            <button class="mini-btn danger" data-del title="删除">删除</button>
          </div>
        </div>
        ${field('标题', `i.${i}.title`, it.title)}
        ${field('分类标签（可选）', `i.${i}.tag`, it.tag)}
        ${field(isPost ? '摘要 / 正文' : '描述', `i.${i}.desc`, it.desc, { type: 'textarea' })}
        ${field('日期（可选）', `i.${i}.date`, it.date)}
        ${field('外部链接（可选）', `i.${i}.link`, it.link, { placeholder: 'https://...' })}
        <div class="field"><label>主图 / 封面 ${isPost ? '（可选）' : ''}</label>
          ${cover ? `<div class="gallery-mini"><div class="gm"><img src="${esc(cover)}" alt="封面"><button data-del-cover title="删除">✕</button></div></div>` : ''}
          <div class="file-pick"><input type="file" data-cover="${i}" accept="image/*${key === 'media' ? ',video/*' : ''}" /></div>
        </div>
        <div class="field"><label>附图 / 附件（可多选）</label>
          <div class="gallery-mini">${gallery.filter((g) => g.url).map((g, gi) => `<div class="gm">
            ${/^video\//.test(g.type) ? `<video src="${esc(g.url)}" muted></video>` : `<img src="${esc(g.url)}" alt="${esc(g.name)}">`}
            <button data-del-gallery="${gi}" title="移除">✕</button></div>`).join('')}</div>
          <div class="file-pick"><input type="file" data-gallery="${i}" multiple accept="image/*,video/*" /></div>
        </div>
      </div>`;
    }));
    root.innerHTML = html.join('');
  }

  /* 收集当前表单值到 draft */
  function collectFields() {
    $$('#editorBody [data-key]').forEach((el) => {
      const k = el.dataset.key;
      const v = el.value;
      if (k.startsWith('p.')) draft.profile[k.slice(2)] = v;
      else if (k.startsWith('r.')) draft.resume[k.slice(2)] = v;
      else if (k.startsWith('i.')) {
        const [_, idx, prop] = k.split('.');
        const item = draft[activeTab]?.[Number(idx)];
        if (item) item[prop] = v;
      }
    });
  }

  function bindTab() {
    const body = $('#editorBody');
    // 列表项操作
    $$('[data-del]', body).forEach((b) => b.addEventListener('click', () => {
      collectFields();
      const i = Number(b.closest('.editor-item').dataset.i);
      draft[activeTab].splice(i, 1); renderListItems(activeTab); toast('已删除（记得保存）');
    }));
    $$('[data-move]', body).forEach((b) => b.addEventListener('click', () => {
      collectFields();
      const i = Number(b.closest('.editor-item').dataset.i);
      const arr = draft[activeTab];
      const j = b.dataset.move === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < arr.length) { [arr[i], arr[j]] = [arr[j], arr[i]]; renderListItems(activeTab); }
    }));
    $$('[data-add]', body).forEach((b) => b.addEventListener('click', () => {
      collectFields();
      draft[activeTab] = draft[activeTab] || [];
      draft[activeTab].push({ id: Store.newId(), title: '新作品', tag: '', desc: '', date: '', link: '', fileId: '', gallery: [] });
      renderListItems(activeTab).then(() => $('#listRoot').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }));

    // 文件上传
    const avatarInput = $('#avatarInput');
    if (avatarInput) avatarInput.addEventListener('change', async (e) => {
      collectFields();
      const f = e.target.files[0]; if (!f) return;
      if (!/^image\//.test(f.type)) { toast('请选择图片文件'); return; }
      if (draft.profile.avatar) await Store.deleteFile(draft.profile.avatar);
      draft.profile.avatar = await Store.putFile(Store.newId(), f);
      SiteApp.invalidateUrl(draft.profile.avatar);
      renderTab(); toast('头像已上传（记得保存）');
    });
    const delAvatar = $('[data-del-avatar]');
    if (delAvatar) delAvatar.addEventListener('click', async () => {
      collectFields();
      if (draft.profile.avatar) await Store.deleteFile(draft.profile.avatar);
      draft.profile.avatar = ''; renderTab(); toast('已移除头像');
    });
    const resumeInput = $('#resumeInput');
    if (resumeInput) resumeInput.addEventListener('change', async (e) => {
      collectFields();
      const f = e.target.files[0]; if (!f) return;
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { toast('请上传 PDF 文件'); return; }
      if (f.size > 40 * 1024 * 1024) { toast('文件超过 40MB，请压缩后再试'); return; }
      if (draft.resume.fileId) await Store.deleteFile(draft.resume.fileId);
      draft.resume.fileId = await Store.putFile(Store.newId(), f);
      draft.resume.fileName = f.name;
      SiteApp.invalidateUrl(draft.resume.fileId);
      renderTab(); toast('简历已上传（记得保存）');
    });
    $$('[data-cover]', body).forEach((inp) => inp.addEventListener('change', async (e) => {
      collectFields();
      const f = e.target.files[0]; if (!f) return;
      const i = Number(inp.dataset.cover);
      const item = draft[activeTab][i];
      if (item.fileId) await Store.deleteFile(item.fileId);
      item.fileId = await Store.putFile(Store.newId(), f);
      item.type = f.type; item.fileName = f.name;
      SiteApp.invalidateUrl(item.fileId);
      renderListItems(activeTab); toast('封面已上传（记得保存）');
    }));
    $$('[data-del-cover]', body).forEach((b) => b.addEventListener('click', async () => {
      collectFields();
      const i = Number(b.closest('.editor-item').dataset.i);
      const item = draft[activeTab][i];
      if (item.fileId) await Store.deleteFile(item.fileId);
      item.fileId = ''; renderListItems(activeTab);
    }));
    $$('[data-gallery]', body).forEach((inp) => inp.addEventListener('change', async (e) => {
      collectFields();
      const i = Number(inp.dataset.gallery);
      const item = draft[activeTab][i];
      item.gallery = item.gallery || [];
      for (const f of Array.from(e.target.files)) {
        if (f.size > 40 * 1024 * 1024) { toast('单个文件超过 40MB，已跳过：' + f.name); continue; }
        const fileId = await Store.putFile(Store.newId(), f);
        item.gallery.push({ name: f.name, type: f.type, fileId });
      }
      renderListItems(activeTab); toast('附件已上传（记得保存）');
    }));
    $$('[data-del-gallery]', body).forEach((b) => b.addEventListener('click', async () => {
      collectFields();
      const i = Number(b.closest('.editor-item').dataset.i);
      const gi = Number(b.dataset.delGallery);
      const item = draft[activeTab][i];
      const g = item.gallery[gi];
      if (g?.fileId) await Store.deleteFile(g.fileId);
      item.gallery.splice(gi, 1); renderListItems(activeTab);
    }));

    const saveBtn = $('[data-save]');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      collectFields();
      await Store.saveState(draft);
      SiteApp.updateState(JSON.parse(JSON.stringify(draft)));
      toast('✓ 已保存到这台设备');
    });
  }

  /* ---------- 初始化事件 ---------- */
  $('#editEntry').addEventListener('click', openAuth);
  $('#authCancel').addEventListener('click', closeAuth);
  $('#authConfirm').addEventListener('click', confirmAuth);
  $('#pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmAuth(); });
  $('#editorClose').addEventListener('click', exitEditor);
  $('#editorScrim').addEventListener('click', exitEditor);
  $$('.editor-tabs button').forEach((b) => b.addEventListener('click', async () => {
    if (!unlocked) return;
    collectFields(); activeTab = b.dataset.tab; await renderTab();
  }));

  $('#exportBtn').addEventListener('click', async () => {
    try {
      collectFields();
      const data = await Store.exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '我的网站备份_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('备份已下载');
    } catch (e) { toast('导出失败：' + e.message); }
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('导入备份会覆盖当前所有内容，确定继续吗？')) return;
    try {
      const data = JSON.parse(await f.text());
      await Store.importBackup(data);
      draft = await Store.getState();
      SiteApp.updateState(JSON.parse(JSON.stringify(draft)));
      renderTab(); toast('✓ 备份已恢复');
    } catch (err) { toast('导入失败：' + err.message); }
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm('确定要清空所有内容和上传的文件吗？此操作不可撤销。建议先导出备份。')) return;
    if (!confirm('再次确认：真的要全部删除吗？')) return;
    const pin = await Store.getMeta('pin');
    await Store.wipe();
    if (pin) await Store.setMeta('pin', pin);
    draft = await Store.getState();
    SiteApp.updateState(JSON.parse(JSON.stringify(draft)));
    renderTab(); toast('已清空');
  });

  window.addEventListener('beforeunload', () => { if (unlocked) collectFields(); });
})();
