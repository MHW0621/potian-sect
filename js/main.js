/* 破天宗 · 启动与编排 */
import { Game, migrate } from './engine.js';
import { UI } from './ui.js';
import { TICK_MS, DAYS_PER_TICK, OFFLINE_CAP_DAYS, RANDOM_EVENTS, FLAGS, resolveFlag, RECRUIT } from './config.js';
import { STORY_BY_ID } from './story.js';
import { deriveMatters } from './matters.js';
import * as cloud from './cloud.js';
import { Admin } from './admin.js';

const DAYS_PER_SEC = DAYS_PER_TICK / (TICK_MS / 1000);
const AUTOSAVE_MS = 8000;

const state = {
  session: null,
  rows: [],
  game: null,
  saveTimer: 0,
  ranking: [],
  opponents: [],
  dirty: false,
  saving: false,
  flags: { announcement: '', modules: {} },
  grayscale: { sceneHome: true, pendingMode: true },
};

/* ---------- 灰度开关：后台默认 + 白名单/比例 + 本地覆盖 ---------- */
const FLAG_OVERRIDE_KEY = 'potian.flags';

export function readFlagOverride() {
  try { return JSON.parse(localStorage.getItem(FLAG_OVERRIDE_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function writeFlagOverride(k, v) {
  const cur = readFlagOverride();
  if (v === null) delete cur[k]; else cur[k] = !!v;
  try { localStorage.setItem(FLAG_OVERRIDE_KEY, JSON.stringify(cur)); } catch (e) { /* ignore */ }
}

function resolveGrayscale() {
  const acc = cloud.currentAccount() || {};
  const ov = readFlagOverride();
  const out = {};
  for (const k of Object.keys(FLAGS)) {
    out[k] = resolveFlag(FLAGS[k], acc);
    if (typeof ov[k] === 'boolean') out[k] = ov[k];
  }
  return out;
}

/* ---------- 视图切换 ---------- */
function show(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === id));
  window.scrollTo(0, 0);
}

/* ---------- 提示 ---------- */
const toast = (m) => UI.toast(m);

/* ---------- 启动 ---------- */
async function boot() {
  bindAuth();
  bindSlotView();
  bindGameChrome();

  bindPassView();

  const acc = await cloud.restore();
  if (acc && acc.mustChange) showPass(acc);
  else if (acc) enterSlots(acc);
  else show('view-auth');

  setInterval(loop, TICK_MS);
  setInterval(() => { if (state.dirty) autoSave(); }, AUTOSAVE_MS);
  setInterval(() => { if (state.session) loadFlags(); }, 60000);
  window.addEventListener('beforeunload', () => { if (state.dirty) { try { flush(false); } catch (e) {} } });
}

/* ---------- 登录（账号由管理台开立，无自助注册） ---------- */
function bindAuth() {
  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = (document.getElementById('authUser').value || '').trim().toLowerCase();
    const pass = document.getElementById('authPass').value || '';
    if (!user) return setHint('请输入账号', true);
    if (!pass) return setHint('请输入口令', true);
    const btn = document.getElementById('btnLogin');
    btn.disabled = true; btn.textContent = '验证中';
    const r = await cloud.login(user, pass);
    btn.disabled = false; btn.textContent = '入 宗';
    if (!r.ok) return setHint(r.msg, true);
    document.getElementById('authPass').value = '';
    setHint('账号由宗门管理方统一开立，此处不开放自助注册。');
    if (r.account && r.account.mustChange) showPass(r.account);
    else enterSlots(r.account);
  });

  document.getElementById('btnSignOut').addEventListener('click', doSignOut);
}

/* ---------- 首次登录强制改密 ---------- */
let passAccount = null;

function showPass(acc) {
  passAccount = acc;
  show('view-pass');
  const hint = document.getElementById('passHint');
  hint.textContent = '改密后，其他设备上的登录将立即失效。';
  hint.style.color = '';
  document.getElementById('pcOld').value = '';
  document.getElementById('pcNew').value = '';
  document.getElementById('pcNew2').value = '';
}

