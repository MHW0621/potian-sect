/* 破天宗 · 界面层（V1.4）
 * 主页 = 宗门场景；所有功能面板进单例抽屉；事件不再弹窗，统一进待处理与消息中心。
 */
import {
  RESOURCES, RES_BY_KEY, FACILITIES, INSTITUTIONS, LAYERS, REGIONS,
  MISSION_TEMPLATES, TECHNIQUES, ENDINGS, RECRUIT,
} from './config.js';
import { STORY_BY_ID, STORY_NODES } from './story.js';
import { Scene, BUILDINGS } from './scene.js';
import {
  deriveMatters, mattersByBuilding, unreadCount, markSeen, snooze,
  memorials, floaters, STANCES, LAWS, LEVEL, BUILDING_NAMES,
} from './matters.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => {
  n = Number(n) || 0;
  if (Math.abs(n) >= 100000) return (n / 10000).toFixed(1) + '万';
  return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
};
const STAGE_NAME = { 1: '第一幕 立宗', 2: '第二幕 开山', 3: '第三幕 争锋', 4: '第四幕 问天' };
const STATE_NAME = { cultivate: '修炼中', bottleneck: '瓶颈', injured: '疗伤', mission: '任务中', expedition: '外派', post: '在任', idle: '闲居' };
const REL_NAME = ['敌对', '冷淡', '中立', '友善', '结盟', '同盟'];

const PANEL_META = {
  disciples: ['弟子名录', '在册弟子、修为与去留'],
  org: ['机构席位', '三机构九席，竞选按八维加权'],
  workshop: ['资源工坊', '库房、产线与营建'],
  tasks: ['任务派遣', '山门所接的活计与远行'],
  world: ['大世界', '小世界分层、三方势力与道印'],
  battle: ['宗门对战', '双方同意才开战'],
  rank: ['赛季榜单', '只展示公开字段'],
  chronicle: ['宗门史', '自决与批复皆留痕'],
  settings: ['设置', '界面偏好与账号'],
  pending: ['待处理', '日常、重要、待决三级'],
  messages: ['消息中心', '全部事件，可一键已读'],
  autonomy: ['破天阁', '施政策略与自决记录'],
};

const GFX_KEY = 'potian.gfx';

function gfxPref() {
  try {
    const raw = localStorage.getItem(GFX_KEY);
    if (raw) return Object.assign({ q: 2, motion: true }, JSON.parse(raw));
  } catch (e) { /* ignore */ }
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { q: reduce ? 1 : 2, motion: !reduce };
}

