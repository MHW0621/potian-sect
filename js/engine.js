/* 破天宗 · 引擎层
 * 所有玩法结算集中在此，UI 只负责渲染与调用。
 */
import {
  VERSION, REALMS, REALM_MAX, SERVANT_REALM_CAP, STEPS, SPIRIT_ROOTS, PHYSIQUES,
  TECHNIQUES, TECH_BY_KEY, RESOURCES, RES_BY_KEY, FACILITIES, INSTITUTIONS, LAYERS,
  REGIONS, MISSION_TEMPLATES, RANDOM_EVENTS, ENDINGS, FACTIONS, SURNAMES, GIVEN_1, GIVEN_2,
  NAMED_BACKGROUNDS, OFFLINE_CAP_DAYS, RECRUIT, HEIR, ELDER, AREAS, AREA_BY_KEY,
  DAOHAO_HEAD, DAOHAO_BODY, DAOHAO_TAIL, DAOHAO_MIN_STEP,
} from './config.js';
import { STORY_NODES, STORY_BY_ID } from './story.js';

/* ---------- 小工具 ---------- */
export const rnd = (a, b) => a + Math.random() * (b - a);
export const ri = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* 灵根与体质是定表，每次 find 扫一遍是纯浪费，做成查找表 */
const ROOT_BY_KEY = Object.fromEntries(SPIRIT_ROOTS.map((r) => [r.key, r]));
const PHYS_BY_KEY = Object.fromEntries(PHYSIQUES.map((p) => [p.key, p]));
export function weighted(arr, key = 'w') {
  const total = arr.reduce((s, x) => s + (x[key] ?? 1), 0);
  let r = Math.random() * total;
  for (const x of arr) { r -= (x[key] ?? 1); if (r <= 0) return x; }
  return arr[arr.length - 1];
}
const emptyRes = () => Object.fromEntries(RESOURCES.map((r) => [r.key, 0]));

/* ---------- 姓名 ---------- */
export function genName(surname, generation) {
  const s = surname || pick(SURNAMES);
  /* 字辈：同一批弟子共用一个中间字，读起来像同门 */
  const g = generation || pick(GIVEN_1);
  return Math.random() < 0.62 ? s + g + pick(GIVEN_2) : s + g;
}

/* 道号：内门以上的体面，第七步起才有 */
export function genDaohao() {
  return pick(DAOHAO_HEAD) + pick(DAOHAO_BODY) + pick(DAOHAO_TAIL);
}

/* ---------- 弟子工厂 ---------- */
let uid = Date.now() % 100000;
const nextId = () => ++uid;

function makeDisciple(kind, opts = {}) {
  const isNamed = kind === 'named';
  /* rare：天资拔高，用于天才与亲传候选 */
  const root = opts.rootKey
    ? (SPIRIT_ROOTS.find((r) => r.key === opts.rootKey) || weighted(SPIRIT_ROOTS))
    : opts.rare
      ? weighted(SPIRIT_ROOTS.filter((r) => r.mul >= 1.3))
      : weighted(SPIRIT_ROOTS);
  const phys = weighted(PHYSIQUES);
  let type = kind === 'servant' || kind === 'servant_std' ? 'servant' : 'formal';
  if (kind === 'genius') type = 'formal';
  if (opts.type) type = opts.type;
  const realm = opts.realm || (type === 'servant' ? ri(1, 3) : ri(4, 5));
  const step = opts.step != null ? opts.step : (type === 'servant' ? 0 : (realm <= 4 ? 1 : realm <= 6 ? 2 : 3));
  const bg = isNamed ? pick(NAMED_BACKGROUNDS) : null;
  const d = {
    id: nextId(),
    name: opts.name || genName(opts.surname, opts.generation),
    /* 道号不是名字，是身份：第七步（内门）以上才有，可被祖师另行赐下 */
    daohao: opts.daohao !== undefined ? opts.daohao
      : (type !== 'servant' && step >= DAOHAO_MIN_STEP ? genDaohao() : null),
    type,
    named: isNamed,
    bg: bg ? bg.key : null,
    bgName: bg ? bg.name : null,
    star: type === 'servant' ? 1 : 0,
    step,
    realm,
    root: root.key,
    phys: phys.key,
    tech: type === 'servant' ? null : 'fan_juqi',
    prog: 0,
    demon: ri(0, 8),
    loyalty: ri(55, 82),
    age: type === 'servant' ? ri(14, 30) : ri(12, 22),
    life: 0,
    state: 'cultivate',
    injDays: 0,
    gongxian: 0,
    tries3: 0,
    passed4: false,
    rel: {},
    history: [],
    joinedDay: 0,
  };
  d.life = baseLife(d);
  return d;
}

function baseLife(d) {
  const r = REALMS[clamp(d.realm, 1, REALM_MAX) - 1];
  return r.life + 45 + ri(0, 25);
}

/* =========================================================
 * Game
 * ========================================================= */
export class Game {
  constructor(save, hooks = {}) {
    this.save = save;
    this.hooks = hooks; // { onMsg, onStory, onDirty, onLog, modules }
    this._msgQueue = [];
    this._grp = null;
    this._idx = null;
    this._maxStep = null;
    this._heirN = null;
    this._sm = null;
    this._smKey = null;
    this.mod = Object.assign(
      { battle: true, rank: true, prod: true, story: true, world: true, tasks: true, org: true },
      hooks.modules || {}
    );
  }

  /* 全服开关：关闭的模块入口隐藏、相关结算暂停，数据不动 */
  setModules(m) { Object.assign(this.mod, m || {}); }
  modOpen(k) { return this.mod[k] !== false; }
  _log(module, action, detail) {
    this.hooks.onLog && this.hooks.onLog(module, action, detail || {});
  }

  /* ---------- 建宗 ---------- */
  static create({ sectName, founderName, slot }) {
    const save = {
      v: VERSION,
      slot,
      revision: 1,
      day: 0,
      sect: { name: sectName, founder: founderName, renown: 0, fortune: 0, stage: 1, speed: 1 },
      res: Object.assign(emptyRes(), { lingshi: 800, liangshi: 600, lingzhi: 120, lingyao: 60, danyao: 40, qicai: 40, fulu: 20, zhenfa: 10, yaoshou: 0, kuangshi: 60, qizhen: 1 }),
      fac: { lingtian: 1, gongfang: 0, juling: 0, xunshan: 0, zangjing: 0 },
      layers: 1,
      disciples: [],
      posts: { dizige: [null, null, null], hufatang: [null, null, null], zhanglaohui: [null, null, null] },
      missions: [],
      expeditions: [],
      story: { done: [], pending: [], log: [] },
      relations: { tianshu: 0, xuanyin: 0, shangmeng: 0 },
      battle: { atk: [], def: [], reports: [], lastChallenge: -999 },
      flags: {},
      stats: { recruited: 0, broke: 0, wins: 0, losses: 0, peakStep: 1 },
      settings: { autoBreak: true, autoRecruit: true, sound: false, recruitFee: false, heirStipend: true },
      /* V1.4：破天阁施政策略（宽纵 / 均衡 / 严苛）与自决范围 */
      policy: {
        stance: 'balanced',
        areas: Object.fromEntries(AREAS.map((a) => [a.key, true])),
        recruit: { minRoot: 'fan' },
        laws: { morning: true, curfew: false, bounty: false },
      },
      /* 待处理的已读/暂缓状态（事项本身由状态推导，不落冗余副本） */
      matterState: { snooze: {}, seen: {}, seenDay: 0 },
      news: [],
      createdAt: Date.now(),
      lastTick: Date.now(),
    };
    const g = new Game(save);
    g.seedDisciples();
    return g;
  }

  /* ---------- 基础存取 ---------- */
  get s() { return this.save; }

  /* ---------- 开宗铺底 ----------
   * 新宗不能是空山：一到八步每一档都有人，第一次选拔、第一次任务都有人可用。
   * 第九步故意留空 —— 亲传只能祖师亲册，开局就送，册封这个动作就没意义了。
   */
  seedDisciples() {
    const s = this.save;
    if (s.disciples.length) return;
    /* 人数按境界倒着递减，越往上越少，看得出宗门是有建制的 */
    const plan = [
      { step: 1, n: 12 },
      { step: 2, n: 8 },
      { step: 3, n: 6 },
      { step: 4, n: 4 },
      { step: 5, n: 3 },
      { step: 6, n: 2 },
      { step: 7, n: 1 },
      { step: 8, n: 2 },
    ];
    for (const p of plan) {
      const si = STEPS[p.step - 1];
      for (let i = 0; i < p.n; i++) {
        /* 同档里修为有高有低，不要一水儿贴着下界 */
        const realm = clamp(ri(si.realmFrom, si.realmTo), 1, REALM_MAX);
        const d = makeDisciple('formal', { type: 'formal', realm, step: p.step });
        d.age = 14 + (p.step - 1) * 4 + ri(0, 12);
        d.life = baseLife(d);
        /* 起步的人忠诚略高，避免开局就有人跑 */
        d.loyalty = ri(60, 86);
        this.pushDisciple(d);
      }
    }
    /* 杂役：粗活总得有人干，八个够撑起灵田与工坊 */
    for (let i = 0; i < 8; i++) {
      const d = makeDisciple('servant', { type: 'servant' });
      d.age = ri(14, 32);
      d.life = baseLife(d);
      d.loyalty = ri(60, 86);
      this.pushDisciple(d);
    }
    /* 阁老先落两席：两名第八步正好填上，第一天阁中就能议事 */
    const seats = this._ensureSeats();
    let put = 0;
    for (const d of this.formal()) {
      if (put >= seats.length - 1) break;
      if (d.step !== 8) continue;
      seats[put] = d.id;
      d.state = 'post';
      put++;
    }
    this._touchDisc();
  }

  realmInfo(d) { return REALMS[clamp(d.realm, 1, REALM_MAX) - 1]; }
  need(d) { return this.realmInfo(d).need; }
  stepInfo(step) { return STEPS[clamp(step, 1, 9) - 1]; }
  stepTitle(d) { return d.type === 'servant' ? `${d.star}星杂役` : this.stepInfo(d.step).title; }
  rootOf(d) { return ROOT_BY_KEY[d.root] || SPIRIT_ROOTS[0]; }
  physOf(d) { return PHYS_BY_KEY[d.phys] || PHYSIQUES[0]; }
  techOf(d) { return d.tech ? TECH_BY_KEY[d.tech] : null; }

