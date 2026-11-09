/* 破天宗 · 管理台
 * 十页：总览 / 账号 / 存档 / 玩家数据 / 兑换码 / 赛季 / 开关 / 日志 / 设置 / 须知。
 * 后台只管人、不管数：不改资源、弟子属性与榜单分数，发资源只能经兑换码并留痕。
 */
import { admin as api, currentAccount, displayName } from './cloud.js';
import { UI } from './ui.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });

const MODULES = [
  { k: 'battle', n: '宗门对战', d: '邀约入口隐藏，已有邀约失效，战报仍可查看' },
  { k: 'rank', n: '排行榜与赛季', d: '榜单页显示维护中，赛季计时暂停' },
  { k: 'prod', n: '资源与生产', d: '工坊产出暂停并提示维护，库存不变' },
  { k: 'story', n: '剧情', d: '不再触发新节点，已结算记录保留' },
  { k: 'world', n: '大世界', d: '派遣与外交入口隐藏，在途队伍照常归来' },
  { k: 'tasks', n: '任务派遣', d: '任务大厅隐藏，已领任务仍可结算' },
  { k: 'org', n: '机构席位', d: '席位与竞选页隐藏，已任命者保留' },
];
const MOD_NAME = MODULES.reduce((m, x) => (m[x.k] = x.n, m), {});
const LOG_MODULES = [
  ['', '全部'], ['account', '账号操作'], ['session', '会话'], ['redeem', '兑换'],
  ['disciple', '弟子行为'], ['story', '剧情'], ['battle', '对战'], ['save', '存档变更'],
  ['switch', '开关'], ['season', '赛季'], ['setting', '设置'],
];

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name, rows) {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === id));
  window.scrollTo(0, 0);
}

/* 十个页面收成六个入口：低频页收进二级切换，一级只留"进来就知道要干什么"的那几件 */
const GROUPS = {
  people: { key: 'sub', pages: [['accounts', '账号'], ['players', '玩家数据']], def: 'accounts' },
  system: { key: 'subSys', pages: [['switches', '模块开关'], ['logs', '操作日志'], ['settings', '公告与安全'], ['notice', '后台须知']], def: 'switches' },
};

