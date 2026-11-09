/* 破天宗 · 待处理与奏疏
 * 事项不落冗余副本：全部由存档状态推导，因此多端看到的待办天然一致。
 * 只有「已读 / 暂缓」这类个人处置状态存在 matterState 里。
 */
import { INSTITUTIONS, RES_BY_KEY, REGIONS, LAYERS, AREAS, AREA_BY_KEY } from './config.js';

const AREA_BY_LOG = Object.fromEntries(AREAS.map((a) => [a.log, a]));
import { STORY_BY_ID } from './story.js';

export const LEVEL = {
  1: { name: '日常', cls: 'lv1', dot: 'daily' },
  2: { name: '重要', cls: 'lv2', dot: 'important' },
  3: { name: '待决', cls: 'lv3', dot: 'decide' },
};

export const BUILDING_NAMES = {
  gate: '山门', city: '破天城', post: '任务堂', pavilion: '破天阁',
  hut: '庐舍', field: '灵田', workshop: '工坊', arena: '演武场',
  library: '藏经阁', dorm: '弟子居', hall: '护法堂', council: '长老会',
  temple: '祖师殿', altar: '问天台',
};

const SNOOZE_DAYS = 45;

/* ---------- 待办推导 ----------
 * 两条铁律：
 * ① 破天阁能办的，不进待办。席位补缺、弟子突破、选拔排期、疗伤归队都是阁中日常，
 *    这里只出一条「已处置·报备」汇总（auto: true），不再逐人逐席地堆到祖师案上。
 * ② 待办条数不能随弟子人数增长。一千名弟子只该有一条汇总，不是一千条。
 * 真正要祖师拍板的只有：剧情、异动、亲传册封、粮荒、外交交恶、山门无人。
 */
