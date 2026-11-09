/* 破天宗 · 引擎层
 * 所有玩法结算集中在此，UI 只负责渲染与调用。
 */
import {
  VERSION, REALMS, REALM_MAX, SERVANT_REALM_CAP, STEPS, SPIRIT_ROOTS, PHYSIQUES,
  TECHNIQUES, TECH_BY_KEY, RESOURCES, RES_BY_KEY, FACILITIES, INSTITUTIONS, LAYERS,
  REGIONS, MISSION_TEMPLATES, RANDOM_EVENTS, ENDINGS, FACTIONS, SURNAMES, GIVEN_1, GIVEN_2,
  NAMED_BACKGROUNDS, OFFLINE_CAP_DAYS,
} from './config.js';
import { STORY_NODES, STORY_BY_ID } from './story.js';

/* ---------- 小工具 ---------- */
export const rnd = (a, b) => a + Math.random() * (b - a);
export const ri = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function weighted(arr, key = 'w') {
  const total = arr.reduce((s, x) => s + (x[key] ?? 1), 0);
  let r = Math.random() * total;
  for (const x of arr) { r -= (x[key] ?? 1); if (r <= 0) return x; }
  return arr[arr.length - 1];
}
const emptyRes = () => Object.fromEntries(RESOURCES.map((r) => [r.key, 0]));

/* ---------- 姓名 ---------- */
export function genName() {
  const s = pick(SURNAMES);
  return Math.random() < 0.55 ? s + pick(GIVEN_1) + pick(GIVEN_2) : s + pick(GIVEN_1);
}

/* ---------- 弟子工厂 ---------- */
let uid = Date.now() % 100000;
const nextId = () => ++uid;