  /* 分组与索引：弟子可达数千，每次 filter/find 都是全表扫，必须缓存。
   * 任何增删弟子都必须调 _touchDisc()，否则缓存会指到已删的人身上。
   * 亲传人数也在每日修炼里被读，同样要缓存，否则 O(n²)。 */
  _touchDisc() { this._grp = null; this._idx = null; this._maxStep = null; this._heirN = null; }
  _groups() {
    if (this._grp) return this._grp;
    const formal = [], servant = [], staff = [];
    for (const d of this.save.disciples) {
      if (d.type === 'formal') formal.push(d);
      else if (d.type === 'servant') servant.push(d);
      else if (d.type === 'staff') staff.push(d);
    }
    this._grp = { formal, servant, staff };
    return this._grp;
  }
  _index() {
    if (this._idx) return this._idx;
    const m = new Map();
    for (const d of this.save.disciples) m.set(d.id, d);
    this._idx = m;
    return m;
  }
  /* 返回内部数组的副本再排序，避免调用方 sort 污染缓存 */
  formal() { return this._groups().formal; }
  servants() { return this._groups().servant; }
  staff() { return this._groups().staff; }
  byId(id) { return this._index().get(id) || null; }
  maxStep() {
    if (this._maxStep == null) {
      let m = 0;
      for (const d of this._groups().formal) if (d.step > m) m = d.step;
      this._maxStep = m;
    }
    return this._maxStep;
  }

  /* ---------- 消息 ---------- */
  msg(text, type = 'info') {
    this._msgQueue.push({ text, type, day: this.save.day });
    if (this._msgQueue.length > 40) this._msgQueue.shift();
    /* 持久化一份，供消息中心跨端查看（不弹窗） */
    this.save.news = this.save.news || [];
    this.save.news.unshift({ text, type, day: this.save.day });
    if (this.save.news.length > 80) this.save.news.pop();
    this.hooks.onMsg && this.hooks.onMsg(text, type);
  }
  drainMsgs() { const q = this._msgQueue.slice(); this._msgQueue.length = 0; return q; }

  /* ---------- 施政策略 ---------- */
  policy() {
    return this.save.policy || { stance: 'balanced', areas: {}, recruit: {}, laws: {} };
  }
  stance() { return this.policy().stance || 'balanced'; }
  law(k) { const l = this.policy().laws || {}; return !!l[k]; }
  /* 三档倾向对修炼、产出、突破、忠诚、心魔的乘数/增量。
   * 每日每弟子都要读它，按档位缓存一份，别在循环里反复建对象。 */
  stanceMul() {
    const st = this.stance();
    if (this._sm && this._smKey === st) return this._sm;
    const table = {
      lenient: { gain: 0.97, prod: 0.94, break_: 0.0, loyalty: 0.02, demon: 0.94, name: '宽纵' },
      balanced: { gain: 1, prod: 1, break_: 0, loyalty: 0, demon: 1, name: '均衡' },
      strict: { gain: 1.05, prod: 1.08, break_: 0.01, loyalty: -0.02, demon: 1.08, name: '严苛' },
    };
    this._smKey = st;
    this._sm = table[st] || table.balanced;
    return this._sm;
  }
  setPolicy(patch) {
    const p = this.policy();
    this.save.policy = {
      stance: patch.stance || p.stance || 'balanced',
      areas: Object.assign(Object.fromEntries(AREAS.map((a) => [a.key, true])), p.areas, patch.areas || {}),
      recruit: Object.assign({ minRoot: 'fan' }, p.recruit, patch.recruit || {}),
      laws: Object.assign({ morning: true, curfew: false, bounty: false }, p.laws, patch.laws || {}),
    };
    this.save.policy.updatedAt = Date.now();
    this.hooks.onDirty && this.hooks.onDirty();
    return this.save.policy;
  }
  /* 宗门史留痕：自决与批复都要可追溯到事由、处置与结果 */
  chronicle(kind, title, label, result, extra) {
    const s = this.save;
    s.story = s.story || { done: [], pending: [], log: [] };
    s.story.log.unshift(Object.assign({
      kind, title, label, result, day: s.day, by: kind === 'auto' ? '破天阁' : '祖师',
    }, extra || {}));
    if (s.story.log.length > 240) s.story.log.length = 240;
  }

  /* ---------- 资源与通用数值 ---------- */
  addRes(delta) {
    for (const [k, v] of Object.entries(delta || {})) {
      if (!(k in this.save.res)) continue;
      this.save.res[k] = Math.max(0, +(this.save.res[k] + v).toFixed(2));
    }
  }
  addRenown(v) { this.save.sect.renown = Math.max(0, (this.save.sect.renown || 0) + v); }
  get renown() { return this.save.sect.renown || 0; }
  addFortune(v) { this.save.sect.fortune = clamp(this.save.sect.fortune + v, -100, 100); }
  addRelation(k, v) { this.save.relations[k] = clamp((this.save.relations[k] || 0) + v, -5, 5); }
  loyaltyAll(v) { for (const d of this.save.disciples) d.loyalty = clamp(d.loyalty + v, 0, 100); }
  hurt(n) {
    const pool = this.formal().filter((d) => d.state !== 'injured');
    for (let i = 0; i < n && pool.length; i++) {
      const d = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      d.state = 'injured';
      d.injDays = ri(10, 40);
      d.loyalty = clamp(d.loyalty - 3, 0, 100);
    }
  }
  calmWorst(v) {
    const worst = this.formal().slice().sort((a, b) => b.demon - a.demon)[0];
    if (worst) worst.demon = clamp(worst.demon - v, 0, 100);
  }

  /* ---------- 招收 ----------
   * 门派不设名额上限：来多少人由粮秣与资源自然调节。
   * 招收分三路：两年一次的开山（自动、上百人）、祖师亲收（随时、可指定数量与赐名）、
   * 以及阁中零星补人（自治）。三条路都走 pushDisciple，保证计数与统计一致。
   */
  cap() { return Infinity; }

  pushDisciple(d) {
    d.joinedDay = this.save.day;
    this.save.disciples.push(d);
    this.save.stats.recruited++;
    this._touchDisc();
    return d;
  }

  addDisciple(kind = 'servant', opts) {
    return this.pushDisciple(makeDisciple(kind, opts));
  }

  /* 一次开山：先抽根骨，再按资质分流 —— 资质是主判据，比例只做两端夹逼。
   * 人数硬边界 100~200，声望只决定落在区间的哪一段。
   * 入门费默认不收；政策开了才按人计，付不起就按付得起的人数开。 */
  recruitBatch({ count = 120, surname = '', generation = '', log = true } = {}) {
    const s = this.save;
    const cfg = RECRUIT.batch;
    const out = { ok: true, total: 0, formal: 0, servant: 0, cost: {}, asked: 0, trimmed: 0 };

    const ask = clamp(Math.round(count), cfg.min, cfg.max);
    out.asked = ask;

    const feeOn = s.settings.recruitFee === true;
    let real = ask;
    if (feeOn) {
      const per = cfg.fee.liangshi || 0;
      const afford = per > 0 ? Math.floor((s.res.liangshi || 0) / per) : ask;
      if (afford <= 0) return { ok: false, msg: '粮秣不足，开不了山门', ...out };
      if (afford < ask) out.trimmed = ask - afford;
      real = Math.min(ask, afford);
    }
    out.real = real;
    const n = real;

    /* 同批弟子一个姓、一个字辈，读起来像同门 */
    const batch = [];
    for (let i = 0; i < n; i++) {
      batch.push(makeDisciple('formal', { surname: surname || undefined, generation: generation || undefined }));
    }

    /* 资质分流：根骨达门槛的入正式，这是主判据 */
    const thr = cfg.formalRootMul;
    let fm = batch.filter((d) => this.rootOf(d).mul >= thr);
    let sv = batch.filter((d) => this.rootOf(d).mul < thr);

    /* 两端夹逼：整批全杂役或整批全天才都不像话，夹住才有"开山收徒"的样子 */
    const lo = Math.ceil(n * cfg.formalMin);
    const hi = Math.floor(n * cfg.formalMax);
    if (fm.length < lo && sv.length) {
      sv.sort((a, b) => this.rootOf(b).mul - this.rootOf(a).mul);
      fm = fm.concat(sv.splice(0, Math.min(lo - fm.length, sv.length)));
    } else if (fm.length > hi) {
      fm.sort((a, b) => this.rootOf(a).mul - this.rootOf(b).mul);
      sv = sv.concat(fm.splice(0, fm.length - hi));
    }

    /* 落档：入杂役的要真的改身份，不只是换个标签 */
    for (const d of sv) {
      d.type = 'servant';
      d.step = 0;
      d.star = 1;
      d.tech = null;
      d.daohao = null;
      d.realm = clamp(d.realm, 1, SERVANT_REALM_CAP);
      d.state = 'cultivate';
    }

    for (const d of batch) this.pushDisciple(d);
    out.formal = fm.length;
    out.servant = sv.length;
    out.total = batch.length;
    out.ratio = batch.length ? +(fm.length / batch.length).toFixed(2) : 0;

    if (feeOn && out.total) {
      const per = cfg.fee.liangshi || 0;
      const fp = cfg.formalFee.lingshi || 0;
      s.res.liangshi = Math.max(0, (s.res.liangshi || 0) - per * out.total);
      s.res.lingshi = Math.max(0, (s.res.lingshi || 0) - fp * out.formal);
      out.cost.liangshi = +(per * out.total).toFixed(1);
      out.cost.lingshi = +(fp * out.formal).toFixed(1);
    }

    if (log && out.total) {
      this.chronicle('recruit', '山门大开', `${out.formal} 正 · ${out.servant} 役`,
        `${surname ? `${surname}氏` : '四方'}来投 ${out.total} 人，验根骨后 ${out.formal} 人入正式、${out.servant} 人入杂役。`);
      this.msg(`山门大开：收 ${out.total} 人（正式 ${out.formal} · 杂役 ${out.servant}）`, 'good');
    }
    return out;
  }