export function deriveMatters(g) {
  const s = g.save;
  const out = [];
  const st = s.matterState || {};
  const add = (m) => {
    const until = (st.snooze || {})[m.ref];
    if (until != null && s.day - until < SNOOZE_DAYS) return;
    out.push(m);
  };

  /* 剧情与异动：必须由祖师裁决 */
  (s.story.pending || []).forEach((id) => {
    const n = STORY_BY_ID[id];
    if (!n) return;
    add({
      ref: `story:${id}`, level: 3, kind: 'story', building: 'temple',
      title: n.title, desc: `第${n.act}幕 · 候祖师一言`,
      act: { type: 'story', arg: id },
    });
  });
  if (g.pendingEvent) {
    add({
      ref: `evt:${g.pendingEvent.key}`, level: 3, kind: 'event', building: 'temple',
      title: g.pendingEvent.name, desc: '大世界异动，候祖师一言',
      act: { type: 'event', arg: g.pendingEvent.key },
    });
  }

  /* 亲传候册：第九步唯祖师可定，这是阁中不敢代劳的一件事 */
  const bn = g.formal().filter((d) => d.state === 'bottleneck');
  const ready = [];
  for (const d of bn) {
    if (d.step >= 8 && g.enshrineCheck && g.enshrineCheck(d).ok) ready.push(d);
  }
  if (ready.length) {
    ready.sort((a, b) => g.heirScore(b) - g.heirScore(a));
    const lead = ready[0];
    add({
      ref: 'heir:pool', level: 3, kind: 'heir', building: 'temple',
      title: `${ready.length} 人候册亲传`,
      desc: `首推 ${lead.name}（${g.rootOf(lead).name} · 综合 ${Math.round(g.heirScore(lead))}）`,
      act: { type: 'panel', arg: 'disciples' },
    });
  }

  /* 阁中无主：自治里唯一需要祖师动一下手的事。
   * 阁中不会因此停摆（按旧档慢办），所以这条是"请指个人"，不是"救命"。 */
  const quorum = g.elderQuorum ? g.elderQuorum() : { ok: true };
  if (!quorum.ok) {
    add({
      ref: 'auto:quorum', level: 3, kind: 'quorum', building: 'dorm',
      title: '阁中无人主事',
      desc: '弟子阁空无一人，宗务只按旧档慢办。请祖师指一人入阁。',
      act: { type: 'quorum' },
    });
  }

  /* 粮秣：真正的宗门生死，留 */
  if ((s.res.liangshi || 0) < 200) {
    add({
      ref: 'res:liangshi', level: (s.res.liangshi || 0) < 60 ? 3 : 2, kind: 'res', building: 'field',
      title: '粮仓告急', desc: `存粮 ${Math.round(s.res.liangshi || 0)}，日耗约 ${Math.round(s.disciples.length * 0.16)}`,
      act: { type: 'panel', arg: 'workshop' },
    });
  }

  /* 山门无人：开局指引 */
  if (!s.disciples.length) {
    add({ ref: 'recruit:none', level: 2, kind: 'recruit', building: 'gate', title: '山门无人', desc: '先收第一批弟子', act: { type: 'panel', arg: 'disciples' } });
  }

  /* 势力交恶：要祖师定外交基调 */
  Object.entries(s.relations || {}).forEach(([k, v]) => {
    if (v > -2) return;
    add({
      ref: `dip:${k}`, level: 2, kind: 'dip', building: 'city',
      title: '外部势力交恶', desc: `${(k === 'tianshu' ? '天枢剑宗' : k === 'xuanyin' ? '玄阴教' : '万宝商盟')} 已断往来`,
      act: { type: 'panel', arg: 'world' },
    });
  });

  /* ---------- 以下是阁中已办、只作报备 ---------- */
  const auto = [];
  const vac = [];
  INSTITUTIONS.forEach((inst) => {
    (s.posts[inst.key] || []).forEach((id, i) => { if (!id) vac.push(`${inst.name}·${g.seatLabel(inst.key, i)}`); });
  });
  if (vac.length) {
    auto.push({
      ref: 'auto:seat', level: 1, auto: true, kind: 'seat', building: 'dorm',
      title: `${vac.length} 席待补`,
      desc: `阁议按施政次序推举，${vac[0]} 等已在议`,
      act: { type: 'panel', arg: 'org' },
    });
  }
  const brk = bn.filter((d) => d.step < 8);
  if (brk.length) {
    auto.push({
      ref: 'auto:break', level: 1, auto: true, kind: 'break', building: 'dorm',
      title: `${brk.length} 人修为已满`,
      desc: '阁中已排期，按例推进或留级',
      act: { type: 'panel', arg: 'disciples' },
    });
  }
  const inj = s.disciples.filter((d) => d.state === 'injured');
  if (inj.length) {
    auto.push({
      ref: 'auto:heal', level: 1, auto: true, kind: 'heal', building: 'hut',
      title: `${inj.length} 人闭关疗伤`,
      desc: '阁中已排期，无需过问',
      act: { type: 'panel', arg: 'disciples' },
    });
  }
  /* 阁中自办的其余几类：从宗门史里归拢近 180 日，按事类各出一条。
     一条百件也只占一行 —— 报备的条数同样不能随弟子数增长。 */
  const log = (s.story && s.story.log) || [];
  const since = s.day - 180;
  const bucket = {};
  for (const e of log) {
    if (e.kind !== 'auto' || e.day < since) continue;
    const a = AREA_BY_LOG[e.title];
    /* 补缺与疗养已按当前状态出过一条，不必再从史里数一遍 */
    if (!a || a.key === 'seat' || a.key === 'heal') continue;
    const b = bucket[a.key] || (bucket[a.key] = { a, n: 0, last: null });
    b.n++;
    if (!b.last) b.last = e;
  }
  for (const k of Object.keys(bucket)) {
    const b = bucket[k];
    auto.push({
      ref: `auto:${k}`, level: 1, auto: true, kind: 'auto', area: k, building: 'pavilion',
      title: `${b.a.name} · ${b.n} 件`,
      desc: `最近：${b.last.label} — ${b.last.result}`,
      act: { type: 'panel', arg: 'autonomy' },
    });
  }

  out.push(...auto);

  out.sort((a, b) => (b.auto ? 0 : 1) - (a.auto ? 0 : 1) || b.level - a.level);
  return out;
}

/* 每处建筑的提示等级与数量 */
export function mattersByBuilding(list) {
  const map = {};
  for (const m of list) {
    const cur = map[m.building] || { level: 0, count: 0 };
    cur.level = Math.max(cur.level, m.level);
    cur.count++;
    map[m.building] = cur;
  }
  return map;
}

export function unreadCount(g, list) {
  const st = g.save.matterState || { seen: {} };
  const seen = st.seen || {};
  return list.filter((m) => !seen[m.ref]).length;
}

