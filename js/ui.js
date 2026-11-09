/* 破天宗 · 界面层 */
import {
  RESOURCES, RES_BY_KEY, FACILITIES, INSTITUTIONS, LAYERS, REGIONS,
  MISSION_TEMPLATES, TECHNIQUES, ENDINGS, FACTIONS,
} from './config.js';
import { STORY_BY_ID, STORY_NODES } from './story.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => {
  n = Number(n) || 0;
  if (Math.abs(n) >= 100000) return (n / 10000).toFixed(1) + '万';
  return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
};
const STAGE_NAME = { 1: '第一幕 立宗', 2: '第二幕 开山', 3: '第三幕 争锋', 4: '第四幕 问天' };
const STATE_NAME = { cultivate: '修炼中', bottleneck: '瓶颈', injured: '疗伤', mission: '任务中', expedition: '外派', post: '在任', idle: '闲居' };
const REL_NAME = ['敌对', '冷淡', '中立', '友善', '结盟', '同盟'];

export const UI = {
  game: null,
  helpers: null,
  panel: 'overview',
  msgs: [],
  mods: {},
  _storyOpen: false,
  discFilter: { type: 'all', sort: 'power', q: '' },

  mount(game, helpers) {
    this.game = game;
    this.helpers = helpers;
    this.msgs = [];
    this.panel = 'overview';
    if (!this._stageBound) {
      this._stageBound = true;
      document.getElementById('stage').addEventListener('click', (e) => this.onClick(e));
    }
    document.querySelectorAll('.nav-item[data-panel]').forEach((b) => {
      if (b._bound) return;
      b._bound = true;
      b.addEventListener('click', () => {
        this.setPanel(b.dataset.panel);
        this.closeDrawer();
      });
    });
    this.applyModules(helpers.modules || game.mod);
    this.render();
  },

  /* 全服模块开关：关闭的入口隐藏，误入时提示维护中 */
  applyModules(mods) {
    this.mods = mods || {};
    const map = { org: 'org', workshop: 'prod', tasks: 'tasks', world: 'world', battle: 'battle', rank: 'rank' };
    document.querySelectorAll('.nav-item[data-panel]').forEach((b) => {
      const k = map[b.dataset.panel];
      const off = k && this.mods[k] === false;
      b.classList.toggle('hide', !!off);
    });
    const cur = map[this.panel];
    if (cur && this.mods[cur] === false) this.setPanel('overview');
  },

  panelClosed(name) {
    const map = { org: 'org', workshop: 'prod', tasks: 'tasks', world: 'world', battle: 'battle', rank: 'rank' };
    const k = map[name];
    return !!(k && this.mods[k] === false);
  },

  setPanel(name) {
    if (this.panelClosed(name)) {
      this.toast('该模块维护中，暂未开放');
      return;
    }
    this.panel = name;
    document.querySelectorAll('.nav-item[data-panel]').forEach((b) => b.classList.toggle('is-on', b.dataset.panel === name));
    this.renderPanel();
    document.getElementById('stage').scrollTop = 0;
  },

  closeDrawer() {
    const d = document.getElementById('sidenav');
    const m = document.getElementById('drawerMask');
    if (d) d.classList.remove('open');
    if (m) m.classList.remove('on');
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
    this.renderMsgs();
  },

  renderMsgs() {
    const ul = document.getElementById('msgList');
    if (!ul) return;
    ul.innerHTML = this.msgs.length
      ? this.msgs.map((m) => `<li class="${m.type}">${esc(m.text)}<span class="d">开宗 ${Math.floor(m.day / 360) + 1} 年 · 第 ${m.day % 360} 日</span></li>`).join('')
      : '<li class="empty" style="border:0;background:none">暂无消息</li>';
  },

  /* ---------- 顶栏 ---------- */
  renderTop() {
    const g = this.game; const s = g.save;
    document.getElementById('hSect').textContent = s.sect.name;
    document.getElementById('hFounder').textContent = '祖师 · ' + s.sect.founder;
    document.getElementById('hStage').textContent = STAGE_NAME[s.sect.stage].split(' ')[0];
    document.getElementById('hRenown').textContent = fmt(g.renown);
    document.getElementById('hFortune').textContent = (s.sect.fortune >= 0 ? '+' : '') + Math.round(s.sect.fortune);
    document.getElementById('hDisc').textContent = `弟子 ${s.disciples.length}`;
    document.getElementById('hDate').textContent = `开宗 ${Math.floor(s.day / 360) + 1} 年`;
    document.querySelectorAll('#speedBox button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s.sect.speed));
  },

  render() {
    this.renderTop();
    this.renderPanel();
    this.renderMsgs();
  },

  renderPanel() {
    const stage = document.getElementById('stage');
    if (!stage || !this.game) return;
    const map = {
      overview: () => this.pOverview(), disciples: () => this.pDisciples(), org: () => this.pOrg(),
      workshop: () => this.pWorkshop(), tasks: () => this.pTasks(), world: () => this.pWorld(),
      battle: () => this.pBattle(), rank: () => this.pRank(), chronicle: () => this.pChronicle(),
      settings: () => this.pSettings(),
    };
    stage.innerHTML = (map[this.panel] || map.overview)();
  },

  /* ---------- 总览 ---------- */
  pOverview() {
    const g = this.game; const s = g.save;
    const todo = [];
    const node = g.pendingNode();
    if (node) todo.push({ t: `待决剧情：${node.title}`, act: `story:open`, arg: node.id });
    if (g.pendingEvent) todo.push({ t: `异动：${g.pendingEvent.name}`, act: `evt:open`, arg: '' });
    const bn = g.formal().filter((d) => d.state === 'bottleneck');
    if (bn.length) todo.push({ t: `${bn.length} 名弟子修为已满，等待突破`, act: 'panel', arg: 'disciples' });
    const vac = this.vacancies();
    if (vac.length) todo.push({ t: `${vac.length} 个席位空缺`, act: 'panel', arg: 'org' });
    s.expeditions.forEach((x) => todo.push({ t: `派遣中：${REGIONS.find((r) => r.key === x.region).name}（剩 ${Math.max(0, x.endDay - s.day)} 日）`, act: 'panel', arg: 'tasks' }));
    s.missions.forEach((x) => todo.push({ t: `任务中：${MISSION_TEMPLATES.find((m) => m.key === x.tpl).name}（剩 ${Math.max(0, x.endDay - s.day)} 日）`, act: 'panel', arg: 'tasks' }));
    if (s.res.liangshi < 150) todo.push({ t: '粮仓告急，考虑派遣或减少口粮', act: 'panel', arg: 'workshop' });

    return `
    <div class="stack">
      <div class="panel-head">
        <h2>${esc(s.sect.name)} · 宗门总览</h2>
        <p>${STAGE_NAME[s.sect.stage]} · 开宗第 ${Math.floor(s.day / 360) + 1} 年 · 小世界已启 ${s.layers} 层</p>
      </div>

      <div class="metrics">
        ${this.metric('正式弟子', g.formal().length, '人')}
        ${this.metric('杂役', g.servants().length, '人')}
        ${this.metric('杂役以上职员', g.staff().length, '人')}
        ${this.metric('最高步数', g.maxStep() || 0, '步')}
        ${this.metric('宗门声望', fmt(g.renown), '')}
        ${this.metric('气运', (s.sect.fortune >= 0 ? '+' : '') + Math.round(s.sect.fortune), '')}
      </div>

      <div class="grid g2">
        <div class="card">
          <div class="card-head"><div class="t"><h3>待处理</h3><small>回来就知道该做什么</small></div><span class="pill">${todo.length}</span></div>
          ${todo.length ? `<div class="list">${todo.slice(0, 8).map((x, i) => `
            <div class="item"><div class="main"><div class="name" style="font-size:13px">${esc(x.t)}</div></div>
            <div class="act"><button class="btn sm" data-act="${x.act}" data-arg="${esc(x.arg)}">前往</button></div></div>`).join('')}</div>`
        : '<div class="empty"><strong>诸事已毕</strong>弟子在修炼，山门很安静。</div>'}
        </div>

        <div class="card">
          <div class="card-head"><div class="t"><h3>宗门近况</h3></div></div>
          <div class="stack" style="gap:10px">
            <div class="spread"><span class="sub">修行环境</span><b>×${g.envMul().toFixed(2)}</b></div>
            <div class="spread"><span class="sub">全宗战力</span><b>${fmt(g.teamPower())}</b></div>
            <div class="spread"><span class="sub">每日粮耗</span><b>${fmt(s.disciples.length * 0.34 + g.staff().length * 0.2)}</b></div>
            <div class="spread"><span class="sub">库中灵石</span><b>${fmt(s.res.lingshi)}</b></div>
            <div class="spread"><span class="sub">库中粮食</span><b>${fmt(s.res.liangshi)}</b></div>
            <div class="spread"><span class="sub">已决剧情</span><b>${s.story.done.length} / ${STORY_NODES.length}</b></div>
          </div>
          <div class="row" style="margin-top:14px;flex-wrap:wrap">
            <button class="btn primary" data-act="recruit" data-arg="servant">招收杂役</button>
            <button class="btn" data-act="recruit" data-arg="formal">招收正式弟子</button>
            <button class="btn ghost" data-act="exam">举行宗内选拔</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>宗门纪事</h3><small>最近二十条</small></div><button class="btn sm ghost" data-act="panel" data-arg="chronicle">查看全部</button></div>
        <div class="list">
          ${(s.story.log || []).slice(0, 4).map((l) => `
            <div class="item"><div class="main"><div class="name" style="font-size:13px">${esc(l.title)} · ${esc(l.label)}</div>
            <div class="meta">${esc(l.result)}</div></div></div>`).join('') || '<div class="empty">尚未有决断被写入宗门史。</div>'}
        </div>
      </div>
    </div>`;
  },

  metric(k, v, unit) {
    return `<div class="metric"><div class="k">${k}</div><div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
  },

  vacancies() {
    const s = this.game.save; const out = [];
    for (const inst of INSTITUTIONS) s.posts[inst.key].forEach((id, i) => { if (!id) out.push({ inst: inst.key, i }); });
    return out;
  },

  /* ---------- 弟子 ---------- */
  pDisciples() {
    const g = this.game;
    let list = g.save.disciples.slice();
    const f = this.discFilter;
    if (f.type === 'formal') list = list.filter((d) => d.type === 'formal');
    if (f.type === 'servant') list = list.filter((d) => d.type === 'servant');
    if (f.type === 'staff') list = list.filter((d) => d.type === 'staff');
    if (f.type === 'break') list = list.filter((d) => d.state === 'bottleneck');
    if (f.q) list = list.filter((d) => d.name.includes(f.q));
    const sorters = {
      power: (a, b) => g.power(b) - g.power(a),
      step: (a, b) => (b.step || 0) - (a.step || 0) || b.star - a.star,
      life: (a, b) => (b.life - b.age) - (a.life - a.age),
      join: (a, b) => b.joinedDay - a.joinedDay,
      demon: (a, b) => b.demon - a.demon,
    };
    list.sort(sorters[f.sort] || sorters.power);

    return `
    <div class="stack">
      <div class="panel-head"><h2>弟子名录</h2><p>共 ${g.save.disciples.length} 人 · 正式 ${g.formal().length} · 杂役 ${g.servants().length} · 转职 ${g.staff().length}</p></div>
      <div class="card tight">
        <div class="row" style="flex-wrap:wrap">
          ${[['all', '全部'], ['formal', '正式弟子'], ['servant', '杂役'], ['staff', '已转职'], ['break', '待突破']]
        .map(([k, n]) => `<button class="btn sm ${f.type === k ? 'primary' : ''}" data-act="filter" data-arg="type:${k}">${n}</button>`).join('')}
          <span style="flex:1"></span>
          ${[['power', '战力'], ['step', '步数'], ['life', '寿元'], ['demon', '心魔'], ['join', '入门']]
        .map(([k, n]) => `<button class="btn sm ${f.sort === k ? 'ghost' : ''}" data-act="filter" data-arg="sort:${k}">${n}</button>`).join('')}
        </div>
      </div>
      ${list.length ? `<div class="grid g2">${list.slice(0, 80).map((d) => this.discCard(d)).join('')}</div>` : '<div class="card empty"><strong>还没有弟子</strong>去招收第一批人吧。</div>'}
      ${list.length > 80 ? `<p class="hint center">仅显示前 80 人</p>` : ''}
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
    const head = `第${g.maxStep() || 0}步为当前最高。护法堂与长老会席位需已转职的第六步以上者；弟子阁席位需亲传弟子（第九步）。`;
    const blocks = INSTITUTIONS.map((inst) => {
      const seats = s.posts[inst.key];
      return `
      <div class="card">
        <div class="card-head"><div class="t"><h3>${inst.name}</h3><small>${inst.key === 'dizige' ? '亲传弟子保留弟子身份，为全宗唯一例外' : '任职即脱离弟子身份'}</small></div></div>
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
      <div class="panel-head"><h2>机构席位</h2><p>${head}</p></div>
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
    const gong = 1 + (s.fac.gongfang || 0) * 0.3;
    const tian = 1 + (s.fac.lingtian || 0) * 0.28;
    const rates = [
      ['灵植', sv * 0.55 * tian], ['粮食', sv * 0.62 * tian], ['灵药', sv * 0.14 * tian],
      ['丹药', sv * 0.10 * gong], ['灵石', sv * 0.22 * gong], ['炼器材料', sv * 0.06 * gong],
    ];
    return `<div class="stack">
      <div class="panel-head"><h2>资源与工坊</h2><p>正式弟子不参与任何产线；生产由杂役、弟子阁与长老会转职人员承担。</p></div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>库房</h3><small>近两日净变化</small></div></div>
        <div class="res-grid">
          ${RESOURCES.map((r) => `<div class="res"><div class="k">${r.name}</div><div class="v">${fmt(s.res[r.key] || 0)}</div><div class="d">${r.desc}</div></div>`).join('')}
        </div>
      </div>

      <div class="grid g2">
        <div class="card">
          <div class="card-head"><div class="t"><h3>工坊产线</h3><small>每日产出</small></div></div>
          <div class="list">
            ${rates.map(([k, v]) => `<div class="spread" style="padding:6px 0;border-bottom:1px dashed var(--line)"><span class="sub">${k}</span><b>+${fmt(v)} / 日</b></div>`).join('')}
          </div>
          <p class="hint" style="margin-top:10px">在岗杂役 ${sv} 人；灵田 ${s.fac.lingtian || 0} 级，工坊 ${s.fac.gongfang || 0} 级。</p>
        </div>

        <div class="card">
          <div class="card-head"><div class="t"><h3>营建</h3><small>消耗资源提升宗门基建</small></div></div>
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
      </div>
    </div>`;
  },

  /* ---------- 任务与派遣 ---------- */
  pTasks() {
    const g = this.game; const s = g.save;
    const avail = g.missionsAvailable();
    return `<div class="stack">
      <div class="panel-head"><h2>任务与派遣</h2><p>正式弟子可承任务与派遣；杂役只在小世界内劳作。</p></div>

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
        <div class="card-head"><div class="t"><h3>任务大厅</h3><small>按等级分层</small></div></div>
        <div class="list">
          ${avail.map((m) => `
            <div class="item"><div class="main"><div class="name">${m.name} <span class="pill mute">${m.lv} 级</span></div>
            <div class="meta"><span>${m.desc}</span><span>耗时 ${m.days} 日</span><span>要求第 ${m.need} 步</span>
            <span>奖励 ${Object.entries(m.reward).map(([k, v]) => k === 'gongxian' ? `贡献 ${v}` : `${RES_BY_KEY[k].name} ${v[0]}-${v[1]}`).join(' · ')}</span></div></div>
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
      <div class="panel-head"><h2>大世界</h2><p>云荒东南一片，三家势力互为制衡；宗门位置关键，三方都会来敲门。</p></div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>小世界分层</h3><small>已启 ${s.layers} / 10 层</small></div>
          <button class="btn sm primary" data-act="layer:open">开辟第 ${Math.min(10, s.layers + 1)} 层</button></div>
        <p class="hint" style="margin-bottom:8px">开辟下一层需 ${Object.entries(g.nextLayerCost()).map(([k, v]) => `${RES_BY_KEY[k].name} ${v}`).join(' · ')}；层位越高，可容纳弟子越多、灵气越浓。</p>
        <div class="list">
          ${LAYERS.map((l) => {
      const on = l.lv <= s.layers;
      return `<div class="item" style="${on ? '' : 'opacity:.45'}"><div class="main"><div class="name">${l.name} ${on ? '<span class="pill jade">已启</span>' : '<span class="pill mute">混沌</span>'}</div>
            <div class="meta">${l.desc}</div></div></div>`;
    }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>三方势力</h3><small>关系分为敌对 / 冷淡 / 中立 / 友善 / 结盟</small></div></div>
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
        <div class="card-head"><div class="t"><h3>道印</h3></div></div>
        <div class="kv" style="font-size:12px">
          <span>已回收碎片 <b>${s.flags.shard || 0} / 3</b></span>
          <span>终局路径 <b>${s.flags.finalPath ? ({ search: '搜寻第三片', cast: '以宗门之力补铸', shell: '补出一个空壳', mortal: '不再追问' }[s.flags.finalPath] || s.flags.finalPath) : '未定'}</b></span>
        </div>
        <p class="hint" style="margin-top:8px">道印只有三分之一完整，印面纹路断断续续。它让这片土地被天地承认，也记录着宗门气运。</p>
      </div>
    </div>`;
  },

  /* ---------- 对战 ---------- */
  pBattle() {
    const g = this.game; const s = g.save;
    const pool = s.disciples.filter((d) => d.type !== 'servant');
    const atk = s.battle.atk; const def = s.battle.def;
    const list = this.helpers.opponents || [];
    return `<div class="stack">
      <div class="panel-head"><h2>宗门对战</h2><p>必须双方同意才开战。对方同意后由服务端结算，客户端只做过程演示。</p></div>

      <div class="grid g2">
        <div class="card">
          <div class="card-head"><div class="t"><h3>进攻编队</h3><small>${atk.length}/5</small></div><button class="btn sm ghost" data-act="team:atk">设置</button></div>
          <div class="list">${atk.length ? atk.map((id) => { const d = g.byId(id); return d ? `<div class="item"><div class="main"><div class="name">${esc(d.name)}</div><div class="meta">第${d.step || 0}步 · 战力 ${fmt(g.power(d))}</div></div></div>` : ''; }).join('') : '<div class="empty">尚未设置进攻编队</div>'}</div>
          <p class="hint" style="margin-top:8px">编队总战力 ${fmt(g.teamPower(atk))}</p>
        </div>
        <div class="card">
          <div class="card-head"><div class="t"><h3>防守编队</h3><small>${def.length}/5</small></div><button class="btn sm ghost" data-act="team:def">设置</button></div>
          <div class="list">${def.length ? def.map((id) => { const d = g.byId(id); return d ? `<div class="item"><div class="main"><div class="name">${esc(d.name)}</div><div class="meta">第${d.step || 0}步 · 战力 ${fmt(g.power(d))}</div></div></div>` : ''; }).join('') : '<div class="empty">尚未设置防守编队</div>'}</div>
          <p class="hint" style="margin-top:8px">护法堂人员在防守时优先出场。</p>
        </div>
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
            <div class="meta"><span>我方战力 ${r.myPower}</span><span>对方 ${r.oppPower}</span><span>开宗 ${Math.floor(r.day / 360) + 1} 年</span>${r.reward ? `<span>声望 +${r.reward}</span>` : ''}</div></div></div>`).join('')
        : '<div class="empty">尚无战报。</div>'}
        </div>
      </div>
    </div>`;
  },

  /* ---------- 榜单 ---------- */
  pRank() {
    const list = this.helpers.ranking || [];
    return `<div class="stack">
      <div class="panel-head"><h2>赛季榜单</h2><p>全服每小时刷新一次。只展示公开字段，不提供查看他人宗门内部的入口。</p></div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>赛季 · 声望排序</h3></div><button class="btn sm" data-act="rank:refresh">刷新</button></div>
        ${list.length ? `<div class="list">${list.map((r, i) => `
          <div class="item"><div style="width:26px;font-family:var(--f-head);color:var(--ink-3)">${i + 1}</div>
          <div class="main"><div class="name">${esc(r.sect_name)}</div>
          <div class="meta"><span>祖师 ${esc(r.founder_name || '—')}</span><span>声望 ${r.renown}</span><span>最高 ${r.max_step} 步</span><span>弟子 ${r.disciple_count}</span></div></div></div>`).join('')}</div>`
        : '<div class="empty"><strong>榜单为空</strong>还没有宗门留下姓名。</div>'}
      </div>
    </div>`;
  },

  /* ---------- 宗门史 ---------- */
  pChronicle() {
    const s = this.game.save;
    return `<div class="stack">
      <div class="panel-head"><h2>宗门史</h2><p>已写入 ${s.story.done.length} / ${STORY_NODES.length} 个关键节点。已结算的选择不可撤销。</p></div>
      ${s.ended ? `<div class="card" style="border-color:var(--seal)"><div class="card-head"><div class="t"><h3>终局 · ${ENDINGS[s.ended].name}</h3></div></div><p>${ENDINGS[s.ended].text}</p></div>` : ''}
      <div class="card">
        <div class="list">
          ${s.story.log.length ? s.story.log.map((l) => `
            <div class="item"><div class="main"><div class="name">${esc(l.title)} <span class="pill mute">${esc(l.label)}</span></div>
            <div class="meta">${esc(l.result)}</div>
            <div class="meta">开宗 ${Math.floor(l.day / 360) + 1} 年 · 第 ${l.day % 360} 日</div></div></div>`).join('')
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
    return `<div class="stack">
      <div class="panel-head"><h2>设置</h2><p>界面偏好只保存在本地；时间流速属于存档级设置，跨端同步。</p></div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>自动化</h3></div></div>
        <div class="list">
          <div class="item"><div class="main"><div class="name">自动突破</div><div class="meta">修为满后由弟子自行尝试（成功率较低）</div></div>
            <div class="act"><button class="btn sm ${s.settings.autoBreak ? 'primary' : ''}" data-act="toggle" data-arg="autoBreak">${s.settings.autoBreak ? '已开' : '已关'}</button></div></div>
          <div class="item"><div class="main"><div class="name">自动招收</div><div class="meta">每六十日自动收一名杂役，需有存粮</div></div>
            <div class="act"><button class="btn sm ${s.settings.autoRecruit ? 'primary' : ''}" data-act="toggle" data-arg="autoRecruit">${s.settings.autoRecruit ? '已开' : '已关'}</button></div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>存档</h3></div></div>
        <div class="kv" style="font-size:12px">
          <span>槽位 <b>${s.slot + 1}</b></span><span>数据版本 <b>v${s.v}</b></span>
          <span>修订号 <b>${s.revision}</b></span><span>开宗 <b>${Math.floor(s.day / 360) + 1} 年</b></span>
        </div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap">
          <button class="btn primary" data-act="save:now">立即保存到云端</button>
          <button class="btn ghost" data-act="panel" data-arg="slots">切换存档</button>
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
      <div class="card">
        <div class="card-head"><div class="t"><h3>关于</h3></div></div>
        <p class="hint">《破天宗》网页版 · 依据《破天宗修仙模拟器游戏设计开发文档 V1.3》实现。<br>
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
    switch (act) {
      case 'panel': this.setPanel(arg); break;
      case 'filter': {
        const [k, v] = arg.split(':');
        this.discFilter[k] = v; this.renderPanel(); break;
      }
      case 'story:open': this.openStory(arg); break;
      case 'evt:open': this.openEvent(); break;
      case 'recruit': this.helpers.recruit(arg); break;
      case 'exam': {
        const r = g.batchExam();
        this.toast(r.msg); this.render(); if (this.helpers.autoSave) this.helpers.autoSave();
        break;
      }
      case 'disc:detail': this.openDisciple(Number(arg)); break;
      case 'disc:break': {
        const r = g.tryBreak(Number(arg));
        this.toast(r.msg); this.render(); this.helpers.autoSave && this.helpers.autoSave();
        break;
      }
      case 'disc:convert': this.openConvert(Number(arg)); break;
      case 'disc:back': {
        const d = g.byId(Number(arg));
        if (d) { d.type = 'formal'; d.step = d.prevStep || 4; d.state = 'cultivate'; d.staffInst = null; }
        this.render(); this.helpers.autoSave && this.helpers.autoSave(); break;
      }
      case 'build': {
        const r = g.build(arg); this.toast(r.msg); this.render(); this.helpers.autoSave && this.helpers.autoSave(); break;
      }
      case 'seat:elect': {
        const [inst, i] = arg.split(':');
        const r = g.autoElect(inst, i);
        this.toast(r.msg);
        if (r.ranking) this.openElectResult(inst, r.ranking);
        this.render(); this.helpers.autoSave && this.helpers.autoSave();
        break;
      }
      case 'seat:assign': {
        const [inst, i] = arg.split(':');
        this.openAssign(inst, Number(i)); break;
      }
      case 'seat:vacate': {
        const [inst, i] = arg.split(':');
        const id = g.save.posts[inst][Number(i)];
        g.vacate(inst, Number(i));
        const d = g.byId(id);
        if (d && d.type === 'staff') d.state = 'idle';
        this.toast('已卸任'); this.render(); this.helpers.autoSave && this.helpers.autoSave(); break;
      }
      case 'mission:start': this.openMission(arg); break;
      case 'exp:start': this.openExpedition(arg); break;
      case 'team:atk': this.openTeam('atk'); break;
      case 'team:def': this.openTeam('def'); break;
      case 'battle:go': this.helpers.battle(arg); break;
      case 'rank:refresh': this.helpers.refreshRank(); break;
      case 'toggle': {
        g.save.settings[arg] = !g.save.settings[arg]; this.render(); this.helpers.autoSave && this.helpers.autoSave(); break;
      }
      case 'save:now': this.helpers.forceSave(); break;
      case 'signout': this.helpers.signOut(); break;
      case 'passwd': this.helpers.changePass && this.helpers.changePass(); break;
      case 'sessions': this.helpers.sessions && this.helpers.sessions(); break;
      case 'admin': this.helpers.openAdmin && this.helpers.openAdmin(); break;
      case 'dip:gift': { const r = g.diplomacy(arg, 'gift'); this.toast(r.msg); this.render(); this.helpers.autoSave && this.helpers.autoSave(); break; }
      case 'dip:press': { const r = g.diplomacy(arg, 'press'); this.toast(r.msg); this.render(); this.helpers.autoSave && this.helpers.autoSave(); break; }
      case 'layer:open': { const r = g.openNextLayer(); this.toast(r.msg); this.render(); this.helpers.autoSave && this.helpers.autoSave(); break; }
      case 'disc:heir': { const r = g.designateHeir(Number(arg)); this.toast(r.msg); this.render(); this.helpers.autoSave && this.helpers.autoSave(); break; }
      default: break;
    }
  },

  /* ---------- 弹窗基础 ---------- */
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

  /* ---------- 剧情 ---------- */
  openStory(nodeId) {
    const node = STORY_BY_ID[nodeId];
    if (!node) return;
    const g = this.game;
    this.modal({
      title: node.title,
      sub: `第${node.act}幕 · 开宗 ${Math.floor(g.save.day / 360) + 1} 年`,
      body: `<div class="story-text">${esc(node.text)}</div>
        ${node.options.map((o, i) => `<button class="opt" data-oi="${i}">${esc(o.label)}</button>`).join('')}`,
      actions: [{ label: '暂不处理', cls: 'ghost', onClick: (close) => { g.save.story.pending.push(nodeId); close(); this.render(); } }],
      onMount: (root, close) => {
        root.querySelectorAll('[data-oi]').forEach((b) => b.addEventListener('click', () => {
          const idx = Number(b.dataset.oi);
          g.resolveStory(nodeId, idx);
          close();
          const opt = node.options[idx];
          this.modal({
            title: node.title,
            sub: '其结果已写入宗门史',
            body: `<div class="story-text">${esc(opt.result)}</div>`,
            actions: [{ label: '记下了', cls: 'primary', onClick: (c2) => c2() }],
          });
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
        ${ev.options.map((o, i) => `<button class="opt" data-oi="${i}">${esc(o.label)}<span class="r">结果在结算时才显露</span></button>`).join('')}`,
      actions: [{ label: '稍后处置', cls: 'ghost', onClick: (c) => c() }],
      onMount: (root, close) => {
        root.querySelectorAll('[data-oi]').forEach((b) => b.addEventListener('click', () => {
          const idx = Number(b.dataset.oi);
          const res = ev.options[idx].result;
          g.resolveEvent(idx);
          close();
          this.modal({ title: ev.name, body: `<div class="story-text">${esc(res)}</div>`, actions: [{ label: '知道了', cls: 'primary', onClick: (c2) => c2() }] });
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
        <p class="hint" style="margin-top:8px">更换功法完全保留修为进度，只改变效率、心魔抗性、突破率与战力。当前境界可装配 ${techList.length} 部。</p>
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
      sub: '转入护法堂或长老会将脱离弟子身份；两个机构只能择一，不得兼任。',
      body: `<p class="hint">该弟子将不再参加晋升考核，也不计入弟子人数统计；修为可继续增长。</p>`,
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
