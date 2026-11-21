/* 本地数据存储：IndexedDB 保存文字配置；文件以 Blob 形式单独存，避免撑爆 localStorage */
(function () {
  'use strict';

  const DB_NAME = 'my-site-db';
  const DB_VERSION = 1;
  const META_STORE = 'meta';
  const FILE_STORE = 'files';

  let dbPromise = null;

  /* IndexedDB 在部分受限环境（隐私模式/无头/禁用存储）不可用，
     用超时兜底并降级为内存存储，保证页面始终能打开（本次会话内有效） */
  const memory = { meta: {}, files: {} };
  let useMemory = false;

  function memoryDB() {
    return {
      memory: true,
      transaction() {
        return {
          objectStore(name) {
            const bag = name === META_STORE ? memory.meta : memory.files;
            return {
              get(key) { const r = {}; setTimeout(() => { r.result = bag[key]; r.onsuccess && r.onsuccess(); }, 0); return r; },
              put(value, key) { bag[key] = value; return {}; },
              delete(key) { delete bag[key]; return {}; },
              clear() { Object.keys(bag).forEach((k) => delete bag[k]); return {}; }
            };
          },
          set oncomplete(fn) { setTimeout(fn, 0); },
          set onerror(fn) {},
          set onabort(fn) {}
        };
      }
    };
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true; useMemory = true; resolve(memoryDB());
      }, 1500);
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { clearTimeout(timer); settled = true; useMemory = true; resolve(memoryDB()); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE);
      };
      req.onsuccess = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(req.result); };
      req.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); useMemory = true; resolve(memoryDB()); };
      req.onblocked = () => { if (settled) return; settled = true; clearTimeout(timer); useMemory = true; resolve(memoryDB()); };
    });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const defaults = {
    pin: '',
    profile: {
      name: '欢迎来到张丹鸿的个人网站',
      subtitle: '网络与新媒体 · 用内容讲好每一个故事',
      intro: '欢迎来到我的小宇宙。这里放着我做过的策划、写过的推文，还有一些和 AI 有关的 experimentation。',
      quote: '保持好奇，持续创造。',
      avatar: ''
    },
    resume: { fileId: '', fileName: '张丹鸿-暨南大学.pdf', builtin: 'assets/resume.pdf', builtinImage: 'assets/resume-hd.webp' },
    planningDoc: { title: '南方报业 AIGC 创作培训基地 · 策划方案', dir: 'assets/planning/', count: 36, ext: 'webp' },
    postsBuiltin: [
      { title: '志愿服务，探索全运智慧', tag: '推文作品', cover: 'assets/posts/cover1.webp', image: 'assets/posts/post1.webp' },
      { title: '从侨批到侨校学子', tag: '推文作品', cover: 'assets/posts/cover2.webp', image: 'assets/posts/post2.webp' },
      { title: '融合传播训练营 · 潮安手拉壶', tag: '推文作品', cover: 'assets/posts/cover3.webp', image: 'assets/posts/post3.webp' }
    ],
    videosBuiltin: [
      { title: '实验室制取粤语', tag: '视频剪辑', desc: '自制趣味粤语视频，获得5000+浏览，600+点赞', cover: 'assets/videos/video1.webp' },
      { title: '综艺混剪作品1', tag: '视频剪辑', cover: 'assets/videos/video2.webp' },
      { title: '综艺混剪作品2', tag: '视频剪辑', cover: 'assets/videos/video3.webp' }
    ],
    mediaBuiltin: [
      { video: 'assets/ai-media/ai-video.mp4' }
    ],
    aiCodingBuiltin: [
      { title: '自制小红书休闲小工具，上线一天就有超100人使用', cover: 'assets/ai-coding/coding1.webp' },
      { title: '预览图', cover: 'assets/ai-coding/coding2.webp' }
    ],
    planning: [],
    posts: [],
    extra: [],
    board: [],
    media: [],
    vibe: []
  };

  const Store = {
    defaults,

    async getMeta(key) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async setMeta(key, value) {
      const db = await openDB();
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(value, key);
      await txDone(tx);
      return value;
    },

    async getState() {
      const saved = await this.getMeta('site');
      const state = JSON.parse(JSON.stringify(defaults));
      if (saved && typeof saved === 'object') {
        Object.keys(saved).forEach((k) => {
          if (k === 'profile') {
            state.profile = Object.assign({}, defaults.profile, saved.profile || {});
            // 迁移旧默认名，避免老数据仍显示"阿圆"/旧短标题
            if (state.profile.name === '你好，我是阿圆' || state.profile.name === '张丹鸿') state.profile.name = defaults.profile.name;
          }
          else if (k === 'planningDoc') state.planningDoc = Object.assign({}, defaults.planningDoc, saved.planningDoc || {});
          else if (k === 'postsBuiltin' || k === 'videosBuiltin' || k === 'mediaBuiltin' || k === 'aiCodingBuiltin') { /* 始终用最新内置内容，不覆盖 */ }
          else if (k === 'resume') {
            state.resume = Object.assign({}, defaults.resume, saved.resume || {});
            // 内置简历图路径始终用最新版（webp），避免旧数据残留 png 路径
            state.resume.builtinImage = defaults.resume.builtinImage;
            // 未上传过自定义文件时，文件名跟随内置简历
            if (!state.resume.fileId && state.resume.builtin) state.resume.fileName = defaults.resume.fileName;
          }
          else state[k] = saved[k];
        });
      }
      return state;
    },

    async saveState(state) {
      return this.setMeta('site', state);
    },

    async putFile(id, blob) {
      const db = await openDB();
      const tx = db.transaction(FILE_STORE, 'readwrite');
      tx.objectStore(FILE_STORE).put(blob, id);
      await txDone(tx);
      return id;
    },

    async getFile(id) {
      if (!id) return null;
      const db = await openDB();
      return new Promise((resolve) => {
        const req = db.transaction(FILE_STORE, 'readonly').objectStore(FILE_STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    },

    async deleteFile(id) {
      if (!id) return;
      const db = await openDB();
      const tx = db.transaction(FILE_STORE, 'readwrite');
      tx.objectStore(FILE_STORE).delete(id);
      await txDone(tx);
    },

    newId() {
      return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    },

    /* 导出为可下载备份（文件转 dataURL） */
    async exportBackup() {
      const state = await this.getState();
      const blobToData = (blob) => new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
      const out = JSON.parse(JSON.stringify(state));
      const collect = async (items) => Promise.all(items.map(async (it) => Object.assign({}, it, {
        fileData: it.fileId ? await blobToData(await this.getFile(it.fileId)) : '',
        galleryData: it.gallery ? await Promise.all(it.gallery.map(async (g) => ({
          name: g.name, type: g.type,
          data: g.fileId ? await blobToData(await this.getFile(g.fileId)) : ''
        }))) : []
      })));
      out.resume = Object.assign({}, state.resume, {
        fileData: state.resume.fileId ? await blobToData(await this.getFile(state.resume.fileId)) : ''
      });
      out.planning = await collect(state.planning || []);
      out.posts = await collect(state.posts || []);
      out.board = await collect(state.board || []);
      out.media = await collect(state.media || []);
      out.vibe = await collect(state.vibe || []);
      out.profile = Object.assign({}, state.profile, {
        avatarData: state.profile.avatar ? await blobToData(await this.getFile(state.profile.avatar)) : ''
      });
      return out;
    },

    dataUrlToBlob(dataUrl) {
      return new Promise((resolve) => {
        fetch(dataUrl).then((r) => r.blob()).then(resolve).catch(() => resolve(null));
      });
    },

    /* 从备份恢复 */
    async importBackup(data) {
      if (!data || typeof data !== 'object') throw new Error('备份格式不正确');
      const state = JSON.parse(JSON.stringify(Store.defaults));
      Object.keys(data).forEach((k) => {
        if (k === 'profile') state.profile = Object.assign({}, defaults.profile, data.profile || {});
        else if (k !== 'fileData' && k !== 'galleryData' && k !== 'avatarData') state[k] = data[k];
      });
      const restore = async (items) => Promise.all((items || []).map(async (it) => {
        const c = Object.assign({}, it);
        delete c.fileData; delete c.galleryData;
        if (it.fileData) {
          c.fileId = Store.newId();
          await Store.putFile(c.fileId, await Store.dataUrlToBlob(it.fileData));
        }
        if (it.galleryData) {
          c.gallery = await Promise.all(it.galleryData.map(async (g) => {
            const fileId = g.data ? Store.newId() : '';
            if (fileId) await Store.putFile(fileId, await Store.dataUrlToBlob(g.data));
            return { name: g.name, type: g.type, fileId };
          }));
        }
        return c;
      }));
      state.resume = Object.assign({}, state.resume, { fileName: (data.resume || {}).fileName || '我的简历.pdf' });
      if (data.resume && data.resume.fileData) {
        state.resume.fileId = Store.newId();
        await Store.putFile(state.resume.fileId, await Store.dataUrlToBlob(data.resume.fileData));
      }
      state.profile.avatar = '';
      if (data.profile && data.profile.avatarData) {
        state.profile.avatar = Store.newId();
        await Store.putFile(state.profile.avatar, await Store.dataUrlToBlob(data.profile.avatarData));
      }
      for (const key of ['planning', 'posts', 'extra', 'board', 'media', 'vibe']) {
        state[key] = await restore(data[key] || []);
      }
      await Store.saveState(state);
      return state;
    },

    async wipe() {
      const db = await openDB();
      const tx = db.transaction([META_STORE, FILE_STORE], 'readwrite');
      tx.objectStore(META_STORE).clear();
      tx.objectStore(FILE_STORE).clear();
      await txDone(tx);
    }
  };

  window.Store = Store;
})();
