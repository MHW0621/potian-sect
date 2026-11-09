/* 破天宗 · 云服务层
 * 自建账号体系：账号只能由管理员创建，玩家不可自助注册。
 * 口令经服务端加盐多次散列后存储，客户端只持有会话令牌。
 * 全部读写经 SECURITY DEFINER 函数，客户端拿不到表结构。
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

/* ---------- 设备标识（归一化为桌面/平板/手机三类） ---------- */
function deviceTag() {
  const ua = (navigator && navigator.userAgent) || '';
  let kind = '桌面端';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) kind = '平板端';
  else if (/Mobile|iPhone|Android|HarmonyOS|MicroMessenger/i.test(ua)) kind = '手机端';
  let br = '浏览器';
  if (/MicroMessenger/i.test(ua)) br = '微信';
  else if (/Edg\//i.test(ua)) br = 'Edge';
  else if (/Chrome\//i.test(ua)) br = 'Chrome';
  else if (/Safari\//i.test(ua)) br = 'Safari';
  else if (/Firefox\//i.test(ua)) br = 'Firefox';
  return `${kind}·${br}`;
}

/* ---------- 账号 ---------- */
export function currentAccount() { return account; }
export function isAdmin() { return !!(account && account.role === 'admin'); }
export function displayName() {
  if (!account) return '道友';
  return account.nick || account.username || '道友';
}
export function slotLimit() {
  return (account && account.slotLimit) || 3;
}
export function mustChangePass() {
  return !!(account && account.mustChange);
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
    data = await call('account_login', {
      p_user: username, p_pass: password, p_dev: deviceTag(), p_ip: null,
    });
  } catch (e) {
    return { ok: false, reason: 'error', msg: friendly(e) };
  }
  if (!data || !data.ok) {
    const map = {
      no_account: '账号不存在，请联系宗门管理方',
      bad_password: data && data.left ? `口令不正确，再错 ${data.left} 次将临时锁定` : '口令不正确',
      disabled: '此账号已被停用',
      locked: '账号已临时锁定，请十五分钟后再试或联系管理员解锁',
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
    if (account) account.mustChange = false;
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: friendly(e) };
  }
}

export async function sessions() {
  const d = await call('account_sessions', { p_token: token() });
  return Array.isArray(d) ? d : [];
}

export async function revokeSession(sid) {
  const d = await call('session_revoke', { p_token: token(), p_sid: sid });
  return !!(d && d.ok);
}

/* ---------- 全服开关与公告 ---------- */
export async function flags() {
  try {
    const d = await call('player_flags', { p_token: token() });
    return d || { announcement: '', modules: {} };
  } catch (e) {
    return { announcement: '', modules: {} };
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

/* 写入：带修订号校验。冲突返回 { conflict: true }
 * extra 仅在本次请求中附加（例如待处理镜像），不写回本地存档对象。 */
export async function putSave(save, expectedRevision, extra) {
  const payload = extra ? Object.assign({}, save, extra) : save;
  const data = await call('save_put', {
    p_token: token(),
    p_slot: save.slot,
    p_data: payload,
    p_expected: expectedRevision == null ? null : Number(expectedRevision),
  });
  if (!data || !data.ok) {
    if (data && data.reason === 'conflict') return { ok: false, conflict: true };
    if (data && data.reason === 'unauthenticated') return { ok: false, auth: true };
    if (data && data.reason === 'slot_limit') return { ok: false, slotLimit: true, msg: '存档槽位不足，请联系管理员开通' };
    if (data && data.reason === 'sealed') return { ok: false, sealed: true, msg: '存档维护中，暂时无法写入' };
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

/* ---------- 行为日志（弟子/剧情/对战三类由客户端上报摘要） ---------- */
export function logEvent(module, action, detail) {
  call('log_append', {
    p_token: token(), p_module: module, p_action: action, p_detail: detail || {},
  }).catch(() => {});
}

/* ---------- 场景与待处理（V1.4） ---------- */
export async function sceneState(slot) {
  try {
    const d = await call('scene_state', { p_token: token(), p_slot: slot });
    return d && d.ok ? d : null;
  } catch (e) { return null; }
}

export async function pendingList(slot) {
  try {
    const d = await call('pending_list', { p_token: token(), p_slot: slot });
    return d && d.ok ? d : null;
  } catch (e) { return null; }
}

/* 事项处置：携带请求编号，重复提交由服务端幂等返回 */
export async function matterAct(slot, reqId, ref, action, note) {
  try {
    const d = await call('matter_act', {
      p_token: token(), p_slot: slot, p_req: reqId, p_ref: ref, p_action: action, p_note: note || null,
    });
    return d || { ok: false };
  } catch (e) { return { ok: false }; }
}

export async function policySet(slot, patch) {
  try {
    const d = await call('policy_set', { p_token: token(), p_slot: slot, p_patch: patch });
    return d || { ok: false };
  } catch (e) { return { ok: false }; }
}

/* ---------- 管理员 ---------- */
function adminCall(name, args) {
  return call(name, Object.assign({ p_token: token() }, args || {}));
}

export const admin = {
  async overview() {
    const d = await adminCall('admin_overview');
    return d || {};
  },

  /* 账号 */
  async list() {
    const d = await adminCall('admin_account_list');
    return Array.isArray(d) ? d : [];
  },
  async create({ username, password, nick, role, note, slotLimit }) {
    const d = await adminCall('admin_account_create', {
      p_user: username, p_pass: password, p_nick: nick, p_role: role || 'player',
      p_note: note, p_slot_limit: slotLimit == null ? 3 : Number(slotLimit),
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
  async update(username, action, value, reason) {
    const d = await adminCall('admin_account_update', {
      p_user: username, p_action: action, p_value: value, p_reason: reason || null,
    });
    if (!d || !d.ok) {
      const map = {
        forbidden: '需要管理员权限', not_found: '账号不存在', weak: '口令至少 6 位',
        self: '不能对当前登录账号执行此操作',
      };
      return { ok: false, msg: map[d && d.reason] || '操作失败' };
    }
    return { ok: true };
  },
  async forceLogout(username, reason) {
    const d = await adminCall('admin_force_logout', { p_user: username, p_reason: reason });
    if (!d || !d.ok) return { ok: false, msg: '操作失败' };
    return { ok: true, revoked: d.revoked };
  },

  /* 存档 */
  async saveList(q) {
    const d = await adminCall('admin_save_list', { p_q: q || null });
    return Array.isArray(d) ? d : [];
  },
  async saveDetail(id) {
    const d = await adminCall('admin_save_detail', { p_id: Number(id) });
    return d && d.ok ? d : null;
  },
  async saveSeal(id, sealed, reason) {
    const d = await adminCall('admin_save_seal', { p_id: Number(id), p_sealed: !!sealed, p_reason: reason });
    return d && d.ok ? { ok: true } : { ok: false, msg: '操作失败' };
  },
  async saveSnapshot(id, reason) {
    const d = await adminCall('admin_save_snapshot', { p_id: Number(id), p_reason: reason });
    return d && d.ok ? { ok: true } : { ok: false, msg: '操作失败' };
  },
  async saveRollback(id, snapId, reason) {
    const d = await adminCall('admin_save_rollback', {
      p_id: Number(id), p_snap: Number(snapId), p_reason: reason,
    });
    if (!d || !d.ok) return { ok: false, msg: d && d.reason === 'no_snapshot' ? '快照不存在' : '回滚失败' };
    return { ok: true };
  },
  async saveDelete(id, reason) {
    const d = await adminCall('admin_save_delete', { p_id: Number(id), p_reason: reason });
    return d && d.ok ? { ok: true, purgeAt: d.purge_at } : { ok: false, msg: '操作失败' };
  },
  async saveRestore(id, reason) {
    const d = await adminCall('admin_save_restore', { p_id: Number(id), p_reason: reason });
    return d && d.ok ? { ok: true } : { ok: false, msg: '操作失败' };
  },
  async savePurge() {
    const d = await adminCall('admin_save_purge');
    return d && d.ok ? d.removed : 0;
  },

  /* 玩家数据 */
  async playerData(username, slot) {
    const d = await adminCall('admin_player_data', { p_username: username, p_slot: slot == null ? 0 : slot });
    return d && d.ok ? d : null;
  },

  /* 兑换码 */
  async redeemList() {
    const d = await adminCall('admin_redeem_list');
    return Array.isArray(d) ? d : [];
  },
  async redeemSet(code, reward, note, active = true, opt = {}) {
    const d = await adminCall('admin_redeem_set', {
      p_code: code, p_reward: reward, p_note: note, p_active: active,
      p_kind: opt.kind || 'general', p_bound: opt.bound || null,
      p_days: opt.days == null ? 365 : Number(opt.days),
    });
    if (!d || !d.ok) {
      const map = { forbidden: '需要管理员权限', bad_code: '兑换码须为 3-32 位大写字母、数字、下划线或短横' };
      return { ok: false, msg: map[d && d.reason] || '操作失败' };
    }
    return { ok: true, code: d.code };
  },
  async redeemBatch(prefix, count, reward, note, days, kind) {
    const d = await adminCall('admin_redeem_batch', {
      p_prefix: prefix, p_count: Number(count), p_reward: reward, p_note: note,
      p_days: days == null ? 365 : Number(days), p_kind: kind || 'general',
    });
    return d && d.ok ? { ok: true, codes: d.codes } : { ok: false, msg: '生成失败' };
  },
  async redeemLogs(q) {
    const d = await adminCall('admin_redeem_logs', { p_q: q || null, p_limit: 200 });
    return Array.isArray(d) ? d : [];
  },

  /* 赛季 */
  async seasonList() {
    const d = await adminCall('admin_season_list');
    return Array.isArray(d) ? d : [];
  },
  async seasonOpen(name, reason) {
    const d = await adminCall('admin_season_open', { p_name: name, p_reason: reason });
    if (!d || !d.ok) return { ok: false, msg: d && d.reason === 'still_active' ? '当前赛季仍在进行，请先结束' : '开启失败' };
    return { ok: true, no: d.no };
  },
  async seasonEnd(no, reason) {
    const d = await adminCall('admin_season_end', { p_no: Number(no), p_reason: reason });
    if (!d || !d.ok) return { ok: false, msg: d && d.reason === 'not_active' ? '该赛季不在进行中' : '结束失败' };
    return { ok: true, rows: d.rows, standings: d.standings };
  },
  async seasonReset(no, reason) {
    const d = await adminCall('admin_season_reset', { p_no: Number(no), p_reason: reason });
    if (!d || !d.ok) {
      const map = { still_active: '进行中的赛季不能重置', no_snapshot: '缺少赛季快照，请先结束赛季' };
      return { ok: false, msg: map[d && d.reason] || '重置失败' };
    }
    return { ok: true, cleared: d.cleared };
  },
  async seasonStandings(no) {
    const d = await adminCall('admin_season_standings', { p_no: Number(no) });
    return Array.isArray(d) ? d : [];
  },
  async seasonAward(no, reward, topn, note, days) {
    const d = await adminCall('admin_season_award', {
      p_no: Number(no), p_reward: reward, p_topn: Number(topn),
      p_note: note, p_days: days == null ? 30 : Number(days),
    });
    return d && d.ok ? { ok: true, codes: d.codes } : { ok: false, msg: '发奖失败' };
  },

  /* 开关与灰度 */
  async settingsGet() {
    const d = await adminCall('admin_settings_get');
    return d || {};
  },
  async settingsSet(patch, reason) {
    const d = await adminCall('admin_settings_set', { p_patch: patch, p_reason: reason });
    if (!d || !d.ok) {
      const map = { forbidden: '需要管理员权限', too_long: '公告不超过 200 字', bad_patch: '参数不合法' };
      return { ok: false, msg: map[d && d.reason] || '保存失败' };
    }
    return { ok: true };
  },
  async moduleSet(module, enabled, reason) {
    const d = await adminCall('admin_module_set', {
      p_module: module, p_enabled: !!enabled, p_reason: reason,
    });
    return d && d.ok ? { ok: true } : { ok: false, msg: '操作失败' };
  },
  async whitelistSet(module, user, on, reason) {
    const d = await adminCall('admin_whitelist_set', {
      p_module: module, p_user: user, p_on: !!on, p_reason: reason,
    });
    if (!d || !d.ok) {
      const map = { no_account: '账号不存在', bad_module: '模块不存在' };
      return { ok: false, msg: map[d && d.reason] || '操作失败' };
    }
    return { ok: true, whitelist: d.whitelist };
  },

  /* 日志 */
  async logs(module, q) {
    const d = await adminCall('admin_log_list', { p_module: module || null, p_q: q || null, p_limit: 150 });
    return Array.isArray(d) ? d : [];
  },
};

function friendly(err) {
  const m = (err && err.message) || '请求失败';
  if (/failed to fetch|network|NetworkError/i.test(m)) return '无法连接云端，请检查网络后重试';
  return m;
}