  /* 赐名 / 赐道号：祖师可给任何弟子改名，记入宗门史，并带一点人情数值。
   * input 既接受字符串（旧调用只改名），也接受 { name, daohao }。
   * 道号是内门以上的体面，第七步起才赐；名字谁都可以改。 */
  renameDisciple(id, input) {
    const d = this.byId(id);
    if (!d) return { ok: false, msg: '查无此人' };
    const patch = typeof input === 'string' ? { name: input } : (input || {});
    const name = patch.name != null ? String(patch.name).trim().slice(0, 12) : '';
    const daohao = patch.daohao != null ? String(patch.daohao).trim().slice(0, 12) : '';
    if (!name && !daohao) return { ok: false, msg: '名字与道号不能都空着' };
    const canDaohao = d.step >= DAOHAO_MIN_STEP || d.type === 'staff';
    if (daohao && !canDaohao) return { ok: false, msg: `道号是内门以上的体面，需第 ${DAOHAO_MIN_STEP} 步` };

    const from = { name: d.name, daohao: d.daohao || null };
    const changed = [];
    if (name && name !== d.name) { changed.push(`名「${from.name}」改「${name}」`); d.name = name; }
    if (daohao && daohao !== (d.daohao || '')) { changed.push(`号「${from.daohao || '无'}」改「${daohao}」`); d.daohao = daohao; }
    if (!changed.length) return { ok: false, msg: '名号未变' };

    /* 赐名是恩典：忠诚与声望各加一点，名正而言顺 */
    d.renamed = (d.renamed || 0) + 1;
    d.loyalty = clamp(d.loyalty + 4, 0, 100);
    this.addRenown(2);
    this.chronicle('rename', '祖师赐名', `${d.name}${d.daohao ? ` · ${d.daohao}` : ''}`,
      `祖师亲笔，为${this.stepTitle(d)}${from.name}赐：${changed.join('，')}。`);
    this.msg(`${from.name} 已赐${name ? `名「${name}」` : `道号「${daohao}」`}。`, 'good');
    return { ok: true, msg: `${from.name} → ${d.name}`, from, to: { name: d.name, daohao: d.daohao } };
  }

  /* 抽一个道号给界面用，祖师可以改，也可以直接采纳 */
  rollDaohao() { return genDaohao(); }

  /* ---------- 修炼速率 ---------- */
  envMul() {
    const f = this.save.fac;
    return 1 + this.save.layers * 0.12 + (f.juling || 0) * 0.18 + (f.lingtian || 0) * 0.04 + (this.save.flags.veinOpen ? 0.25 : 0);
  }
  gainPerDay(d) {
    const base = d.type === 'servant' ? 3.2 : 6.0;
    const t = this.techOf(d);
    const techMul = t ? t.cult : 0.85;
    const dq = clamp(1 - d.demon / 220, 0.35, 1);
    const slow = this.save.flags.slowUntil && this.save.day < this.save.flags.slowUntil ? 0.5 : 1;
    const sm = this.stanceMul();
    const lawMul = this.law('morning') ? 1.04 : 1;
    return base * this.rootOf(d).mul * this.physOf(d).mul * techMul * this.envMul() * dq * slow * sm.gain * lawMul * (0.9 + REALMS[d.realm - 1].i * 0.02) * this.heirBonus();
  }

  /* ---------- 战力 ---------- */
  power(d) {
    const r = this.realmInfo(d);
    const t = this.techOf(d);
    const stepBonus = 1 + (d.step || 0) * 0.05;
    return Math.round(r.atk * this.rootOf(d).mul * this.physOf(d).mul * (t ? 1 + t.atk : 1) * stepBonus * (1 - d.demon / 400) * (d.type === 'staff' ? 1.1 : 1) * (d.guard && d.step === 9 ? 1.15 : 1));
  }
  teamPower(ids) {
    const list = ids ? ids.map((i) => this.byId(i)).filter(Boolean) : this.formal();
    return list.reduce((s, d) => s + this.power(d), 0);
  }

  /* ---------- 时间推进 ---------- */
  advance(days, { silent = false } = {}) {
    let remain = Math.max(0, days);
    const total = remain;
    let guard = 0;
    while (remain > 0 && guard < 6000) {
      const step = Math.min(remain, 1);
      remain -= step;
      this._day();
      guard++;
      if (this.save.ended) break;
    }
    if (total > 0 && !silent) this.save.lastTick = Date.now();
    this.hooks.onDirty && this.hooks.onDirty();
  }

  _day() {
    const s = this.save;
    s.day++;
    const day = s.day;

    /* 阶段推进 */
    this._checkStage();

    /* 声望涓流：宗门的名声随岁月累积 */
    if (day % 360 === 0) this.addRenown(Math.round(Math.sqrt(this.formal().length) * 2 + s.layers));

    /* 弟子结算
     * 门派不设人数上限，后期动辄数千人，逐日全扫必然卡。
     * 超过 200 人时按两片轮转：每天只精算一半，增益按两日给，
     * 数值等价，只是状态跳变最多晚一天。少于 200 人时仍逐日全算。 */
    const all = s.disciples;
    const total = all.length;
    const slices = total > 200 ? 2 : 1;
    const sliceKey = slices === 1 ? -1 : day % slices;
    const span = slices;
    const sm = this.stanceMul();
    const curfewMul = this.law('curfew') ? 0.92 : 1;
    const demonBase = 0.03 * sm.demon * curfewMul;
    const loyalDrift = day % 10 === 0 && sm.loyalty ? sm.loyalty * 10 : 0;

    for (let i = 0; i < total; i++) {
      if (sliceKey >= 0 && i % slices !== sliceKey) continue;
      const d = all[i];
      // 寿元
      d.age += span / 365;
      if (d.age >= d.life) {
        d.dead = true;
        this.msg(`${d.name} 寿元耗尽，坐化于静室。`, 'bad');
        continue;
      }
      if (d.state === 'injured') {
        d.injDays -= span;
        if (d.injDays <= 0) d.state = 'cultivate';
        continue;
      }
      // 心魔
      const tech = this.techOf(d);
      d.demon = clamp(d.demon + demonBase * span * this.physOf(d).demon * (1 + d.realm * 0.05) * (tech?.calm ? 1 - tech.calm : 1), 0, 100);
      // 法度与施政带来的忠诚漂移（每十日结算一次）
      if (loyalDrift) d.loyalty = clamp(d.loyalty + loyalDrift, 0, 100);
      if (d.demon >= 100 && Math.random() < 0.0005 * span) {
        this.msg(`${d.name} 心魔爆发，修为倒退一境。`, 'bad');
        d.realm = Math.max(1, d.realm - 1);
        d.prog = 0;
        d.demon = 60;
      }
      // 修为
      if (d.state !== 'bottleneck') {
        d.prog += this.gainPerDay(d) * span;
        const need = this.need(d);
        if (d.prog >= need) {
          d.prog = need;
          d.state = 'bottleneck';
        }
      }
      // 外派/任务中的弟子不参与自动突破
      if (d.state === 'bottleneck' && s.settings.autoBreak && d.type !== 'servant') this._autoBreak(d);
      if (d.state === 'bottleneck' && d.type === 'servant') this._servantStar(d);
    }

    /* 去世清理 */
    const dead = s.disciples.filter((d) => d.dead);
    if (dead.length) {
      s.disciples = s.disciples.filter((d) => !d.dead);
      this._touchDisc();
      for (const inst of Object.keys(s.posts)) {
        s.posts[inst] = s.posts[inst].map((id) => (dead.some((x) => x.id === id) ? null : id));
      }
      s.battle.atk = s.battle.atk.filter((id) => !dead.some((x) => x.id === id));
      s.battle.def = s.battle.def.filter((id) => !dead.some((x) => x.id === id));
    }

    /* 生产与消耗：每 2 日结算一次以减轻负担 */
    if (day % 2 === 0) this._economy(2);

    /* 任务与派遣 */
    this._tickJobs();

    /* 剧情 */
    this._checkStory();

    /* 随机事件（每 40 日一次判定） */
    if (day % 40 === 0) this._randomEvent();

    /* 山门大开：每两年一次。人数先随机，再按声望把分布往区间上端推，
       硬边界仍是 100~200 —— 名声大了来的人多，但不会多到离谱 */
    if (s.settings.autoRecruit && day % RECRUIT.batch.interval === 0) {
      const span = RECRUIT.batch.max - RECRUIT.batch.min;
      const fame = clamp((s.sect.renown || 0) / RECRUIT.batch.renownFull, 0, 1);
      const lo = RECRUIT.batch.min + Math.round(span * 0.45 * fame);
      this.recruitBatch({ count: ri(lo, RECRUIT.batch.max), log: true });
    }

    if (day % 15 === 0) {
      /* 断粮三级：先减供给，再走杂役，最后才轮到正式弟子 */
      this._famine();
      /* 席位随层数开，进层后要把数组补齐 */
      this._ensureSeats();
      /* 破天阁自治：日常与重要事务按施政策略自行处置，结果写入宗门史 */
      this._autoGovern();
    }

    /* 弟子阁轮值：阁老不终身占席 */
    if (day % ELDER.rotateDays === 0) this.rotateElder();

    /* 榜单同步由外部节流调用 */
  }