export function markSeen(g, refs) {
  const s = g.save;
  s.matterState = s.matterState || { snooze: {}, seen: {}, seenDay: 0 };
  for (const r of refs) s.matterState.seen[r] = s.day;
  s.matterState.seenDay = s.day;
  g.hooks.onDirty && g.hooks.onDirty();
}

export function snooze(g, ref) {
  const s = g.save;
  s.matterState = s.matterState || { snooze: {}, seen: {}, seenDay: 0 };
  s.matterState.snooze[ref] = s.day;
  g.hooks.onDirty && g.hooks.onDirty();
}

/* ---------- 施政策略说明 ---------- */
export const STANCES = [
  {
    key: 'lenient', name: '宽纵', motto: '养之以宽，缓其成',
    desc: '招收从宽、课业从缓。弟子忠诚渐长，心魔平缓，但产出与修炼略低。',
    effect: '修炼 −3% · 产出 −6% · 忠诚 +0.02/日 · 心魔 −6%',
  },
  {
    key: 'balanced', name: '均衡', motto: '不宽不苛，循例而行',
    desc: '依常例处置宗务，无明显偏斜。适合不知如何取舍时。',
    effect: '各项无增减，阁议按例补缺',
  },
  {
    key: 'strict', name: '严苛', motto: '以法束人，以功取士',
    desc: '课业加严、役使加派。产出与修炼提升，突破略易，但忠诚缓降、心魔易涨。',
    effect: '修炼 +5% · 产出 +8% · 突破 +1% · 忠诚 −0.02/日 · 心魔 +8%',
  },
];

export const LAWS = [
  { key: 'morning', name: '晨课', desc: '每日卯时课诵，修炼 +4%，弟子略觉辛苦', cost: '无' },
  { key: 'curfew', name: '夜禁', desc: '入夜闭户，心魔增速 −8%，产出 −3%，突破 +1%', cost: '无' },
  { key: 'bounty', name: '厚赏', desc: '以灵石厚赏有功者，产出 −2%，忠诚每月 +2', cost: '无' },
];

/* ---------- 奏疏（祖师殿） ----------
 * 四段式：事由 / 影响 / 三处置（各附后果）/ 附注
 * 只收大事：不出现杂役升星、排产、常规任务。
 */