export const UI = {
  game: null,
  helpers: null,
  panel: 'scene',
  msgs: [],
  mods: {},
  scene: null,
  discFilter: { type: 'all', sort: 'power', q: '' },
  msgFilter: 'all',
  templeTab: 'memo',
  gfx: gfxPref(),

  mount(game, helpers) {
    this.game = game;
    this.helpers = helpers;
    this.flags = Object.assign({ sceneHome: true, pendingMode: true }, helpers.grayscale || {});
    this.msgs = [];
    this.panel = 'scene';
    this.bindOnce();
    this.applyModules(helpers.modules || game.mod || {});
    this.render();
  },

  bindOnce() {
    if (this._bound) return;
    this._bound = true;

    document.querySelectorAll('.rail-item[data-panel]').forEach((b) => {
      b.addEventListener('click', () => {
        this.setPanel(b.dataset.panel);
        this.closeRail();
      });
    });
    document.getElementById('panelClose').addEventListener('click', () => this.closePanel());
    document.getElementById('btnPending').addEventListener('click', () => this.setPanel('pending'));
    document.getElementById('btnMsg').addEventListener('click', () => this.setPanel('messages'));
    document.getElementById('btnRail').addEventListener('click', () => this.toggleRail());
    document.getElementById('railMask').addEventListener('click', () => this.closeRail());
    document.getElementById('btnTempleBack').addEventListener('click', () => this.backToScene());
    document.querySelectorAll('#templeTabs .tab').forEach((b) => {
      b.addEventListener('click', () => {
        this.templeTab = b.dataset.ttab;
        document.querySelectorAll('#templeTabs .tab').forEach((x) => x.classList.toggle('is-on', x.dataset.ttab === this.templeTab));
        this.renderTemple();
      });
    });
    document.getElementById('panelBody').addEventListener('click', (e) => this.onClick(e));
    /* 交互窗口：按下后 1.5 秒内不做自动重排 */
    const hold = () => { this._interactUntil = Date.now() + 1500; };
    document.getElementById('panelBody').addEventListener('pointerdown', hold, true);
    document.getElementById('panelBody').addEventListener('keydown', hold, true);
    document.getElementById('templeStage').addEventListener('pointerdown', hold, true);
    document.getElementById('templeStage').addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.getElementById('view-temple').classList.contains('is-active')) this.backToScene();
        else this.closePanel();
      }
    });
  },

  /* ---------- 场景 ---------- */
  ensureScene() {
    /* 场景开关关闭时走旧看板，不加载 canvas */
    if (!this.flags.sceneHome) { this.renderBoard(); return; }
    if (this.scene) return;
    this.teardownBoard();
    const canvas = document.getElementById('sceneCanvas');
    const overlay = document.getElementById('sceneOverlay');
    if (!canvas || !overlay) return;
    this.scene = new Scene({
      canvas,
      overlay,
      onOpen: (key) => {
        const b = BUILDINGS.find((x) => x.key === key);
        if (!b) return;
        if (b.panel === 'temple') this.openTemple();
        else this.setPanel(b.panel);
      },
      onSelect: (key) => {
        const b = BUILDINGS.find((x) => x.key === key);
        const hint = document.getElementById('sceneHint');
        if (hint && b) { hint.textContent = `${b.name} · 再点一次进入`; hint.classList.remove('off'); }
      },
    });
    this.scene.onDowngrade = (q) => {
      this.gfx.q = q;
      this.saveGfx();
      this.toast('帧率偏低，画质已自动降为「' + ['极简', '流畅', '标准', '精细'][q] + '」');
    };
    this.scene.mount();
    this.scene.setQuality(this.gfx.q, this.gfx.motion);
    this.syncScene();
  },

  enter() {
    this.ensureScene();
    if (this.scene) { this.scene.resize(); this.syncScene(); }
    else this.renderBoard();
    if (this.panel !== 'scene') this.setPanel(this.panel);
  },

  syncScene() {
    if (!this.game) return;
    const list = deriveMatters(this.game);
    this._matters = list;
    if (!this.scene) { this.renderBoard(list); this.syncBadges(list); return; }
    const g = this.game;
    const s = g.save;
    this.scene.setModel({
      layers: s.layers,
      day: s.day,
      badges: mattersByBuilding(list),
      floaters: floaters(g),
      figures: this.figurePlan(),
    });
    this.syncBadges(list);
  },

  /* ---------- 场景回退：旧看板（场景开关关闭时） ---------- */
  renderBoard(list) {
    const g = this.game;
    if (!g) return;
    const stage = document.getElementById('sceneStage');
    if (!stage) return;
    const s = g.save;
    const canvas = document.getElementById('sceneCanvas');
    const overlay = document.getElementById('sceneOverlay');
    const hint = document.getElementById('sceneHint');
    if (canvas) canvas.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    if (hint) hint.style.display = 'none';
    let box = document.getElementById('boardFallback');
    if (!box) {
      box = document.createElement('div');
      box.id = 'boardFallback';
      box.className = 'board';
      box.addEventListener('click', (e) => this.onClick(e));
      stage.appendChild(box);
    }
    const ms = list || this._matters || [];
    const badges = mattersByBuilding(ms);
    const fl = floaters(g);
    const layers = s.layers || 1;
    const cards = BUILDINGS.map((b) => {
      const bd = badges[b.key];
      const f = fl[b.key];
      const locked = b.layer > layers;
      const note = locked ? '山门未及此层'
        : (f ? `${f.k} ${fmt(f.v)} / 日` : (b.panel === 'temple' ? '重大事项' : '查看'));
      return `<button class="board-card ${locked ? 'is-locked' : ''}" data-act="board:open" data-arg="${b.key}">
        <span class="bc-name">${esc(b.name)}</span>
        <span class="bc-note">${esc(note)}</span>
        ${bd ? `<i class="bc-dot lv${bd.level}">${bd.count > 1 ? bd.count : ''}</i>` : ''}
      </button>`;
    }).join('');
    box.innerHTML = `<div class="board-head"><b>宗门看板</b>
        <small>旧版视图 · 场景开关已关闭</small>
        <span class="board-count">待办 ${ms.length} 件</span></div>
      <div class="board-grid">${cards}</div>`;
  },

  teardownBoard() {
    const box = document.getElementById('boardFallback');
    if (box) box.remove();
    const canvas = document.getElementById('sceneCanvas');
    const overlay = document.getElementById('sceneOverlay');
    const hint = document.getElementById('sceneHint');
    if (canvas) canvas.style.display = '';
    if (overlay) overlay.style.display = '';
    if (hint) hint.style.display = '';
  },

  /* 灰度切换后重建主页 */
  rebuildHome() {
    if (this.flags.sceneHome) {
      this.teardownBoard();
      this.ensureScene();
      if (this.scene) { this.scene.resize(); this.syncScene(); }
    } else {
      if (this.scene) {
        this.scene.destroy();
        this.scene = null;
        const ov = document.getElementById('sceneOverlay');
        if (ov) ov.innerHTML = '';
      }
      this.syncScene();
    }
    this.renderPanel();
  },

  /* 提示模式回退：旧式阻断弹窗 */
  storyPopup(node, isEvent) {
    const g = this.game;
    if (!g || !node) return;
    const opts = (node.options || []).map((o, i) => `<button class="choice" data-si="${i}">
      <b>${esc(o.label)}</b><span>${esc(o.result || '')}</span></button>`).join('');
    const close = this.modal({
      title: node.title || node.name || '宗门来信',
      sub: '旧提示模式 · 事件会打断当前操作',
      body: `<p class="story-text">${esc(node.text || '')}</p><div class="choices">${opts}</div>`,
      actions: [],
    });
    const root = document.getElementById('modalRoot');
    root.querySelectorAll('[data-si]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.si);
        if (isEvent) g.resolveEvent(i); else g.resolveStory(node.id, i);
        close();
        this.render();
        this.syncScene();
      });
    });
  },

  figurePlan() {
    const g = this.game;
    const out = [];
    let n = 0;
    /* 人只站在已开辟的山层上，未开辟的山只留形 */
    const maxT = Math.max(0, Math.min(9, (g.save.layers || 1) - 1));
    for (const d of g.save.disciples) {
      if (n >= 40) break;
      let t = 5;
      let kind = 'formal';
      if (d.type === 'servant') { t = d.id % 2 ? 1 : 2; kind = 'servant'; }
      else if (d.type === 'staff') { t = d.staffInst === 'hufatang' ? 6 : 7; kind = 'staff'; }
      else if (d.state === 'injured') { t = 0; kind = 'injured'; }
      else if (d.state === 'mission' || d.state === 'expedition') { t = 0; kind = 'away'; }
      else if (d.state === 'post') { t = 6; kind = 'staff'; }
      else if (d.state === 'bottleneck' || d.demon > 60 || d.step >= 7) { t = 8; kind = 'formal'; }
      else if (d.step >= 5) { t = 4; kind = 'formal'; }
      const u = ((d.id * 37) % 100) / 100;
      out.push({ t: Math.min(t, maxT), u: 0.16 + u * 0.68, kind, seed: u * 6.28 });
      n++;
    }
    if (!out.length) {
      out.push({ t: 0, u: 0.32, kind: 'servant', seed: 1 });
      out.push({ t: 1, u: 0.58, kind: 'servant', seed: 2.4 });
    }
    return out;
  },

  syncBadges(list) {
    const unread = unreadCount(this.game, list);
    const decide = list.filter((m) => m.level === 3).length;
    const topLevel = list.length ? Math.max(...list.map((m) => m.level)) : 0;
    const setDot = (el, n, lv) => {
      if (!el) return;
      el.hidden = n <= 0;
      if (n > 0) { el.textContent = ''; el.className = 'dot' + (lv === 2 ? ' lv2' : lv === 1 ? ' lv1' : ''); }
    };
    setDot(document.getElementById('pendingDot'), unread, topLevel);
    setDot(document.getElementById('msgDot'), this.unreadNews(), 1);

    const pb = document.getElementById('pendingBadge');
    if (pb) { pb.hidden = list.length === 0; pb.textContent = list.length; pb.className = 'rail-badge' + (topLevel === 2 ? ' lv2' : topLevel === 1 ? ' lv1' : ''); }
    const tb = document.getElementById('templeBadge');
    if (tb) { tb.hidden = decide === 0; tb.textContent = decide; tb.className = 'rail-badge'; }
    const mb = document.getElementById('msgBadge');
    if (mb) { const u = this.unreadNews(); mb.hidden = u <= 0; mb.textContent = u; mb.className = 'rail-badge lv1'; }
  },

  unreadNews() {
    const s = this.game ? this.game.save : null;
    if (!s) return 0;
    const seenDay = (s.matterState && s.matterState.seenDay) || 0;
    return (s.news || []).filter((x) => x.day > seenDay).length;
  },

  /* ---------- 顶栏 ---------- */
  renderTop() {
    const g = this.game; const s = g.save;
    const speed = s.sect.speed;
    const sig = [s.sect.name, s.sect.founder, Math.floor(s.day / 360), fmt(g.renown), fmt(s.res.lingshi || 0), speed].join('|');
    if (sig === this._topSig) return;
    this._topSig = sig;
    document.getElementById('hSect').textContent = s.sect.name;
    document.getElementById('hFounder').textContent = '祖师 · ' + s.sect.founder;
    document.getElementById('hYear').textContent = Math.floor(s.day / 360) + 1;
    document.getElementById('hRenown').textContent = fmt(g.renown);
    document.getElementById('hStone').textContent = fmt(s.res.lingshi || 0);
    document.querySelectorAll('#speedBox button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
  },

  render() {
    if (!this.game) return;
    this.renderTop();
    this.syncScene();
    if (this.panel !== 'scene') this.renderPanel();
    if (document.getElementById('view-temple').classList.contains('is-active')) this.renderTemple();
  },

  renderPanel(force) {
    const body = document.getElementById('panelBody');
    if (!body || !this.game) return;
    const map = {
      disciples: () => this.pDisciples(), org: () => this.pOrg(), workshop: () => this.pWorkshop(),
      tasks: () => this.pTasks(), world: () => this.pWorld(), battle: () => this.pBattle(),
      rank: () => this.pRank(), chronicle: () => this.pChronicle(), settings: () => this.pSettings(),
      pending: () => this.pPending(), messages: () => this.pMessages(), autonomy: () => this.pAutonomy(),
    };
    /* 手指/鼠标还按在抽屉里时不重排，否则点击目标会被销毁，点了等于没点 */
    if (!force && Date.now() < (this._interactUntil || 0)) return;
    const html = (map[this.panel] || map.pending)();
    /* 内容一模一样就不动 DOM：省掉每秒一次的大树重建与滚动跳动 */
    if (!force && html === this._panelHtml) return;
    this._panelHtml = html;
    const top = body.scrollTop;
    body.innerHTML = html;
    if (top) body.scrollTop = top;
  },

  isLive() {
    return ['disciples', 'workshop', 'world', 'tasks', 'pending', 'messages', 'autonomy'].includes(this.panel);
  },

  /* ---------- 抽屉 ---------- */
  setPanel(name) {
    if (name === 'scene') { this.closePanel(); return; }
    if (name === 'temple') { this.openTemple(); return; }
    if (this.panelClosed(name)) { this.toast('该模块维护中，暂未开放'); return; }
    const meta = PANEL_META[name];
    if (!meta) return;
    this.panel = name;
    document.querySelectorAll('.rail-item[data-panel]').forEach((b) => b.classList.toggle('is-on', b.dataset.panel === name));
    document.getElementById('panelTitle').textContent = meta[0];
    document.getElementById('panelSub').textContent = meta[1];
    this._panelHtml = '';
    this.renderPanel(true);
    document.getElementById('panelBody').scrollTop = 0;
    document.getElementById('view-game').classList.add('panel-open');
    document.getElementById('panel').setAttribute('aria-hidden', 'false');
    if (this.scene) { this.scene.clearSelection(); this.scene.pause(); }
    this.closeRail();
    if (name === 'messages') this.markNewsSeen();
    this.syncBadges(this._matters || []);
  },

  closePanel() {
    this.panel = 'scene';
    document.querySelectorAll('.rail-item[data-panel]').forEach((b) => b.classList.toggle('is-on', b.dataset.panel === 'scene'));
    document.getElementById('view-game').classList.remove('panel-open');
    document.getElementById('panel').setAttribute('aria-hidden', 'true');
    if (this.scene) { this.scene.resize(); this.scene.resume(); }
    const hint = document.getElementById('sceneHint');
    if (hint) { hint.textContent = '选一处建筑，再点一次进入'; hint.classList.remove('off'); }
  },

  markNewsSeen() {
    const s = this.game && this.game.save;
    if (!s) return;
    s.matterState = s.matterState || { snooze: {}, seen: {}, seenDay: 0 };
    s.matterState.seenDay = s.day;
    if (this.helpers && this.helpers.autoSave) this.helpers.autoSave();
  },

  toggleRail() {
    const r = document.getElementById('rail');
    const m = document.getElementById('railMask');
    const on = !r.classList.contains('open');
    r.classList.toggle('open', on);
    m.classList.toggle('on', on);
  },
  closeRail() {
    document.getElementById('rail').classList.remove('open');
    document.getElementById('railMask').classList.remove('on');
  },

  /* ---------- 全服模块开关 ---------- */
  applyModules(mods) {
    this.mods = mods || {};
    const map = { org: 'org', workshop: 'prod', tasks: 'tasks', world: 'world', battle: 'battle', rank: 'rank' };
    document.querySelectorAll('.rail-item[data-panel]').forEach((b) => {
      const k = map[b.dataset.panel];
      b.classList.toggle('hide', !!(k && this.mods[k] === false));
    });
    if (this.panelClosed(this.panel)) this.closePanel();
  },

  panelClosed(name) {
    const map = { org: 'org', workshop: 'prod', tasks: 'tasks', world: 'world', battle: 'battle', rank: 'rank' };
    const k = map[name];
    return !!(k && this.mods[k] === false);
  },

  /* 模块关闭时，对应建筑仍可点，但提示维护中 */
  checkModule(name) {
    if (this.panelClosed(name)) { this.toast('该模块维护中，暂未开放'); return false; }
    return true;
  },

  toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => el.classList.remove('on'), 2200);
  },

  pushMsg(text, type = 'info') {
    this.msgs.unshift({ text, type, day: this.game ? this.game.save.day : 0 });
    if (this.msgs.length > 60) this.msgs.pop();
  },

  /* ---------- 待处理 ---------- */
  pPending() {
    const list = this._matters || deriveMatters(this.game);
    if (!list.length) {
      return `<div class="stack">
        <div class="card empty" style="background:rgba(255,253,248,.7)"><strong>诸事已毕</strong>阁中依策自处，山门安静。</div>
        <div class="card"><div class="card-head"><div class="t"><h3>自决记录</h3><small>破天阁</small></div></div>${this.autoLog(4)}</div>
      </div>`;
    }
    const groups = [3, 2, 1].map((lv) => ({ lv, items: list.filter((m) => m.level === lv) })).filter((x) => x.items.length);
    return `<div class="stack">
      <div class="card tight">
        <div class="spread">
          <div><b style="font-family:var(--f-head)">共 ${list.length} 件</b>
            <span class="sub">　待决 ${list.filter((m) => m.level === 3).length} · 重要 ${list.filter((m) => m.level === 2).length} · 日常 ${list.filter((m) => m.level === 1).length}</span></div>
          <button class="btn sm ghost" data-act="pending:read">全部已读</button>
        </div>
        <p class="hint" style="margin-top:6px">待决事项须去祖师殿批复；日常事务破天阁会自行处置，此处只作备查。</p>
      </div>
      ${groups.map((grp) => `
        <div class="stack" style="gap:8px">
          <div class="spread" style="padding:0 2px"><span class="sub">${LEVEL[grp.lv].name}</span><span class="sub">${grp.items.length}</span></div>
          ${grp.items.map((m) => `
            <div class="matter ${LEVEL[grp.lv].cls}">
              <div class="m-main">
                <div class="m-title">${esc(m.title)}</div>
                <div class="m-desc">${esc(m.desc || '')}</div>
              </div>
              <span class="m-lv">${LEVEL[grp.lv].name}</span>
              <div class="m-act">
                <button class="btn sm ${m.level === 3 ? 'primary' : ''}" data-act="matter:go" data-arg="${esc(m.ref)}">${m.level === 3 ? '批阅' : '前往'}</button>
                <button class="btn sm ghost" data-act="matter:snooze" data-arg="${esc(m.ref)}">暂缓</button>
              </div>
            </div>`).join('')}
        </div>`).join('')}
      <p class="hint center">暂缓的事项四十五日内不再提示。</p>
    </div>`;
  },

  autoLog(n = 6) {
    const logs = (this.game.save.story.log || []).filter((l) => l.kind === 'auto').slice(0, n);
    if (!logs.length) return '<div class="empty">破天阁尚未自行处置过事务。</div>';
    return `<div class="list">${logs.map((l) => `
      <div class="item"><div class="main">
        <div class="name" style="font-size:12.5px">${esc(l.title)} <span class="pill mute">${esc(l.label || '')}</span></div>
        <div class="meta">${esc(l.result || '')}</div>
        <div class="meta">开宗 ${Math.floor(l.day / 360) + 1} 年 · 第 ${l.day % 360} 日</div>
      </div></div>`).join('')}</div>`;
  },

  /* ---------- 消息中心 ---------- */
  pMessages() {
    const s = this.game.save;
    const news = (s.news || []).map((x) => ({ day: x.day, type: x.type, text: x.text }));
    const autos = (s.story.log || []).filter((l) => l.kind === 'auto')
      .map((l) => ({ day: l.day, type: 'auto', text: `${l.title}：${l.result || l.label || ''}` }));
    let all = news.concat(autos).sort((a, b) => b.day - a.day);
    if (this.msgFilter === 'news') all = all.filter((x) => x.type !== 'auto');
    if (this.msgFilter === 'auto') all = all.filter((x) => x.type === 'auto');
    if (this.msgFilter === 'story') all = all.filter((x) => x.type === 'story');
    if (this.msgFilter === 'bad') all = all.filter((x) => x.type === 'bad');
    return `<div class="stack">
      <div class="chips">
        ${[['all', '全部'], ['news', '宗门'], ['auto', '自决'], ['story', '剧情'], ['bad', '凶信']].map(([k, n]) =>
      `<button class="chip ${this.msgFilter === k ? 'is-on' : ''}" data-act="msg:filter" data-arg="${k}">${n}</button>`).join('')}
        <button class="btn sm ghost" style="margin-left:auto" data-act="msg:read">一键已读</button>
      </div>
      <div class="list">
        ${all.length ? all.slice(0, 120).map((x) => `
          <div class="news-item ${x.type || 'info'}">
            <div class="n-body">${esc(x.text)}</div>
            <div class="n-day">${Math.floor(x.day / 360) + 1}年${x.day % 360}日</div>
          </div>`).join('') : '<div class="empty">暂无消息。</div>'}
      </div>
    </div>`;
  },

  /* ---------- 破天阁 ---------- */
  pAutonomy() {
    const g = this.game;
    const p = g.policy();
    const areas = p.areas || {};
    const laws = p.laws || {};
    const autoN = (g.save.story.log || []).filter((l) => l.kind === 'auto').length;
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>施政策略</h3><small>决定阁中如何自处</small></div></div>
        <div class="stance-grid">
          ${STANCES.map((st) => `
            <button class="stance ${p.stance === st.key ? 'is-on' : ''}" data-act="pol:stance" data-arg="${st.key}">
              <div class="s-name">${st.name}</div>
              <div class="s-motto">${st.motto}</div>
              <div class="s-desc">${st.desc}</div>
              <div class="s-eff">${st.effect}</div>
            </button>`).join('')}
        </div>
        <p class="hint" style="margin-top:10px">策略写入即生效，并同步到云端与其他设备。</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>自决范围</h3><small>关闭后此类事务回到待处理</small></div></div>
        ${[['seat', '补缺', '席位空缺时由阁议推举'], ['recruit', '招揽', '杂役不足时自行招收'], ['heal', '疗养', '伤者康复后归队'], ['prod', '排产', '灵田与工坊按例开工']]
        .map(([k, n, d]) => `
          <div class="toggle-row">
            <div><div class="l-name">${n}</div><div class="l-desc">${d}</div></div>
            <button class="switch ${areas[k] !== false ? 'on' : ''}" data-act="pol:area" data-arg="${k}" aria-label="${n}"></button>
          </div>`).join('')}
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>本阁法度</h3><small>可在祖师殿详阅</small></div>
          <button class="btn sm ghost" data-act="open:temple-law">去祖师殿</button></div>
        ${LAWS.map((l) => `
          <div class="toggle-row">
            <div><div class="l-name">${l.name}</div><div class="l-desc">${l.desc}</div></div>
            <button class="switch ${laws[l.key] ? 'on' : ''}" data-act="pol:law" data-arg="${l.key}"></button>
          </div>`).join('')}
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>自决记录</h3><small>共 ${autoN} 条，均已写入宗门史</small></div>
          <button class="btn sm ghost" data-act="panel" data-arg="chronicle">全部</button></div>
        ${this.autoLog(8)}
      </div>
    </div>`;
  },

  /* ---------- 祖师殿 ---------- */
  openTemple() {
    this.closePanel();
    if (this.scene) this.scene.pause();
    document.querySelectorAll('.rail-item[data-panel]').forEach((b) => b.classList.toggle('is-on', b.dataset.panel === 'temple'));
    document.getElementById('templeSect').textContent = this.game.save.sect.name;
    document.querySelectorAll('#templeTabs .tab').forEach((x) => x.classList.toggle('is-on', x.dataset.ttab === this.templeTab));
    this.renderTemple();
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-temple'));
    window.scrollTo(0, 0);
  },

  backToScene() {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-game'));
    this.panel = 'scene';
    document.querySelectorAll('.rail-item[data-panel]').forEach((b) => b.classList.toggle('is-on', b.dataset.panel === 'scene'));
    if (this.scene) { this.scene.resize(); this.syncScene(); this.scene.resume(); }
  },

  renderTemple() {
    const stage = document.getElementById('templeStage');
    if (!stage || !this.game) return;
    if (this.templeTab === 'law') { stage.innerHTML = this.templeLaw(); return; }
    if (this.templeTab === 'seal') { stage.innerHTML = this.templeSeal(); return; }
    stage.innerHTML = this.templeMemo();
  },

  templeMemo() {
    const list = memorials(this.game);
    if (!list.length) {
      return `<div class="card empty" style="padding:46px 20px">
        <strong>案上无疏</strong>宗门安稳，暂无可陈之事。阁中自处，祖师可去场景走走。
      </div>
      <div class="card" style="margin-top:12px">
        <div class="card-head"><div class="t"><h3>已批近事</h3></div></div>
        ${this.memorialLog()}
      </div>`;
    }
    return list.map((m, i) => {
      const first = i === 0;
      return `<article class="memo ${first ? 'is-first' : ''}" data-memo="${esc(m.ref)}">
        <header class="memo-head">
          <span class="memo-seal">${esc(m.seal || '奏')}</span>
          <div class="m-h"><strong>${esc(m.title)}</strong><span>${esc(m.from || '')}</span></div>
          <span class="pill ${first ? '' : 'mute'}">待批</span>
        </header>
        <div class="memo-body">
          <div class="memo-sec">
            <div class="s-t">事由</div>
            <div class="s-c quote">${esc(m.cause)}</div>
          </div>
          <div class="memo-sec">
            <div class="s-t">影响</div>
            <div class="s-c warn">${esc(m.impact)}</div>
          </div>
          <div class="memo-sec">
            <div class="s-t">三处置</div>
            <div class="memo-opts">
              ${m.options.map((o, k) => `
                <button class="memo-opt ${o.disabled ? 'is-off' : ''}" data-act="memo:pick" data-arg="${esc(m.ref)}|${k}" ${o.disabled ? 'disabled' : ''}>
                  <span class="o-label">${esc(o.label)}${o.disabled ? '<em class="o-off">存量不足</em>' : ''}</span>
                  <span class="o-eff">${esc(o.detail || '')}</span>
                </button>`).join('')}
            </div>
          </div>
        </div>
        <div class="memo-note">附注：${esc(m.note || '')}</div>
      </article>`;
    }).join('') + `<div class="memo-queue">
      <b>逐件批阅</b><span>点任一处置即为批复一件，其余仍留在案上；批语与后果即时写入宗门史。</span>
    </div>`;
  },

  memorialLog() {
    const logs = (this.game.save.story.log || []).filter((l) => l.kind === 'memorial' || l.kind === 'story' || l.kind === 'event').slice(0, 6);
    if (!logs.length) return '<div class="empty">尚无批语。</div>';
    return `<div class="list">${logs.map((l) => `
      <div class="item"><div class="main">
        <div class="name" style="font-size:13px">${esc(l.title)} <span class="pill mute">${esc(l.label || '')}</span></div>
        <div class="meta">${esc(l.result || '')}</div>
        <div class="meta">开宗 ${Math.floor(l.day / 360) + 1} 年 · 第 ${l.day % 360} 日</div>
      </div></div>`).join('')}</div>`;
  },

  templeLaw() {
    const g = this.game;
    const laws = g.policy().laws || {};
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>法度</h3><small>改一条，即刻行于全宗</small></div></div>
        ${LAWS.map((l) => `
          <div class="law-row">
            <div class="l-main"><div class="l-name">${l.name}</div><div class="l-desc">${l.desc}</div></div>
            <button class="switch ${laws[l.key] ? 'on' : ''}" data-act="pol:law" data-arg="${l.key}" aria-label="${l.name}"></button>
          </div>`).join('')}
        <p class="hint" style="margin-top:10px">法度与施政策略共同决定修炼、产出、忠诚与心魔的走向。</p>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>当下成效</h3><small>按当前策略与法度折算</small></div></div>
        <div class="kv" style="font-size:12px">
          <span>修炼 <b>×${(g.stanceMul().gain * (laws.morning ? 1.04 : 1)).toFixed(2)}</b></span>
          <span>产出 <b>×${(g.stanceMul().prod * (laws.curfew ? 0.97 : 1) * (laws.bounty ? 0.98 : 1)).toFixed(2)}</b></span>
          <span>突破 <b>+${Math.round((g.stanceMul().break_ + (laws.curfew ? 0.01 : 0)) * 100)}%</b></span>
          <span>心魔增速 <b>×${(g.stanceMul().demon * (laws.curfew ? 0.92 : 1)).toFixed(2)}</b></span>
          <span>忠诚漂移 <b>${g.stanceMul().loyalty > 0 ? '+' : ''}${g.stanceMul().loyalty}/日</b></span>
        </div>
      </div>
    </div>`;
  },

  templeSeal() {
    const g = this.game; const s = g.save;
    const shard = s.flags.shard || 0;
    const pathName = s.flags.finalPath
      ? ({ search: '搜寻第三片', cast: '以宗门之力补铸', shell: '补出一个空壳', mortal: '不再追问' }[s.flags.finalPath] || s.flags.finalPath)
      : '未定';
    return `<div class="stack">
      <div class="seal-panel">
        <div class="seal-card">
          <div class="sc-t">道印残片</div>
          <div class="sc-v">${shard} / 3</div>
          <div class="seal-frag">
            ${[0, 1, 2].map((i) => `<i class="${i < shard ? 'on' : ''}">${i < shard ? '印' : '缺'}</i>`).join('')}
          </div>
        </div>
        <div class="seal-card">
          <div class="sc-t">宗门气运</div>
          <div class="sc-v">${s.sect.fortune >= 0 ? '+' : ''}${Math.round(s.sect.fortune)}</div>
          <p class="hint">气运影响异动的吉凶倾向，范围 −100 至 +100。</p>
        </div>
        <div class="seal-card">
          <div class="sc-t">终局路径</div>
          <div class="sc-v" style="font-size:17px">${esc(pathName)}</div>
          <p class="hint">${s.ended ? '终局已定：' + ENDINGS[s.ended].name : '尚未定局。问天台仍空着。'}</p>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>印面</h3><small>三分之一完整，纹路断断续续</small></div></div>
        <p class="hint">它让这片土地被天地承认，也记录着宗门气运。三片归位之前，问天台只是一块石头。</p>
        <div class="kv" style="font-size:12px;margin-top:10px">
          <span>已决剧情 <b>${s.story.done.length} / ${STORY_NODES.length}</b></span>
          <span>小世界 <b>${s.layers} / 10 层</b></span>
          <span>最高步数 <b>${g.maxStep() || 0}</b></span>
        </div>
      </div>
    </div>`;
  },
  /* ---------- 弟子 ---------- */
  pDisciples() {
    const g = this.game;
    const s = g.save;
    const f = this.discFilter;
    const sorters = {
      power: (a, b) => g.power(b) - g.power(a),
      step: (a, b) => (b.step || 0) - (a.step || 0) || b.star - a.star,
      life: (a, b) => (b.life - b.age) - (a.life - a.age),
      join: (a, b) => b.joinedDay - a.joinedDay,
      demon: (a, b) => b.demon - a.demon,
    };
    const cmp = sorters[f.sort] || sorters.power;
    const cap = g.cap();
    const total = s.disciples.length;
    const formal = s.disciples.filter((d) => d.type === 'formal').sort(cmp);
    const servant = s.disciples.filter((d) => d.type === 'servant').sort(cmp);
    const staff = s.disciples.filter((d) => d.type === 'staff').sort(cmp);
    const broken = s.disciples.filter((d) => d.state === 'bottleneck');

    const afford = (cost) => Object.entries(cost).every(([k, v]) => (s.res[k] || 0) >= v);
    const costTxt = (cost) => Object.entries(cost).map(([k, v]) => `${(RES_BY_KEY[k] || {}).name || k} ${v}`).join(' · ');

    const recBtn = (key) => {
      const r = RECRUIT[key];
      const full = total >= cap;
      const poor = !afford(r.cost);
      const off = full || poor;
      const why = full ? `已满 ${cap} 人，先开辟更高层` : poor ? `缺 ${costTxt(r.cost)}` : '';
      return `<div class="rec">
        <div class="rec-top"><b>${r.name}</b><span class="rec-cost">${costTxt(r.cost)}</span></div>
        <p class="rec-desc">${r.desc}</p>
        <button class="btn sm ${key === 'formal' ? 'primary' : ''}" data-act="recruit" data-arg="${key}" ${off ? 'disabled' : ''}>
          ${off ? why : `招一名${r.name}`}
        </button>
      </div>`;
    };

    const group = (title, list, note) => {
      if (!list.length) return '';
      return `<div class="disc-group">
        <div class="dg-head"><b>${title}</b><span>${list.length} 人</span><em>${note}</em></div>
        <div class="dg-body">${list.slice(0, 60).map((d) => this.discCard(d)).join('')}</div>
      </div>`;
    };

    const filtered = (list) => (list.length
      ? `<div class="stack">${list.slice(0, 60).map((d) => this.discCard(d)).join('')}</div>`
      : '<div class="card empty"><strong>此处无人</strong>换个筛选项看看。</div>');

    let body;
    if (f.type === 'all') {
      body = group('正式弟子', formal, '修炼、出战、转职')
        + group('杂役', servant, '跑腿、守门，占口粮')
        + group('已转职', staff, '在机构当值')
        || '<div class="card empty"><strong>还没有人</strong>先在山门收第一批。</div>';
    } else if (f.type === 'break') body = filtered(broken);
    else if (f.type === 'formal') body = filtered(formal);
    else if (f.type === 'servant') body = filtered(servant);
    else body = filtered(staff);

    const examPool = formal.filter((d) => d.step === 3 && d.state === 'bottleneck' && d.tries3 < 3);
    return `<div class="stack">
      <div class="card recruit-card">
        <div class="card-head">
          <div class="t"><h3>招收入门</h3><small>在册 ${total} / ${cap} 人</small></div>
          ${examPool.length ? `<button class="btn sm ghost" data-act="exam">第三步选拔 · ${examPool.length} 人</button>` : ''}
        </div>
        <div class="rec-grid">${recBtn('formal')}${recBtn('servant')}</div>
        <div class="cap-bar"><i style="width:${Math.min(100, (total / cap) * 100)}%"></i></div>
      </div>

      <div class="card tight">
        <div class="row" style="flex-wrap:wrap">
          ${[['all', '全部'], ['formal', '正式'], ['servant', '杂役'], ['staff', '已转职'], ['break', '待突破']]
        .map(([k, n]) => `<button class="btn sm ${f.type === k ? 'primary' : ''}" data-act="filter" data-arg="type:${k}">${n}${k === 'break' && broken.length ? ` ${broken.length}` : ''}</button>`).join('')}
        </div>
        <div class="row" style="flex-wrap:wrap;margin-top:8px">
          ${[['power', '战力'], ['step', '步数'], ['life', '寿元'], ['demon', '心魔'], ['join', '入门']]
        .map(([k, n]) => `<button class="btn sm ${f.sort === k ? 'ghost' : ''}" data-act="filter" data-arg="sort:${k}">${n}</button>`).join('')}
        </div>
      </div>
      ${body}
    </div>`;
  },

  discCard(d) {
    const g = this.game;
    const r = g.realmInfo(d);
    const root = g.rootOf(d);
    const need = g.need(d);
    const pct = Math.min(100, (d.prog / need) * 100);
    const lifeLeft = Math.max(0, d.life - d.age);
    const typePill = d.type === 'servant' ? '<span class="pill mute">杂役</span>'
      : d.type === 'staff' ? '<span class="pill gold">已转职</span>'
        : `<span class="pill jade">第${d.step}步</span>`;
    return `
    <div class="card disc-card">
      <div class="disc-top">
        <span class="n">${esc(d.name)}</span>
        ${d.named ? `<span class="pill gold">${esc(d.bgName)}</span>` : ''}
        ${typePill}
        <span class="sp">${STATE_NAME[d.state] || ''}</span>
      </div>
      <div class="kv">
        <span>${g.stepTitle(d)}</span><span>${r.name}</span><span>${root.name}</span><span>${g.physOf(d).name}</span>
      </div>
      <div>
        <div class="spread" style="font-size:11px;color:var(--ink-3)"><span>修为 ${fmt(d.prog)} / ${fmt(need)}</span><span>战力 ${fmt(g.power(d))}</span></div>
        <div class="bar" style="margin-top:4px"><i style="width:${pct}%"></i></div>
      </div>
      <div class="kv">
        <span>心魔 <b style="color:${d.demon > 60 ? 'var(--seal)' : 'inherit'}">${Math.round(d.demon)}</b></span>
        <span>忠诚 <b>${Math.round(d.loyalty)}</b></span>
        <span>寿元 <b style="color:${lifeLeft < 8 ? 'var(--seal)' : 'inherit'}">${Math.floor(d.age)}/${Math.floor(d.life)}</b></span>
        <span>贡献 <b>${Math.round(d.gongxian)}</b></span>
      </div>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn sm" data-act="disc:detail" data-arg="${d.id}">详情</button>
        ${d.type === 'formal' && d.state === 'bottleneck' && d.step < 9 && d.step !== 3 ? `<button class="btn sm primary" data-act="disc:break" data-arg="${d.id}">突破</button>` : ''}
        ${d.type === 'formal' && d.step >= 4 ? `<button class="btn sm ghost" data-act="disc:convert" data-arg="${d.id}">转职</button>` : ''}
        ${d.type === 'staff' ? `<button class="btn sm ghost" data-act="disc:back" data-arg="${d.id}">复归弟子</button>` : ''}
        ${d.type === 'formal' && d.step === 8 ? `<button class="btn sm gold" data-act="disc:heir" data-arg="${d.id}">指定亲传</button>` : ''}
      </div>
    </div>`;
  },

  /* ---------- 机构 ---------- */
  pOrg() {
    const g = this.game; const s = g.save;
    const blocks = INSTITUTIONS.map((inst) => {
      const seats = s.posts[inst.key];
      return `
      <div class="card">
        <div class="card-head"><div class="t"><h3>${inst.name}</h3><small>${inst.key === 'dizige' ? '亲传保留弟子身份' : '任职即脱离弟子身份'}</small></div></div>
        <div class="seat-grid">
          ${seats.map((id, i) => {
        const d = id ? g.byId(id) : null;
        return `<div class="seat ${d ? '' : 'vacant'}">
              <div class="sl">${inst.seats[i]}</div>
              <div class="sn">${d ? esc(d.name) : '空缺'}</div>
              ${d ? `<div class="sub">第${d.type === 'staff' ? d.prevStep : d.step}步 · 战力 ${fmt(g.power(d))}</div>
              <button class="btn sm ghost" style="margin-top:6px" data-act="seat:vacate" data-arg="${inst.key}:${i}">卸任</button>`
            : `<button class="btn sm" data-act="seat:elect" data-arg="${inst.key}:${i}">竞选</button>
              <button class="btn sm ghost" style="margin-top:4px" data-act="seat:assign" data-arg="${inst.key}:${i}">手动提名</button>`}
            </div>`;
      }).join('')}
        </div>
      </div>`;
    }).join('');

    return `<div class="stack">
      <div class="card tight"><p class="hint">第${g.maxStep() || 0}步为当前最高。护法堂与长老会席位需已转职的第六步以上者；弟子阁席位需亲传弟子。空缺由破天阁按策略自行补选，也可在此亲择。</p></div>
      ${blocks}
      <div class="card">
        <div class="card-head"><div class="t"><h3>可转职人员</h3><small>第四步以上正式弟子</small></div></div>
        <div class="list">
          ${g.formal().filter((d) => d.step >= 4).slice(0, 12).map((d) => `
            <div class="item"><div class="main"><div class="name">${esc(d.name)}</div>
            <div class="meta"><span>第${d.step}步 ${g.stepInfo(d.step).title}</span><span>战力 ${fmt(g.power(d))}</span><span>贡献 ${Math.round(d.gongxian)}</span></div></div>
            <div class="act"><button class="btn sm ghost" data-act="disc:convert" data-arg="${d.id}">转职</button></div></div>`).join('')
        || '<div class="empty">暂无满足条件的弟子</div>'}
        </div>
      </div>
    </div>`;
  },

  /* ---------- 资源与工坊 ---------- */
  pWorkshop() {
    const g = this.game; const s = g.save;
    const sv = g.servants().length;
    const sm = g.stanceMul();
    const gong = 1 + (s.fac.gongfang || 0) * 0.3;
    const tian = 1 + (s.fac.lingtian || 0) * 0.28;
    const prodMul = sm.prod * (g.law('curfew') ? 0.97 : 1) * (g.law('bounty') ? 0.98 : 1);
    const rates = [
      ['灵植', sv * 0.6 * tian], ['粮食', sv * 0.5 * tian], ['灵药', sv * 0.2 * tian],
      ['丹药', sv * 0.11 * gong], ['灵石', sv * 0.34 * gong], ['炼器材料', sv * 0.07 * gong],
    ];
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>库房</h3><small>${sm.name}之政 · 产出 ×${prodMul.toFixed(2)}</small></div></div>
        <div class="res-grid">
          ${RESOURCES.map((r) => `<div class="res"><div class="k">${r.name}</div><div class="v">${fmt(s.res[r.key] || 0)}</div><div class="d">${r.desc}</div></div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>工坊产线</h3><small>每日产出</small></div></div>
        <div class="list">
          ${rates.map(([k, v]) => `<div class="spread" style="padding:6px 0;border-bottom:1px dashed var(--line)"><span class="sub">${k}</span><b>+${fmt(v * prodMul)} / 日</b></div>`).join('')}
        </div>
        <p class="hint" style="margin-top:10px">在岗杂役 ${sv} 人；灵田 ${s.fac.lingtian || 0} 级，工坊 ${s.fac.gongfang || 0} 级。正式弟子不事生产。</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>营建</h3><small>消耗资源提升基建</small></div></div>
        <div class="list">
          ${FACILITIES.map((f) => {
      const lv = s.fac[f.key] || 0;
      const cost = g.buildCost(f.key);
      const can = lv < f.maxLv && Object.entries(cost).every(([k, v]) => (s.res[k] || 0) >= v);
      return `<div class="item">
              <div class="main"><div class="name">${f.name} <span class="pill mute">Lv.${lv}/${f.maxLv}</span></div>
              <div class="meta">${f.desc}</div>
              <div class="meta">${Object.entries(cost).map(([k, v]) => `${RES_BY_KEY[k].name} ${v}`).join(' · ')}</div></div>
              <div class="act"><button class="btn sm ${can ? 'primary' : ''}" data-act="build" data-arg="${f.key}" ${lv >= f.maxLv ? 'disabled' : ''}>${lv >= f.maxLv ? '已满' : '营建'}</button></div>
            </div>`;
    }).join('')}
        </div>
      </div>
    </div>`;
  },

  /* ---------- 任务与派遣 ---------- */
  pTasks() {
    const g = this.game; const s = g.save;
    const avail = g.missionsAvailable();
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>进行中</h3></div></div>
        <div class="list">
          ${s.missions.map((m) => {
      const t = MISSION_TEMPLATES.find((x) => x.key === m.tpl);
      const ds = m.dIds.map((i) => g.byId(i)).filter(Boolean).map((d) => d.name).join('、');
      return `<div class="item"><div class="main"><div class="name">${t.name}</div><div class="meta"><span>${ds}</span><span>剩余 ${Math.max(0, m.endDay - s.day)} 日</span></div></div></div>`;
    }).join('')}
          ${s.expeditions.map((x) => {
      const r = REGIONS.find((y) => y.key === x.region);
      const ds = x.dIds.map((i) => g.byId(i)).filter(Boolean).map((d) => d.name).join('、');
      return `<div class="item"><div class="main"><div class="name">派遣 · ${r.name}</div><div class="meta"><span>${ds}</span><span>剩余 ${Math.max(0, x.endDay - s.day)} 日</span></div></div></div>`;
    }).join('')}
          ${!s.missions.length && !s.expeditions.length ? '<div class="empty">没有进行中的任务。</div>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>任务大厅</h3><small>山门所接</small></div>
          <button class="btn sm ghost" data-act="recruit" data-arg="servant">招收杂役</button></div>
        <div class="list">
          ${avail.map((m) => `
            <div class="item"><div class="main"><div class="name">${m.name} <span class="pill mute">${m.lv} 级</span></div>
            <div class="meta"><span>${m.desc}</span><span>耗时 ${m.days} 日</span><span>要求第 ${m.need} 步</span></div></div>
            <div class="act"><button class="btn sm primary" data-act="mission:start" data-arg="${m.key}">领取</button></div></div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>大世界派遣</h3><small>带回资源，也可能带回伤者</small></div></div>
        <div class="list">
          ${REGIONS.map((r) => `<div class="item"><div class="main"><div class="name">${r.name} <span class="pill ${r.risk > 0.2 ? '' : 'jade'}">风险 ${Math.round(r.risk * 100)}%</span></div>
            <div class="meta"><span>${r.desc}</span><span>耗时 ${r.days} 日</span><span>要求第 ${r.need} 步</span></div></div>
            <div class="act"><button class="btn sm" data-act="exp:start" data-arg="${r.key}">派遣</button></div></div>`).join('')}
        </div>
      </div>
    </div>`;
  },

  /* ---------- 大世界 ---------- */
  pWorld() {
    const g = this.game; const s = g.save;
    const facs = [['tianshu', '天枢剑宗', '规矩、敬语，暗含倨傲'], ['xuanyin', '玄阴教', '绵软、爱用反问'], ['shangmeng', '万宝商盟', '开口先谈价钱']];
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>小世界分层</h3><small>已启 ${s.layers} / 10 层</small></div>
          <button class="btn sm primary" data-act="layer:open">开辟第 ${Math.min(10, s.layers + 1)} 层</button></div>
        <p class="hint" style="margin-bottom:8px">开辟下一层需 ${Object.entries(g.nextLayerCost()).map(([k, v]) => `${RES_BY_KEY[k].name} ${v}`).join(' · ')}。</p>
        <div class="list">
          ${LAYERS.map((l) => {
      const on = l.lv <= s.layers;
      return `<div class="item" style="${on ? '' : 'opacity:.45'}"><div class="main"><div class="name">${l.name} ${on ? '<span class="pill jade">已启</span>' : '<span class="pill mute">混沌</span>'}</div>
            <div class="meta">${l.desc}</div></div></div>`;
    }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>三方势力</h3><small>敌对 / 冷淡 / 中立 / 友善 / 结盟</small></div></div>
        <div class="list">
          ${facs.map(([k, n, tone]) => {
      const v = s.relations[k] || 0;
      const idx = Math.max(0, Math.min(5, v + 2));
      const cd = g.dipCooldown(k);
      return `<div class="item"><div class="main"><div class="name">${n} <span class="pill ${v >= 3 ? 'jade' : v <= -1 ? '' : 'mute'}">${REL_NAME[idx]}</span></div>
            <div class="meta"><span>${tone}</span><span>${cd > 0 ? `使节往返中（${cd} 日）` : '可遣使'}</span></div></div>
            <div class="act">
              <button class="btn sm" data-act="dip:gift" data-arg="${k}" ${cd > 0 ? 'disabled' : ''}>送礼交好</button>
              <button class="btn sm ghost" data-act="dip:press" data-arg="${k}" ${cd > 0 ? 'disabled' : ''}>公开表态</button>
            </div></div>`;
    }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>道印</h3></div><button class="btn sm ghost" data-act="open:temple-seal">祖师殿</button></div>
        <div class="kv" style="font-size:12px">
          <span>已回收碎片 <b>${s.flags.shard || 0} / 3</b></span>
          <span>气运 <b>${s.sect.fortune >= 0 ? '+' : ''}${Math.round(s.sect.fortune)}</b></span>
        </div>
      </div>
    </div>`;
  },

  /* ---------- 对战 ---------- */
  pBattle() {
    const g = this.game; const s = g.save;
    const atk = s.battle.atk; const def = s.battle.def;
    const list = this.helpers.opponents || [];
    const team = (ids, kind) => (ids.length
      ? ids.map((id) => { const d = g.byId(id); return d ? `<div class="item"><div class="main"><div class="name">${esc(d.name)}</div><div class="meta">第${d.step || 0}步 · 战力 ${fmt(g.power(d))}</div></div></div>` : ''; }).join('')
      : `<div class="empty">尚未设置${kind}编队</div>`);
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>进攻编队</h3><small>${atk.length}/5 · 总战力 ${fmt(g.teamPower(atk))}</small></div><button class="btn sm ghost" data-act="team:atk">设置</button></div>
        <div class="list">${team(atk, '进攻')}</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>防守编队</h3><small>${def.length}/5 · 护法堂优先进场</small></div><button class="btn sm ghost" data-act="team:def">设置</button></div>
        <div class="list">${team(def, '防守')}</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>邀约</h3><small>${g.canChallenge() ? '可以发出邀约' : '冷却中'}</small></div></div>
        <div class="list">
          ${list.length ? list.slice(0, 8).map((o) => `
            <div class="item"><div class="main"><div class="name">${esc(o.sect_name)}</div>
            <div class="meta"><span>祖师 ${esc(o.founder_name || '—')}</span><span>声望 ${o.renown}</span><span>最高 ${o.max_step} 步</span><span>弟子 ${o.disciple_count}</span></div></div>
            <div class="act"><button class="btn sm" data-act="battle:go" data-arg="${esc(o.sect_name)}" ${g.canChallenge() ? '' : 'disabled'}>发出邀约</button></div></div>`).join('')
        : `<div class="empty"><strong>暂无对手</strong>榜单尚未同步，先经营一段时间。</div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>战报</h3><small>${s.stats.wins} 胜 ${s.stats.losses} 负</small></div></div>
        <div class="list">
          ${s.battle.reports.length ? s.battle.reports.slice(0, 10).map((r) => `
            <div class="item"><div class="main"><div class="name">${r.win ? '<span style="color:var(--seal)">胜</span>' : '<span style="color:var(--jade)">负</span>'} ${esc(r.opp)}</div>
            <div class="meta"><span>我方 ${r.myPower}</span><span>对方 ${r.oppPower}</span>${r.reward ? `<span>声望 +${r.reward}</span>` : ''}</div></div></div>`).join('')
        : '<div class="empty">尚无战报。</div>'}
        </div>
      </div>
    </div>`;
  },

  /* ---------- 榜单 ---------- */
  pRank() {
    const list = this.helpers.ranking || [];
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>赛季 · 声望排序</h3><small>每小时刷新</small></div><button class="btn sm" data-act="rank:refresh">刷新</button></div>
        ${list.length ? `<div class="list">${list.map((r, i) => `
          <div class="item"><div style="width:24px;font-family:var(--f-head);color:var(--ink-3)">${i + 1}</div>
          <div class="main"><div class="name">${esc(r.sect_name)}</div>
          <div class="meta"><span>${esc(r.founder_name || '—')}</span><span>声望 ${r.renown}</span><span>最高 ${r.max_step} 步</span><span>弟子 ${r.disciple_count}</span></div></div></div>`).join('')}</div>`
        : '<div class="empty"><strong>榜单为空</strong>还没有宗门留下姓名。</div>'}
      </div>
    </div>`;
  },

  /* ---------- 宗门史 ---------- */
  pChronicle() {
    const s = this.game.save;
    const kindName = { auto: '自决', memorial: '批复', story: '剧情', event: '异动' };
    return `<div class="stack">
      ${s.ended ? `<div class="card" style="border-color:var(--seal)"><div class="card-head"><div class="t"><h3>终局 · ${ENDINGS[s.ended].name}</h3></div></div><p>${ENDINGS[s.ended].text}</p></div>` : ''}
      <div class="card">
        <div class="card-head"><div class="t"><h3>留痕</h3><small>自决与批复皆在此</small></div><span class="pill mute">${s.story.log.length}</span></div>
        <div class="list">
          ${s.story.log.length ? s.story.log.slice(0, 60).map((l) => `
            <div class="item"><div class="main">
              <div class="name" style="font-size:13px">${esc(l.title)} <span class="pill ${l.kind === 'auto' ? 'mute' : 'gold'}">${kindName[l.kind] || '史'}</span>
                <span class="pill mute">${esc(l.label || '')}</span></div>
              <div class="meta">${esc(l.result || '')}</div>
              <div class="meta">开宗 ${Math.floor(l.day / 360) + 1} 年 · 第 ${l.day % 360} 日 · ${l.by === '破天阁' ? '破天阁自决' : '祖师批复'}</div>
            </div></div>`).join('')
        : '<div class="empty"><strong>史书尚白</strong>随着宗门发展，决断会一条条写进来。</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>未至之章</h3><small>按幕序</small></div></div>
        <div class="list">
          ${STORY_NODES.map((n) => {
      const done = s.story.done.includes(n.id);
      return `<div class="item" style="${done ? 'opacity:.5' : ''}"><div class="main"><div class="name">第${n.act}幕 · ${n.title}</div>
            <div class="meta">${done ? '已定' : '未触发'}</div></div></div>`;
    }).join('')}
        </div>
      </div>
    </div>`;
  },

  /* ---------- 设置 ---------- */
  pSettings() {
    const g = this.game; const s = g.save;
    const qNames = ['极简', '流畅', '标准', '精细'];
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>画质</h3><small>按设备能力选择</small></div></div>
        <div class="q-grid">
          ${qNames.map((n, i) => `<button class="q-btn ${this.gfx.q === i ? 'is-on' : ''}" data-act="gfx:q" data-arg="${i}">${n}<small>${['最省电', '流畅', '默认', '最细'][i]}</small></button>`).join('')}
        </div>
        <div class="toggle-row" style="margin-top:8px">
          <div><div class="l-name">减少动态效果</div><div class="l-desc">停止循环动画，保留静态明暗与状态提示</div></div>
          <button class="switch ${this.gfx.motion ? '' : 'on'}" data-act="gfx:motion"></button>
        </div>
        <p class="hint" style="margin-top:6px">帧率连续偏低时会自动降一档，功能不受影响。</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>自动化</h3><small>更细的自决范围在破天阁</small></div>
          <button class="btn sm ghost" data-act="panel" data-arg="autonomy">破天阁</button></div>
        <div class="list">
          <div class="toggle-row"><div><div class="l-name">自动突破</div><div class="l-desc">前三步自然晋级，第三步起仍需祖师安排</div></div>
            <button class="switch ${s.settings.autoBreak ? 'on' : ''}" data-act="toggle" data-arg="autoBreak"></button></div>
          <div class="toggle-row"><div><div class="l-name">自动招收</div><div class="l-desc">阁中按策略自行招收杂役</div></div>
            <button class="switch ${s.settings.autoRecruit ? 'on' : ''}" data-act="toggle" data-arg="autoRecruit"></button></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>存档</h3></div></div>
        <div class="kv" style="font-size:12px">
          <span>槽位 <b>${s.slot + 1}</b></span><span>修订号 <b>${s.revision}</b></span>
          <span>开宗 <b>${Math.floor(s.day / 360) + 1} 年</b></span>
        </div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap">
          <button class="btn primary" data-act="save:now">立即保存</button>
          <button class="btn ghost" data-act="signout">退出登录</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>账号</h3></div></div>
        ${(() => {
          const a = (this.helpers && this.helpers.account) || {};
          return `<div class="kv" style="font-size:12px">
            <span>账号 <b>${esc(a.username || '—')}</b></span><span>称呼 <b>${esc(a.nick || '—')}</b></span>
            <span>角色 <b>${a.role === 'admin' ? '管理员' : '玩家'}</b></span>
          </div>
          <div class="row" style="margin-top:12px;flex-wrap:wrap">
            <button class="btn ghost" data-act="passwd">修改口令</button>
            <button class="btn ghost" data-act="sessions">登录设备</button>
            ${a.role === 'admin' ? '<button class="btn gold" data-act="admin">管理台</button>' : ''}
          </div>
          <p class="hint">账号由宗门管理方统一开立，站点不提供手机号、邮箱等自助注册入口。</p>`;
        })()}
      </div>

      ${(() => {
        const a = (this.helpers && this.helpers.account) || {};
        if (a.role !== 'admin' || !this.helpers.setFlag) return '';
        const on = (k) => (this.flags[k] ? 'on' : '');
        return `<div class="card">
          <div class="card-head"><div class="t"><h3>灰度与回退</h3><small>模块级，仅本机生效</small></div></div>
          <div class="list">
            <div class="toggle-row"><div><div class="l-name">宗门场景主页</div>
              <div class="l-desc">关闭后回退到旧的卡片看板</div></div>
              <button class="switch ${on('sceneHome')}" data-act="flag:sceneHome"></button></div>
            <div class="toggle-row"><div><div class="l-name">待处理提示模式</div>
              <div class="l-desc">关闭后事件回到旧的阻断弹窗</div></div>
              <button class="switch ${on('pendingMode')}" data-act="flag:pendingMode"></button></div>
          </div>
          <p class="hint">两个开关都保留旧路径，出问题可立即回滚；正式灰度按账号白名单与比例下发。</p>
        </div>`;
      })()}

      <div class="card">
        <div class="card-head"><div class="t"><h3>关于</h3></div></div>
        <p class="hint">《破天宗》网页版 · 依据设计文档 V1.4 第 28 章改造：主页为宗门场景，事件不夺焦点，
          日常由破天阁自治，重大事项进祖师殿。<br>
          掌柜的话：这里没有自由交易市场，也没有资源换成现实价值的通道；后台不改数值，只发兑换码。</p>
      </div>
    </div>`;
  },

  /* ---------- 点击分发 ---------- */
  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act; const arg = t.dataset.arg || '';
    const g = this.game;
    const done = (rendered) => { if (rendered !== true) this.render(); this.helpers.autoSave && this.helpers.autoSave(); };

    switch (act) {
      case 'panel': this.setPanel(arg); break;
      case 'board:open': {
        const b = BUILDINGS.find((x) => x.key === arg);
        if (b) this.setPanel(b.panel === 'temple' ? 'temple' : b.panel);
        break;
      }
      case 'flag:sceneHome':
      case 'flag:pendingMode': {
        const k = act.slice(5);
        const next = !this.flags[k];
        this.flags[k] = next;
        this.helpers.setFlag(k, next);
        this.toast(next ? '已切到新版' : '已回退旧版，刷新后仍生效');
        break;
      }
      case 'filter': { const [k, v] = arg.split(':'); this.discFilter[k] = v; this.renderPanel(); break; }
      case 'pending:read': {
        markSeen(g, (this._matters || []).map((m) => m.ref));
        this.syncBadges(this._matters || []);
        this.renderPanel(); this.helpers.autoSave && this.helpers.autoSave();
        this.toast('已全部标记为已读');
        break;
      }
      case 'msg:filter': this.msgFilter = arg; this.renderPanel(); break;
      case 'msg:read': this.markNewsSeen(); this.syncBadges(this._matters || []); this.renderPanel(); this.toast('消息已全部已读'); break;
      case 'matter:go': {
        const m = (this._matters || []).find((x) => x.ref === arg);
        if (!m) break;
        if (m.level === 3) { this.openTemple(); break; }
        this.setPanel(m.act && m.act.arg === 'temple' ? 'pending' : (m.act ? m.act.arg : 'pending'));
        break;
      }
      case 'matter:snooze': {
        snooze(g, arg);
        this.toast('已暂缓四十五日');
        this.syncScene(); this.renderPanel();
        this.helpers.autoSave && this.helpers.autoSave();
        break;
      }
      case 'memo:pick': {
        const [ref, idx] = arg.split('|');
        this.applyMemorial(ref, Number(idx));
        break;
      }
      case 'pol:stance': {
        g.setPolicy({ stance: arg });
        this.syncScene(); this.renderPanel(); this.helpers.autoSave && this.helpers.autoSave();
        if (this.helpers.syncPolicy) this.helpers.syncPolicy(g.save.policy);
        this.toast('已改为' + (STANCES.find((s) => s.key === arg) || {}).name);
        break;
      }
      case 'pol:area': {
        const p = g.policy();
        g.setPolicy({ areas: { [arg]: p.areas[arg] === false } });
        this.renderPanel(); this.helpers.autoSave && this.helpers.autoSave();
        if (this.helpers.syncPolicy) this.helpers.syncPolicy(g.save.policy);
        break;
      }
      case 'pol:law': {
        const p = g.policy();
        g.setPolicy({ laws: { [arg]: !p.laws[arg] } });
        this.renderPanel();
        if (document.getElementById('view-temple').classList.contains('is-active')) this.renderTemple();
        this.helpers.autoSave && this.helpers.autoSave();
        if (this.helpers.syncPolicy) this.helpers.syncPolicy(g.save.policy);
        break;
      }
      case 'open:temple-law': this.templeTab = 'law'; this.openTemple(); break;
      case 'open:temple-seal': this.templeTab = 'seal'; this.openTemple(); break;
      case 'gfx:q': this.gfx.q = Number(arg); this.saveGfx(); this.applyGfx(); this.renderPanel(); break;
      case 'gfx:motion': this.gfx.motion = !this.gfx.motion; this.saveGfx(); this.applyGfx(); this.renderPanel(); break;
      case 'story:open': this.openStory(arg); break;
      case 'evt:open': this.openEvent(); break;
      case 'recruit': this.helpers.recruit(arg); break;
      case 'exam': { const r = g.batchExam(); this.toast(r.msg); done(); break; }
      case 'disc:detail': this.openDisciple(Number(arg)); break;
      case 'disc:break': { const r = g.tryBreak(Number(arg)); this.toast(r.msg); done(); break; }
      case 'disc:convert': this.openConvert(Number(arg)); break;
      case 'disc:back': {
        const d = g.byId(Number(arg));
        if (d) { d.type = 'formal'; d.step = d.prevStep || 4; d.state = 'cultivate'; d.staffInst = null; }
        done(); break;
      }
      case 'build': { const r = g.build(arg); this.toast(r.msg); done(); break; }
      case 'seat:elect': {
        const [inst, i] = arg.split(':');
        const r = g.autoElect(inst, i);
        this.toast(r.msg);
        if (r.ranking) this.openElectResult(inst, r.ranking);
        done(); break;
      }
      case 'seat:assign': { const [inst, i] = arg.split(':'); this.openAssign(inst, Number(i)); break; }
      case 'seat:vacate': {
        const [inst, i] = arg.split(':');
        const id = g.save.posts[inst][Number(i)];
        g.vacate(inst, Number(i));
        const d = g.byId(id);
        if (d && d.type === 'staff') d.state = 'idle';
        this.toast('已卸任'); done(); break;
      }
      case 'mission:start': this.openMission(arg); break;
      case 'exp:start': this.openExpedition(arg); break;
      case 'team:atk': this.openTeam('atk'); break;
      case 'team:def': this.openTeam('def'); break;
      case 'battle:go': this.helpers.battle(arg); break;
      case 'rank:refresh': this.helpers.refreshRank(); break;
      case 'toggle': {
        g.save.settings[arg] = !g.save.settings[arg];
        this.renderPanel(); this.helpers.autoSave && this.helpers.autoSave(); break;
      }
      case 'save:now': this.helpers.forceSave(); break;
      case 'signout': this.helpers.signOut(); break;
      case 'passwd': this.helpers.changePass && this.helpers.changePass(); break;
      case 'sessions': this.helpers.sessions && this.helpers.sessions(); break;
      case 'admin': this.helpers.openAdmin && this.helpers.openAdmin(); break;
      case 'dip:gift': { const r = g.diplomacy(arg, 'gift'); this.toast(r.msg); done(); break; }
      case 'dip:press': { const r = g.diplomacy(arg, 'press'); this.toast(r.msg); done(); break; }
      case 'layer:open': { const r = g.openNextLayer(); this.toast(r.msg); done(); break; }
      case 'disc:heir': { const r = g.designateHeir(Number(arg)); this.toast(r.msg); done(); break; }
      default: break;
    }
  },

  applyMemorial(ref, idx) {
    const list = memorials(this.game);
    const m = list.find((x) => x.ref === ref);
    if (!m) return;
    const opt = m.options[idx];
    if (!opt) return;
    if (opt.disabled) { this.toast('此策存量不足，换一条'); return; }
    let res = {};
    try {
      res = opt.run() || {};
    } catch (err) {
      this.toast('批复未能施行：' + (err && err.message ? err.message : '未知错误'));
      return;
    }
    if (res.ok === false) { this.toast(res.msg || '未能施行'); return; }
    this.game.chronicle('memorial', m.title, opt.label, res.msg || opt.detail || '');
    this.game.msg(`批复：${m.title} · ${opt.label}`, 'story');
    const ms = this.game.save.matterState;
    if (ms) ms.seen[ref] = this.game.save.day;
    if (this.helpers.matterAct) this.helpers.matterAct(ref, 'approve', opt.label);
    const left = memorials(this.game).length;
    this.toast(`${res.msg || '已批复'}${left ? ` · 案上还有 ${left} 件` : ' · 案上已空'}`);
    this.helpers.autoSave && this.helpers.autoSave();
    this.syncScene();
    this.syncBadges(this._matters || []);
    if (res.nav) { this.backToScene(); this.setPanel(res.nav); return; }
    this.renderTemple();
  },

  saveGfx() {
    try { localStorage.setItem(GFX_KEY, JSON.stringify(this.gfx)); } catch (e) { /* ignore */ }
  },
  applyGfx() {
    if (this.scene) this.scene.setQuality(this.gfx.q, this.gfx.motion);
  },

  /* ---------- 弹窗基础（只用于不可逆确认、冲突、会话异常） ---------- */
  modal({ title, sub, body, actions = [], onMount }) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `<div class="modal-mask"><div class="modal">
      <div class="modal-head"><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-mi="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div></div>`;
    const mask = root.querySelector('.modal-mask');
    const close = () => { root.innerHTML = ''; };
    root.querySelectorAll('[data-mi]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = actions[Number(b.dataset.mi)];
        if (a.keepOpen === false) close();
        a.onClick && a.onClick(close);
      });
    });
    mask.addEventListener('click', (ev) => { if (ev.target === mask) close(); });
    onMount && onMount(root, close);
    return close;
  },

  /* ---------- 剧情与异动（不再自动弹出，只从待处理/祖师殿进入） ---------- */
  openStory(nodeId) {
    const node = STORY_BY_ID[nodeId];
    if (!node) return;
    const g = this.game;
    this.modal({
      title: node.title,
      sub: `第${node.act}幕 · 开宗 ${Math.floor(g.save.day / 360) + 1} 年`,
      body: `<div class="story-text">${esc(node.text)}</div>
        ${node.options.map((o, i) => `<button class="opt" data-oi="${i}">${esc(o.label)}<span class="r">${esc(o.result)}</span></button>`).join('')}`,
      actions: [{ label: '搁置', cls: 'ghost', onClick: (close) => close() }],
      onMount: (root, close) => {
        root.querySelectorAll('[data-oi]').forEach((b) => b.addEventListener('click', () => {
          const idx = Number(b.dataset.oi);
          g.resolveStory(nodeId, idx);
          if (this.helpers.matterAct) this.helpers.matterAct(`story:${nodeId}`, 'approve', node.options[idx].label);
          close();
          this.toast('已批，结果写入宗门史');
          this.render();
          this.helpers.autoSave && this.helpers.autoSave();
        }));
      },
    });
  },

  openEvent() {
    const ev = this.game.pendingEvent;
    if (!ev) return;
    const g = this.game;
    this.modal({
      title: ev.name,
      sub: '大世界异动',
      body: `<div class="story-text">${esc(ev.text)}</div>
        ${ev.options.map((o, i) => `<button class="opt" data-oi="${i}">${esc(o.label)}<span class="r">${esc(o.result)}</span></button>`).join('')}`,
      actions: [{ label: '稍后处置', cls: 'ghost', onClick: (c) => c() }],
      onMount: (root, close) => {
        root.querySelectorAll('[data-oi]').forEach((b) => b.addEventListener('click', () => {
          const idx = Number(b.dataset.oi);
          g.resolveEvent(idx);
          if (this.helpers.matterAct) this.helpers.matterAct(`evt:${ev.key}`, 'approve', ev.options[idx].label);
          close();
          this.toast('已处置，结果写入宗门史');
          this.render();
          this.helpers.autoSave && this.helpers.autoSave();
        }));
      },
    });
  },

  /* ---------- 弟子详情 ---------- */
  openDisciple(id) {
    const g = this.game; const d = g.byId(id);
    if (!d) return;
    const r = g.realmInfo(d);
    const need = g.need(d);
    const lifeLeft = Math.max(0, d.life - d.age);
    const techList = TECHNIQUES.filter((t) => t.door <= d.realm);
    const body = `
      <div class="detail-grid">
        <div class="fieldset"><h4>基本信息</h4>
          <div class="kv" style="flex-direction:column;gap:4px">
            <span>姓名 <b>${esc(d.name)}</b></span><span>编号 <b>#${d.id}</b></span>
            <span>身份 <b>${g.stepTitle(d)}</b></span><span>境界 <b>${r.name}</b></span>
            <span>寿元 <b>${Math.floor(d.age)} / ${Math.floor(d.life)}</b></span>
          </div>
        </div>
        <div class="fieldset"><h4>天赋</h4>
          <div class="kv" style="flex-direction:column;gap:4px">
            <span>灵根 <b>${g.rootOf(d).name} ×${g.rootOf(d).mul}</b></span>
            <span>体质 <b>${g.physOf(d).name} ×${g.physOf(d).mul}</b></span>
            <span>心魔增速 <b>×${g.physOf(d).demon}</b></span>
            ${d.bgName ? `<span>背景 <b>${esc(d.bgName)}</b></span>` : ''}
          </div>
        </div>
        <div class="fieldset"><h4>修炼</h4>
          <div class="kv" style="flex-direction:column;gap:4px">
            <span>修为 <b>${fmt(d.prog)} / ${fmt(need)}</b></span>
            <span>日增 <b>${fmt(g.gainPerDay(d))}</b></span>
            <span>突破成功率 <b>${Math.round(g.breakChance(d) * 100)}%</b></span>
            <span>主修功法 <b>${d.tech ? g.techOf(d).name : '无'}</b></span>
          </div>
        </div>
        <div class="fieldset"><h4>状态</h4>
          <div class="kv" style="flex-direction:column;gap:4px">
            <span>当前 <b>${STATE_NAME[d.state]}</b></span>
            <span>心魔 <b>${Math.round(d.demon)}</b></span>
            <span>忠诚 <b>${Math.round(d.loyalty)}</b></span>
            <span>宗门贡献 <b>${Math.round(d.gongxian)}</b></span>
            <span>战力 <b>${fmt(g.power(d))}</b></span>
          </div>
        </div>
      </div>

      <div class="fieldset" style="margin-top:12px"><h4>装配功法</h4>
        <div class="row" style="flex-wrap:wrap">
          ${techList.map((t) => `<button class="btn sm ${d.tech === t.key ? 'primary' : ''}" data-tech="${t.key}">${t.name}（${t.grade}品）</button>`).join('')}
        </div>
        <p class="hint" style="margin-top:8px">更换功法完全保留修为进度，只改变效率、心魔抗性、突破率与战力。</p>
      </div>

      <div class="fieldset" style="margin-top:12px"><h4>履历</h4>
        <p class="hint">入门于开宗第 ${Math.floor(d.joinedDay / 360) + 1} 年；晋升 ${d.step || 0} 步；三晋四已考 ${d.tries3} 次${d.passed4 ? '（已通过）' : ''}；余寿 ${lifeLeft.toFixed(1)} 年。</p>
      </div>`;

    this.modal({
      title: d.name,
      sub: `${g.stepTitle(d)} · ${r.name}`,
      body,
      actions: [
        { label: '遣散', cls: 'danger', onClick: (close) => { g.dismiss(id); close(); this.render(); this.helpers.autoSave && this.helpers.autoSave(); } },
        { label: '关闭', cls: 'ghost', onClick: (c) => c() },
      ],
      onMount: (root, close) => {
        root.querySelectorAll('[data-tech]').forEach((b) => b.addEventListener('click', () => {
          const r2 = g.setTech(id, b.dataset.tech);
          this.toast(r2.msg);
          close(); this.openDisciple(id); this.render();
          this.helpers.autoSave && this.helpers.autoSave();
        }));
      },
    });
  },

  openConvert(id) {
    const g = this.game; const d = g.byId(id);
    if (!d) return;
    this.modal({
      title: '转职',
      sub: '转入护法堂或长老会将脱离弟子身份；两个机构只能择一。',
      body: '<p class="hint">该弟子将不再参加晋升考核，不计入弟子人数统计；修为可继续增长。</p>',
      actions: [
        { label: '转入护法堂', cls: 'primary', onClick: (c) => { const r = g.convert(id, 'hufatang'); this.toast(r.msg); c(); this.render(); this.helpers.autoSave && this.helpers.autoSave(); } },
        { label: '转入长老会', cls: 'primary', onClick: (c) => { const r = g.convert(id, 'zhanglaohui'); this.toast(r.msg); c(); this.render(); this.helpers.autoSave && this.helpers.autoSave(); } },
        { label: '取消', cls: 'ghost', onClick: (c) => c() },
      ],
    });
  },

  openAssign(inst, idx) {
    const g = this.game;
    const cands = g.save.disciples
      .filter((d) => g.eligible(inst, d))
      .filter((d) => !Object.values(g.save.posts).some((arr) => arr.includes(d.id)));
    this.modal({
      title: '手动提名',
      sub: `${INSTITUTIONS.find((i) => i.key === inst).name} · ${INSTITUTIONS.find((i) => i.key === inst).seats[idx]}`,
      body: cands.length ? `<div class="list">${cands.map((d) => `
        <div class="item"><div class="main"><div class="name">${esc(d.name)}</div>
        <div class="meta"><span>第${d.type === 'staff' ? d.prevStep : d.step}步</span><span>战力 ${fmt(g.power(d))}</span><span>贡献 ${Math.round(d.gongxian)}</span><span>心魔 ${Math.round(d.demon)}</span></div></div>
        <div class="act"><button class="btn sm primary" data-pick="${d.id}">任命</button></div></div>`).join('')}</div>`
        : '<div class="empty">暂无满足条件的弟子</div>',
      actions: [{ label: '取消', cls: 'ghost', onClick: (c) => c() }],
      onMount: (root, close) => {
        root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
          const r = g.assignSeat(inst, idx, Number(b.dataset.pick));
          this.toast(r.msg); close(); this.render(); this.helpers.autoSave && this.helpers.autoSave();
        }));
      },
    });
  },

  openElectResult(inst, ranking) {
    this.modal({
      title: '竞选结果',
      sub: '按八维加权排序，不是单纯比拼战力',
      body: `<div class="list">${ranking.map((c, i) => `
        <div class="item"><div style="width:22px;font-family:var(--f-head);color:var(--ink-3)">${i + 1}</div>
        <div class="main"><div class="name">${esc(c.name)}</div>
        <div class="meta"><span>总评 ${c.total}</span><span>战力 ${c.detail.power}</span><span>贡献 ${c.detail.contribution}</span>
        <span>心性 ${Math.round(c.detail.mind)}</span><span>忠诚 ${Math.round(c.detail.loyalty)}</span><span>阅历 ${Math.round(c.detail.exp)}</span><span>人际 ${Math.round(c.detail.social)}</span></div></div></div>`).join('')}</div>`,
      actions: [{ label: '知道了', cls: 'primary', onClick: (c) => c() }],
    });
  },

  openMission(tplKey) {
    const g = this.game;
    const tpl = MISSION_TEMPLATES.find((m) => m.key === tplKey);
    const pool = g.formal().filter((d) => d.state === 'cultivate' && d.step >= tpl.need);
    this.modal({
      title: `领取任务 · ${tpl.name}`,
      sub: `耗时 ${tpl.days} 日，需第 ${tpl.need} 步以上弟子`,
      body: pool.length ? `<div class="list">${pool.map((d) => `
        <div class="item"><div class="main"><div class="name">${esc(d.name)}</div>
        <div class="meta"><span>第${d.step}步</span><span>战力 ${fmt(g.power(d))}</span><span>${STATE_NAME[d.state]}</span></div></div>
        <div class="act"><button class="btn sm primary" data-pick="${d.id}">派他前往</button></div></div>`).join('')}</div>`
        : '<div class="empty">没有空闲且满足步数的弟子</div>',
      actions: [{ label: '取消', cls: 'ghost', onClick: (c) => c() }],
      onMount: (root, close) => {
        root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
          const r = g.startMission(tplKey, [Number(b.dataset.pick)]);
          this.toast(r.msg); close(); this.render(); this.helpers.autoSave && this.helpers.autoSave();
        }));
      },
    });
  },

  openExpedition(regionKey) {
    const g = this.game;
    const reg = REGIONS.find((r) => r.key === regionKey);
    const pool = g.formal().filter((d) => d.state === 'cultivate' && d.step >= reg.need);
    const chosen = new Set();
    this.modal({
      title: `派遣 · ${reg.name}`,
      sub: `耗时 ${reg.days} 日，风险 ${Math.round(reg.risk * 100)}%，需第 ${reg.need} 步以上`,
      body: pool.length ? `<p class="hint" style="margin-bottom:10px">已选 <b id="pickCount">0</b> 人（最多 4 人）</p>
        <div class="list">${pool.map((d) => `
        <div class="item"><div class="main"><div class="name">${esc(d.name)}</div>
        <div class="meta"><span>第${d.step}步</span><span>战力 ${fmt(g.power(d))}</span></div></div>
        <div class="act"><button class="btn sm" data-pick="${d.id}">选中</button></div></div>`).join('')}</div>`
        : '<div class="empty">没有满足步数的空闲弟子</div>',
      actions: [
        { label: '确认派遣', cls: 'primary', onClick: (c) => { const r = g.startExpedition(regionKey, [...chosen]); this.toast(r.msg); if (r.ok) { c(); this.render(); this.helpers.autoSave && this.helpers.autoSave(); } } },
        { label: '取消', cls: 'ghost', onClick: (c) => c() },
      ],
      onMount: (root) => {
        root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
          const id = Number(b.dataset.pick);
          if (chosen.has(id)) { chosen.delete(id); b.classList.remove('primary'); b.textContent = '选中'; }
          else if (chosen.size < 4) { chosen.add(id); b.classList.add('primary'); b.textContent = '已选'; }
          const el = root.querySelector('#pickCount'); if (el) el.textContent = chosen.size;
        }));
      },
    });
  },

  openTeam(kind) {
    const g = this.game;
    const pool = g.save.disciples.filter((d) => d.type !== 'servant');
    const chosen = new Set(g.save.battle[kind]);
    this.modal({
      title: kind === 'atk' ? '设置进攻编队' : '设置防守编队',
      sub: '杂役不具备参战资格；最多五人',
      body: pool.length ? `<div class="list">${pool.map((d) => `
        <div class="item"><div class="main"><div class="name">${esc(d.name)}</div>
        <div class="meta"><span>第${d.type === 'staff' ? d.prevStep : d.step}步</span><span>战力 ${fmt(g.power(d))}</span>${d.type === 'staff' ? '<span class="pill gold">在任</span>' : ''}</div></div>
        <div class="act"><button class="btn sm ${chosen.has(d.id) ? 'primary' : ''}" data-pick="${d.id}">${chosen.has(d.id) ? '已选' : '入选'}</button></div></div>`).join('')}</div>`
        : '<div class="empty">没有可参战的弟子</div>',
      actions: [
        { label: '保存编队', cls: 'primary', onClick: (c) => { g.setTeam(kind, [...chosen]); this.toast('编队已保存'); c(); this.render(); this.helpers.autoSave && this.helpers.autoSave(); } },
        { label: '取消', cls: 'ghost', onClick: (c) => c() },
      ],
      onMount: (root) => {
        root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
          const id = Number(b.dataset.pick);
          if (chosen.has(id)) { chosen.delete(id); b.classList.remove('primary'); b.textContent = '入选'; }
          else if (chosen.size < 5) { chosen.add(id); b.classList.add('primary'); b.textContent = '已选'; }
        }));
      },
    });
  },
};

export { BUILDING_NAMES };