function bindPassView() {
  document.getElementById('passForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPass = document.getElementById('pcOld').value || '';
    const n1 = document.getElementById('pcNew').value || '';
    const n2 = document.getElementById('pcNew2').value || '';
    const hint = document.getElementById('passHint');
    if (!oldPass) return (hint.textContent = '请输入当前口令', hint.style.color = 'var(--seal)');
    if (n1.length < 6) return (hint.textContent = '新口令至少 6 位', hint.style.color = 'var(--seal)');
    if (n1 !== n2) return (hint.textContent = '两次输入的新口令不一致', hint.style.color = 'var(--seal)');
    if (n1 === oldPass) return (hint.textContent = '新口令不能与初始口令相同', hint.style.color = 'var(--seal)');
    const btn = document.getElementById('btnPass');
    btn.disabled = true; btn.textContent = '提交中';
    const r = await cloud.changePassword(oldPass, n1);
    btn.disabled = false; btn.textContent = '改 密 入 宗';
    if (!r.ok) { hint.textContent = r.msg; hint.style.color = 'var(--seal)'; return; }
    if (passAccount) passAccount.mustChange = false;
    await enterSlots(passAccount || {});
  });

  document.getElementById('btnPassOut').addEventListener('click', doSignOut);
}

function setHint(text, bad) {
  const el = document.getElementById('authHint');
  el.textContent = text;
  el.style.color = bad ? 'var(--seal)' : '';
}

async function doSignOut() {
  await cloud.logout();
  state.game = null; state.session = null; state.rows = [];
  const btn = document.getElementById('btnAdmin');
  if (btn) btn.classList.add('hide');
  show('view-auth');
}

/* ---------- 存档 ---------- */
function bindSlotView() {
  document.getElementById('slotGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (!b) return;
    const slot = Number(b.dataset.slot);
    const act = b.dataset.do;
    if (act === 'create') createSlot(slot);
    else if (act === 'open') openSlot(slot);
    else if (act === 'del') deleteSlot(slot);
  });
}

async function enterSlots(session) {
  state.session = session;
  show('view-slots');
  const who = (session.nick || session.username) + (session.role === 'admin' ? ' · 管理员' : '');
  document.getElementById('slotsUser').textContent = `${who} · 云端存档`;
  document.getElementById('slotsHint').textContent = '同一账号在手机、平板与电脑上登录，看到的是同一份宗门。';
  const ab = document.getElementById('btnAdmin');
  if (ab) {
    ab.classList.toggle('hide', session.role !== 'admin');
    if (!ab._bound) {
      ab._bound = true;
      ab.addEventListener('click', () => {
        Admin.helpers = { back: () => show('view-slots') };
        Admin.open();
      });
    }
  }
  await refreshRows();
  renderSlots();
  loadFlags();
}

/* 全服开关与公告：进入存档页时拉一次，进入游戏后每分钟校准 */
async function loadFlags() {
  state.flags = await cloud.flags();
  renderNotice();
  if (state.game) {
    state.game.setModules(state.flags.modules || {});
    UI.applyModules(state.flags.modules || {});
    if (UI.helpers) UI.helpers.modules = state.flags.modules || {};
  }
}

function renderNotice() {
  const bar = document.getElementById('noticeBar');
  if (!bar) return;
  const text = (state.flags && state.flags.announcement) || '';
  bar.hidden = !text;
  bar.innerHTML = text ? `<b>宗门公告</b><span>${esc(text)}</span>` : '';
}

async function refreshRows() {
  try {
    state.rows = await cloud.listSaves();
  } catch (e) {
    state.rows = [];
    document.getElementById('slotsHint').textContent = '存档读取失败：' + e.message;
  }
}