  /* ---------- 破天阁自治 ----------
   * 判定器输入：事由、候选人、当前策略；输出：处置与消耗。
   * 全部为确定性挑选（分数排序），同一事务只结算一次。
   * 一条硬规矩：阁中无主时不等于不办事 —— 只是办得慢，绝不堆着没人管。
   */
  _autoGovern() {
    const s = this.save;
    const p = this.policy();
    const areas = p.areas || {};
    const sm = this.stanceMul();
    const q = this.elderQuorum();
    /* 无阁老：周期按 idleMul 拉长，事照办 */
    if (!q.ok && Math.floor(s.day / 15) % ELDER.idleMul !== 0) return;
    const eff = this.elderEfficiency() || 0.5;

    /* 一、补缺：席位空缺时由阁议推举，严苛档更积极、宽纵档更迟缓 */
    if (areas.seat !== false && this.modOpen('org') && s.day % 45 === 0) {
      const vac = [];
      for (const inst of INSTITUTIONS) {
        const seats = inst.key === 'dizige' ? this._ensureSeats() : s.posts[inst.key];
        seats.forEach((id, i) => {
          if (!id || !this.byId(id)) vac.push({ inst: inst.key, i, seat: this.seatLabel(inst.key, i), name: inst.name });
        });
      }
      if (vac.length) {
        const v = vac[0];
        /* 只挑一个最优者，不排序全表：一千人时 sort 比一趟遍历贵得多 */
        const taken = new Set([].concat(s.posts.dizige, s.posts.hufatang, s.posts.zhanglaohui).filter(Boolean));
        let best = null, bestScore = -Infinity;
        for (const d of s.disciples) {
          if (taken.has(d.id)) continue;
          /* 弟子阁按阶梯收人；别的机构只看资格 */
          const tier = v.inst === 'dizige' ? this.elderTier(d) : (this.eligible(v.inst, d) ? 1 : 0);
          if (!tier) continue;
          /* 降格任职要扣分：能不降格就不降格 */
          const sc = this.electScore(d).total - (tier - 1) * 180;
          if (sc > bestScore) { bestScore = sc; best = d; }
        }
        const wantRate = (this.stance() === 'strict' ? 0.92 : this.stance() === 'lenient' ? 0.55 : 0.78) * eff;
        if (best && Math.random() < wantRate) {
          const r = this.assignSeat(v.inst, v.i, best.id);
          if (r.ok) {
            this.chronicle('auto', AREA_BY_KEY.seat.log, `${v.name}·${v.seat}`,
              `依${sm.name}之政，阁议推 ${best.name} 补此席（总评 ${Math.round(bestScore)}），未经祖师过目。`);
          }
        }
      }
    }

    /* 二、招揽：阁中零星补人，人数不设限，只受粮秣约束 */
    if (areas.recruit !== false && s.day % 90 === 0 && s.settings.autoRecruit) {
      const want = this.stance() === 'lenient' ? 6 : this.stance() === 'strict' ? 2 : 4;
      if (this.servants().length < want && s.res.liangshi > 240) {
        const d = this.addDisciple('servant');
        if (d) this.chronicle('auto', AREA_BY_KEY.recruit.log, '杂役', `${d.name} 由阁中自行招入，月给口粮，未惊动祖师。`);
      }
    }

    /* 三、疗养：伤者复归由阁中排期，不再逐条请裁 */
    if (areas.heal !== false && s.day % 30 === 0) {
      const healed = s.disciples.filter((d) => d.state === 'injured' && d.injDays <= 0);
      for (const d of healed) d.state = 'cultivate';
      if (healed.length) {
        this.chronicle('auto', AREA_BY_KEY.heal.log, `${healed.length} 人`,
          `${healed.map((d) => d.name).join('、')} 伤愈归队，已复入日常课业。`);
      }
    }

    /* 四、分派：阁中按例派人做任务，不必祖师点名。
       挑的是战力最低的那几个闲人 —— 好苗子留着修炼，跑腿的活轮不到他们。 */
    if (areas.assign !== false && this.modOpen('tasks') && s.day % 90 === 0) {
      if (s.missions.length < 3) {
        const pool = this._idleFormal();
        const tpl = this.missionsAvailable().slice().reverse().find((t) => t.need <= pool.length);
        if (tpl) {
          /* 战力低的先去：按 power 取前 need 个 */
          const pickIds = pool.slice(0, tpl.need).map((d) => d.id);
          const r = this.startMission(tpl.key, pickIds);
          if (r.ok) {
            this.chronicle('auto', AREA_BY_KEY.assign.log, tpl.name,
              `阁中按例派出 ${pickIds.length} 人接【${tpl.name}】，${tpl.days} 日后归来。`);
          }
        }
      }
    }

    /* 五、营建：库房有余才动土，且一次只起一处，免得把家底掏空 */
    if (areas.build !== false && s.day % 180 === 0 && this.stance() !== 'lenient') {
      let best = null, bestLv = 99;
      for (const f of FACILITIES) {
        const lv = s.fac[f.key] || 0;
        if (lv >= f.maxLv) continue;
        const cost = this.buildCost(f.key);
        const afford = Object.entries(cost).every(([k, v]) => (s.res[k] || 0) >= v * 2.4);
        if (afford && lv < bestLv) { bestLv = lv; best = f; }
      }
      if (best) {
        const r = this.build(best.key);
        if (r.ok) {
          this.chronicle('auto', AREA_BY_KEY.build.log, best.name,
            `库房有余，阁中排期营建，${best.name} 升至 ${s.fac[best.key]} 级。`);
        }
      }
    }

    /* 六、转职：晋升无望的老弟子转任执事，腾出修炼位，也给机构添人手 */
    if (areas.turn !== false && s.day % 300 === 0 && this.staff().length < 6) {
      let old = null;
      for (const d of this.formal()) {
        if (d.step < 4 || d.step >= 7) continue;
        if (d.age < 45 || d.gongxian < 30) continue;
        if (!old || d.gongxian > old.gongxian) old = d;
      }
      if (old) {
        const r = this.convert(old.id, 'hufatang');
        if (r.ok) {
          this.chronicle('auto', AREA_BY_KEY.turn.log, old.name,
            `${old.name} 年过四十五、久不进阶，阁中商定转任执事，不再占修炼位。`);
        }
      }
    }

    /* 七、刑赏：门规小过由阁中处置，不用事事请裁。
       手段只到"闭门思过"一级，逐出与处决仍归祖师。 */
    if (areas.punish !== false && s.day % 120 === 0) {
      let worst = null;
      for (const d of this._groups().formal) {
        if (d.demon < 70) continue;
        if (!worst || d.demon > worst.demon) worst = d;
      }
      if (worst) {
        worst.demon = clamp(worst.demon - 12, 0, 100);
        worst.loyalty = clamp(worst.loyalty - 3, 0, 100);
        this.chronicle('auto', AREA_BY_KEY.punish.log, worst.name,
          `${worst.name} 心魔深重，阁中罚其闭门思过，心魔已降，然心中不服。`);
      }
    }
  }

  /* 闲置的正式弟子：战力升序，供阁中按例分派 */
  _idleFormal() {
    const out = [];
    for (const d of this._groups().formal) {
      if (d.state === 'cultivate' && d.step < 9) out.push(d);
    }
    out.sort((a, b) => this.power(a) - this.power(b));
    return out;
  }

  /* 祖师追责：阁中办错了，把这一类政务收回亲裁，阁中声望受损。
   * 撤销的是"以后再这么办"的权力，不是把已经办的事倒回去 —— 事已至此，改不了。 */
  reviewAuto(key) {
    const a = AREA_BY_KEY[key];
    if (!a) return { ok: false, msg: '无此类政务' };
    if (this.policy().areas[key] === false) return { ok: false, msg: `${a.name}已归祖师亲裁` };
    this.setPolicy({ areas: { [key]: false } });
    this.addRenown(-6);
    this.chronicle('review', '祖师追责', a.name,
      `祖师以阁中${a.name}处置失当，收回此权，仍归亲裁。阁中声望受损。`);
    this.msg(`已收回${a.name}之权，改由祖师亲裁。`, 'story');
    return { ok: true, msg: `${a.name}已收回亲裁` };
  }

  _checkStage() {
    const s = this.save;
    const ms = this.maxStep();
    const n = s.disciples.length;
    if (s.sect.stage === 1 && s.layers >= 3 && n >= 10 && s.day >= 900) {
      s.sect.stage = 2;
      this.msg('第一幕终：宗门第一次能自己养活自己。进入【开山】。', 'story');
      this.addRenown(30);
    } else if (s.sect.stage === 2 && s.layers >= 6 && ms >= 5 && s.sect.renown >= 200) {
      s.sect.stage = 3;
      this.msg('第二幕终：开山立制已成。进入【争锋】。', 'story');
      this.addRenown(60);
    } else if (s.sect.stage === 3 && s.layers >= 8 && ms >= 7 && s.sect.renown >= 500) {
      s.sect.stage = 4;
      this.msg('第三幕终：宗门已入大世界的棋盘。进入【问天】。', 'story');
      this.addRenown(100);
    }
  }

  _economy(days) {
    if (!this.modOpen('prod')) return;
    const s = this.save;
    const sv = this.servants().length;
    const st = this.staff().length;
    const fm = this.formal().length;
    const f = s.fac;
    const slow = s.flags.slowUntil && s.day < s.flags.slowUntil ? 0.5 : 1;
    const gong = 1 + (f.gongfang || 0) * 0.3;
    const tian = 1 + (f.lingtian || 0) * 0.28;

    /* 产出：全部由杂役与转职人员承担，正式弟子不事生产 */
    const gross = {
      lingzhi: sv * 0.6 * tian * slow,
      liangshi: sv * 0.5 * tian * slow,
      lingyao: sv * 0.2 * tian * slow,
      danyao: sv * 0.11 * gong * slow,
      lingshi: 2 + sv * 0.34 * gong * slow + fm * 0.06 + st * 0.12,
      qicai: sv * 0.07 * gong * slow + st * 0.02,
      fulu: sv * 0.05 * gong * slow,
      zhenfa: sv * 0.035 * gong * slow,
      yaoshou: sv * 0.012 * slow,
      kuangshi: sv * 0.2 * slow,
    };

    /* 消耗：维持运转 + 高阶弟子修炼供养 + 宗务用度，整体略低于产出 */
    const realmSum = this.formal().reduce((a, d) => a + d.realm, 0)
      + this.staff().reduce((a, d) => a + (d.prevStep || 4) * 2, 0);
    const renownRate = Math.min(0.12, this.renown / 40000);
    /* V1.4：施政策略与法度影响产出（宽纵略低、严苛略高） */
    const prodMul = this.stanceMul().prod * (this.law('curfew') ? 0.97 : 1) * (this.law('bounty') ? 0.98 : 1);
    for (const k of Object.keys(gross)) gross[k] *= prodMul;
    const use = {
      lingzhi: gross.lingzhi * 0.8,
      liangshi: Math.max(gross.liangshi * 0.86, s.disciples.length * 0.16),
      lingyao: gross.lingyao * 0.75,
      danyao: Math.max(gross.danyao * 0.8, fm * 0.03),
      lingshi: gross.lingshi * (0.8 + renownRate) + realmSum * 0.004 + this.heirStipendPerDay(),
      qicai: gross.qicai * 0.72,
      fulu: gross.fulu * 0.72,
      zhenfa: gross.zhenfa * 0.72,
      yaoshou: 0,
      kuangshi: gross.kuangshi * 0.82,
    };

    for (const k of Object.keys(gross)) {
      const net = (gross[k] - (use[k] || 0)) * days;
      s.res[k] = Math.max(0, +((s.res[k] || 0) + net).toFixed(2));
    }

    /* 纳贡 */
    if (s.flags.tribute && s.day % 360 === 0) {
      this.addRes({ lingshi: -Math.min(s.res.lingshi * 0.1, 600) });
    }

    /* 断粮由 _famine() 分三级处置，这里只结算收支 */
  }