export function memorials(g) {
  const s = g.save;
  const list = [];
  const fmt = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + '万' : Math.round(n));

  /* 一、剧情 */
  const node = g.pendingNode();
  if (node) {
    list.push({
      ref: `story:${node.id}`, kind: 'story', seal: '急',
      title: node.title, from: `第${node.act}幕 · 山门来报`,
      cause: node.text,
      impact: '悬而不决，宗门气运每日流失；批复后写入宗门史，不可撤销。',
      note: '此事无两全之法。请祖师定夺。',
      options: node.options.map((o, i) => ({
        label: o.label, detail: o.result,
        run: () => { g.resolveStory(node.id, i); return { ok: true, msg: `已批：${o.label}` }; },
      })).concat(node.options.length >= 3 ? [] : [{
        label: '留中不发，从长再议', detail: '不改变当下局势；此事仍压在案上，气运每日流失。',
        run: () => {
          g.save.matterState.snooze[`story:${node.id}`] = g.save.day;
          return { ok: true, msg: '此疏留中' };
        },
      }]),
    });
  }

  /* 二、异动 */
  if (g.pendingEvent) {
    const ev = g.pendingEvent;
    list.push({
      ref: `evt:${ev.key}`, kind: 'event', seal: '异',
      title: ev.name, from: '大世界异动',
      cause: ev.text,
      impact: '置之不理则局势自走，气运与声望随势而变。',
      note: '结果在批复后才完全显露。',
      options: ev.options.map((o, i) => ({
        label: o.label, detail: o.result,
        run: () => { g.resolveEvent(i); return { ok: true, msg: `已批：${o.label}` }; },
      })).concat(ev.options.length >= 3 ? [] : [{
        label: '闭门不理，静观其变', detail: '不表态、不出手；局势自走，后果在事后才见分晓。',
        run: () => {
          g.save.matterState.snooze[`evt:${ev.key}`] = g.save.day;
          return { ok: true, msg: '已命闭门不理' };
        },
      }]),
    });
  }

  /* 三、弟子心魔（取最重者） */
  const worst = g.formal().slice().sort((a, b) => b.demon - a.demon)[0];
  if (worst && worst.demon >= 55) {
    list.push({
      ref: `demon:${worst.id}`, kind: 'demon', seal: '魔',
      title: `${worst.name} 心魔缠身`, from: '弟子居 · 执事禀报',
      cause: `该弟子心魔已至 ${Math.round(worst.demon)}，闭关时屡有异声，同舍者不敢近。修为第${worst.step}步，战力 ${fmt(g.power(worst))}。`,
      impact: '若至满值，轻则修为倒退一境，重则伤及同门。',
      note: `破天阁拟：依${g.stanceMul().name}之政，先静室清修。`,
      options: [
        {
          label: '静室清修，不见外人', detail: '心魔 −18，修为进度 −8%；不耗丹药，需些时日。',
          run: () => { worst.demon = Math.max(0, worst.demon - 18); worst.prog = Math.max(0, worst.prog * 0.92); return { ok: true, msg: `${worst.name} 入静室清修` }; },
        },
        {
          label: '赐丹压制', detail: `耗丹药 40（现存 ${Math.round(s.res.danyao || 0)}），心魔 −32，即刻见效。`,
          disabled: (s.res.danyao || 0) < 40,
          run: () => { g.addRes({ danyao: -40 }); worst.demon = Math.max(0, worst.demon - 32); return { ok: true, msg: `丹药已赐，${worst.name} 心魔大减` }; },
        },
        {
          label: '逐出内门，以净同舍', detail: '该弟子离宗，全宗忠诚 −3，声望 +4（外人视为整肃）。',
          run: () => { const nm = worst.name; g.dismiss(worst.id); g.loyaltyAll(-3); g.addRenown(4); return { ok: true, msg: `${nm} 已被逐出` }; },
        },
      ],
    });
  }

  /* 四、寿元将尽 */
  const old = g.formal().filter((d) => d.life - d.age < 12).sort((a, b) => (a.life - a.age) - (b.life - b.age))[0];
  if (old) {
    list.push({
      ref: `life:${old.id}`, kind: 'life', seal: '寿',
      title: `为 ${old.name} 请延寿`, from: '长老会 · 代呈',
      cause: `该弟子寿元余 ${Math.max(0, old.life - old.age).toFixed(1)} 年，第${old.step}步。近日已不能久立。`,
      impact: '若不处置，坐化后其席位与编队俱空。',
      note: '奇珍异宝可延寿，但宗门存量有限。',
      options: [
        {
          label: '赐奇珍延寿', detail: `耗奇珍 1（现存 ${Math.round(s.res.qizhen || 0)}），寿元 +18 年。`,
          disabled: (s.res.qizhen || 0) < 1,
          run: () => { g.addRes({ qizhen: -1 }); old.life += 18; return { ok: true, msg: `${old.name} 寿元延十八年` }; },
        },
        {
          label: '令其著书传法', detail: '贡献 +30，忠诚 +8；不延寿，但所学留于宗门。',
          run: () => { old.gongxian += 30; old.loyalty = Math.min(100, old.loyalty + 8); return { ok: true, msg: `${old.name} 始著书立说` }; },
        },
        {
          label: '任其坐化', detail: '全宗忠诚 +2（视为仁厚），气运 −1。',
          run: () => { g.loyaltyAll(2); g.addFortune(-1); return { ok: true, msg: '已命人备下后事' }; },
        },
      ],
    });
  }

  /* 五、粮秣 */
  if ((s.res.liangshi || 0) < 200) {
    list.push({
      ref: 'res:liangshi', kind: 'res', seal: '粮',
      title: '粮仓将罄', from: '破天阁 · 急报',
      cause: `库中存粮 ${fmt(s.res.liangshi || 0)}，全宗 ${s.disciples.length} 口，日耗约 ${(s.disciples.length * 0.16).toFixed(1)}。`,
      impact: '断粮则杂役先散，产线停摆，正式弟子亦会下山。',
      note: g.stance() === 'strict' ? '严苛之政下，阁中不敢擅自减口粮。' : '阁中已备三策，请祖师择一。',
      options: [
        {
          label: '出灵石购粮', detail: `耗灵石 400（现存 ${fmt(s.res.lingshi || 0)}），粮 +600。`,
          disabled: (s.res.lingshi || 0) < 400,
          run: () => { g.addRes({ lingshi: -400, liangshi: 600 }); return { ok: true, msg: '粮车已入山门' }; },
        },
        {
          label: '减半口粮，共度此冬', detail: '粮 +200，全宗忠诚 −6。',
          run: () => { g.addRes({ liangshi: 200 }); g.loyaltyAll(-6); return { ok: true, msg: '已命减半支给' }; },
        },
        {
          label: '遣杂役下山就食', detail: '离宗杂役最多 2 人，其余忠诚 +3。',
          run: () => { const two = g.servants().slice(0, 2); for (const d of two) g.dismiss(d.id); g.loyaltyAll(3); return { ok: true, msg: `${two.length} 名杂役下山就食` }; },
        },
      ],
    });
  }

  /* 六、席位空缺 */
  for (const inst of INSTITUTIONS) {
    const i = (s.posts[inst.key] || []).findIndex((x) => !x);
    if (i < 0) continue;
    const cands = g.save.disciples.filter((d) => g.eligible(inst.key, d)
      && !Object.values(g.save.posts).some((arr) => arr.includes(d.id)));
    list.push({
      ref: `vac:${inst.key}:${i}`, kind: 'seat', seal: '缺',
      title: `${inst.name}·${g.seatLabel(inst.key, i)}虚位`, from: `${inst.name} · 合议`,
      cause: `此席空缺已久。合于资格者 ${cands.length} 人${cands.length ? `，以 ${cands[0].name} 总评最高` : ''}。`,
      impact: '席位久空，机构加成不生效，宗务积压。',
      note: '阁议可代推，但祖师亦可另择。',
      options: [
        {
          label: '依阁议推举', detail: cands.length ? `任命 ${cands[0].name}，即刻到任。` : '无人可推，此策不可行。',
          disabled: !cands.length,
          run: () => { const r = g.autoElect(inst.key, i); return { ok: r.ok, msg: r.msg }; },
        },
        {
          label: '祖师亲择', detail: '转至机构席位页，由祖师逐一点选。',
          run: () => ({ ok: true, msg: '已转机构席位', nav: 'org' }),
        },
        {
          label: '悬缺待贤', detail: '全宗忠诚 +3，声望 −3（外议宗中无人）。',
          run: () => { g.loyaltyAll(3); g.addRenown(-3); return { ok: true, msg: '此席暂悬' }; },
        },
      ],
    });
    break;
  }

  /* 七、势力交恶 */
  const bad = Object.entries(s.relations || {}).find(([, v]) => v <= -2);
  if (bad) {
    const [k] = bad;
    const nm = k === 'tianshu' ? '天枢剑宗' : k === 'xuanyin' ? '玄阴教' : '万宝商盟';
    list.push({
      ref: `dip:${k}`, kind: 'dip', seal: '外',
      title: `${nm} 断我往来`, from: '山门 · 使节回报',
      cause: `${nm} 已闭关却使，商路与典籍交换俱停。`,
      impact: '关系再降则边境生衅，派遣风险上升。',
      note: '三策各有代价，无万全之法。',
      options: [
        {
          label: '遣使赔礼', detail: `耗灵石 500（现存 ${fmt(s.res.lingshi || 0)}），关系 +1。`,
          disabled: (s.res.lingshi || 0) < 500,
          run: () => { g.addRes({ lingshi: -500 }); g.addRelation(k, 1); return { ok: true, msg: '使节已出山门' }; },
        },
        {
          label: '强硬回绝', detail: '声望 +15，气运 +2，关系 −1。',
          run: () => { g.addRenown(15); g.addFortune(2); g.addRelation(k, -1); return { ok: true, msg: '已闭门谢客' }; },
        },
        {
          label: '置之不理', detail: '关系 −1，声望 −5。',
          run: () => { g.addRelation(k, -1); g.addRenown(-5); return { ok: true, msg: '未作回应' }; },
        },
      ],
    });
  }

  return list.slice(0, 3);
}

/* 场景浮标：只给两处建筑挂数字，首屏数字总量受控 */
export function floaters(g) {
  const s = g.save;
  const sv = g.servants().length;
  const tian = 1 + (s.fac.lingtian || 0) * 0.28;
  const gong = 1 + (s.fac.gongfang || 0) * 0.3;
  const prod = g.stanceMul().prod;
  return {
    field: { k: '粮', v: '+' + Math.max(0, sv * 0.5 * tian * prod).toFixed(1) },
    workshop: { k: '丹', v: '+' + Math.max(0, sv * 0.11 * gong * prod).toFixed(1) },
  };
}

export function layerName(lv) {
  const l = LAYERS[lv - 1];
  return l ? l.name.split('·')[1] : '';
}