function renderSlots() {
  const grid = document.getElementById('slotGrid');
  const cards = [];
  const limit = cloud.slotLimit();
  for (let i = 0; i < limit; i++) {
    const row = state.rows.find((r) => r.slot === i);
    if (row) {
      const d = row.data || {};
      const day = d.day || 0;
      cards.push(`<div class="card slot-card">
        <div class="no">存档 ${i + 1}</div>
        <div class="name">${esc(row.sect_name || '未名宗')}</div>
        <div class="meta"><span>祖师 ${esc(row.founder_name || '—')}</span><span>第 ${row.stage || 1} 幕</span></div>
        <div class="meta"><span>开宗 ${Math.floor(day / 360) + 1} 年</span><span>弟子 ${row.disciple_count || 0}</span><span>最高 ${row.max_step || 1} 步</span></div>
        <div class="meta"><span>修订号 ${row.revision}</span></div>
        <div class="row" style="margin-top:auto">
          <button class="btn primary sm" data-slot="${i}" data-do="open">入宗</button>
          <button class="btn ghost sm danger" data-slot="${i}" data-do="del">删除</button>
        </div>
      </div>`);
    } else {
      cards.push(`<div class="card slot-card is-empty">
        <div class="no">存档 ${i + 1}</div>
        <p class="sub">空置 · 尚未开宗</p>
        <button class="btn sm" data-slot="${i}" data-do="create">在此开宗</button>
      </div>`);
    }
  }
  grid.innerHTML = cards.join('');
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function createSlot(slot) {
  UI.modal({
    title: '开宗立派',
    sub: '落雁原 · 不祥之地 · 断脉之上',
    body: `<label class="field"><span>宗门之名</span><input id="inSect" maxlength="8" placeholder="破天宗" value="破天宗"></label>
      <label class="field"><span>祖师之名</span><input id="inFounder" maxlength="8" placeholder="请输入道号"></label>
      <p class="hint">宗门名将派生三处称谓：最高机构、外部城池、内部小世界。</p>`,
    actions: [
      { label: '开宗', cls: 'primary', onClick: (close) => doCreate(slot, close) },
      { label: '取消', cls: 'ghost', onClick: (c) => c() },
    ],
  });
}

async function doCreate(slot, close) {
  const sectName = (document.getElementById('inSect').value || '破天宗').trim().slice(0, 8);
  const founder = (document.getElementById('inFounder').value || '').trim().slice(0, 8);
  if (!founder) return toast('请填写祖师道号');
  const save = Game.create({ sectName, founderName: founder, slot }).save;
  try {
    const r = await cloud.putSave(save, null);
    if (!r.ok) throw new Error(r.msg || '开宗失败');
    save.revision = r.revision;
    close();
    await refreshRows();
    renderSlots();
    startGame({ slot, data: save, revision: r.revision }, r.revision);
  } catch (e) {
    toast(e.message);
  }
}

async function deleteSlot(slot) {
  const row = state.rows.find((r) => r.slot === slot);
  if (!row) return;
  UI.modal({
    title: '删除存档',
    sub: '宗门、弟子、资源与剧情进度将一并清除',
    body: `<p class="hint">此操作不可撤销。若只是想换个方式查看，请先导出或截图留存。</p>`,
    actions: [
      { label: '确认删除', cls: 'danger', onClick: async (c) => { await cloud.deleteSave(slot); c(); await refreshRows(); renderSlots(); } },
      { label: '取消', cls: 'ghost', onClick: (c) => c() },
    ],
  });
}

function ownerName() {
  return cloud.displayName();
}

async function openSlot(slot) {
  try {
    const row = await cloud.loadSave(slot);
    if (!row) return toast('存档不存在');
    if (row.sealed) {
      return UI.modal({
        title: '存档维护中',
        sub: `${row.sect_name} · 槽位 ${row.slot + 1}`,
        body: '<p class="hint">该存档正在维护，暂时只读。你的弟子、资源与剧情都完好保留，稍后再来或联系宗门管理方。</p>',
        actions: [{ label: '知道了', cls: 'primary', onClick: (c) => c() }],
      });
    }
    startGame(row, row.revision);
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- 游戏启动 ---------- */
function startGame(row, revision) {
  const save = migrate(row.data);
  save.revision = revision || row.revision || save.revision || 1;
  save.slot = row.slot;

  state.grayscale = resolveGrayscale();
  const gray = state.grayscale;

  const game = new Game(save, {
    modules: state.flags.modules || {},
    onLog: (module, action, detail) => cloud.logEvent(module, action, detail),
    onMsg: (text, type) => UI.pushMsg(text, type),
    /* V1.4：事件不再驱动弹窗，只更新场景与角标；回滚时按提示模式开关弹窗 */
    onStory: (id) => {
      if (gray.pendingMode === false) {
        const node = id === '__event__' ? game.pendingEvent : STORY_BY_ID[id];
        if (node) setTimeout(() => UI.storyPopup(node, id === '__event__'), 0);
      }
      setTimeout(() => UI.syncScene(), 0);
    },
    onDirty: () => { state.dirty = true; },
  });

  // 恢复离线期间的随机事件
  if (save.story && save.story.pendingEvt) {
    const def = RANDOM_EVENTS.find((e) => e.key === save.story.pendingEvt.key);
    if (def) game.pendingEvent = def;
  }

  state.game = game;
  state.dirty = false;

  const helpers = {
    autoSave: () => { state.dirty = true; },
    forceSave: () => flush(true),
    signOut: doSignOut,
    recruit: (kind) => recruit(kind),
    battle: (oppName) => doBattle(oppName),
    refreshRank: () => refreshRank(),
    ranking: state.ranking,
    opponents: state.opponents,
    account: cloud.currentAccount(),
    modules: state.flags.modules || {},
    grayscale: gray,
    setFlag: (k, v) => {
      writeFlagOverride(k, v);
      state.grayscale = resolveGrayscale();
      UI.flags = state.grayscale;
      UI.rebuildHome();
    },
    sessions: () => openSessions(),
    openAdmin: () => {
      Admin.helpers = { back: () => { show('view-game'); UI.enter(); } };
      Admin.open();
    },
    changePass: () => openChangePass(),
    /* 事项处置：请求编号做幂等，重复点击不会重复结算 */
    matterAct: (ref, action, note) => {
      const req = newReqId();
      cloud.matterAct(save.slot, req, ref, action, note).catch(() => {});
    },
    /* 赐名：改完即落盘，并回写云端 */
    renameDisciple: (id, name) => {
      const r = game.renameDisciple(id, name);
      if (r.ok) { state.dirty = true; autoSave(); UI.renderPanel(true); UI.syncScene(); }
      return r;
    },
    /* 第九步册封：唯祖师可定 */
    enshrine: (id) => {
      const r = game.enshrine(id);
      if (r.ok) { state.dirty = true; autoSave(); UI.renderPanel(true); UI.syncScene(); }
      return r;
    },
    /* 传功：亲传自降一境，把修为渡给后辈 */
    passOn: (fromId, toId) => {
      const r = game.passOn(fromId, toId);
      if (r.ok) { state.dirty = true; autoSave(); UI.renderPanel(true); UI.syncScene(); }
      return r;
    },
    /* 镇山：亲传驻守山门 */
    setGuard: (id, on) => {
      const r = game.setGuard(id, on);
      if (r.ok) { state.dirty = true; autoSave(); UI.renderPanel(true); }
      return r;
    },
    /* 阁中无人时，祖师一指派人 */
    forceQuorum: () => {
      const r = game.forceQuorum();
      if (r.ok) { state.dirty = true; autoSave(); UI.renderPanel(true); }
      return r;
    },
    /* 追责：把某一类政务收回祖师亲裁 */
    reviewAuto: (key) => {
      const r = game.reviewAuto(key);
      if (r.ok) { state.dirty = true; autoSave(); UI.renderPanel(true); UI.syncScene(); }
      return r;
    },
    /* 施政策略写入服务端，跨端一致 */
    syncPolicy: (p) => cloud.policySet(save.slot, p).catch(() => {}),
  };

  state.game = game;
  state.dirty = false;

  show('view-game');
  UI.mount(game, helpers);
  UI.enter();
  bindGameChromeOnce();

  // 离线结算
  const elapsedSec = Math.max(0, (Date.now() - (save.lastTick || Date.now())) / 1000);
  const offDays = Math.min(OFFLINE_CAP_DAYS, Math.floor(elapsedSec * DAYS_PER_SEC));
  if (offDays > 30) {
    game.advance(offDays, { silent: true });
    save.lastTick = Date.now();
    UI.pushMsg(`离开期间宗门照常运转，共推进 ${offDays} 日（离线收益已按上限结算）。`, 'story');
    UI.render();
  }

  loadFlags();
  refreshRank();
  /* 首次进入时把施政策略同步到服务端镜像，供多端与接口读取 */
  cloud.policySet(save.slot, save.policy).catch(() => {});
}

let loopTick = 0;
let panelSig = '';
let panelAt = 0;

function loop() {
  const g = state.game;
  if (!g || g.save.ended) return;
  const speed = g.save.sect.speed || 0;
  if (speed === 0) return;
  g.advance(DAYS_PER_TICK * speed);
  state.dirty = true;
  loopTick++;
  UI.renderTop();
  /* 事件驱动：数据变了才刷；另加 8 秒兜底，防止有字段漏进指纹 */
  if (UI.isLive()) {
    const sig = UI.panelSignature();
    const now = Date.now();
    /* 数据变了才刷，但最快 1.2 秒一次：免得忙时把 DOM 刷成跑马灯 */
    if ((sig !== panelSig && now - panelAt > 1200) || now - panelAt > 8000) {
      panelSig = sig;
      panelAt = now;
      UI.renderPanel();
    }
  }
  /* 场景：状态字段变更后两秒内重绘（弟子位置、建筑光晕随状态走） */
  if (loopTick % 8 === 0) UI.syncScene();
  /* 状态变化才让顶栏红点跟上，避免每帧重排 DOM */
  if (loopTick % 8 === 4) UI.syncBadges(UI._matters || []);
}

function newReqId() {
  try {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* ignore */ }
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ---------- 自动保存 ---------- */
async function flush(explicit) {
  const g = state.game;
  if (!g || state.saving) return;
  state.saving = true;
  const rev = g.save.revision;
  try {
    const matters = deriveMatters(g).map((m) => ({ ref: m.ref, level: m.level, kind: m.kind, title: m.title, desc: m.desc || '' }));
    const r = await cloud.putSave(g.save, rev, { matters });
    if (r.ok) {
      g.save.revision = r.revision;
      state.dirty = false;
      if (explicit) toast('已保存到云端');
      cloud.syncRanking(g.save);
    } else if (r.conflict) {
      /* 存档冲突属于三类阻断式提示之一 */
      UI.modal({
        title: '存档已在别处更新',
        sub: '同一账号在其他设备上写过这份宗门',
        body: '<p class="hint">为避免覆盖对方进度，本次改动未写入云端。载入最新版本后继续；若你确信本地更新，可先导出留档再联系管理员。</p>',
        actions: [
          { label: '载入最新', cls: 'primary', onClick: async (c) => { c(); await openSlot(g.save.slot); } },
          { label: '稍后再说', cls: 'ghost', onClick: (c) => c() },
        ],
      });
    } else if (r.sealed) {
      toast('存档维护中，本次改动未写入云端');
      state.dirty = false;
    } else if (r.slotLimit) {
      toast(r.msg || '存档槽位不足');
    } else if (r.auth) {
      UI.modal({
        title: '会话已失效',
        sub: '口令可能已在其他设备修改',
        body: '<p class="hint">需要重新登录才能继续保存。本次未写入的改动会在登录后由云端版本覆盖。</p>',
        actions: [{ label: '重新登录', cls: 'primary', onClick: async (c) => { c(); await doSignOut(); } }],
      });
    } else if (explicit) {
      toast('保存失败：' + (r.msg || '云端拒绝写入'));
    }
  } catch (e) {
    if (explicit) toast('保存失败：' + e.message);
  } finally {
    state.saving = false;
  }
}

function autoSave() { flush(false); }

/* ---------- 顶栏/抽屉/兑换 ---------- */
let chromeBound = false;
function bindGameChrome() { /* 占位，实际绑定在 first mount 后 */ }

function bindGameChromeOnce() {
  if (chromeBound) return;
  chromeBound = true;

  document.querySelectorAll('#speedBox button').forEach((b) => {
    b.addEventListener('click', () => {
      if (!state.game) return;
      state.game.save.sect.speed = Number(b.dataset.speed);
      state.dirty = true;
      UI.renderTop();
      toast(Number(b.dataset.speed) === 0 ? '时间已暂停' : `时间流速 ${b.dataset.speed} 倍`);
    });
  });

  document.getElementById('btnRedeem').addEventListener('click', openRedeem);
  document.getElementById('btnBackSlots').addEventListener('click', async () => {
    const g = state.game;
    if (g && state.dirty) await flush(false);
    state.game = null;
    await refreshRows();
    renderSlots();
    show('view-slots');
  });
}

/* ---------- 招收 ----------
 * 三种口径：
 *   formal / servant —— 逐个收，按人头扣费（祖师亲收，可指定数量与赐名）
 *   batch            —— 一次开山，按根骨分流入正式与杂役
 * 门派不设名额上限，能不能收只看粮秣与灵石。
 */
function recruit(opts) {
  const g = state.game;
  if (!g) return;
  const o = typeof opts === 'string' ? { kind: opts } : (opts || {});
  const kind = o.kind || 'formal';
  const count = Math.max(1, Math.min(RECRUIT.manual.max, Math.round(Number(o.count) || 1)));
  const surname = String(o.surname || '').trim().slice(0, 2);
  const generation = String(o.generation || '').trim().slice(0, 1);

  if (kind === 'batch') {
    const r = g.recruitBatch({ count, surname, generation });
    if (!r.ok) return toast(r.msg || '开山失败');
    UI.pushMsg(`祖师亲开山门：收 ${r.total} 人（正式 ${r.formal} · 杂役 ${r.servant}）`, 'good');
    UI.syncScene(); UI.renderPanel(true);
    state.dirty = true; autoSave();
    return;
  }

  const def = RECRUIT[kind] || RECRUIT.formal;
  const per = def.cost;
  const room = Math.min(...Object.entries(per).map(([k, v]) => Math.floor((g.save.res[k] || 0) / v)));
  const n = Math.min(count, Math.max(0, room));
  if (n <= 0) {
    const lack = Object.entries(per)
      .filter(([k, v]) => (g.save.res[k] || 0) < v)
      .map(([k]) => ({ lingshi: '灵石', liangshi: '粮食' }[k] || k)).join('、');
    return toast(`${lack}不足，连一个人也收不起`);
  }

  let made = 0;
  for (let i = 0; i < n; i++) {
    g.addRes(Object.fromEntries(Object.entries(per).map(([k, v]) => [k, -v])));
    const d = g.addDisciple(kind === 'servant' ? 'servant' : (Math.random() < 0.12 ? 'genius' : 'formal'), {
      surname: surname || undefined,
      generation: generation || undefined,
    });
    if (d) made++;
  }
  if (!made) return toast('未能入门');
  const who = kind === 'servant' ? '杂役' : '正式弟子';
  UI.pushMsg(n < count
    ? `资源只够收 ${made} 名${who}（本想收 ${count} 名）。`
    : `${made} 名${who}入宗${surname ? `，皆姓${surname}` : ''}${generation ? `，${generation}字辈` : ''}。`,
  kind === 'servant' ? 'info' : 'good');
  UI.syncScene();
  UI.renderPanel(true);
  state.dirty = true;
  autoSave();
}

/* ---------- 榜单与对战 ---------- */
async function refreshRank() {
  if (state.flags && state.flags.modules && state.flags.modules.rank === false) {
    state.ranking = [];
    state.opponents = [];
    if (UI.helpers) { UI.helpers.ranking = []; UI.helpers.opponents = []; }
    if (UI.panel === 'rank' || UI.panel === 'battle') UI.renderPanel();
    return;
  }
  const list = await cloud.fetchRanking(50);
  state.ranking = list;
  const me = state.game ? state.game.save.sect.name : '';
  state.opponents = list.filter((r) => r.sect_name !== me);
  if (UI.helpers) { UI.helpers.ranking = state.ranking; UI.helpers.opponents = state.opponents; }
  if (state.game && state.game.save.sect.renown > 0) cloud.syncRanking(state.game.save);
  if (UI.panel === 'rank' || UI.panel === 'battle') UI.renderPanel();
}

async function doBattle(oppName) {
  const g = state.game;
  if (!g) return;
  if (!g.modOpen('battle')) return toast('对战模块维护中，暂未开放');
  if (!g.canChallenge()) return toast('邀约冷却中（每三 game 日一次）');
  if (!g.save.battle.atk.length) return toast('请先设置进攻编队');
  const opp = state.opponents.find((o) => o.sect_name === oppName);
  if (!opp) return toast('对手已不在榜单');
  UI.modal({
    title: '发出对战邀约',
    sub: `对象：${opp.sect_name}`,
    body: `<p class="hint">对方同意后才会开战。战败方按动态比例损失资源：双方实力接近时掠夺比例较高，差距悬殊时被压低。</p>
      <div class="kv" style="margin-top:10px"><span>我方战力 <b>${Math.round(g.teamPower(g.save.battle.atk))}</b></span><span>对方约 <b>${opp.renown * 1.6 + opp.max_step * 60 | 0}</b></span></div>`,
    actions: [
      { label: '发出邀约', cls: 'primary', onClick: (c) => { c(); const r = g.challenge(opp); UI.render(); state.dirty = true; autoSave(); refreshRank(); if (r.win) toast('对方应战，我方获胜'); else toast('对方应战，我方失利'); } },
      { label: '取消', cls: 'ghost', onClick: (c) => c() },
    ],
  });
}

/* ---------- 兑换码 ---------- */
function openRedeem() {
  const g = state.game;
  if (!g) return;
  UI.modal({
    title: '兑换',
    sub: '输入不区分大小写，自动去除空格',
    body: `<label class="field"><span>兑换码</span><input id="inCode" placeholder="例如 POTIAN2026" maxlength="32"></label>
      <p class="hint">兑换记录会写入云端。单存档对同一码只能使用一次。</p>`,
    actions: [
      { label: '兑换', cls: 'primary', onClick: async (c) => {
        const code = (document.getElementById('inCode').value || '').toUpperCase().replace(/\s/g, '');
        if (!code) return toast('请输入兑换码');
        const r = await cloud.redeem(code, g.save.slot);
        if (!r.ok) {
          const map = { not_found: '兑换码不存在', expired: '兑换码已过期', not_started: '兑换码尚未生效', used: '该存档已使用过此码', unauthenticated: '登录已失效' };
          return toast(map[r.reason] || r.msg || '兑换失败');
        }
        const rw = r.reward || {};
        if (rw.res) g.addRes(rw.res);
        if (rw.renown) g.addRenown(rw.renown);
        if (rw.fortune) g.addFortune(rw.fortune);
        c();
        UI.render();
        state.dirty = true;
        autoSave();
        const items = Object.entries(rw.res || {}).map(([k, v]) => `${resName(k)} ×${v}`).join('、');
        UI.modal({ title: '兑换成功', body: `<p class="story-text">${items}${rw.renown ? `；声望 +${rw.renown}` : ''}${rw.fortune ? `；气运 +${rw.fortune}` : ''}</p>`, actions: [{ label: '收下', cls: 'primary', onClick: (x) => x() }] });
      } },
      { label: '取消', cls: 'ghost', onClick: (c) => c() },
    ],
  });
}

/* ---------- 登录设备 ---------- */
async function openSessions() {
  const list = await cloud.sessions();
  UI.modal({
    title: '登录设备',
    sub: '同一账号可在多台设备上同时在线',
    body: `<div class="list">${list.length ? list.map((s) => `<div class="item">
      <div class="main"><div class="name">${esc(s.dev || '未知设备')} ${s.current ? '<span class="pill jade">当前</span>' : ''}</div>
      <div class="meta"><span>登录 ${esc(s.created)}</span><span>活跃 ${esc(s.seen)}</span></div></div>
      <div class="act">${s.current ? '' : `<button class="btn sm ghost danger" data-sess="${esc(s.sid)}">下线</button>`}</div>
    </div>`).join('') : '<div class="item"><div class="main"><div class="name">没有其他设备</div></div></div>'}</div>
    <p class="hint">下线后该设备需重新登录。修改口令会使全部设备立即失效。</p>`,
    actions: [{ label: '关闭', cls: 'ghost', onClick: (c) => c() }],
    onMount: (root) => {
      root.querySelectorAll('[data-sess]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await cloud.revokeSession(b.dataset.sess);
        toast(ok ? '已下线' : '操作失败');
        if (ok) { const c = document.querySelector('.modal-foot .btn'); c && c.click(); openSessions(); }
      }));
    },
  });
}

/* ---------- 修改口令 ---------- */
function openChangePass() {
  const acc = cloud.currentAccount() || {};
  UI.modal({
    title: '修改口令',
    sub: `账号 ${acc.username || ''}`,
    body: `<label class="field"><span>原口令</span><input id="op" type="password" maxlength="64" autocomplete="current-password"></label>
      <label class="field"><span>新口令</span><input id="np2" type="password" maxlength="64" autocomplete="new-password" placeholder="至少 6 位"></label>
      <p class="hint">修改后，其他设备上的登录会失效。</p>`,
    actions: [
      { label: '确认修改', cls: 'primary', onClick: async (c) => {
          const o = document.getElementById('op').value || '';
          const n = document.getElementById('np2').value || '';
          if (n.length < 6) return toast('新口令至少 6 位');
          const r = await cloud.changePassword(o, n);
          if (!r.ok) return toast(r.msg);
          c(); toast('口令已修改');
        } },
      { label: '取消', cls: 'ghost', onClick: (c) => c() },
    ],
  });
}

function resName(k) {  const m = { lingshi: '灵石', liangshi: '粮食', lingzhi: '灵植', lingyao: '灵药', danyao: '丹药', qicai: '炼器材料', fulu: '符箓材料', zhenfa: '阵法材料', yaoshou: '妖兽材料', kuangshi: '矿石', qizhen: '奇珍异宝', gongfa: '功法残页' };
  return m[k] || k;
}

/* ---------- 事件绑定 ---------- */
let booted = false;
function safeBoot() { if (booted) return; booted = true; boot(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot);
else safeBoot();