  /* ---------- 断粮三级 ----------
   * 一级：供给下调，修炼效率腰斩，还撑得住；
   * 二级：杂役开始下山（他们最先感知粮仓见底）；
   * 三级：正式弟子离开。
   * 为什么分级：一断粮就成批赶人，玩家会觉得是系统在惩罚，而不是自己在经营。
   */
  _famine() {
    const s = this.save;
    if (s.res.liangshi > 0.5) {
      if (s.flags.famine) {
        s.flags.famine = 0;
        delete s.flags.famineDay;
        this.msg('粮仓回满，供给恢复如常。', 'good');
      }
      return;
    }
    s.flags.famineDay = s.flags.famineDay || s.day;
    const held = s.day - s.flags.famineDay;
    let lvl = s.flags.famine || 1;
    /* 一级：先削供给，别急着赶人 */
    s.flags.slowUntil = Math.max(s.flags.slowUntil || 0, s.day + 120);
    if (lvl < 2 && held >= 120) {
      lvl = 2;
      this.msg('粮仓见底逾月，杂役开始有人下山。', 'bad');
    }
    if (lvl < 3 && held >= 240) {
      lvl = 3;
      this.msg('供给断绝太久，正式弟子也留不住了。', 'bad');
    }
    s.flags.famine = lvl;
    /* 一级只削供给，不赶人 —— 刚见底就开始打发弟子，玩家会觉得是系统在撒气 */
    if (lvl < 2) return;
    if (s.day % 60 !== 0 || !s.disciples.length) return;

    const pool = lvl >= 3 ? this.formal() : this.servants();
    if (!pool.length) return;
    const leave = pool.slice(0, lvl >= 3 ? 1 : 2);
    for (const d of leave) {
      s.disciples = s.disciples.filter((x) => x.id !== d.id);
      for (const k of Object.keys(s.posts)) s.posts[k] = s.posts[k].map((x) => (x === d.id ? null : x));
      this.msg(`${d.name} 不告而别。`, 'bad');
      this.chronicle('famine', '断粮', `${d.name} 下山`, `粮秣断绝，${this.stepTitle(d)}${d.name}自行离山。`);
    }
    this._touchDisc();
  }


  _tickJobs() {
    const s = this.save;
    /* 任务 */
    for (const job of s.missions.slice()) {
      if (s.day >= job.endDay) {
        s.missions = s.missions.filter((j) => j.id !== job.id);
        const tpl = MISSION_TEMPLATES.find((t) => t.key === job.tpl);
        const rw = {};
        for (const [k, v] of Object.entries(tpl.reward || {})) {
          if (k === 'gongxian') continue;
          const [a, b] = Array.isArray(v) ? v : [Number(v) || 0, Number(v) || 0];
          rw[k] = ri(a, b);
        }
        this.addRes(rw);
        const gx = tpl.reward.gongxian || 0;
        for (const id of job.dIds) {
          const d = this.byId(id);
          if (d) { d.gongxian += gx; d.state = 'cultivate'; }
        }
        this.msg(`任务【${tpl.name}】完成。`, 'good');
      }
    }
    /* 派遣 */
    for (const job of s.expeditions.slice()) {
      if (s.day >= job.endDay) {
        s.expeditions = s.expeditions.filter((j) => j.id !== job.id);
        const reg = REGIONS.find((r) => r.key === job.region);
        const rw = {};
        for (const [k, v] of Object.entries(reg.res || {})) {
          const [a, b] = Array.isArray(v) ? v : [Number(v) || 0, Number(v) || 0];
          rw[k] = ri(a, b);
        }
        this.addRes(rw);
        this.addRenown(ri(3, 9));
        let lost = 0;
        for (const id of job.dIds) {
          const d = this.byId(id);
          if (!d) continue;
          d.state = 'cultivate';
          if (Math.random() < reg.risk) { d.state = 'injured'; d.injDays = ri(15, 45); lost++; }
        }
        if (reg.key === 'guiyuan' && !s.flags.shard) {
          s.flags.shard = 1;
          this.msg('无归渊深处带回一片道印碎片。', 'story');
          this.addFortune(10);
        }
        this.msg(`派遣【${reg.name}】归来，带回资源${lost ? `，${lost} 人受伤` : ''}。`, lost ? 'bad' : 'good');
      }
    }
  }

  _checkStory() {
    if (!this.modOpen('story')) return;
    const s = this.save;
    for (const node of STORY_NODES) {
      if (s.story.done.includes(node.id) || s.story.pending.includes(node.id)) continue;
      if (node.cond(this)) {
        s.story.pending.push(node.id);
        this.msg(`剧情触发：${node.title}`, 'story');
        this.hooks.onStory && this.hooks.onStory(node.id);
        break; // 一次只推一个，避免连续弹出
      }
    }
  }

  _randomEvent() {
    if (!this.modOpen('story')) return;
    const s = this.save;
    const stage = s.sect.stage;
    const pool = RANDOM_EVENTS.filter((e) => !e.minStage || stage >= e.minStage);
    const tone = s.sect.fortune >= 0 ? 1 : -1;
    const list = pool.map((e) => ({ ...e, w: e.weight * (e.tone === tone ? 1.6 : 0.7) }));
    const ev = weighted(list);
    if (!ev) return;
    s.story.pendingEvt = { key: ev.key };
    this.pendingEvent = ev;
    this.msg(`异动：${ev.name}`, 'story');
    this.hooks.onStory && this.hooks.onStory('__event__');
  }

  /* ---------- 突破 ---------- */
  breakChance(d) {
    const si = this.stepInfo(d.step);
    let base = si.rate ?? 0.9;
    const t = this.techOf(d);
    base += t ? t.break_ : 0;
    base += (this.save.fac.zangjing || 0) * 0.02;
    base += (d.loyalty - 50) / 1000;
    base -= d.demon / 320;
    base += this.stanceMul().break_ + (this.law('curfew') ? 0.01 : 0);
    if (this.save.flags.humanFactor) base += 0.02;
    return clamp(base, 0.05, 0.95);
  }

  _autoBreak(d) {
    if (d.step >= 9) return;
    if (d.step <= 2) { this._promote(d); return; }
    // 第三步起需祖师安排考核：批次选拔或逐个突破，不自动进行
  }

  _promote(d, force = false) {
    this._log('disciple', 'promote', { save: this.save.sect.name, name: d.name, to: d.step + 1, day: this.save.day });
    const s = this.save;
    const si = this.stepInfo(d.step);
    d.step = Math.min(9, d.step + 1);
    const next = STEPS[d.step - 1];
    d.realm = clamp(Math.max(d.realm + 1, next.realmFrom), 1, REALM_MAX);
    d.prog = 0;
    d.state = 'cultivate';
    d.demon = clamp(d.demon + 3 + d.realm * 0.4, 0, 100);
    d.life = Math.max(d.life, baseLife(d) + d.realm * 4);
    s.stats.broke++;
    s.stats.peakStep = Math.max(s.stats.peakStep, d.step);
    if (d.step > this.maxStep()) s.flags.peak = d.step;
    this.msg(`${d.name} 晋升至第${d.step}步·${this.stepInfo(d.step).title}。`, 'good');
    if (d.step === 5) this.addRenown(4);
    if (d.step === 7) this.addRenown(10);
    if (d.step === 8) this.addRenown(20);
  }

  tryBreak(id) {
    const d = this.byId(id);
    if (!d || d.type !== 'formal' || d.state !== 'bottleneck') return { ok: false, msg: '该弟子尚未到达瓶颈' };
    if (d.step >= 8) return { ok: false, msg: '第八步晋第九步只能由祖师指定为亲传' };
    if (d.step === 3) return { ok: false, msg: '第三步晋第四步需通过批次选拔' };
    const chance = this.breakChance(d);
    this.addRes({ danyao: -Math.min(8, this.save.res.danyao || 0) });
    if (Math.random() < chance) {
      this._promote(d);
      return { ok: true, msg: `突破成功，晋升第${d.step}步。` };
    }
    d.prog = Math.max(0, d.prog * 0.45);
    d.demon = clamp(d.demon + 8, 0, 100);
    d.state = 'injured';
    d.injDays = ri(20, 50);
    this.msg(`${d.name} 突破失败，修为倒退，闭关休养。`, 'bad');
    return { ok: false, msg: '突破失败。修为受损，心魔上涌。' };
  }

  /* 宗内选拔（三晋四，批次竞争，最多四成通过） */
  batchExam() {
    const pool = this.formal().filter((d) => d.step === 3 && d.state === 'bottleneck' && d.tries3 < 3);
    if (pool.length === 0) return { ok: false, msg: '当前没有可参加选拔的第三步弟子' };
    pool.sort((a, b) => this.examScore(b) - this.examScore(a));
    const passCount = Math.max(1, Math.floor(pool.length * 0.4));
    const passed = [];
    const failed = [];
    pool.forEach((d, i) => {
      if (i < passCount && Math.random() < 0.92) {
        d.passed4 = true;
        passed.push(d);
        this._promote(d);
      } else {
        d.tries3++;
        d.prog = Math.max(0, d.prog * 0.6);
        d.state = 'cultivate';
        failed.push(d);
      }
    });
    this.msg(`选拔结束：${passed.length} 人升第四步，${failed.length} 人留级。`, passed.length ? 'good' : 'bad');
    return { ok: true, msg: `通过 ${passed.length} 人，落选 ${failed.length} 人。`, passed, failed };
  }
  examScore(d) {
    return this.power(d) * 0.5 + d.gongxian * 2 + (100 - d.demon) * 0.6 + d.loyalty * 0.4 + (d.age - 12) * 0.5;
  }

  /* ---------- 第九步 · 亲传 ----------
   * 第九步不靠自动晋升，只能由祖师亲自册封（STEPS 标了 manual）。
   * 门槛三条：修为已至第八步、天赋够（灵根倍率）、心魔未失控。
   * 名额不设上限 —— 天赋只是门票，册不册封由祖师定；养不养得起是俸禄的事。
   */
  heirMinRoot() { return HEIR.minRoot; }
  heirCap() { return Infinity; }
  heirCount() {
    if (this._heirN == null) {
      let n = 0;
      for (const d of this._groups().formal) if (d.step === 9) n++;
      this._heirN = n;
    }
    return this._heirN;
  }

  /* 在册亲传给全宗的加成：人越多，山门气象越盛 */
  heirBonus() { return 1 + this.heirCount() * HEIR.bonus.gain; }
  /* 亲传俸禄：按年折算到日；政策可关（settings.heirStipend = false） */
  heirStipendPerDay() {
    const n = this.heirCount();
    if (!n || this.save.settings.heirStipend === false) return 0;
    return n * (HEIR.stipend.lingshi || 0) / 360;
  }

