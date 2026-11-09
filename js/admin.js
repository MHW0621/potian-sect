/* 破天宗 · 管理台
 * 仅 role=admin 可见：开立账号、重置口令、停启账号、维护兑换码。
 */
import { admin as api, currentAccount, displayName } from './cloud.js';
import { UI } from './ui.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === id));
  window.scrollTo(0, 0);
}

export const Admin = {
  tab: 'accounts',
  accounts: [],
  codes: [],

  async open() {
    const acc = currentAccount();
    if (!acc || acc.role !== 'admin') return UI.toast('仅管理员可进入管理台');
    const who = document.getElementById('adminWho');
    if (who) who.textContent = `${displayName()} · 管理员 · ${acc.username}`;
    this.bind();
    await this.refresh();
    showView('view-admin');
  },

  bind() {
    if (this._bound) return;
    this._bound = true;
    document.getElementById('btnAdminBack').addEventListener('click', () => {
      this.helpers && this.helpers.back ? this.helpers.back() : showView('view-slots');
    });
    document.getElementById('adminTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-atab]');
      if (!b) return;
      this.tab = b.dataset.atab;
      document.querySelectorAll('#adminTabs [data-atab]').forEach((x) => x.classList.toggle('is-on', x === b));
      this.render();
    });
    document.getElementById('adminStage').addEventListener('click', (e) => this.onClick(e));
  },

  async refresh() {
    try {
      if (this.tab === 'codes') this.codes = await api.redeemList();
      else this.accounts = await api.list();
    } catch (err) {
      UI.toast(err.message || '读取失败');
    }
    this.render();
  },

  render() {
    const box = document.getElementById('adminStage');
    if (!box) return;
    box.innerHTML = this.tab === 'codes' ? this.codesHtml() : this.tab === 'notice' ? this.noticeHtml() : this.accountsHtml();
  },

  /* ---------- 账号 ---------- */
  accountsHtml() {
    const rows = this.accounts.map((a) => {
      const isAdmin = a.role === 'admin';
      const off = a.status !== 'active';
      const me = currentAccount() && currentAccount().username === a.username;
      return `<div class="item">
        <div class="main">
          <div class="name">${esc(a.username)}
            <span class="pill ${isAdmin ? 'gold' : 'jade'}">${isAdmin ? '管理员' : '玩家'}</span>
            ${off ? '<span class="pill">已停用</span>' : ''}
            ${me ? '<span class="pill mute">当前登录</span>' : ''}
          </div>
          <div class="meta">
            <span>称呼 ${esc(a.nick || '—')}</span>
            <span>存档 ${a.saves || 0}</span>
            <span>创建 ${esc(a.created_at || '—')}</span>
            <span>上次登录 ${esc(a.last_login || '从未')}</span>
          </div>
        </div>
        <div class="act">
          <button class="btn sm ghost" data-a="reset" data-u="${esc(a.username)}">重置口令</button>
          <button class="btn sm ${off ? 'primary' : 'ghost'}" data-a="${off ? 'enable' : 'disable'}" data-u="${esc(a.username)}">${off ? '启用' : '停用'}</button>
          <button class="btn sm ghost danger" data-a="del" data-u="${esc(a.username)}">删除</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>开立新账号</h3><small>玩家账号只能在此创建，站点不提供自助注册</small></div></div>
        <div class="form-grid">
          <label class="field"><span>账号</span><input id="nu" maxlength="20" autocapitalize="off" spellcheck="false" placeholder="3-20 位小写字母/数字/下划线"></label>
          <label class="field"><span>称呼</span><input id="nn" maxlength="12" placeholder="显示名，可留空"></label>
          <label class="field"><span>初始口令</span><input id="np" maxlength="64" placeholder="至少 6 位"></label>
          <label class="field"><span>角色</span>
            <select id="nr"><option value="player">玩家</option><option value="admin">管理员</option></select>
          </label>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" data-a="create">开立账号</button>
          <button class="btn ghost" data-a="refresh">刷新名录</button>
        </div>
        <p class="hint">口令经服务端加盐散列存储，管理台不可见；忘记时只能重置。建议玩家首次登录后在「设置」中自行修改。</p>
      </div>

      <div class="card">
        <div class="card-head"><div class="t"><h3>账号名录</h3><small>共 ${this.accounts.length} 个</small></div></div>
        <div class="list">${rows || '<div class="item"><div class="main"><div class="name">尚无账号</div></div></div>'}</div>
      </div>
    </div>`;
  },

  /* ---------- 兑换码 ---------- */
  codesHtml() {
    const rows = this.codes.map((c) => {
      const r = c.reward || {};
      const res = r.res || {};
      const parts = Object.entries(res).filter(([, v]) => Number(v)).map(([k, v]) => `${resName(k)} ×${v}`);
      if (r.renown) parts.push(`声望 +${r.renown}`);
      if (r.fortune) parts.push(`气运 +${r.fortune}`);
      return `<div class="item">
        <div class="main">
          <div class="name">${esc(c.code)} <span class="pill ${c.active ? 'jade' : ''}">${c.active ? '生效中' : '已停用'}</span>
            <span class="pill mute">已兑 ${c.used || 0}</span></div>
          <div class="meta"><span>${esc(parts.join('、') || '无奖励')}</span><span>${esc(c.note || '')}</span><span>截止 ${esc(c.ends_at || '—')}</span></div>
        </div>
        <div class="act">
          <button class="btn sm ${c.active ? 'ghost' : 'primary'}" data-a="code:toggle" data-u="${esc(c.code)}" data-v="${c.active ? '0' : '1'}">${c.active ? '停用' : '启用'}</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>发一枚兑换码</h3><small>同码重发会覆盖奖励内容</small></div></div>
        <div class="form-grid">
          <label class="field"><span>兑换码</span><input id="cu" maxlength="24" autocapitalize="characters" spellcheck="false" placeholder="如 POTIAN2026"></label>
          <label class="field"><span>灵石</span><input id="c_lingshi" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>丹药</span><input id="c_danyao" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>奇珍异宝</span><input id="c_qizhen" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>声望</span><input id="c_renown" type="number" min="0" placeholder="0"></label>
          <label class="field"><span>备注</span><input id="c_note" maxlength="40" placeholder="发放缘由，可留空"></label>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" data-a="code:add">发放</button>
          <button class="btn ghost" data-a="code:refresh">刷新</button>
        </div>
        <p class="hint">后台只发码，不改数值。每账号对同一码只能兑一次，由服务端核销。</p>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>已发兑换码</h3><small>共 ${this.codes.length} 枚</small></div></div>
        <div class="list">${rows || '<div class="item"><div class="main"><div class="name">尚无兑换码</div></div></div>'}</div>
      </div>
    </div>`;
  },

  noticeHtml() {
    return `<div class="stack">
      <div class="card">
        <div class="card-head"><div class="t"><h3>账号规则</h3></div></div>
        <p class="hint">· 站点不提供手机号、邮箱等自助注册入口；《破天宗》的账号一律由管理台开立。<br>
        · 口令以加盐多次散列存储，服务端不回传明文，也不可反查；遗失只能重置为临时口令。<br>
        · 停用账号会立刻踢下线，云端存档保留；删除账号连同其三处存档一并清除，不可撤销。</p>
      </div>
      <div class="card">
        <div class="card-head"><div class="t"><h3>数值边界</h3></div></div>
        <p class="hint">· 管理台不改境界、步数、资源上限与突破概率，这些只由宗门内的经营与考核决定。<br>
        · 兑换码是唯一的外部投放手段，且单账号一次。<br>
        · 榜单只展示宗门名、祖师、声望、最高步与弟子数，不暴露账号信息。</p>
      </div>
    </div>`;
  },

  /* ---------- 交互 ---------- */
  async onClick(e) {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const act = b.dataset.a;
    const user = b.dataset.u || '';

    if (act === 'refresh' || act === 'code:refresh') { await this.refresh(); return; }

    if (act === 'create') {
      const username = (document.getElementById('nu').value || '').trim().toLowerCase();
      const nick = (document.getElementById('nn').value || '').trim();
      const password = document.getElementById('np').value || '';
      const role = document.getElementById('nr').value;
      if (!/^[a-z0-9_]{3,20}$/.test(username)) return UI.toast('账号名须为 3-20 位小写字母、数字或下划线');
      if (password.length < 6) return UI.toast('口令至少 6 位');
      b.disabled = true;
      const r = await api.create({ username, password, nick, role, note: null });
      b.disabled = false;
      if (!r.ok) return UI.toast(r.msg);
      UI.toast(`已开立账号 ${r.username}`);
      await this.refresh();
      return;
    }

    if (act === 'reset') {
      UI.modal({
        title: '重置口令',
        sub: `账号 ${user}`,
        body: `<label class="field"><span>临时口令</span><input id="npass" maxlength="64" placeholder="至少 6 位"></label>
          <p class="hint">重置后该账号所有已登录设备将立即失效。</p>`,
        actions: [
          { label: '确认重置', cls: 'primary', onClick: async (close) => {
              const v = document.getElementById('npass').value || '';
              if (v.length < 6) return UI.toast('口令至少 6 位');
              const r = await api.update(user, 'reset', v);
              if (!r.ok) return UI.toast(r.msg);
              close(); UI.toast('口令已重置'); await this.refresh();
            } },
          { label: '取消', cls: 'ghost', onClick: (c) => c() },
        ],
      });
      return;
    }

    if (act === 'disable' || act === 'enable') {
      const r = await api.update(user, act);
      if (!r.ok) return UI.toast(r.msg);
      UI.toast(act === 'disable' ? '已停用' : '已启用');
      await this.refresh();
      return;
    }

    if (act === 'del') {
      UI.modal({
        title: '删除账号',
        sub: `账号 ${user} 及其全部存档将被清除`,
        body: '<p class="hint">此操作不可撤销。若只是暂时禁止登录，请改用「停用」。</p>',
        actions: [
          { label: '确认删除', cls: 'danger', onClick: async (close) => {
              const r = await api.update(user, 'delete');
              if (!r.ok) return UI.toast(r.msg);
              close(); UI.toast('已删除'); await this.refresh();
            } },
          { label: '取消', cls: 'ghost', onClick: (c) => c() },
        ],
      });
      return;
    }

    if (act === 'code:add') {
      const code = (document.getElementById('cu').value || '').trim().toUpperCase().replace(/\s/g, '');
      if (!/^[A-Z0-9_]{3,24}$/.test(code)) return UI.toast('兑换码须为 3-24 位大写字母、数字或下划线');
      const res = {};
      for (const k of ['lingshi', 'danyao', 'qizhen']) {
        const v = Number(document.getElementById('c_' + k).value || 0);
        if (v > 0) res[k] = Math.round(v);
      }
      const renown = Number(document.getElementById('c_renown').value || 0);
      if (!Object.keys(res).length && !renown) return UI.toast('至少填写一项奖励');
      const reward = {};
      if (Object.keys(res).length) reward.res = res;
      if (renown > 0) reward.renown = Math.round(renown);
      const note = (document.getElementById('c_note').value || '').trim();
      const r = await api.redeemSet(code, reward, note || null, true);
      if (!r.ok) return UI.toast(r.msg);
      UI.toast(`已发放 ${r.code || code}`);
      this.tab = 'codes';
      await this.refresh();
      return;
    }

    if (act === 'code:toggle') {
      const r = await api.redeemSet(user, null, null, b.dataset.v === '1');
      if (!r.ok) return UI.toast(r.msg);
      await this.refresh();
    }
  },
};

function resName(k) {
  const m = { lingshi: '灵石', liangshi: '粮食', lingzhi: '灵植', lingyao: '灵药', danyao: '丹药', qicai: '炼器材料', fulu: '符箓材料', zhenfa: '阵法材料', yaoshou: '妖兽材料', kuangshi: '矿石', qizhen: '奇珍异宝', gongfa: '功法残页' };
  return m[k] || k;
}