function makeDisciple(kind) {
  const isNamed = kind === 'named';
  const root = weighted(SPIRIT_ROOTS);
  const phys = weighted(PHYSIQUES);
  let type = kind === 'servant' || kind === 'servant_std' ? 'servant' : 'formal';
  if (kind === 'genius') type = 'formal';
  const realm = type === 'servant' ? ri(1, 3) : ri(4, 5);
  const step = type === 'servant' ? 0 : (realm <= 4 ? 1 : realm <= 6 ? 2 : 3);
  const bg = isNamed ? pick(NAMED_BACKGROUNDS) : null;
  const d = {
    id: nextId(),
    name: genName(),
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
      settings: { autoBreak: true, autoRecruit: true, sound: false },
      createdAt: Date.now(),
      lastTick: Date.now(),
    };
    return new Game(save);
  }

  /* ---------- 基础存取 ---------- */
  get s() { return this.save; }
  realmInfo(d) { return REALMS[clamp(d.realm, 1, REALM_MAX) - 1]; }
  need(d) { return this.realmInfo(d).need; }
  stepInfo(step) { return STEPS[clamp(step, 1, 9) - 1]; }
  stepTitle(d) { return d.type === 'servant' ? `${d.star}星杂役` : this.stepInfo(d.step).title; }
  rootOf(d) { return SPIRIT_ROOTS.find((r) => r.key === d.root) || SPIRIT_ROOTS[0]; }
  physOf(d) { return PHYSIQUES.find((p) => p.key === d.phys) || PHYSIQUES[0]; }
  techOf(d) { return d.tech ? TECH_BY_KEY[d.tech] : null; }
  formal() { return this.save.disciples.filter((d) => d.type === 'formal'); }
  servants() { return this.save.disciples.filter((d) => d.type === 'servant'); }
  staff() { return this.save.disciples.filter((d) => d.type === 'staff'); }
  byId(id) { return this.save.disciples.find((d) => d.id === id); }
  maxStep() { return this.formal().reduce((m, d) => Math.max(m, d.step), 0); }

  /* ---------- 消息 ---------- */
  msg(text, type = 'info') {
    this._msgQueue.push({ text, type, day: this.save.day });
    if (this._msgQueue.length > 40) this._msgQueue.shift();
    this.hooks.onMsg && this.hooks.onMsg(text, type);
  }
  drainMsgs() { const q = this._msgQueue.slice(); this._msgQueue.length = 0; return q; }

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

  /* ---------- 招收 ---------- */
  cap() { return 10 + this.save.layers * 6; }

  addDisciple(kind = 'servant') {
    if (this.save.disciples.length >= this.cap()) return null;
    const d = makeDisciple(kind);
    d.joinedDay = this.save.day;
    this.save.disciples.push(d);
    this.save.stats.recruited++;
    return d;
  }

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
    return base * this.rootOf(d).mul * this.physOf(d).mul * techMul * this.envMul() * dq * slow * (0.9 + REALMS[d.realm - 1].i * 0.02);
  }

  /* ---------- 战力 ---------- */
  power(d) {
    const r = this.realmInfo(d);
    const t = this.techOf(d);
    const stepBonus = 1 + (d.step || 0) * 0.05;
    return Math.round(r.atk * this.rootOf(d).mul * this.physOf(d).mul * (t ? 1 + t.atk : 1) * stepBonus * (1 - d.demon / 400) * (d.type === 'staff' ? 1.1 : 1));
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

    /* 弟子结算 */
    for (const d of s.disciples) {
      // 寿元
      d.age += 1 / 365;
      if (d.age >= d.life) {
        d.dead = true;
        this.msg(`${d.name} 寿元耗尽，坐化于静室。`, 'bad');
      }
      if (d.state === 'injured') {
        d.injDays--;
        if (d.injDays <= 0) d.state = 'cultivate';
        continue;
      }
      // 心魔
      const phys = this.physOf(d);
      d.demon = clamp(d.demon + 0.03 * phys.demon * (1 + d.realm * 0.05) * (this.techOf(d)?.calm ? 1 - this.techOf(d).calm : 1), 0, 100);
      if (d.demon >= 100 && Math.random() < 0.0005) {
        this.msg(`${d.name} 心魔爆发，修为倒退一境。`, 'bad');
        d.realm = Math.max(1, d.realm - 1);
        d.prog = 0;
        d.demon = 60;
      }
      // 修为
      if (d.state !== 'bottleneck') {
        d.prog += this.gainPerDay(d);
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

    /* 自动招收 */
    if (s.settings.autoRecruit && day % 60 === 0) {
      const cap = 6 + this.save.layers * 4;
      if (s.disciples.length < cap && s.res.liangshi > 120) this.addDisciple('servant');
    }

    /* 榜单同步由外部节流调用 */
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
    const use = {
      lingzhi: gross.lingzhi * 0.8,
      liangshi: Math.max(gross.liangshi * 0.86, s.disciples.length * 0.16),
      lingyao: gross.lingyao * 0.75,
      danyao: Math.max(gross.danyao * 0.8, fm * 0.03),
      lingshi: gross.lingshi * (0.8 + renownRate) + realmSum * 0.004,
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

    /* 断粮：弟子开始下山 */
    if (s.res.liangshi <= 0.5 && s.disciples.length && s.day % 150 === 0) {
      this.msg('粮仓见底，弟子开始有人下山。', 'bad');
      const leave = this.servants().slice(0, 2).concat(this.formal().slice(0, 1));
      for (const d of leave) {
        s.disciples = s.disciples.filter((x) => x.id !== d.id);
        this.msg(`${d.name} 不告而别。`, 'bad');
      }
    }

    /* 纳贡 */
    if (s.flags.tribute && s.day % 360 === 0) {
      this.addRes({ lingshi: -Math.min(s.res.lingshi * 0.1, 600) });
    }
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

  eligible(inst, d) {
    if (inst === 'dizige') return d.type === 'formal' && d.step === 9;
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
    this.save.posts[inst][idx] = id;
    d.state = 'post';
    this.msg(`${d.name} 出任${INSTITUTIONS.find((i) => i.key === inst).name}·${INSTITUTIONS.find((i) => i.key === inst).seats[idx]}。`, 'good');
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
    this.save.story.log.unshift({ id: nodeId, title: node.title, label: opt.label, result: opt.result, day: this.save.day });
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
    this.save.story.log.unshift({ id: ev.key, title: ev.name, label: opt.label, result: opt.result, day: this.save.day });
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
    if (mode === 'exile') { this.save.disciples = this.save.disciples.filter((x) => x.id !== target.id); }
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
  save.relations = save.relations || { tianshu: 0, xuanyin: 0, shangmeng: 0 };
  save.layers = save.layers || 1;
  save.v = VERSION;
  return save;
}

export { STORY_NODES, STORY_BY_ID, ENDINGS, LAYERS, REGIONS, MISSION_TEMPLATES, INSTITUTIONS, FACILITIES, RESOURCES, RES_BY_KEY, TECHNIQUES, SPIRIT_ROOTS, PHYSIQUES, REALMS, STEPS, RANDOM_EVENTS, OFFLINE_CAP_DAYS };