  /* ---------- 第九步 · 亲传的四项特权 ----------
   * 传功   —— 把修为渡给后辈，自身降一小境，后辈升一境。亲传的分量在这儿。
   * 代师出征 —— 可单独领队接高难任务，不必凑满人。
   * 镇山   —— 驻守山门时战力 +15%（在 power() 里生效）。
   * 继承   —— 宗主空缺时，由综合分最高的亲传接位。
   */
  canLeadSolo(d) { return !!d && d.step === 9; }

  passOn(fromId, toId) {
    if (!this.modOpen('org')) return { ok: false, msg: '机构模块未开放' };
    const a = this.byId(fromId);
    const b = this.byId(toId);
    if (!a || !b) return { ok: false, msg: '查无此人' };
    if (a.step !== 9) return { ok: false, msg: '只有亲传弟子可以传功' };
    if (a.id === b.id) return { ok: false, msg: '不能传给自己' };
    if (b.type !== 'formal') return { ok: false, msg: '只能传给正式弟子' };
    if (a.realm <= STEPS[8].realmFrom) return { ok: false, msg: '亲传修为已至底线，再传便跌出九步' };
    if (b.realm >= a.realm) return { ok: false, msg: '后辈修为不在其下，无需传功' };
    const before = { a: a.realm, b: b.realm };
    a.realm -= 1;
    a.prog = 0;
    a.life = Math.max(1, a.life - 8);
    a.demon = clamp(a.demon + 5, 0, 100);   // 逆天改命，总要沾点因果
    b.realm = clamp(b.realm + 1, 1, REALM_MAX);
    b.prog = 0;
    b.life = Math.max(b.life, baseLife(b));
    this._touchDisc();
    this.addRenown(5);
    this.chronicle('passon', '亲传传功', `${a.name} → ${b.name}`,
      `${a.name}自降一境（${before.a}→${a.realm}），将修为渡与${b.name}（${before.b}→${b.realm}）。`);
    this.msg(`${a.name} 传功于 ${b.name}：${b.name} 至 ${this.realmInfo(b).name}。`, 'story');
    return { ok: true, msg: `${b.name} 进境至 ${this.realmInfo(b).name}` };
  }

  /* 镇山：亲传驻守山门，战力加成在 power() 里生效 */
  setGuard(id, on) {
    const d = this.byId(id);
    if (!d) return { ok: false, msg: '查无此人' };
    if (d.step !== 9) return { ok: false, msg: '只有亲传可镇山' };
    d.guard = on !== false;
    d.state = d.guard ? 'guard' : 'cultivate';
    this.chronicle('guard', '镇山', d.name, `${d.name}${d.guard ? '受命镇守山门' : '撤去镇山之责'}。`);
    return { ok: true, msg: `${d.name} ${d.guard ? '镇山' : '撤守'}` };
  }

  /* 继承：宗主空缺时，由综合分最高的亲传接位 */
  successor() {
    let best = null, bs = -Infinity;
    for (const d of this._groups().formal) {
      if (d.step !== 9 || d.dead) continue;
      const sc = this.heirScore(d);
      if (sc > bs) { bs = sc; best = d; }
    }
    return best;
  }

  /* 候册排序：门槛看天赋，先后看综合分 */
  heirScore(d) {
    const c = HEIR.score;
    return this.rootOf(d).mul * c.root + this.physOf(d).mul * c.phys
      + Math.min(400, d.gongxian) * c.gongxian + d.loyalty * c.loyalty + (100 - d.demon) * c.mind;
  }

  enshrineCheck(d) {
    if (!d) return { ok: false, why: '查无此人' };
    if (d.type === 'servant') return { ok: false, why: '杂役不入亲传' };
    if (d.type === 'staff') return { ok: false, why: '已转职者不在此列' };
    if (d.step >= 9) return { ok: false, why: '已是亲传' };
    if (d.step < 8) return { ok: false, why: `修为未到第八步（现第${d.step}步）` };
    const r = this.rootOf(d);
    if (r.mul < this.heirMinRoot()) return { ok: false, why: `天赋不足（${r.name}），需双灵根以上` };
    if (d.demon >= HEIR.maxDemon) return { ok: false, why: `心魔 ${Math.round(d.demon)}，先静心` };
    return { ok: true };
  }