export const Admin = {
  tab: 'overview',
  sub: 'accounts',
  subSys: 'switches',
  busy: false,
  d: { overview: null, accounts: [], saves: [], codes: [], logs: [], seasons: [], settings: {}, player: null, redeemLogs: [], logModule: '' },

  async open() {
    const acc = currentAccount();
    if (!acc || acc.role !== 'admin') return UI.toast('仅管理员可进入管理台');
    const who = document.getElementById('adminWho');
    if (who) who.textContent = `${displayName()} · 管理员 · ${acc.username}`;
    this.bind();
    this.markTab();
    showView('view-admin');
    await this.refresh();
  },

  bind() {
    if (this._bound) return;
    this._bound = true;
    document.getElementById('btnAdminBack').addEventListener('click', () => {
      if (this.helpers && this.helpers.back) this.helpers.back();
      else showView('view-slots');
    });
    document.getElementById('adminTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-atab]');
      if (!b) return;
      this.tab = b.dataset.atab;
      this.markTab();
      this.refresh();
    });
    document.getElementById('adminStage').addEventListener('click', (e) => {
      const sub = e.target.closest('[data-asub]');
      if (sub) {
        const g = GROUPS[this.tab];
        if (g) this[g.key] = sub.dataset.asub;
        this.refresh();
        return;
      }
      this.onClick(e);
    });
    /* 全局搜索：一个框，落到能查到东西的那一页去 */
    const box = document.getElementById('admSearch');
    if (box) {
      const go = () => {
        const q = box.value.trim();
        if (!q) return;
        this.d.q = q;
        this.d.pu = q;
        /* 像账号名的（无空格、字母数字下划线）先去账号页，否则直接翻存档 */
        if (/^[A-Za-z0-9_.-]{2,20}$/.test(q)) { this.tab = 'people'; this.sub = 'players'; }
        else { this.tab = 'saves'; }
        this.markTab();
        this.refresh();
      };
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    }
    // 弹窗内的按钮（留存快照、回滚、移出白名单）同样走同一套分发
    const root = document.getElementById('modalRoot');
    if (root && !root._adminBound) {
      root._adminBound = true;
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-a]')) this.onClick(e);
      });
    }
  },

  markTab() {
    document.querySelectorAll('#adminTabs [data-atab]').forEach((x) => x.classList.toggle('is-on', x.dataset.atab === this.tab));
  },

  async refresh() {
    const t = this.page();
    try {
      if (t === 'overview') this.d.overview = await api.overview();
      else if (t === 'accounts') this.d.accounts = await api.list();
      else if (t === 'saves') this.d.saves = await api.saveList(this.d.q || '');
      else if (t === 'codes') {
        this.d.codes = await api.redeemList();
        this.d.redeemLogs = await api.redeemLogs('');
      } else if (t === 'season') this.d.seasons = await api.seasonList();
      else if (t === 'logs') this.d.logs = await api.logs(this.d.logModule, this.d.logQ || '');
      else if (t === 'switches' || t === 'settings') this.d.settings = await api.settingsGet();
    } catch (err) {
      UI.toast(err.message || '读取失败');
    }
    this.render();
  },

  /* 当前真正要渲染的那一页（一级页签或组内子页） */
  page() {
    const g = GROUPS[this.tab];
    return g ? (this[g.key] || g.def) : this.tab;
  },

  subBar() {
    const g = GROUPS[this.tab];
    if (!g) return '';
    const cur = this[g.key] || g.def;
    return `<div class="adm-sub">${g.pages.map(([k, n]) =>
      `<button class="adm-chip ${k === cur ? 'is-on' : ''}" data-asub="${k}">${n}</button>`).join('')}</div>`;
  },

  render() {
    const box = document.getElementById('adminStage');
    if (!box) return;
    const map = {
      overview: () => this.overviewHtml(),
      accounts: () => this.accountsHtml(),
      saves: () => this.savesHtml(),
      players: () => this.playersHtml(),
      codes: () => this.codesHtml(),
      season: () => this.seasonHtml(),
      switches: () => this.switchesHtml(),
      logs: () => this.logsHtml(),
      settings: () => this.settingsHtml(),
      notice: () => this.noticeHtml(),
    };
    const page = this.page();
    box.innerHTML = this.subBar() + (map[page] || map.overview)();
  },

  /* 每页统一页头：一页只说一件事，主操作固定在右上角。
     以前各页一进来就是一堆卡，看不到"这页是干什么的"。 */
  head(title, desc, acts) {
    return `<div class="adm-head">
      <div class="ah-t"><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>
      ${acts ? `<div class="ah-act">${acts}</div>` : ''}
    </div>`;
  },

  /* ================= 总览 ================= */
  overviewHtml() {
    const o = this.d.overview || {};
    const s = o.season || {};
    const off = (o.modules_off || []);
    const stageMix = o.stage_mix || {};
    const stageTxt = Object.keys(stageMix).sort().map((k) => `第${k}幕 ${stageMix[k]}`).join(' · ') || '—';
    return `<div class="stack">
      ${this.head('总览', '一屏看清宗门现在的样子：谁在线、多少存档、赛季走到哪一步。',
    '<button class="btn sm ghost" data-a="ov:refresh">刷新</button>')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>日常巡检</h3><small>六项常看指标</small></div></div>
        <div class="metrics">
          <div class="metric"><div class="k">在线账号</div><div class="v">${num(o.online)}</div></div>
          <div class="metric"><div class="k">账号总数</div><div class="v">${num(o.accounts)}<small>玩家 ${num(o.players)}</small></div></div>
          <div class="metric"><div class="k">活跃存档</div><div class="v">${num(o.saves)}<small>封存 ${num(o.sealed)}</small></div></div>
          <div class="metric"><div class="k">今日兑换</div><div class="v">${num(o.today_redeem)}<small>有效码 ${num(o.codes)}</small></div></div>
          <div class="metric"><div class="k">当前赛季</div><div class="v">${s.no ? '第 ' + s.no + ' 季' : '—'}</div><div class="k">${esc(s.status === 'active' ? '进行中' : s.status === 'ended' ? '已结束' : '未开启')}</div></div>
          <div class="metric"><div class="k">模块关闭</div><div class="v">${off.length}<small>/ 7</small></div></div>
        </div>
        <p class="hint" style="margin-top:10px">存档阶段分布：${esc(stageTxt)}</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>赛季声望前五</h3><small>第 ${s.no || 1} 赛季</small></div></div>
        <div class="list">${(o.top || []).length ? o.top.map((r, i) => `<div class="item">
          <div class="main"><div class="name">${i + 1}. ${esc(r.sect_name)}</div>
          <div class="meta"><span>祖师 ${esc(r.founder_name || '—')}</span><span>声望 ${num(r.renown)}</span></div></div>
        </div>`).join('') : '<div class="item"><div class="main"><div class="name">榜单暂无数据</div><div class="meta"><span>玩家进入存档并同步后出现</span></div></div></div>'}</div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>最近操作</h3><small>全量日志见「日志中心」</small></div></div>
        <div class="list">${(o.recent_logs || []).length ? o.recent_logs.map((l) => `<div class="item">
          <div class="main"><div class="name">${esc(l.action)} <span class="pill mute">${esc(MOD_NAME[l.module] || l.module)}</span></div>
          <div class="meta"><span>${esc(l.at)}</span><span>对象 ${esc(l.target || '—')}</span></div></div>
        </div>`).join('') : '<div class="item"><div class="main"><div class="name">暂无记录</div></div></div>'}</div>
      </div>

      <div class="adm-tools">
        <span class="hint">维护：清掉到期存档可腾出配额，操作会写入日志。</span>
        <span class="sp"></span>
        <button class="btn sm ghost" data-a="ov:purge">清理到期存档</button>
      </div>
    </div>`;
  },

  /* ================= 账号 ================= */
  accountsHtml() {
    const rows = this.d.accounts.map((a) => {
      const isAdmin = a.role === 'admin';
      const off = a.status !== 'active';
      const me = currentAccount() && currentAccount().username === a.username;
      return `<div class="item">
        <div class="main">
          <div class="name">${esc(a.username)}
            <span class="pill ${isAdmin ? 'gold' : 'jade'}">${isAdmin ? '管理员' : '玩家'}</span>
            ${off ? '<span class="pill">已停用</span>' : ''}
            ${a.locked ? '<span class="pill">已锁定</span>' : ''}
            ${a.must_change ? '<span class="pill mute">待改密</span>' : ''}
            ${me ? '<span class="pill mute">当前登录</span>' : ''}
          </div>
          <div class="meta">
            <span>称呼 ${esc(a.nick || '—')}</span>
            <span>槽位 ${a.slot_limit}</span>
            <span>存档 ${a.saves || 0}</span>
            <span>在线 ${a.online || 0}</span>
            <span>创建 ${esc(a.created_at || '—')}</span>
            <span>上次登录 ${esc(a.last_login || '从未')}</span>
          </div>
        </div>
        <div class="act">
          <button class="btn sm ghost" data-a="acc:reset" data-u="${esc(a.username)}">重置口令</button>
          <button class="btn sm ghost" data-a="acc:slots" data-u="${esc(a.username)}" data-n="${a.slot_limit}">槽位</button>
          ${a.locked ? `<button class="btn sm ghost" data-a="acc:unlock" data-u="${esc(a.username)}">解锁</button>` : ''}
          ${a.online > 0 ? `<button class="btn sm ghost" data-a="acc:kick" data-u="${esc(a.username)}">强制下线</button>` : ''}
          <button class="btn sm ghost" data-a="acc:view" data-u="${esc(a.username)}">数据</button>
          <button class="btn sm ${off ? 'primary' : 'ghost'}" data-a="acc:${off ? 'enable' : 'disable'}" data-u="${esc(a.username)}">${off ? '启用' : '停用'}</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="stack">
      ${this.head('账号', '开立、停用、重置口令、批量导入。玩家账号只能在这里创建，站点不开放自助注册。',
    '<button class="btn sm ghost" data-a="acc:refresh">刷新名录</button>')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>开立新账号</h3><small>一次一人，可批量请用下方导入</small></div></div>
        <div class="form-grid">
          <label class="field"><span>账号</span><input id="nu" maxlength="20" autocapitalize="off" spellcheck="false" placeholder="3-20 位小写字母/数字/下划线"></label>
          <label class="field"><span>称呼</span><input id="nn" maxlength="12" placeholder="显示名，可留空"></label>
          <label class="field"><span>初始口令</span><input id="np" maxlength="64" placeholder="至少 6 位"></label>
          <label class="field"><span>角色</span>
            <select id="nr"><option value="player">玩家</option><option value="admin">管理员</option></select>
          </label>
          <label class="field"><span>槽位上限</span>
            <select id="ns">${[3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n}</option>`).join('')}</select>
          </label>
          <label class="field"><span>备注</span><input id="nnt" maxlength="64" placeholder="线下核对用，可留空"></label>
        </div>
        <div class="adm-acts">
          <button class="btn primary" data-a="acc:create">开立账号</button>
          <p class="hint">口令经服务端加盐散列存储，管理台不可见；忘记时只能重置。新账号首次登录须改密后才能进入游戏。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>批量导入</h3><small>每行一条：账号,初始口令,备注</small></div></div>
        <div class="form-grid">
          <label class="fg-full"><span>粘贴表格内容</span>
            <textarea id="bulk" rows="4" placeholder="lin01,lin2026,小林&#10;lin02,lin2026,&#10;lin03,lin2026,旧部"></textarea>
          </label>
        </div>
        <div class="adm-acts">
          <button class="btn primary" data-a="acc:bulk">逐行校验并导入</button>
          <p class="hint">账号名重复、格式不合规、口令不足 6 位的行会被跳过，只写入合法行，结束后回显成功与失败明细。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>账号名录</h3><small>共 ${this.d.accounts.length} 个</small></div></div>
        <div class="list">${rows || '<div class="item"><div class="main"><div class="name">尚无账号</div><div class="meta"><span>先在上方开立第一个</span></div></div></div>'}</div>
      </div>
    </div>`;
  },

  /* ================= 存档 ================= */
  savesHtml() {
    const rows = this.d.saves.map((s) => `<div class="item">
      <div class="main">
        <div class="name">${esc(s.sect_name)} <span class="pill mute">${esc(s.account || '—')}</span>
          ${s.sealed ? '<span class="pill">封存中</span>' : ''}
          ${s.purge_at ? `<span class="pill">待删除 ${esc(s.purge_at)}</span>` : ''}</div>
        <div class="meta">
          <span>槽位 ${s.slot + 1}</span><span>祖师 ${esc(s.founder_name || '—')}</span>
          <span>第 ${s.stage} 幕</span><span>弟子 ${s.disciple_count}</span>
          <span>最高 ${s.max_step} 步</span><span>修订号 ${s.revision}</span>
          <span>保存 ${esc(s.updated)}</span>
        </div>
      </div>
      <div class="act">
        <button class="btn sm ghost" data-a="sav:detail" data-i="${s.id}">详情</button>
        <button class="btn sm ghost" data-a="sav:seal" data-i="${s.id}" data-v="${s.sealed ? '0' : '1'}">${s.sealed ? '解封' : '封存'}</button>
        <button class="btn sm ghost" data-a="sav:export" data-i="${s.id}">导出</button>
        ${s.purge_at
          ? `<button class="btn sm primary" data-a="sav:restore" data-i="${s.id}">撤销删除</button>`
          : `<button class="btn sm ghost danger" data-a="sav:del" data-i="${s.id}">删除</button>`}
      </div>
    </div>`).join('');

    return `<div class="stack">
      ${this.head('存档', '按宗门名或账号检索，封存、导出、删除。删除先封存七日，期间可撤销。')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>存档检索</h3><small>按宗门名或账号筛选</small></div></div>
        <div class="form-grid">
          <label class="fg-full"><span>关键词</span>
            <input id="sq" maxlength="24" placeholder="宗门名 / 账号" value="${esc(this.d.q || '')}">
          </label>
        </div>
        <div class="adm-acts">
          <button class="btn primary" data-a="sav:search">检索</button>
          <button class="btn ghost" data-a="sav:purge">清理到期</button>
          <p class="hint">「清理到期」会真正删除已过保留期的存档，写入日志；仅标记未到期的不会被动。</p>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>存档列表</h3><small>共 ${this.d.saves.length} 份</small></div></div>
        <div class="list">${rows || '<div class="item"><div class="main"><div class="name">没有匹配的存档</div></div></div>'}</div>
      </div>
    </div>`;
  },

  /* ================= 玩家数据 ================= */
  playersHtml() {
    const p = this.d.player;
    const searchCard = `<div class="card">
      <div class="card-head"><div class="t"><h3>按账号查看</h3><small>全部只读</small></div></div>
      <div class="form-grid">
        <label><span>账号名</span><input id="pu" maxlength="20" placeholder="如 lin01" value="${esc(this.d.pu || '')}"></label>
        <label><span>槽位</span><input id="ps" type="number" min="1" max="10" placeholder="1" value="${esc(this.d.ps || 1)}"></label>
      </div>
      <div class="adm-acts">
        <button class="btn primary" data-a="ply:load">查看</button>
        <p class="hint">查看动作会写入日志。此页不提供任何修改入口。</p>
      </div>
    </div>`;
    const pageHead = this.head('玩家数据', '按账号与槽位查一份存档的全部只读视图，用于排查问题。');
    if (!p) return `<div class="stack">${pageHead}${searchCard}</div>`;

    if (!p.save) {
      return `<div class="stack">${pageHead}${searchCard}
        <div class="card"><div class="card-head"><div class="t"><h3>${esc(p.account.username)}</h3><small>该槽位尚无存档</small></div></div>
        <p class="hint">账号状态 ${esc(p.account.status)} · 槽位 ${p.account.slot_limit} · 在线 ${p.account.online}</p></div></div>`;
    }

    const s = p.save;
    const d = p.disc || {};
    const res = p.res || {};
    const stepTxt = Object.keys(d.byStep || {}).sort((a, b) => a - b).map((k) => `${k}步×${d.byStep[k]}`).join('、') || '—';
    const starTxt = Object.keys(d.byStar || {}).sort((a, b) => a - b).map((k) => `${k}星×${d.byStar[k]}`).join('、') || '—';
    const resTxt = ['lingshi', 'liangshi', 'lingzhi', 'lingyao', 'danyao', 'qicai', 'fulu', 'zhenfa', 'kuangshi', 'qizhen']
      .map((k) => `${resName(k)} ${num(res[k])}`).join(' · ');
    const posts = p.posts || {};
    const instName = { dizige: '弟子阁', hufatang: '护法堂', zhanglaohui: '长老会' };
    const postsTxt = Object.keys(posts).map((k) => `${instName[k] || k}：${(posts[k] || []).join('、')}`).join('<br>');
    const flow = p.flow || {};

    return `<div class="stack">${pageHead}${searchCard}
      <div class="card">
        <div class="card-head"><div class="t"><h3>${esc(s.sect)}</h3><small>${esc(p.account.username)} · 槽位 ${s.slot + 1}${s.sealed ? ' · 封存中' : ''}</small></div></div>
        <div class="metrics">
          <div class="metric"><div class="k">当前幕</div><div class="v">${s.stage}</div></div>
          <div class="metric"><div class="k">已解锁层</div><div class="v">${s.layers}<small>/10</small></div></div>
          <div class="metric"><div class="k">声望</div><div class="v">${num(s.renown)}</div></div>
          <div class="metric"><div class="k">气运</div><div class="v">${s.fortune}</div></div>
          <div class="metric"><div class="k">修订号</div><div class="v">${s.revision}</div></div>
          <div class="metric"><div class="k">最近保存</div><div class="v" style="font-size:13px">${esc(s.updated)}</div></div>
        </div>
        <p class="hint" style="margin-top:10px">祖师 ${esc(s.founder)} · 账号创建 ${esc(p.account.created)} · 上次登录 ${esc(p.account.last_login || '从未')} · 在线会话 ${p.account.online}</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>弟子结构</h3><small>健康度看三处：心魔、寿元、步数断层</small></div></div>
        <div class="metrics">
          <div class="metric"><div class="k">杂役 / 正式 / 转职</div><div class="v">${d.servant || 0}<small>/ ${d.formal || 0} / ${d.staff || 0}</small></div></div>
          <div class="metric"><div class="k">正式弟子均境</div><div class="v">${d.avgRealm || 0}</div></div>
          <div class="metric"><div class="k">心魔超标</div><div class="v">${d.demonHigh || 0}</div></div>
          <div class="metric"><div class="k">寿元告急</div><div class="v">${d.lifeLow || 0}</div></div>
        </div>
        <p class="hint" style="margin-top:10px">正式弟子分布：${esc(stepTxt)}<br>杂役星级分布：${esc(starTxt)}</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>资源存量</h3><small>结余率与流水见存档详情</small></div></div>
        <p class="hint">${esc(resTxt)}</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>剧情与机构</h3></div></div>
        <p class="hint">已完成节点 ${p.story.done} 个 · 待处理 ${(p.story.pending || []).length} 个 · 关键标记 ${(p.story.flags || []).join('、') || '无'}<br>
        对战 胜 ${flow.wins || 0} / 负 ${flow.losses || 0} · 最高 ${flow.peakStep || 1} 步<br>${postsTxt}</p>
      </div>
    </div>`;
  },

  /* ================= 兑换码 ================= */
  codesHtml() {
    const rows = this.d.codes.map((c) => {
      const r = c.reward || {};
      const parts = Object.entries(r.res || {}).filter(([, v]) => Number(v)).map(([k, v]) => `${resName(k)}×${v}`);
      if (r.renown) parts.push(`声望+${r.renown}`);
      if (r.fortune) parts.push(`气运+${r.fortune}`);
      return `<div class="item">
        <div class="main">
          <div class="name">${esc(c.code)}
            <span class="pill ${c.active ? 'jade' : ''}">${c.active ? '生效中' : '已停用'}</span>
            ${c.bound ? `<span class="pill gold">专属 ${esc(c.bound)}</span>` : ''}
            <span class="pill mute">已兑 ${c.used || 0}</span></div>
          <div class="meta"><span>${esc(parts.join('、') || '无奖励')}</span><span>${esc(c.note || '')}</span><span>截止 ${esc(c.ends_at || '—')}</span></div>
        </div>
        <div class="act">
          <button class="btn sm ${c.active ? 'ghost' : 'primary'}" data-a="code:toggle" data-u="${esc(c.code)}" data-v="${c.active ? '0' : '1'}">${c.active ? '停用' : '启用'}</button>
        </div>
      </div>`;
    }).join('');

    const logs = (this.d.redeemLogs || []).map((l) => `<div class="item">
      <div class="main"><div class="name">${esc(l.code)} <span class="pill mute">${esc(l.account)}</span></div>
      <div class="meta"><span>${esc(l.at)}</span><span>槽位 ${(l.slot || 0) + 1}</span><span>${esc(rewardText(l.reward))}</span></div></div>
    </div>`).join('');

    return `<div class="stack">
      ${this.head('兑换码', '后台只发码、不改数值。同账号同码只兑一次，由服务端核销并留痕。',
    '<button class="btn sm ghost" data-a="code:refresh">刷新</button>')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>发一枚兑换码</h3><small>同码重发会覆盖奖励内容</small></div></div>
        <div class="form-grid">
          <label class="field"><span>兑换码</span><input id="cu" maxlength="32" autocapitalize="characters" spellcheck="false" placeholder="如 POTIAN2026"></label>
          <label class="field"><span>灵石</span><input id="c_lingshi" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>丹药</span><input id="c_danyao" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>奇珍异宝</span><input id="c_qizhen" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>声望</span><input id="c_renown" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>绑定账号</span><input id="c_bound" maxlength="20" placeholder="仅专属码填写"></label>
          <label class="field"><span>有效天数</span><input id="c_days" type="number" min="1" max="3650" value="365"></label>
          <label class="field"><span>备注</span><input id="c_note" maxlength="40" placeholder="发放缘由"></label>
        </div>
        <div class="adm-acts">
          <button class="btn primary" data-a="code:add">发放</button>
          <p class="hint">同账号同码只能兑一次，由服务端核销并留痕；码存在与否不影响已发放的到账记录。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>批量生成</h3><small>用于活动、渠道与补偿</small></div></div>
        <div class="form-grid">
          <label class="field"><span>码前缀</span><input id="bp" maxlength="12" placeholder="如 COMP / S1"></label>
          <label class="field"><span>数量</span><input id="bn" type="number" min="1" max="50" value="5"></label>
          <label class="field"><span>灵石</span><input id="b_lingshi" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>丹药</span><input id="b_danyao" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>有效天数</span><input id="b_days" type="number" min="1" max="3650" value="30"></label>
          <label class="field"><span>备注</span><input id="b_note" maxlength="40" placeholder="本批用途"></label>
        </div>
        <div class="adm-acts">
          <button class="btn primary" data-a="code:batch">生成</button>
          <p class="hint">单次最多 50 枚，生成后自动写入日志，可在下方码表导出。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>已发兑换码</h3><small>共 ${this.d.codes.length} 枚</small></div>
          <button class="btn sm ghost" data-a="code:export">导出码表</button></div>
        <div class="list">${rows || '<div class="item"><div class="main"><div class="name">尚无兑换码</div></div></div>'}</div>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>核销记录</h3><small>最近 ${(this.d.redeemLogs || []).length} 条</small></div>
          <button class="btn sm ghost" data-a="code:logexport">导出</button></div>
        <div class="list">${logs || '<div class="item"><div class="main"><div class="name">尚无核销</div></div></div>'}</div>
      </div>
    </div>`;
  },

  /* ================= 赛季 ================= */
  seasonHtml() {
    const rows = this.d.seasons.map((s) => `<div class="item">
      <div class="main">
        <div class="name">第 ${s.no} 赛季 · ${esc(s.name || '')}
          <span class="pill ${s.status === 'active' ? 'jade' : ''}">${s.status === 'active' ? '进行中' : s.status === 'ended' ? '已结束' : '筹备中'}</span>
          ${s.has_snapshot ? '<span class="pill gold">有快照</span>' : ''}</div>
        <div class="meta"><span>开始 ${esc(s.started || '—')}</span><span>结束 ${esc(s.ended || '—')}</span><span>榜单 ${s.rows} 行</span></div>
      </div>
      <div class="act">
        ${s.status === 'active' ? `<button class="btn sm primary" data-a="ss:end" data-n="${s.no}">结束并锁定</button>` : ''}
        ${s.status === 'ended' ? `<button class="btn sm ghost danger" data-a="ss:reset" data-n="${s.no}">重置</button>` : ''}
        <button class="btn sm ghost" data-a="ss:view" data-n="${s.no}">榜单</button>
        <button class="btn sm ghost" data-a="ss:award" data-n="${s.no}">按名次发奖</button>
      </div>
    </div>`).join('');

    return `<div class="stack">
      ${this.head('赛季', '开启、运行、锁定快照、发奖。重置只清榜单分数，不动玩家存档。',
    '<button class="btn sm primary" data-a="ss:open">开启新赛季</button>')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>赛季五步</h3><small>每一步都由管理员手动触发</small></div></div>
        <p class="hint">开启新赛季 → 日常运行（榜单随存档同步刷新）→ 结束并锁定快照 → 导出榜单 → 按名次批量生成专属码。<br>
        重置只清空榜单分数与赛季统计，玩家的弟子、资源、建筑与剧情进度一律保留。</p>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>赛季记录</h3><small>共 ${this.d.seasons.length} 个</small></div></div>
        <div class="list">${rows || '<div class="item"><div class="main"><div class="name">尚无赛季</div></div></div>'}</div>
      </div>
    </div>`;
  },

  /* ================= 开关 ================= */
  switchesHtml() {
    const st = this.d.settings || {};
    const mods = st.modules || {};
    const wl = st.whitelist || {};
    const rows = MODULES.map((m) => {
      const on = mods[m.k] !== false;
      const list = wl[m.k] || [];
      return `<div class="item">
        <div class="main">
          <div class="name">${m.n} <span class="pill ${on ? 'jade' : ''}">${on ? '开放' : '关闭'}</span>
            ${!on && list.length ? `<span class="pill gold">灰度 ${list.length} 人</span>` : ''}</div>
          <div class="meta"><span>${m.d}</span></div>
          <div class="meta"><span>白名单：${list.length ? list.map(esc).join('、') : '空'}</span></div>
        </div>
        <div class="act">
          <button class="btn sm ${on ? 'ghost' : 'primary'}" data-a="sw:toggle" data-k="${m.k}" data-v="${on ? '0' : '1'}">${on ? '关闭' : '开启'}</button>
          <button class="btn sm ghost" data-a="sw:white" data-k="${m.k}">白名单</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="stack">
      ${this.head('开关', '全服级模块开关。关闭只挡入口与结算，不动任何已有数据。',
    '<button class="btn sm ghost" data-a="sw:refresh">刷新</button>')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>子系统开关</h3><small>全服级，按模块粒度</small></div></div>
        <p class="hint">关闭后入口隐藏、接口拒绝、定时结算暂停，已有数据原样保留；重新开启即恢复。关闭不触发任何数据清理。</p>
        <div class="list" style="margin-top:10px">${rows}</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>灰度说明</h3></div></div>
        <p class="hint">模块关闭时，白名单内的账号仍可见入口并正常调用；白名单为空即全员不可见。把白名单清空可回到全关状态。白名单变更同样写入日志。</p>
      </div>
    </div>`;
  },

  /* ================= 日志 ================= */
  logsHtml() {
    const opts = LOG_MODULES.map(([k, n]) => `<option value="${k}" ${this.d.logModule === k ? 'selected' : ''}>${n}</option>`).join('');
    const rows = (this.d.logs || []).map((l) => `<div class="item">
      <div class="main">
        <div class="name">${esc(l.action)} <span class="pill mute">${esc(MOD_NAME[l.module] || l.module)}</span>
          ${l.actor ? `<span class="pill mute">${esc(l.actor)}</span>` : ''}</div>
        <div class="meta"><span>${esc(l.at)}</span><span>对象 ${esc(l.target || '—')}</span>${l.reason ? `<span>理由 ${esc(l.reason)}</span>` : ''}</div>
        ${l.detail ? `<div class="meta"><span>${esc(JSON.stringify(l.detail))}</span></div>` : ''}
      </div>
    </div>`).join('');
    return `<div class="stack">
      ${this.head('日志', '只追加，不可删除。按模块与关键词定位一次具体操作。',
    '<button class="btn sm ghost" data-a="log:export">导出</button>')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>日志检索</h3><small>只追加，不可删除</small></div></div>
        <div class="form-grid">
          <label><span>模块</span><select id="lm">${opts}</select></label>
          <label class="fg-full"><span>关键词</span>
            <input id="lq" maxlength="30" placeholder="账号 / 对象 / 动作" value="${esc(this.d.logQ || '')}">
          </label>
        </div>
        <div class="adm-acts">
          <button class="btn primary" data-a="log:search">检索</button>
          <p class="hint">共七类：账号操作、会话、兑换、弟子行为、剧情、对战、存档变更；开关与赛季变更另有记录。</p>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>记录</h3><small>最近 ${(this.d.logs || []).length} 条</small></div></div>
        <div class="list">${rows || '<div class="item"><div class="main"><div class="name">没有匹配的记录</div></div></div>'}</div>
      </div>
    </div>`;
  },

  /* ================= 设置 ================= */
  settingsHtml() {
    const st = this.d.settings || {};
    const sec = st.security || {};
    return `<div class="stack">
      ${this.head('设置', '公告与安全策略。改动即时对所有账号生效。')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>公告</h3><small>显示在玩家端主界面顶部，不超过 200 字</small></div></div>
        <div class="form-grid">
          <label class="fg-full"><span>公告内容（留空则隐藏）</span>
            <textarea id="ann" rows="3" maxlength="200">${esc(st.announcement || '')}</textarea>
          </label>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>安全策略</h3><small>全局生效，改动即时影响所有账号</small></div></div>
        <div class="form-grid">
          <label><span>单账号同时在线设备（0 = 不限）</span>
            <select id="maxDev">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(sec.maxDevices || 0) === n ? 'selected' : ''}>${n === 0 ? '不限' : n + ' 台'}</option>`).join('')}</select>
          </label>
          <label><span>登录失败锁定阈值（次）</span>
            <select id="lockTh">${[3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${Number(sec.lockThreshold || 5) === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
          </label>
          <label><span>令牌有效期（小时）</span>
            <input id="tokH" type="number" min="2" max="720" value="${Number(sec.tokenHours || 168)}">
          </label>
        </div>
        <div class="adm-acts">
          <button class="btn primary" data-a="set:save">保存策略</button>
          <p class="hint">收紧同时在线设备数后，新登录会挤掉最早的会话；登录失败达到阈值后账号临时锁定十五分钟，可在账号页解锁。改密使全部会话立即失效，该项不可配置。</p>
        </div>
      </div>
    </div>`;
  },

  noticeHtml() {
    return `<div class="stack">
      ${this.head('须知', '后台的边界与危险操作分级。')}
      <div class="card">
        <div class="card-head"><div class="t"><h3>后台边界</h3><small>这七件事不做</small></div></div>
        <p class="hint">· 不直接修改玩家资源数量<br>
        · 不直接修改弟子属性、境界与步数<br>
        · 不直接修改榜单分数<br>
        · 不查看口令明文与令牌原值<br>
        · 不代替玩家做出剧情选择<br>
        · 不代替玩家参与对战<br>
        · 不发放任何不留记录的奖励</p>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>危险操作分级</h3></div></div>
        <p class="hint">高：赛季重置、存档删除、存档回滚 —— 均需二次确认并填写理由，删除保留七日、回滚自动备份当前状态。<br>
        中：批量发码、强制下线、账号停用、子系统开关 —— 需确认或填写理由，并记录变更前后状态。</p>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>账号规则</h3></div></div>
        <p class="hint">· 站点不提供手机号、邮箱等自助注册入口，账号一律由管理台开立。<br>
        · 口令以加盐多次散列存储，服务端不回传明文，遗失只能重置为临时口令，重置后首次登录须改密。<br>
        · 停用账号会立刻踢下线，云端存档保留；为保证日志与存档可追溯，不提供改号与物理删除。</p>
      </div>
    </div>`;
  },

  /* ================= 交互 ================= */
  ask({ title, sub, hint, label = '确认', danger = false, needReason = true, body = '' }, cb) {
    UI.modal({
      title,
      sub,
      body: `${body}${hint ? `<p class="hint">${hint}</p>` : ''}
        ${needReason ? `<label class="field"><span>操作理由（必填）</span><input id="opReason" maxlength="80" placeholder="将写入日志，不可删除"></label>` : ''}`,
      actions: [
        { label, cls: danger ? 'danger' : 'primary', onClick: async (close) => {
            const el = document.getElementById('opReason');
            const reason = el ? el.value.trim() : '';
            if (needReason && !reason) return UI.toast('请填写操作理由');
            close();
            await cb(reason);
          } },
        { label: '取消', cls: 'ghost', onClick: (c) => c() },
      ],
    });
  },

  async onClick(e) {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const u = b.dataset.u || '';
    const i = b.dataset.i || '';
    const k = b.dataset.k || '';
    const n = b.dataset.n || '';
    if (this.busy) return;

    if (a === 'ov:refresh') return this.refresh();
    if (a === 'ov:purge' || a === 'sav:purge') {
      this.busy = true;
      const c = await api.savePurge();
      this.busy = false;
      UI.toast(c ? `已清理 ${c} 份到期存档` : '没有到期存档');
      return this.refresh();
    }

    /* --- 账号 --- */
    if (a === 'acc:refresh') return this.refresh();
    if (a === 'acc:create') {
      const username = (document.getElementById('nu').value || '').trim().toLowerCase();
      const nick = (document.getElementById('nn').value || '').trim();
      const password = document.getElementById('np').value || '';
      const role = document.getElementById('nr').value;
      const slotLimit = Number(document.getElementById('ns').value || 3);
      const note = (document.getElementById('nnt').value || '').trim();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) return UI.toast('账号名须为 3-20 位小写字母、数字或下划线');
      if (password.length < 6) return UI.toast('口令至少 6 位');
      this.busy = true;
      const r = await api.create({ username, password, nick, role, note, slotLimit });
      this.busy = false;
      if (!r.ok) return UI.toast(r.msg);
      UI.toast(`已开立账号 ${r.username}`);
      return this.refresh();
    }
    if (a === 'acc:bulk') {
      const raw = (document.getElementById('bulk').value || '').trim();
      if (!raw) return UI.toast('请粘贴表格内容');
      const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const ok = []; const bad = [];
      this.busy = true;
      for (const line of lines) {
        const [user, pass, note] = line.split(/[,，\t]/).map((x) => (x || '').trim());
        if (!/^[a-z0-9_]{3,20}$/i.test(user || '')) { bad.push(`${user || '(空)'}：账号格式不合规`); continue; }
        if (!pass || pass.length < 6) { bad.push(`${user}：口令不足 6 位`); continue; }
        const r = await api.create({ username: user.toLowerCase(), password: pass, nick: '', role: 'player', note, slotLimit: 3 });
        if (r.ok) ok.push(user.toLowerCase()); else bad.push(`${user}：${r.msg}`);
      }
      this.busy = false;
      UI.modal({
        title: '导入结果',
        sub: `成功 ${ok.length} 条 · 跳过 ${bad.length} 条`,
        body: `<p class="hint">${ok.length ? '成功：' + ok.join('、') : '本次没有写入任何账号。'}</p>
          ${bad.length ? `<p class="hint" style="color:var(--seal)">跳过：<br>${bad.map(esc).join('<br>')}</p>` : ''}`,
        actions: [{ label: '知道了', cls: 'primary', onClick: (c) => c() }],
      });
      return this.refresh();
    }
    if (a === 'acc:reset') {
      return this.ask({ title: '重置口令', sub: `账号 ${u}`, needReason: false, hint: '重置后该账号全部会话立即失效，并须在下次登录时改密。',
        body: `<label class="field"><span>临时口令</span><input id="npass" maxlength="64" placeholder="至少 6 位"></label>` }, async () => {
        const v = document.getElementById('npass') ? document.getElementById('npass').value : '';
        if (!v || v.length < 6) return UI.toast('口令至少 6 位');
        const r = await api.update(u, 'reset', v, '管理员重置');
        UI.toast(r.ok ? '口令已重置' : r.msg);
        await this.refresh();
      });
    }
    if (a === 'acc:slots') {
      return this.ask({ title: '槽位授权', sub: `账号 ${u}（当前 ${b.dataset.n}）`, hint: '可调范围 3 至 10。调整即时生效，已有存档不受影响。',
        body: `<label class="field"><span>槽位上限</span><select id="nslot">${[3, 4, 5, 6, 7, 8, 9, 10].map((x) => `<option value="${x}" ${Number(b.dataset.n) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>` }, async (reason) => {
        const v = document.getElementById('nslot') ? document.getElementById('nslot').value : '3';
        const r = await api.update(u, 'slots', v, reason);
        UI.toast(r.ok ? '槽位已调整' : r.msg);
        await this.refresh();
      });
    }
    if (a === 'acc:unlock') {
      const r = await api.update(u, 'unlock', null, '管理员解锁');
      UI.toast(r.ok ? '已解锁' : r.msg);
      return this.refresh();
    }
    if (a === 'acc:kick') {
      return this.ask({ title: '强制下线', sub: `账号 ${u}`, hint: '该账号全部会话立即失效，玩家侧看到「已在其他设备登出」。' }, async (reason) => {
        const r = await api.forceLogout(u, reason);
        UI.toast(r.ok ? `已下线 ${r.revoked} 个会话` : r.msg);
        await this.refresh();
      });
    }
    if (a === 'acc:disable') {
      return this.ask({ title: '停用账号', sub: `账号 ${u}`, hint: '停用后无法登录，存档与日志全部保留，可随时启用。', danger: true }, async (reason) => {
        const r = await api.update(u, 'disable', null, reason);
        UI.toast(r.ok ? '已停用' : r.msg);
        await this.refresh();
      });
    }
    if (a === 'acc:enable') {
      const r = await api.update(u, 'enable', null, '管理员启用');
      UI.toast(r.ok ? '已启用' : r.msg);
      return this.refresh();
    }
    if (a === 'acc:view') {
      this.tab = 'players';
      this.markTab();
      this.d.pu = u;
      this.d.ps = 1;
      this.d.player = await api.playerData(u, 0);
      return this.render();
    }

    /* --- 存档 --- */
    if (a === 'sav:search') {
      this.d.q = (document.getElementById('sq').value || '').trim();
      return this.refresh();
    }
    if (a === 'sav:detail' || (a === 'sav:export')) {
      const d = await api.saveDetail(i);
      if (!d) return UI.toast('存档不存在');
      if (a === 'sav:export') {
        const name = `${d.row.sect_name}-槽${d.row.slot + 1}-r${d.row.revision}.json`;
        const blob = new Blob([JSON.stringify({ meta: d.row, snapshots: d.snapshots, data: d.row.data }, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        document.body.appendChild(link); link.click();
        setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1500);
        UI.toast('已导出 JSON 快照');
        return;
      }
      const snaps = (d.snapshots || []).map((s) => `<div class="item">
        <div class="main"><div class="name">#${s.id} ${esc(s.reason || '')}</div>
        <div class="meta"><span>${esc(s.created)}</span><span>修订号 ${s.revision}</span></div></div>
        <div class="act"><button class="btn sm ghost" data-a="sav:rollback" data-i="${d.row.id}" data-s="${s.id}">回滚到此</button></div>
      </div>`).join('');
      UI.modal({
        title: `${d.row.sect_name} · 详情`,
        sub: `账号 ${d.row.account || '—'} · 槽位 ${d.row.slot + 1} · 修订号 ${d.row.revision}${d.row.sealed ? ' · 封存中' : ''}`,
        body: `<p class="hint">祖师 ${esc(d.row.founder_name)} · 第 ${d.row.stage} 幕 · 弟子 ${d.row.disciple_count} · 最高 ${d.row.max_step} 步 · 保存于 ${esc(d.row.updated)}</p>
          <div class="row" style="margin:10px 0">
            <button class="btn sm ghost" data-a="sav:snap" data-i="${d.row.id}">留存快照</button>
            <button class="btn sm ghost" data-a="sav:seal" data-i="${d.row.id}" data-v="${d.row.sealed ? '0' : '1'}">${d.row.sealed ? '解封' : '封存'}</button>
          </div>
          <p class="hint">历史快照（最近 10 份）</p>
          <div class="list">${snaps || '<div class="item"><div class="main"><div class="name">尚无快照</div></div></div>'}</div>`,
        actions: [{ label: '关闭', cls: 'ghost', onClick: (c) => c() }],
      });
      return;
    }
    if (a === 'sav:snap') {
      const r = await api.saveSnapshot(i, '管理员手动留存');
      UI.toast(r.ok ? '已留存快照' : r.msg);
      document.getElementById('modalRoot').innerHTML = '';
      return this.refresh();
    }
    if (a === 'sav:seal') {
      const sealed = b.dataset.v === '1';
      return this.ask({ title: sealed ? '封存存档' : '解封存档', sub: `存档 #${i}`, hint: sealed ? '封存后该存档只读，玩家登录时看到「存档维护中」。' : '解封即恢复写入。', needReason: sealed }, async (reason) => {
        const r = await api.saveSeal(i, sealed, reason);
        UI.toast(r.ok ? (sealed ? '已封存' : '已解封') : r.msg);
        document.getElementById('modalRoot').innerHTML = '';
        await this.refresh();
      });
    }
    if (a === 'sav:rollback') {
      return this.ask({ title: '回滚存档', sub: `回滚到快照 #${b.dataset.s}`, hint: '执行前系统会自动把当前状态另存一份快照，回滚本身可被撤销。', danger: true }, async (reason) => {
        const r = await api.saveRollback(i, b.dataset.s, reason);
        UI.toast(r.ok ? '已回滚' : r.msg);
        document.getElementById('modalRoot').innerHTML = '';
        await this.refresh();
      });
    }
    if (a === 'sav:del') {
      return this.ask({ title: '删除存档', sub: `存档 #${i}`, hint: '后台删除是「先封存、后标记」：立刻只读，保留七日，期间可撤销；七日届满才真正清理。', danger: true }, async (reason) => {
        const r = await api.saveDelete(i, reason);
        UI.toast(r.ok ? `已标记删除，将于 ${r.purgeAt} 清理` : r.msg);
        await this.refresh();
      });
    }
    if (a === 'sav:restore') {
      return this.ask({ title: '撤销删除', sub: `存档 #${i}`, hint: '撤销后存档恢复可写，删除标记清除。' }, async (reason) => {
        const r = await api.saveRestore(i, reason);
        UI.toast(r.ok ? '已撤销删除' : r.msg);
        await this.refresh();
      });
    }

    /* --- 玩家数据 --- */
    if (a === 'ply:load') {
      const pu = (document.getElementById('pu').value || '').trim().toLowerCase();
      const ps = Math.max(1, Math.min(10, Number(document.getElementById('ps').value || 1)));
      if (!pu) return UI.toast('请输入账号名');
      this.d.pu = pu; this.d.ps = ps;
      this.d.player = await api.playerData(pu, ps - 1);
      if (!this.d.player) return UI.toast('账号不存在');
      return this.render();
    }

    /* --- 兑换码 --- */
    if (a === 'code:refresh') return this.refresh();
    if (a === 'code:add') {
      const code = (document.getElementById('cu').value || '').trim().toUpperCase().replace(/\s/g, '');
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return UI.toast('兑换码须为 3-32 位大写字母、数字、下划线或短横');
      const reward = buildReward('c_');
      if (!reward) return UI.toast('至少填写一项奖励');
      const bound = (document.getElementById('c_bound').value || '').trim().toLowerCase();
      const days = Number(document.getElementById('c_days').value || 365);
      const note = (document.getElementById('c_note').value || '').trim();
      this.busy = true;
      const r = await api.redeemSet(code, reward, note || null, true, { kind: bound ? 'exclusive' : 'general', bound: bound || null, days });
      this.busy = false;
      if (!r.ok) return UI.toast(r.msg);
      UI.toast(`已发放 ${r.code}`);
      this.tab = 'codes';
      return this.refresh();
    }
    if (a === 'code:batch') {
      const prefix = (document.getElementById('bp').value || '').trim();
      const count = Number(document.getElementById('bn').value || 5);
      const reward = buildReward('b_');
      if (!reward) return UI.toast('至少填写一项奖励');
      const days = Number(document.getElementById('b_days').value || 30);
      const note = (document.getElementById('b_note').value || '').trim();
      return this.ask({ title: '批量生成兑换码', sub: `前缀 ${prefix || 'POTIAN'} · 共 ${count} 枚`, hint: '生成后立即生效，副本可导出。', label: '确认生成' }, async (reason) => {
        const r = await api.redeemBatch(prefix, count, reward, (note || '') + (reason ? `｜${reason}` : ''), days, 'general');
        if (!r.ok) return UI.toast(r.msg);
        UI.toast(`已生成 ${r.codes.length} 枚`);
        await this.refresh();
        download(`兑换码-${prefix || 'POTIAN'}.csv`, [['码值', '奖励', '有效天数'], ...r.codes.map((c) => [c, JSON.stringify(reward), days])]);
      });
    }
    if (a === 'code:toggle') {
      const r = await api.redeemSet(u, null, null, b.dataset.v === '1');
      UI.toast(r.ok ? '已更新' : r.msg);
      return this.refresh();
    }
    if (a === 'code:export') {
      download('兑换码表.csv', [['码值', '类型', '奖励', '绑定', '已兑', '状态', '截止'],
        ...this.d.codes.map((c) => [c.code, c.kind || 'general', JSON.stringify(c.reward || {}), c.bound || '', c.used || 0, c.active ? '生效' : '停用', c.ends_at || ''])]);
      return;
    }
    if (a === 'code:logexport') {
      download('兑换核销记录.csv', [['码值', '账号', '槽位', '时间', '奖励'],
        ...(this.d.redeemLogs || []).map((l) => [l.code, l.account, (l.slot || 0) + 1, l.at, rewardText(l.reward)])]);
      return;
    }

    /* --- 赛季 --- */
    if (a === 'ss:open') {
      UI.modal({
        title: '开启新赛季',
        sub: '新赛季榜单从零累计，旧赛季记录与快照保留',
        body: `<label class="field"><span>赛季名</span><input id="sn" maxlength="16" placeholder="留空则自动命名"></label>
          <label class="field"><span>操作理由</span><input id="opReason" maxlength="80" placeholder="将写入日志"></label>`,
        actions: [
          { label: '开启', cls: 'primary', onClick: async (c) => {
              const reason = document.getElementById('opReason').value.trim();
              const name = document.getElementById('sn').value.trim();
              if (!reason) return UI.toast('请填写操作理由');
              const r = await api.seasonOpen(name || null, reason);
              c();
              UI.toast(r.ok ? `第 ${r.no} 赛季已开启` : r.msg);
              await this.refresh();
            } },
          { label: '取消', cls: 'ghost', onClick: (c) => c() },
        ],
      });
      return;
    }
    if (a === 'ss:end') {
      return this.ask({ title: `结束第 ${n} 赛季`, sub: '结束后锁定榜单快照', hint: '结束后才可重置；重置前请先导出榜单作为备份。', danger: true }, async (reason) => {
        const r = await api.seasonEnd(n, reason);
        UI.toast(r.ok ? `已结束，锁定 ${r.rows} 行榜单` : r.msg);
        if (r.ok && r.standings) {
          download(`第${n}赛季榜单.csv`, [['名次', '宗门', '祖师', '声望', '最高步', '弟子数'],
            ...r.standings.map((x) => [x.rank, x.sect_name, x.founder_name, x.renown, x.max_step, x.disciple_count])]);
        }
        await this.refresh();
      });
    }
    if (a === 'ss:reset') {
      return this.ask({ title: `重置第 ${n} 赛季`, sub: '清空榜单分数与赛季统计', hint: '弟子、资源、建筑与剧情进度不受影响；历史快照保留，可据此回填。', danger: true }, async (reason) => {
        const r = await api.seasonReset(n, reason);
        UI.toast(r.ok ? `已清零 ${r.cleared} 行榜单` : r.msg);
        await this.refresh();
      });
    }
    if (a === 'ss:view') {
      const list = await api.seasonStandings(n);
      UI.modal({
        title: `第 ${n} 赛季榜单`,
        sub: `共 ${list.length} 行`,
        body: `<div class="list">${list.length ? list.map((x) => `<div class="item">
          <div class="main"><div class="name">${x.rank}. ${esc(x.sect_name || '—')} <span class="pill mute">${esc(x.account || '—')}</span></div>
          <div class="meta"><span>祖师 ${esc(x.founder_name || '—')}</span><span>声望 ${num(x.renown)}</span><span>最高 ${x.max_step} 步</span><span>弟子 ${x.disciple_count}</span></div></div>
        </div>`).join('') : '<div class="item"><div class="main"><div class="name">暂无数据</div></div></div>'}</div>`,
        actions: [
          { label: '导出', cls: 'ghost', onClick: (c) => {
              download(`第${n}赛季榜单.csv`, [['名次', '账号', '宗门', '祖师', '声望', '最高步', '弟子数'],
                ...list.map((x) => [x.rank, x.account, x.sect_name, x.founder_name, x.renown, x.max_step, x.disciple_count])]);
            } },
          { label: '关闭', cls: 'primary', onClick: (c) => c() },
        ],
      });
      return;
    }
    if (a === 'ss:award') {
      UI.modal({
        title: `按名次发奖 · 第 ${n} 赛季`,
        sub: '为前若干名各生成一枚绑定该账号的专属码',
        body: `<div class="form-grid">
            <label class="field"><span>奖励名额</span><input id="an" type="number" min="1" max="20" value="3"></label>
            <label class="field"><span>灵石</span><input id="a_lingshi" type="number" min="0" placeholder="0"></label>
            <label class="field"><span>丹药</span><input id="a_danyao" type="number" min="0" placeholder="0"></label>
            <label class="field"><span>奇珍异宝</span><input id="a_qizhen" type="number" min="0" placeholder="0"></label>
            <label class="field"><span>有效天数</span><input id="a_days" type="number" min="1" max="365" value="30"></label>
          </div>
          <label class="field"><span>操作理由</span><input id="opReason" maxlength="80" placeholder="将写入日志"></label>
          <p class="hint">生成后请导出码表并线下发给对应玩家；专属码只能由绑定账号兑换。</p>`,
        actions: [
          { label: '生成专属码', cls: 'primary', onClick: async (c) => {
              const reason = document.getElementById('opReason').value.trim();
              if (!reason) return UI.toast('请填写操作理由');
              const reward = buildReward('a_');
              if (!reward) return UI.toast('至少填写一项奖励');
              const r = await api.seasonAward(n, reward, document.getElementById('an').value, reason, document.getElementById('a_days').value);
              c();
              if (!r.ok) return UI.toast(r.msg);
              UI.toast(`已生成 ${r.codes.length} 枚专属码`);
              download(`第${n}赛季奖励码.csv`, [['名次', '账号', '宗门', '码值'], ...r.codes.map((x) => [x.rank, x.account, x.sect, x.code])]);
              await this.refresh();
            } },
          { label: '取消', cls: 'ghost', onClick: (c) => c() },
        ],
      });
      return;
    }

    /* --- 开关 --- */
    if (a === 'sw:refresh') return this.refresh();
    if (a === 'sw:toggle') {
      const on = b.dataset.v === '1';
      const name = MOD_NAME[k] || k;
      return this.ask({ title: `${on ? '开启' : '关闭'}${name}`, sub: '全服级开关', hint: '关闭不触发任何数据清理，已产生的数据原样保留。', danger: !on }, async (reason) => {
        const r = await api.moduleSet(k, on, reason);
        UI.toast(r.ok ? `已${on ? '开启' : '关闭'}${name}` : r.msg);
        await this.refresh();
      });
    }
    if (a === 'sw:white') {
      const st = this.d.settings || {};
      const list = (st.whitelist || {})[k] || [];
      UI.modal({
        title: `${MOD_NAME[k]} · 白名单`,
        sub: '模块关闭时，仅名单内账号可见入口',
        body: `<label class="field"><span>添加账号</span><input id="wuser" maxlength="20" placeholder="账号名"></label>
          <p class="hint">当前：${list.length ? list.map(esc).join('、') : '空（全关状态）'}</p>
          <div class="list">${list.map((x) => `<div class="item"><div class="main"><div class="name">${esc(x)}</div></div>
            <div class="act"><button class="btn sm ghost danger" data-a="sw:wdel" data-k="${k}" data-u="${esc(x)}">移出</button></div></div>`).join('')}</div>`,
        actions: [
          { label: '加入', cls: 'primary', onClick: async (c) => {
              const v = (document.getElementById('wuser').value || '').trim().toLowerCase();
              if (!v) return UI.toast('请输入账号名');
              const r = await api.whitelistSet(k, v, true, '白名单变更');
              if (!r.ok) return UI.toast(r.msg);
              UI.toast(`已加入 ${v}`);
              c(); await this.refresh(); await this.onClick({ target: { closest: () => ({ dataset: { a: 'sw:white', k } }) } });
            } },
          { label: '关闭', cls: 'ghost', onClick: (c) => c() },
        ],
      });
      return;
    }
    if (a === 'sw:wdel') {
      const r = await api.whitelistSet(k, u, false, '白名单变更');
      UI.toast(r.ok ? '已移出' : r.msg);
      document.getElementById('modalRoot').innerHTML = '';
      await this.refresh();
      return this.onClick({ target: { closest: () => ({ dataset: { a: 'sw:white', k } }) } });
    }

    /* --- 日志 --- */
    if (a === 'log:search') {
      this.d.logModule = document.getElementById('lm').value;
      this.d.logQ = (document.getElementById('lq').value || '').trim();
      return this.refresh();
    }
    if (a === 'log:export') {
      download('后台日志.csv', [['时间', '模块', '动作', '操作人', '对象', '理由', '明细'],
        ...(this.d.logs || []).map((l) => [l.at, l.module, l.action, l.actor || '', l.target || '', l.reason || '', JSON.stringify(l.detail || {})])]);
      return;
    }

    /* --- 设置 --- */
    if (a === 'set:save') {
      const announcement = (document.getElementById('ann').value || '').trim();
      const security = {
        maxDevices: Number(document.getElementById('maxDev').value || 0),
        lockThreshold: Number(document.getElementById('lockTh').value || 5),
        tokenHours: Number(document.getElementById('tokH').value || 168),
      };
      return this.ask({ title: '保存后台设置', sub: '公告与安全策略', hint: '改动即时生效并写入日志。' }, async (reason) => {
        const r = await api.settingsSet({ announcement, security }, reason);
        UI.toast(r.ok ? '已保存' : r.msg);
        await this.refresh();
      });
    }
  },
};

function buildReward(prefix) {
  const res = {};
  for (const k of ['lingshi', 'danyao', 'qizhen']) {
    const el = document.getElementById(prefix + k);
    const v = Number((el && el.value) || 0);
    if (v > 0) res[k] = Math.round(v);
  }
  const renown = Number((document.getElementById(prefix + 'renown') || {}).value || 0);
  if (!Object.keys(res).length && !renown) return null;
  const reward = {};
  if (Object.keys(res).length) reward.res = res;
  if (renown > 0) reward.renown = Math.round(renown);
  return reward;
}

function rewardText(r) {
  const x = r || {};
  const parts = Object.entries(x.res || {}).map(([k, v]) => `${resName(k)}×${v}`);
  if (x.renown) parts.push(`声望+${x.renown}`);
  if (x.fortune) parts.push(`气运+${x.fortune}`);
  return parts.join('、') || '无';
}

function resName(k) {
  const m = { lingshi: '灵石', liangshi: '粮食', lingzhi: '灵植', lingyao: '灵药', danyao: '丹药', qicai: '炼器材料', fulu: '符箓材料', zhenfa: '阵法材料', yaoshou: '妖兽材料', kuangshi: '矿石', qizhen: '奇珍异宝', gongfa: '功法残页' };
  return m[k] || k;
}
