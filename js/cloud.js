/* 破天宗 · 云服务层
 * 自建账号体系：账号只能由管理员创建，玩家不可自助注册。
 * 口令经服务端加盐多次散列后存储，客户端只持有会话令牌。
 */

const PUBLIC_CONFIG = {
  endpoint: 'https://potian-sect.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_VAGgbXsD36Il9ImstxMN8y_ov7XC2ckFiMYKQB442ggUv4v6ArwZbKW',
};

const TOKEN_KEY = 'potian.token';
const ACCOUNT_KEY = 'potian.account';

let cloud = null;
let account = null;

export function getCloud() {
  if (cloud) return cloud;
  const factory = window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud;
  if (typeof factory !== 'function') {
    throw new Error('云端组件未能载入，请检查网络后刷新页面');
  }
  cloud = factory({
    endpoint: PUBLIC_CONFIG.endpoint,
    oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
    publishableKey: PUBLIC_CONFIG.publishableKey,
  });
  return cloud;
}

/* ---------- 底层调用 ---------- */
export function token() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}

function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* 隐私模式忽略 */ }
}

async function call(name, args) {
  const res = await getCloud().database.rpc(name, args || {});
  if (res && res.error) {
    const err = new Error((res.error && res.error.message) || '云端请求失败');
    err.cloud = res.error;
    throw err;
  }
  return (res && res.data !== undefined) ? res.data : null;
}

/* ---------- 账号 ---------- */
export function currentAccount() { return account; }
export function isAdmin() { return !!(account && account.role === 'admin'); }
export function displayName() {
  if (!account) return '道友';
  return account.nick || account.username || '道友';
}

function remember(tok, acc) {
  account = acc || null;
  setToken(tok || '');
  try {
    if (acc) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acc));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch (e) { /* ignore */ }
}

export async function login(username, password) {
  let data;
  try {
    data = await call('account_login', { p_user: username, p_pass: password });
  } catch (e) {
    return { ok: false, reason: 'error', msg: friendly(e) };
  }
  if (!data || !data.ok) {
    const map = {
      no_account: '账号不存在，请联系宗门管理方',
      bad_password: '口令不正确',
      disabled: '此账号已被停用',
    };
    return { ok: false, reason: data && data.reason, msg: map[data && data.reason] || '登录失败' };
  }
  remember(data.token, data.account);
  return { ok: true, account: data.account };
}

/* 用本地令牌恢复会话；失效则清空 */
export async function restore() {
  const tok = token();
  if (!tok) return null;
  try {
    const data = await call('account_me', { p_token: tok });
    if (!data || !data.ok) { remember('', null); return null; }
    account = data.account;
    return account;
  } catch (e) {
    return null;
  }
}

export async function logout() {
  const tok = token();
  remember('', null);
  if (tok) { try { await call('account_logout', { p_token: tok }); } catch (e) { /* ignore */ } }
}

export async function changePassword(oldPass, newPass) {
  try {
    const data = await call('account_change_pass', { p_token: token(), p_old: oldPass, p_new: newPass });
    if (!data || !data.ok) {
      const map = { unauthenticated: '登录已失效，请重新登录', bad_password: '原口令不正确', weak: '新口令至少 6 位' };
      return { ok: false, msg: map[data && data.reason] || '修改失败' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: friendly(e) };
  }
}

/* ---------- 存档 ---------- */
export async function listSaves() {
  const data = await call('save_list', { p_token: token() });
  return Array.isArray(data) ? data : [];
}

export async function loadSave(slot) {
  const data = await call('save_get', { p_token: token(), p_slot: slot });
  if (!data || !data.ok) return null;
  return data.row;
}

/* 写入：带修订号校验。冲突返回 { conflict: true } */
export async function putSave(save, expectedRevision) {
  const data = await call('save_put', {
    p_token: token(),
    p_slot: save.slot,
    p_data: save,
    p_expected: expectedRevision == null ? null : Number(expectedRevision),
  });
  if (!data || !data.ok) {
    if (data && data.reason === 'conflict') return { ok: false, conflict: true };
    if (data && data.reason === 'unauthenticated') return { ok: false, auth: true };
    return { ok: false, msg: '保存失败' };
  }
  return { ok: true, revision: Number(data.revision), id: data.id };
}

export async function deleteSave(slot) {
  const data = await call('save_del', { p_token: token(), p_slot: slot });
  return !!(data && data.ok);
}

/* ---------- 榜单 ---------- */
export async function syncRanking(save) {
  try {
    await call('rank_push', {
      p_token: token(),
      p_season: 1,
      p_row: {
        sect_name: save.sect.name,
        founder_name: save.sect.founder,
        renown: Math.round(save.sect.renown || 0),
        max_step: (save.stats && save.stats.peakStep) || 1,
        disciple_count: (save.disciples || []).length,
        stage: save.sect.stage || 1,
      },
    });
  } catch (e) { /* 榜单失败不影响主流程 */ }
}

export async function fetchRanking(limit = 50) {
  try {
    const data = await call('rank_top', { p_limit: limit });
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

/* ---------- 兑换码 ---------- */
export async function redeem(code, slot) {
  try {
    const data = await call('redeem_code', { p_token: token(), p_code: code, p_slot: slot });
    if (!data) return { ok: false, reason: 'error' };
    return data;
  } catch (e) {
    return { ok: false, reason: 'error', msg: friendly(e) };
  }
}

/* ---------- 管理员 ---------- */
function adminCall(name, args) {
  return call(name, Object.assign({ p_token: token() }, args || {}));
}

export const admin = {
  async list() {
    const d = await adminCall('admin_account_list');
    return Array.isArray(d) ? d : [];
  },
  async create({ username, password, nick, role, note }) {
    const d = await adminCall('admin_account_create', {
      p_user: username, p_pass: password, p_nick: nick, p_role: role || 'player', p_note: note,
    });
    if (!d || !d.ok) {
      const map = {
        forbidden: '需要管理员权限', bad_username: '账号名须为 3-20 位小写字母、数字或下划线',
        weak: '口令至少 6 位', exists: '该账号名已被占用',
      };
      return { ok: false, msg: map[d && d.reason] || '创建失败' };
    }
    return { ok: true, username: d.username };
  },
  async update(username, action, value) {
    const d = await adminCall('admin_account_update', { p_user: username, p_action: action, p_value: value });
    if (!d || !d.ok) {
      const map = { forbidden: '需要管理员权限', not_found: '账号不存在', weak: '口令至少 6 位', self: '不能对当前登录账号执行此操作' };
      return { ok: false, msg: map[d && d.reason] || '操作失败' };
    }
    return { ok: true };
  },
  async redeemList() {
    const d = await adminCall('admin_redeem_list');
    return Array.isArray(d) ? d : [];
  },
  async redeemSet(code, reward, note, active = true) {
    const d = await adminCall('admin_redeem_set', { p_code: code, p_reward: reward, p_note: note, p_active: active });
    if (!d || !d.ok) {
      const map = { forbidden: '需要管理员权限', bad_code: '兑换码须为 3-24 位大写字母、数字或下划线' };
      return { ok: false, msg: map[d && d.reason] || '操作失败' };
    }
    return { ok: true };
  },
};

function friendly(err) {
  const m = (err && err.message) || '请求失败';
  if (/failed to fetch|network|NetworkError/i.test(m)) return '无法连接云端，请检查网络后重试';
  return m;
}