  /* 候册名单：所有够格未册者，按综合分排。
   * 名额不设上限，所以没有人是"被名额挡在外面"的，只有没排上的。 */
  heirCandidates() {
    const out = [];
    for (const d of this.formal()) {
      if (this.enshrineCheck(d).ok) out.push({ d, score: this.heirScore(d) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.map((x) => x.d);
  }

  enshrine(id) {
    const d = this.byId(id);
    const chk = this.enshrineCheck(d);
    if (!chk.ok) return { ok: false, msg: chk.why };
    const si = this.stepInfo(d.step);
    d.step = 9;
    d.enshrinedDay = this.save.day;
    d.enshrinedBy = this.save.sect.founder;
    d.realm = clamp(Math.max(d.realm, STEPS[8].realmFrom), 1, REALM_MAX);
    d.prog = 0;
    d.state = 'cultivate';
    d.life = Math.max(d.life, baseLife(d));
    d.loyalty = clamp(d.loyalty + 12, 0, 100);
    if (!d.daohao) d.daohao = genDaohao();
    this._touchDisc();
    this.save.stats.peakStep = Math.max(this.save.stats.peakStep || 1, 9);
    this.addRenown(40);
    this.chronicle('enshrine', '祖师册封', `${d.name} · 亲传`,
      `${si.title}${d.name}（${this.rootOf(d).name}）蒙祖师亲册，列第九步亲传，道号「${d.daohao}」，入弟子阁听事。`);
    this.msg(`祖师册封：${d.name} 为亲传弟子。`, 'story');
    return { ok: true, msg: `${d.name} 已列亲传`, disciple: d };
  }

  /* ---------- 弟子阁 · 阁老 ----------
   * 席位随层数开。人不够就按阶梯降格任职（内门也可以坐阁老席），
   * 连降格的人都凑不出，由祖师一指派人顶上 —— 无论如何不让阁中停摆。
   */
  seatCount(inst) {
    const base = INSTITUTIONS.find((x) => x.key === inst);
    if (inst !== 'dizige') return (base && base.seats ? base.seats.length : 0);
    const layers = this.save.layers || 1;
    return clamp(ELDER.base + Math.floor((layers - 1) / ELDER.perLayers), ELDER.base, ELDER.max);
  }

  seatLabel(inst, i) {
    const base = INSTITUTIONS.find((x) => x.key === inst);
    if (base && base.seats && base.seats[i]) return base.seats[i];
    const cn = '甲乙丙丁戊己庚辛壬癸';
    return `阁老·${cn[i] || i + 1}`;
  }

  _ensureSeats() {
    const s = this.save;
    s.posts.dizige = s.posts.dizige || [];
    const want = this.seatCount('dizige');
    while (s.posts.dizige.length < want) s.posts.dizige.push(null);
    return s.posts.dizige;
  }

  /* 递补阶梯：亲传 > 核心 > 内门（降格） */
  elderTier(d) {
    if (!d || d.type !== 'formal') return 0;
    if (d.step >= 9) return 1;
    if (d.step === 8) return 2;
    if (d.step === 7) return 3;
    return 0;
  }
  elderTierEff(tier) {
    const t = ELDER.tiers[Math.max(0, Math.min(ELDER.tiers.length - 1, tier - 1))];
    return t ? t.eff : 0;
  }

  /* 阁中有主否：至少一名阁老在任 */
  elderQuorum() {
    const seats = this._ensureSeats();
    let filled = 0;
    for (const id of seats) { if (id && this.byId(id)) filled++; }
    return { filled, seats: seats.length, need: ELDER.quorum, ok: filled >= ELDER.quorum };
  }

  /* 阁中办事效率：取在任阁老里最高的那一档。
   * 0 表示阁中无主，此时不是不办事，而是把周期按 ELDER.idleMul 拉长。 */
  elderEfficiency() {
    const seats = this._ensureSeats();
    let best = 0;
    for (const id of seats) {
      const d = id && this.byId(id);
      if (!d) continue;
      best = Math.max(best, this.elderTierEff(this.elderTier(d)));
    }
    return best;
  }

  /* 弟子阁轮值：阁老不终身占席。每 120 日换一席；
   * 无人可换时留任 —— 换届换出个空席，是给自己找麻烦。 */
  rotateElder() {
    const s = this.save;
    if (!this.modOpen('org')) return null;
    const seats = this._ensureSeats();
    const holder = seats.map((id, i) => ({ id, i })).filter((x) => x.id && this.byId(x.id));
    if (!holder.length) return null;
    const pickOne = holder[s.day % holder.length];
    const out = this.byId(pickOne.id);
    const taken = new Set([].concat(s.posts.dizige, s.posts.hufatang, s.posts.zhanglaohui).filter(Boolean));
    let next = null, nextScore = -Infinity;
    for (const d of s.disciples) {
      if (taken.has(d.id)) continue;
      const tier = this.elderTier(d);
      if (!tier) continue;
      /* 降格任职要扣分，免得内门把亲传的席挤走 */
      const sc = this.electScore(d).total - (tier - 1) * 180;
      if (sc > nextScore) { nextScore = sc; next = d; }
    }
    if (!next) return null;
    seats[pickOne.i] = next.id;
    if (out && out.state === 'post') out.state = 'cultivate';
    next.state = 'post';
    this.chronicle('elder', '弟子阁轮值', `${out ? out.name : '空席'} → ${next.name}`,
      `弟子阁${this.seatLabel('dizige', pickOne.i)}一职轮值，${out ? `${out.name}卸任还列，` : ''}${next.name}（${ELDER.tiers[this.elderTier(next) - 1].name}）接任。`);
    return { out, next, seat: pickOne.i };
  }

  /* 保底指派：连降格的人都凑不出时，由祖师点一下，系统挑最合适的顶上。
   * 阁中可以寒酸，但不能没有。 */
  forceQuorum() {
    const seats = this._ensureSeats();
    if (this.elderQuorum().ok) return { ok: false, msg: '阁中已有人在任' };
    const taken = new Set(seats.filter(Boolean));
    let best = null, bestScore = -Infinity;
    for (const d of this.formal()) {
      if (taken.has(d.id)) continue;
      const sc = this.electScore(d).total;
      if (sc > bestScore) { bestScore = sc; best = d; }
    }
    if (!best && this.servants().length) best = this.servants()[0];
    if (!best) return { ok: false, msg: '山中无人可用' };
    let idx = seats.findIndex((x) => !x);
    if (idx < 0) idx = 0;
    seats[idx] = best.id;
    best.state = 'post';
    this.chronicle('force', '祖师指派', `${best.name} · ${this.seatLabel('dizige', idx)}`,
      `阁中久无人主事，祖师亲指${best.name}入阁，权理日常。`);
    this.msg(`祖师指派：${best.name} 入阁主事。`, 'story');
    return { ok: true, msg: `${best.name} 入阁主事` };
  }


  /* 杂役升星 */
  _servantStar(d) {
    if (d.star >= 9) return;
    const next = d.star + 1;
    const needDay = [0, 40, 100, 180, 320, 520, 780, 1100, 1500][next - 1] || 999;
    const needGx = [0, 0, 0, 20, 60, 120, 220, 380, 600][next - 1] || 0;
    if (this.save.day - d.joinedDay < needDay) return;
    if (d.gongxian < needGx) return;
    if (next >= 6 && d.demon > 60) return;
    d.star = next;
    d.gongxian = Math.max(0, d.gongxian - needGx);
    d.realm = clamp(Math.min(d.realm + 1, SERVANT_REALM_CAP), 1, SERVANT_REALM_CAP);
    d.prog = 0;
    d.state = 'cultivate';
    this.msg(`${d.name} 升为 ${d.star} 星杂役。`, 'good');
  }

  /* ---------- 机构 ---------- */
  electScore(d) {
    const power = this.power(d);
    const relAvg = Object.values(d.rel).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(d.rel).length);
    return {
      power, contribution: d.gongxian, mind: 100 - d.demon, loyalty: d.loyalty,
      exp: Math.min(100, (d.age - 12) * 3), record: Math.min(100, d.gongxian * 0.4),
      social: clamp(50 + relAvg * 4, 0, 100), demonPenalty: d.demon,
      total: power * 0.35 + d.gongxian * 1.2 + (100 - d.demon) * 0.5 + d.loyalty * 0.5
        + Math.min(100, (d.age - 12) * 3) * 0.3 + clamp(50 + relAvg * 4, 0, 100) * 0.3,
    };
  }

  /* 席位资格：弟子阁按阶梯收人 —— 亲传、核心先来，凑不满才轮到内门降格任职 */
  eligible(inst, d) {
    if (inst === 'dizige') return this.elderTier(d) > 0;
    const step = d.type === 'staff' ? d.prevStep : d.step;
    return step >= 6 && d.type !== 'servant';
  }

  assignSeat(inst, idx, id) {
    if (!this.modOpen('org')) return { ok: false, msg: '机构模块未开放' };
    const d = this.byId(id);
    if (!d) return { ok: false, msg: '弟子不存在' };
    if (!this.eligible(inst, d)) return { ok: false, msg: '该弟子不满足任职资格' };
    if (inst !== 'dizige' && d.type === 'formal') {
      d.type = 'staff';
      d.prevStep = d.step;
      d.staffInst = inst;
      d.name; // keep
    }
    for (const key of Object.keys(this.save.posts)) {
      this.save.posts[key] = this.save.posts[key].map((x) => (x === id ? null : x));
    }
    /* 席位可能随层数增加过，落座前先补齐数组 */
    const seats = inst === 'dizige' ? this._ensureSeats() : this.save.posts[inst];
    seats[idx] = id;
    d.state = 'post';
    this.msg(`${d.name} 出任${INSTITUTIONS.find((i) => i.key === inst).name}·${this.seatLabel(inst, idx)}。`, 'good');
    return { ok: true, msg: '任命完成' };
  }

  autoElect(inst, idx) {
    const cands = this.save.disciples
      .filter((d) => this.eligible(inst, d) && !this.save.posts.dizige.includes(d.id) && !this.save.posts.hufatang.includes(d.id) && !this.save.posts.zhanglaohui.includes(d.id))
      .map((d) => ({ d, s: this.electScore(d) }))
      .sort((a, b) => b.s.total - a.s.total);
    if (!cands.length) return { ok: false, msg: '暂无满足条件的候选人' };
    const best = cands[0].d;
    const r = this.assignSeat(inst, idx, best.id);
    return { ...r, ranking: cands.slice(0, 5).map((c) => ({ name: c.d.name, total: Math.round(c.s.total), detail: c.s })) };
  }

  vacate(inst, idx) {
    this.save.posts[inst][idx] = null;
  }

  /* 转职 */
  convert(id, inst) {
    const d = this.byId(id);
    if (!d || d.type !== 'formal') return { ok: false, msg: '仅正式弟子可转职' };
    if (d.step < 4) return { ok: false, msg: '第四步以上才可转职' };
    d.type = 'staff';
    d.prevStep = d.step;
    d.staffInst = inst;
    d.state = 'idle';
    this.msg(`${d.name} 脱离弟子身份，转入${INSTITUTIONS.find((i) => i.key === inst).name}。`, 'info');
    return { ok: true, msg: '转职完成' };
  }

  dismiss(id) {
    const d = this.byId(id);
    if (!d) return { ok: false, msg: '弟子不存在' };
    this.save.disciples = this.save.disciples.filter((x) => x.id !== id);
    this._touchDisc();
    for (const k of Object.keys(this.save.posts)) this.save.posts[k] = this.save.posts[k].map((x) => (x === id ? null : x));
    this.save.battle.atk = this.save.battle.atk.filter((x) => x !== id);
    this.save.battle.def = this.save.battle.def.filter((x) => x !== id);
    return { ok: true, msg: `${d.name} 已遣散` };
  }

  setTech(id, key) {
    const d = this.byId(id);
    const t = TECH_BY_KEY[key];
    if (!d || !t) return { ok: false, msg: '无效的功法' };
    if (d.realm < t.door) return { ok: false, msg: `需第 ${t.door} 境方可装配` };
    d.tech = key;
    return { ok: true, msg: `已装配 ${t.name}` };
  }

  /* ---------- 剧情结算 ---------- */
  pendingNode() {
    const id = this.save.story.pending[0];
    return id ? STORY_BY_ID[id] : null;
  }

  resolveStory(nodeId, idx) {
    const node = STORY_BY_ID[nodeId];
    if (!node) return;
    const opt = node.options[idx];
    this.save.story.pending = this.save.story.pending.filter((x) => x !== nodeId);
    this.save.story.done.push(nodeId);
    this.save.story.log.unshift({ id: nodeId, kind: 'story', title: node.title, label: opt.label, result: opt.result, day: this.save.day, by: '祖师' });
    opt.apply(this);
    this._log('story', 'node', { save: this.save.sect.name, node: nodeId, opt: opt.label, day: this.save.day });
    this.msg(`${node.title}：${opt.label}`, 'story');
    this.hooks.onDirty && this.hooks.onDirty();
  }

  resolveEvent(idx) {
    const ev = this.pendingEvent;
    if (!ev) return;
    const opt = ev.options[idx];
    this.applyEffect(opt.effect || {});
    this.save.story.log.unshift({ id: ev.key, kind: 'event', title: ev.name, label: opt.label, result: opt.result, day: this.save.day, by: '祖师' });
    this._log('story', 'event', { save: this.save.sect.name, event: ev.key, opt: opt.label, day: this.save.day });
    this.msg(`${ev.name}：${opt.label}`, 'story');
    this.pendingEvent = null;
    this.save.story.pendingEvt = null;
    this.hooks.onDirty && this.hooks.onDirty();
  }

  applyEffect(e) {
    if (!e) return;
    if (e.res) this.addRes(e.res);
    if (e.fortune) this.addFortune(e.fortune);
    if (e.renown) this.addRenown(e.renown);
    if (e.hurt) this.hurt(e.hurt);
    if (e.loyaltyAll) this.loyaltyAll(e.loyaltyAll);
    if (e.addDisciple) this.addDisciple(e.addDisciple);
    if (e.relation) for (const [k, v] of Object.entries(e.relation)) this.addRelation(k, v);
  }

  /* 供剧情调用的动作 */
  unlockLayer(n) {
    this.save.layers = Math.max(this.save.layers, n);
    if (n >= 3) this.save.flags.veinOpen = true;
    this.msg(`小世界开放至第 ${this.save.layers} 层。`, 'good');
  }
  nextLayerCost() {
    const lv = this.save.layers + 1;
    return { lingshi: 420 * (lv - 1), kuangshi: 80 * (lv - 1), zhenfa: 26 * (lv - 1) };
  }
  openNextLayer() {
    const lv = this.save.layers + 1;
    if (lv > 10) return { ok: false, msg: '已至第十层，其上再无路' };
    const needStep = Math.min(9, lv - 2);
    if ((this.maxStep() || 1) < needStep) return { ok: false, msg: `需第 ${needStep} 步弟子方可承载新层` };
    const cost = this.nextLayerCost();
    for (const [k, v] of Object.entries(cost)) if ((this.save.res[k] || 0) < v) return { ok: false, msg: `${RES_BY_KEY[k].name} 不足` };
    this.addRes(Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, -v])));
    this.unlockLayer(lv);
    return { ok: true, msg: `第 ${lv} 层显形` };
  }
  designateHeir(id) {
    const d = this.byId(id);
    if (!d || d.type !== 'formal') return { ok: false, msg: '仅正式弟子可受此位' };
    if (d.step !== 8) return { ok: false, msg: '需第八步核心弟子方可指定' };
    d.step = 9;
    d.realm = Math.max(d.realm, 18);
    d.prog = 0;
    d.state = 'cultivate';
    this.save.flags.heir = d.name;
    this.msg(`祖师指定 ${d.name} 为亲传弟子，直入第九步。此为全篇唯一的破格晋升。`, 'story');
    return { ok: true, msg: '已指定亲传弟子' };
  }
  clearFailedBatch() {
    const list = this.formal().filter((d) => d.step === 3 && d.tries3 >= 3);
    for (const d of list) this.save.disciples = this.save.disciples.filter((x) => x.id !== d.id);
    this._touchDisc();
  }
  convertFailedBatch() {
    const list = this.formal().filter((d) => d.step === 3 && d.tries3 >= 3);
    for (const d of list) { d.type = 'staff'; d.prevStep = 3; d.staffInst = 'waizong'; }
  }
  grantExtraChance() {
    for (const d of this.formal()) if (d.step === 3) d.tries3 = Math.max(0, d.tries3 - 1);
  }
  punishTraitor(mode) {
    const target = this.formal().filter((d) => d.step >= 6).sort((a, b) => a.loyalty - b.loyalty)[0];
    if (!target) return;
    if (mode === 'arrest') { target.loyalty = 5; target.demon = clamp(target.demon + 20, 0, 100); }
    if (mode === 'exile') { this.save.disciples = this.save.disciples.filter((x) => x.id !== target.id); this._touchDisc(); }
    if (mode === 'interrogate') { target.loyalty = clamp(target.loyalty + 20, 0, 100); }
  }
  promoteToHeir(mode) {
    const pool = this.formal().filter((d) => d.step === 8);
    if (!pool.length) return;
    let chosen;
    if (mode === 'senior') chosen = pool.sort((a, b) => b.age - a.age)[0];
    else if (mode === 'power') chosen = pool.sort((a, b) => this.power(b) - this.power(a))[0];
    else chosen = pool.sort((a, b) => a.demon - b.demon)[0];
    chosen.step = 9;
    chosen.realm = Math.max(chosen.realm, 18);
    chosen.prog = 0;
    chosen.state = 'cultivate';
    this.save.flags.heir = chosen.name;
    this.msg(`祖师指定 ${chosen.name} 为亲传弟子，直入第九步。`, 'story');
  }
  endGame(key) {
    this.save.ended = key;
    this.save.endedDay = this.save.day;
    this.msg(`终局：${ENDINGS[key].name}`, 'story');
  }

  /* ---------- 外交 ---------- */
  dipCooldown(key) {
    const d = (this.save.flags.dip || {})[key] || -9999;
    return Math.max(0, 180 - (this.save.day - d));
  }
  diplomacy(key, mode) {
    const cd = this.dipCooldown(key);
    if (cd > 0) return { ok: false, msg: `该势力使节未归，还需 ${cd} 日` };
    this.save.flags.dip = this.save.flags.dip || {};
    if (mode === 'gift') {
      if ((this.save.res.lingshi || 0) < 300) return { ok: false, msg: '灵石不足 300' };
      if ((this.save.res.qizhen || 0) < 1) return { ok: false, msg: '需一件奇珍异宝作礼' };
      this.addRes({ lingshi: -300, qizhen: -1 });
      this.addRelation(key, 1);
      this.msg(`遣使送礼，${FACTIONS.find((f) => f.key === key).name} 态度转好。`, 'good');
    } else {
      this.addRelation(key, -1);
      this.addRenown(12);
      this.msg(`公开表态，与 ${FACTIONS.find((f) => f.key === key).name} 划清界限。`, 'info');
    }
    this.save.flags.dip[key] = this.save.day;
    return { ok: true, msg: '已遣使' };
  }

  /* ---------- 建筑 ---------- */
  facilityInfo(key) { return FACILITIES.find((f) => f.key === key); }
  buildCost(key) {
    const f = this.facilityInfo(key);
    const lv = (this.save.fac[key] || 0) + 1;
    return f.cost(lv);
  }
  build(key) {
    const f = this.facilityInfo(key);
    const lv = this.save.fac[key] || 0;
    if (lv >= f.maxLv) return { ok: false, msg: '已达最高等级' };
    const cost = this.buildCost(key);
    for (const [k, v] of Object.entries(cost)) if ((this.save.res[k] || 0) < v) return { ok: false, msg: `${RES_BY_KEY[k].name} 不足` };
    this.addRes(Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, -v])));
    this.save.fac[key] = lv + 1;
    if (key === 'lingtian' && this.save.fac.lingtian >= 2) this.unlockLayer(2);
    if (key === 'gongfang' && this.save.fac.gongfang >= 1) this.unlockLayer(3);
    this.msg(`${f.name} 升至 ${lv + 1} 级。`, 'good');
    return { ok: true, msg: '建造完成' };
  }

  /* ---------- 任务与派遣 ---------- */
  missionsAvailable() {
    const lv = this.save.sect.stage;
    return MISSION_TEMPLATES.filter((m) => m.lv <= lv + 1);
  }
  startMission(tplKey, dIds) {
    if (!this.modOpen('tasks')) return { ok: false, msg: '任务模块未开放' };
    const tpl = MISSION_TEMPLATES.find((t) => t.key === tplKey);
    if (!tpl || !dIds.length) return { ok: false, msg: '请选择弟子' };
    if (this.save.missions.length >= 3) return { ok: false, msg: '同时最多进行三件任务' };
    for (const id of dIds) { const d = this.byId(id); if (d) { d.state = 'mission'; d.gongxian += 0; } }
    this.save.missions.push({ id: nextId(), tpl: tplKey, dIds, endDay: this.save.day + tpl.days });
    return { ok: true, msg: `已派出【${tpl.name}】，${tpl.days} 日后归来` };
  }
  startExpedition(regionKey, dIds, items = 0) {
    if (!this.modOpen('world')) return { ok: false, msg: '大世界模块未开放' };
    const reg = REGIONS.find((r) => r.key === regionKey);
    if (!reg || !dIds.length) return { ok: false, msg: '请选择弟子' };
    if (this.save.expeditions.length >= 2) return { ok: false, msg: '同时最多两支派遣队' };
    const need = dIds.map((i) => this.byId(i)).filter((d) => d && (d.step || 0) >= reg.need);
    if (need.length !== dIds.length) return { ok: false, msg: `该区域要求第 ${reg.need} 步以上弟子` };
    for (const id of dIds) { const d = this.byId(id); if (d) d.state = 'expedition'; }
    this.save.expeditions.push({ id: nextId(), region: regionKey, dIds, endDay: this.save.day + reg.days });
    return { ok: true, msg: `已派遣至【${reg.name}】，${reg.days} 日后归来` };
  }

  /* ---------- 对战 ---------- */
  setTeam(kind, ids) {
    const list = ids.filter((id) => { const d = this.byId(id); return d && d.type !== 'servant'; });
    this.save.battle[kind] = list.slice(0, 5);
    return { ok: true, msg: '编队已保存' };
  }
  canChallenge() { return this.modOpen('battle') && this.save.day - this.save.battle.lastChallenge >= 3; }
  challenge(opp) {
    if (!this.modOpen('battle')) return { win: false, closed: true };
    const myPower = this.teamPower(this.save.battle.atk.length ? this.save.battle.atk : null);
    const oppPower = Math.max(30, opp.renown * 1.6 + opp.max_step * 60 + ri(-40, 60));
    this.save.battle.lastChallenge = this.save.day;
    const win = myPower * rnd(0.85, 1.15) > oppPower;
    const report = { day: this.save.day, opp: opp.name, myPower: Math.round(myPower), oppPower: Math.round(oppPower), win };
    if (win) {
      const gain = Math.round(clamp(opp.renown * 0.08, 5, 120));
      this.addRenown(gain);
      this.addRes({ lingshi: ri(80, 260), danyao: ri(5, 20) });
      this.save.stats.wins++;
      report.reward = gain;
      this.msg(`对战【${opp.name}】获胜，声望 +${gain}。`, 'good');
    } else {
      this.addRenown(-Math.round(this.renown * 0.04));
      const loss = Math.round(this.save.res.lingshi * 0.04);
      this.addRes({ lingshi: -loss });
      this.hurt(2);
      this.save.stats.losses++;
      this.msg(`对战【${opp.name}】失利，损失灵石 ${loss}。`, 'bad');
    }
    this._log('battle', win ? 'win' : 'lose', { save: this.save.sect.name, opp: opp.name, my: report.myPower, theirs: report.oppPower, day: this.save.day });
    this.save.battle.reports.unshift(report);
    if (this.save.battle.reports.length > 30) this.save.battle.reports.pop();
    return report;
  }

  /* ---------- 状态摘要 ---------- */
  summary() {
    return {
      sect: this.save.sect.name,
      stage: this.save.sect.stage,
      day: this.save.day,
      year: Math.floor(this.save.day / 360) + 1,
      renown: this.renown,
      fortune: this.save.sect.fortune,
      disciples: this.save.disciples.length,
      formal: this.formal().length,
      servants: this.servants().length,
      maxStep: this.maxStep(),
      layers: this.save.layers,
    };
  }

  pendingCount() {
    return this.save.story.pending.length + (this.pendingEvent ? 1 : 0) + this.save.missions.length * 0;
  }
}

/* ---------- 存档迁移 ---------- */
export function migrate(raw) {
  const save = raw;
  if (!save.v) save.v = 1;
  if (typeof save.day !== 'number') save.day = 0;
  save.sect = save.sect || { name: '破天宗', founder: '祖师', renown: 0, fortune: 0, stage: 1, speed: 1 };
  if (typeof save.sect.speed !== 'number') save.sect.speed = 1;
  if (typeof save.sect.stage !== 'number') save.sect.stage = 1;
  if (typeof save.sect.fortune !== 'number') save.sect.fortune = 0;
  if (typeof save.sect.renown !== 'number') save.sect.renown = 0;
  save.disciples = save.disciples || [];
  save.res = Object.assign(emptyRes(), save.res || {});
  save.flags = save.flags || {};
  save.stats = save.stats || { recruited: 0, broke: 0, wins: 0, losses: 0, peakStep: 1 };
  save.battle = save.battle || { atk: [], def: [], reports: [], lastChallenge: -999 };
  save.settings = save.settings || { autoBreak: true, autoRecruit: true, sound: false };
  save.posts = save.posts || { dizige: [null, null, null], hufatang: [null, null, null], zhanglaohui: [null, null, null] };
  save.story = save.story || { done: [], pending: [], log: [] };
  if (!Array.isArray(save.story.log)) save.story.log = [];
  save.relations = save.relations || { tianshu: 0, xuanyin: 0, shangmeng: 0 };
  save.layers = save.layers || 1;
  /* V1.4 增量：旧档不迁移字段，读取时按缺省值补齐 */
  save.policy = save.policy || {};
  save.policy.stance = ['lenient', 'balanced', 'strict'].includes(save.policy.stance) ? save.policy.stance : 'balanced';
  save.policy.areas = Object.assign(Object.fromEntries(AREAS.map((a) => [a.key, true])), save.policy.areas || {});
  save.policy.recruit = Object.assign({ minRoot: 'fan' }, save.policy.recruit || {});
  save.policy.laws = Object.assign({ morning: true, curfew: false, bounty: false }, save.policy.laws || {});
  save.matterState = Object.assign({ snooze: {}, seen: {}, seenDay: 0 }, save.matterState || {});
  save.news = Array.isArray(save.news) ? save.news : [];
  save.v = VERSION;
  return save;
}

export { STORY_NODES, STORY_BY_ID, ENDINGS, LAYERS, REGIONS, MISSION_TEMPLATES, INSTITUTIONS, FACILITIES, RESOURCES, RES_BY_KEY, TECHNIQUES, SPIRIT_ROOTS, PHYSIQUES, REALMS, STEPS, RANDOM_EVENTS, OFFLINE_CAP_DAYS };
