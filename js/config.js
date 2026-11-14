/* 破天宗 · 配置表
 * 全部数值以配置驱动，逻辑层不写死任何数值。
 */

export const VERSION = 1;

/* ---------- V1.4 灰度开关（模块级，可按账号白名单灰度） ----------
 * sceneHome   true = 主页走宗门场景；false = 回退旧的卡片看板
 * pendingMode true = 事件进待处理；false = 回退旧的阻断弹窗
 * whitelist 命中即强制开启；percent 为按账号哈希的灰度比例（0-100）。
 */
export const FLAGS = {
  sceneHome: { def: true, whitelist: [], percent: 100 },
  pendingMode: { def: true, whitelist: [], percent: 100 },
};

export function hashBucket(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 100;
}

export function resolveFlag(spec, account) {
  if (!spec) return true;
  const uid = String((account && (account.username || account.uid || account.id)) || '');
  const wl = spec.whitelist || [];
  if (uid && wl.indexOf(uid) >= 0) return true;
  if (wl.indexOf('*') >= 0) return true;
  const pct = typeof spec.percent === 'number' ? spec.percent : 100;
  if (pct >= 100) return spec.def !== false;
  if (pct <= 0) return false;
  return hashBucket(uid) < pct;
}

/* 时间：1 倍速下每 TICK_MS 毫秒推进 DAYS_PER_TICK 个游戏日
 *
 * 旧值 1.5 表示每秒六个游戏日 —— 一年 360 天只跑六十秒。
 * 掌门一天要被问几十件事，全是秒回秒结，界面数字一直在跳，
 * 看起来就像卡。真实宗门不是这个节奏：文牍要流转，结案有日子。
 * 现在 1 倍速是每秒半个游戏日，一年约十二分钟；嫌慢有 2x / 4x。
 */
export const TICK_MS = 250;
export const DAYS_PER_TICK = 0.125;
export const SPEEDS = [0, 1, 2, 4];
export const OFFLINE_CAP_DAYS = 2400;
/* 一年多少日：UI 用得到，别再各处硬写 360 */
export const DAYS_PER_YEAR = 360;

/* ---------- 二十阶境界 ---------- */
export const REALMS = [
  { i: 1, name: '引气入体', need: 120, life: 20, atk: 6 },
  { i: 2, name: '引气圆满', need: 174, life: 24, atk: 9 },
  { i: 3, name: '炼皮境', need: 252, life: 28, atk: 13 },
  { i: 4, name: '锻骨境', need: 366, life: 34, atk: 19 },
  { i: 5, name: '易筋境', need: 531, life: 40, atk: 26 },
  { i: 6, name: '洗髓境', need: 770, life: 48, atk: 36 },
  { i: 7, name: '凝气境', need: 1116, life: 58, atk: 48 },
  { i: 8, name: '筑基初期', need: 1619, life: 70, atk: 64 },
  { i: 9, name: '筑基圆满', need: 2347, life: 84, atk: 84 },
  { i: 10, name: '凝丹境', need: 3403, life: 120, atk: 112 },
  { i: 11, name: '金丹初期', need: 4935, life: 160, atk: 148 },
  { i: 12, name: '金丹后期', need: 7155, life: 200, atk: 192 },
  { i: 13, name: '元婴境', need: 10375, life: 320, atk: 248 },
  { i: 14, name: '化神境', need: 15044, life: 460, atk: 316 },
  { i: 15, name: '炼虚境', need: 21814, life: 640, atk: 400 },
  { i: 16, name: '合体境', need: 31630, life: 880, atk: 504 },
  { i: 17, name: '大乘境', need: 45864, life: 1200, atk: 632 },
  { i: 18, name: '渡劫境', need: 66503, life: 1600, atk: 792 },
  { i: 19, name: '半仙境', need: 96430, life: 2200, atk: 980 },
  { i: 20, name: '飞升境', need: 139824, life: 3000, atk: 1200 },
];
export const REALM_MAX = REALMS.length;
export const SERVANT_REALM_CAP = 9; // 杂役永不可越过第九境

/* ---------- 正式弟子九步 ---------- */
export const STEPS = [
  { step: 1, title: '记名弟子', realmFrom: 1, realmTo: 2, keep: true },
  { step: 2, title: '记名弟子', realmFrom: 3, realmTo: 4, keep: true },
  { step: 3, title: '记名弟子', realmFrom: 5, realmTo: 6, keep: true },
  { step: 4, title: '外门弟子', realmFrom: 7, realmTo: 8, rate: 0.4, batch: true },
  { step: 5, title: '外门弟子', realmFrom: 9, realmTo: 10, rate: 0.55 },
  { step: 6, title: '外门弟子', realmFrom: 11, realmTo: 12, rate: 0.45 },
  { step: 7, title: '内门弟子', realmFrom: 13, realmTo: 14, rate: 0.32 },
  { step: 8, title: '核心弟子', realmFrom: 15, realmTo: 17, rate: 0.22 },
  { step: 9, title: '亲传弟子', realmFrom: 18, realmTo: 20, manual: true },
];

/* ---------- 灵根 ---------- */
export const SPIRIT_ROOTS = [
  { key: 'fan', name: '凡根', mul: 0.55, w: 26 },
  { key: 'za', name: '杂灵根', mul: 0.8, w: 30 },
  { key: 'san', name: '三灵根', mul: 1.0, w: 24 },
  { key: 'shuang', name: '双灵根', mul: 1.3, w: 13 },
  { key: 'dan', name: '单灵根', mul: 1.7, w: 6 },
  { key: 'bianyi', name: '变异灵根', mul: 2.2, w: 1.6 },
];

/* ---------- 先天体质 ---------- */
export const PHYSIQUES = [
  { key: 'fan', name: '凡体', mul: 1.0, demon: 1.0, w: 62 },
  { key: 'ling', name: '灵体', mul: 1.18, demon: 0.9, w: 25 },
  { key: 'dao', name: '先天道体', mul: 1.55, demon: 0.65, w: 4 },
  { key: 'sha', name: '天煞孤星', mul: 1.35, demon: 1.6, w: 5 },
  { key: 'qi', name: '气运之子', mul: 1.25, demon: 0.75, w: 4 },
];

/* ---------- 功法（五品） ---------- */
export const TECHNIQUES = [
  { key: 'fan_juqi', name: '引气诀', grade: '凡', cult: 1.0, break_: 0, calm: 0, atk: 0, door: 1 },
  { key: 'ling_qingxin', name: '清心谱', grade: '灵', cult: 1.05, break_: 0.02, calm: 0.3, atk: 0, door: 1 },
  { key: 'ling_pojun', name: '破军刀诀', grade: '灵', cult: 0.95, break_: 0, calm: 0, atk: 0.12, door: 1 },
  { key: 'xuan_zixia', name: '紫霞真经', grade: '玄', cult: 1.3, break_: 0.05, calm: 0.1, atk: 0.05, door: 5 },
  { key: 'xuan_ningdan', name: '凝丹要旨', grade: '玄', cult: 1.2, break_: 0.12, calm: 0, atk: 0, door: 7 },
  { key: 'di_taixu', name: '太虚剑典', grade: '地', cult: 1.55, break_: 0.08, calm: 0.15, atk: 0.2, door: 10 },
  { key: 'di_zhenmo', name: '镇魔真解', grade: '地', cult: 1.4, break_: 0.1, calm: 0.45, atk: 0.08, door: 10 },
  { key: 'tian_daoyin', name: '道印残篇', grade: '天', cult: 1.9, break_: 0.18, calm: 0.25, atk: 0.25, door: 13 },
];
export const TECH_BY_KEY = Object.fromEntries(TECHNIQUES.map((t) => [t.key, t]));

/* ---------- 资源 ---------- */
export const RESOURCES = [
  { key: 'lingshi', name: '灵石', desc: '宗门通行的硬通货，修炼、建设与布阵皆需消耗' },
  { key: 'liangshi', name: '粮食', desc: '弟子口粮，断供则弟子流失、生产停摆' },
  { key: 'lingzhi', name: '灵植', desc: '灵田所出，丹药与灵食的原料' },
  { key: 'lingyao', name: '灵药', desc: '炼制丹药的主材' },
  { key: 'danyao', name: '丹药', desc: '修炼与突破的消耗品，亦可用于疗伤' },
  { key: 'qicai', name: '炼器材料', desc: '法器铸造之基' },
  { key: 'fulu', name: '符箓材料', desc: '朱砂、符纸与兽血' },
  { key: 'zhenfa', name: '阵法材料', desc: '阵盘与阵旗的原料' },
  { key: 'yaoshou', name: '妖兽材料', desc: '皮、骨、内丹，多来自兽潮与探索' },
  { key: 'kuangshi', name: '矿石', desc: '断脉开采所得，重建设所需' },
  { key: 'qizhen', name: '奇珍异宝', desc: '稀世之物，可用于延寿与悟道' },
];
export const RES_BY_KEY = Object.fromEntries(RESOURCES.map((r) => [r.key, r]));

/* ---------- 建筑 ---------- */
export const FACILITIES = [
  { key: 'lingtian', name: '灵田', desc: '产出灵植，提升灵气浓度', maxLv: 10, cost: (lv) => ({ lingshi: 150 * lv, kuangshi: 40 * lv }) },
  { key: 'gongfang', name: '工坊', desc: '炼丹、炼器、制符三线生产', maxLv: 10, cost: (lv) => ({ lingshi: 200 * lv, qicai: 30 * lv }) },
  { key: 'juling', name: '聚灵阵', desc: '全宗修炼速度增益', maxLv: 10, cost: (lv) => ({ lingshi: 260 * lv, zhenfa: 40 * lv }) },
  { key: 'xunshan', name: '巡山队', desc: '预警兽潮与入侵，降低损失', maxLv: 5, cost: (lv) => ({ lingshi: 160 * lv, fulu: 30 * lv }) },
  { key: 'zangjing', name: '藏经阁', desc: '解锁更高品级功法，提升突破成功率', maxLv: 6, cost: (lv) => ({ lingshi: 320 * lv, qizhen: lv }) },
];

/* ---------- 机构与席位 ---------- */
export const INSTITUTIONS = [
  { key: 'dizige', name: '弟子阁', seats: ['阁老·甲', '阁老·乙', '阁老·丙'] },
  { key: 'hufatang', name: '护法堂', seats: ['首席护法', '左护法', '右护法'] },
  { key: 'zhanglaohui', name: '长老会', seats: ['大长老', '二长老', '三长老'] },
];

/* ---------- 小世界分层 ---------- */
export const LAYERS = [
  { lv: 1, name: '第一层·庐舍', desc: '草庐与灶房，最初容身之处' },
  { lv: 2, name: '第二层·灵田', desc: '引断脉余气灌溉的薄田' },
  { lv: 3, name: '第三层·工坊', desc: '杂役劳作之所，丹炉与铁砧' },
  { lv: 4, name: '第四层·演武场', desc: '弟子比斗与考核之地' },
  { lv: 5, name: '第五层·藏经阁', desc: '功法与典籍的存放处' },
  { lv: 6, name: '第六层·弟子居', desc: '正式弟子起居与闭关之所' },
  { lv: 7, name: '第七层·护法堂', desc: '守山、刑罚与安防中枢' },
  { lv: 8, name: '第八层·长老会', desc: '议事与教化之所' },
  { lv: 9, name: '第九层·祖师殿', desc: '接引道印、俯瞰全宗' },
  { lv: 10, name: '第十层·问天台', desc: '云层压顶之处，终局的落点' },
];

/* ---------- 探索区域 ---------- */
export const REGIONS = [
  { key: 'luoyan', name: '落雁原外围', lv: 1, days: 6, risk: 0.05, need: 1, res: { lingzhi: [30, 70], kuangshi: [20, 50] }, desc: '荒草与断碑，散修绕行' },
  { key: 'cheng', name: '落雁城', lv: 1, days: 4, risk: 0.02, need: 1, res: { liangshi: [60, 120], lingshi: [40, 90] }, desc: '商队与粮铺，可以用工坊之物换粮' },
  { key: 'duanmai', name: '断脉矿洞', lv: 2, days: 10, risk: 0.1, need: 4, res: { kuangshi: [120, 240], zhenfa: [20, 60] }, desc: '灵脉断裂处，残气仍在流动' },
  { key: 'guzhan', name: '古战场深处', lv: 3, days: 16, risk: 0.18, need: 5, res: { qicai: [60, 140], yaoshou: [30, 80], qizhen: [0, 1] }, desc: '尸骨与断剑埋了厚厚一层' },
  { key: 'guiyuan', name: '无归渊', lv: 5, days: 26, risk: 0.28, need: 8, res: { qicai: [200, 380], qizhen: [1, 3], yaoshou: [120, 260] }, desc: '风从裂口吹出，带着铁锈味' },
];

/* ---------- 任务模板 ---------- */
export const MISSION_TEMPLATES = [
  { key: 'm1', name: '巡山', lv: 1, days: 3, need: 1, reward: { lingshi: [30, 60], gongxian: 4 }, desc: '沿山门走一圈，看看有没有兽迹' },
  { key: 'm2', name: '灵田翻土', lv: 1, days: 4, need: 1, reward: { lingzhi: [40, 80], gongxian: 3 }, desc: '杂役的日常，也是灵植的来源' },
  { key: 'm3', name: '护送货队', lv: 2, days: 6, need: 2, reward: { lingshi: [80, 150], liangshi: [60, 110], gongxian: 8 }, desc: '替落雁城的掌柜跑一趟邻镇' },
  { key: 'm4', name: '清剿妖兽', lv: 3, days: 8, need: 3, reward: { yaoshou: [60, 120], gongxian: 14 }, desc: '山脚有开了灵智的畜生伤人' },
  { key: 'm5', name: '镇守要道', lv: 4, days: 12, need: 4, reward: { lingshi: [200, 340], gongxian: 22 }, desc: '外门弟子才接得下的活' },
  { key: 'm6', name: '秘境引路', lv: 6, days: 18, need: 6, reward: { qizhen: [1, 2], qicai: [80, 160], gongxian: 36 }, desc: '替商盟带路，抽成不薄' },
];

/* ---------- 外部势力 ---------- */
export const FACTIONS = [
  { key: 'tianshu', name: '天枢剑宗', tone: '规矩、敬语，暗含倨傲', desc: '正道之首，需要一个“秩序”的代言人' },
  { key: 'xuanyin', name: '玄阴教', tone: '绵软、爱用反问', desc: '魔道大宗，需要一个“诱惑”的来源' },
  { key: 'shangmeng', name: '万宝商盟', tone: '开口先谈价钱', desc: '商盟需要一个“价格”的裁判' },
];

/* ---------- 结局 ---------- */
export const ENDINGS = {
  yirendedao: { name: '一人得道', text: '道印补全，你踏云而去。身后宗门的灯火一夜暗了三成——弟子们的境界齐齐跌落一层，却无人怨你。' },
  wanggu: { name: '万古仙宗', text: '你把道印留在问天台上。飞升之门自此关闭，可宗门还在，灯还亮着，来投的孩子一年比一年多。' },
  qinzhuan: { name: '亲传承道', text: '你把选择交给了亲传弟子。他沉默了很久，然后接过了道印。此后的路，由他走。' },
};

/* ---------- 随机事件池 ---------- */
export const RANDOM_EVENTS = [
  {
    key: 'talent', name: '天才投奔', weight: 6, tone: 1,
    text: '一个十二三岁的孩子独自走到山门外，说家里没人了，问这里收不收。你探他灵根，澄澈得不像是这个年月该有的东西。',
    options: [
      { label: '收入内门，倾力培养', effect: { addDisciple: 'genius', renown: 10 }, result: '孩子跪下磕了三个头。此后的许多年，他会记得这一天。' },
      { label: '先入杂役，看心性', effect: { addDisciple: 'servant', fortune: 3 }, result: '他没有多问，挑起了水桶。' },
    ],
  },
  {
    key: 'raid', name: '妖兽围山', weight: 5, tone: -1, minStage: 1,
    text: '夜里山门外有影子在动。巡山队报：约莫三十余头，没有开灵智的领头的，只是饿。',
    options: [
      { label: '出山驱赶', effect: { res: { yaoshou: 40 }, hurt: 2 }, result: '弟子伤了两个，兽群散了，留下一地皮毛。' },
      { label: '闭门不出，任其自去', effect: { res: { lingzhi: -60 }, fortune: -2 }, result: '灵田被啃去大半，但没人受伤。' },
    ],
  },
  {
    key: 'price', name: '灵材涨价', weight: 4, tone: 0,
    text: '商盟的人带来口信：北边打起来了，炼器材料要涨三成，问宗门要不要先囤一批。',
    options: [
      { label: '囤一批', effect: { res: { lingshi: -300, qicai: 200 } }, result: '库房堆满了矿石，账上空了一块。' },
      { label: '不囤', effect: {}, result: '你算了算，还是省着点用。' },
    ],
  },
  {
    key: 'betray', name: '弟子叛逃', weight: 3, tone: -1, minStage: 2,
    text: '一个外门弟子不见了，带走了一炉丹药和两个杂役。留下的话只有一句：这里太慢了。',
    options: [
      { label: '追回', effect: { res: { danyao: -20 }, loyaltyAll: 5 }, result: '人追回来了，丹药没了。宗内议论了半个月。' },
      { label: '不追，立规', effect: { fortune: -3, renown: 5 }, result: '你把门规刻在石上。走的人不可惜。' },
    ],
  },
  {
    key: 'relic', name: '废墟现世', weight: 3, tone: 1, minStage: 2,
    text: '落雁原西边塌了一片地，露出半截石阶。有人说是前代剑修的洞府。',
    options: [
      { label: '立刻派人下去', effect: { res: { qizhen: 1, qicai: 120 }, hurt: 1 }, result: '带回一块残玉，也带回一个伤者。' },
      { label: '封起来，慢慢探', effect: { res: { kuangshi: 100 } }, result: '稳妥，但错过了最好的东西。' },
    ],
  },
  {
    key: 'plague', name: '疫病入城', weight: 3, tone: -1, minStage: 2,
    text: '落雁城开始往外烧尸体，风向朝着山门。城主没派人来——他知道宗门也缺药。',
    options: [
      { label: '送药过去', effect: { res: { danyao: -120 }, fortune: 8, renown: 12 }, result: '城里为你立了长生牌位。宗门的丹药见了底。' },
      { label: '闭山门', effect: { fortune: -6 }, result: '山门关了两个月，没人染病，也没人上门。' },
    ],
  },
];

/* ---------- 功法残页与典籍（藏经阁抽取） ---------- */
export const TECH_POOL_BY_GRADE = TECHNIQUES.reduce((acc, t) => {
  (acc[t.grade] = acc[t.grade] || []).push(t.key);
  return acc;
}, {});

/* ---------- 姓名库 ---------- */
export const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳'.split('');
export const GIVEN_1 = '清风明玄元始无相虚怀若谷怀瑾握瑜知白守黑凌霄承影照野听雪拾光望舒'.split('');
export const GIVEN_2 = '子墨尘生然之远山行舟阑夜歌书剑川岳岚溪桥松月'.split('');

/* ---------- 命名弟子背景 ---------- */
export const NAMED_BACKGROUNDS = [
  { key: 'yaotong', name: '药童', tag: '出身', desc: '自小在药炉边长大，认得每一种草的脾气' },
  { key: 'liehu', name: '猎户之子', tag: '出身', desc: '进山比进院子熟，箭法比剑法好' },
  { key: 'zuichen', name: '罪臣之后', tag: '出身', desc: '姓是真的，来历是假的' },
  { key: 'yaozu', name: '妖族混血', tag: '出身', desc: '耳朵比常人尖一点，从不让人碰后颈' },
  { key: 'jueyuan', name: '天生绝脉', tag: '缺陷', desc: '经脉断了两处，修炼比旁人慢一倍' },
  { key: 'queshan', name: '缺一魂', tag: '缺陷', desc: '记不住昨天的事，却记得住每一句口诀' },
  { key: 'buyan', name: '不能言语', tag: '缺陷', desc: '从未开口，写的字却极好' },
  { key: 'shengzhi', name: '生而知之', tag: '天赋', desc: '三岁能背经文，五岁问倒了教习' },
  { key: 'mengqian', name: '梦见前身', tag: '天赋', desc: '常说自己死过一次，说得出细节' },
  { key: 'chuming', name: '旧宗除名', tag: '际遇', desc: '被逐出过一次山门，不愿提为什么' },
  { key: 'mimi', name: '带着秘密来投', tag: '际遇', desc: '包袱里有个从不打开的木匣' },
];

/* ---------- 招收 ---------- */
/* 门派不设人数上限：人来人往靠粮秣与资源自然调节，不靠一道名额门槛。 */
/* 每两年（720 日）山门大开一次，按资质分流；祖师亦可随时亲自开山收徒。 */
export const RECRUIT = {
  servant: { name: '杂役', cost: { liangshi: 60 }, desc: '做粗活、跑腿、守山门；不占修炼位，也不出战' },
  formal: { name: '正式弟子', cost: { lingshi: 260, liangshi: 80 }, desc: '查验根骨后入门，可修炼、可出战、可转职' },
  /* 批量开山：入门费默认不收（政策里可开），只靠每日口粮形成供养压力。
     为什么默认不收：一百人一批，若按人收入门费，两批就能把粮仓抽干，
     扩张反而被自己的收费卡死。供养压力放在每日口粮上更自然。 */
  batch: {
    interval: 720,        // 每两年一次
    min: 100,
    max: 200,             // 硬边界，声望只影响落在区间里的位置
    /* 主判据：根骨 mul ≥ 此值入正式，其余入杂役（三灵根 1.0 及以上） */
    formalRootMul: 1.0,
    /* 两端夹逼：同批总会出现"一个达标的都没有"或"过半达标"的极端，
       夹在区间内保证每一批都有正式也有杂役，读起来才像开山收徒。
       上界放到 0.55：三灵根以上约占四成半，夹得太紧就变成比例说了算、资质说了不算了。 */
    formalMin: 0.22,
    formalMax: 0.55,
    /* 入门费（默认不启用，由政策 settings.recruitFee 打开） */
    fee: { liangshi: 2.4 },
    formalFee: { lingshi: 6 },
    /* 声望加权：声望到 2400 时来人的下界抬到区间中段，上界不动 */
    renownFull: 2400,
  },
  /* 祖师亲收：不受两年之限，随叫随收 */
  manual: {
    max: 200,             // 单次上限，防止一次收入上万
    costPerHead: { liangshi: 3 },
    formalCostPerHead: { lingshi: 8 },
  },
};

/* ---------- 亲传（第九步） ----------
 * 名额不设上限：够格就册，册不册由祖师定。
 * 养不养得起是经济问题（俸禄），不是名额问题。
 */
export const HEIR = {
  minRoot: 1.3,          // 双灵根起。天赋是门票，不是保证
  maxDemon: 70,          // 心魔失控者先静心
  stipend: { lingshi: 96 },   // 每位亲传每年俸禄，政策里可关
  bonus: { gain: 0.01, renown: 3 }, // 每位在册亲传给全宗的修炼/声望加成
  /* 候册排序权重：门槛看天赋，先后看综合分 */
  score: { root: 40, phys: 12, gongxian: 1.2, loyalty: 0.2, mind: 0.3 },
};

/* ---------- 弟子阁 ----------
 * 阁老席位随山门层数开；人不够时按阶梯降格任职，绝不空转。
 */
/* ---------- 文牍与在办 ----------
 *
 * 真实宗门的掌门不是"点一下立刻生效"的许愿机：
 * 旨意要交到当值阁老手上，承办有工期，办完才有回话。
 * 阁中同时能推的事有人手上限，超出的只能排在后面 —— 这就是积压。
 *
 * 积压不是惩罚，是提示：该提拔执事了，或者该少管些闲事。
 */
export const ORDERS = {
  kinds: {
    enshrine: { days: 10, title: '册封礼', area: 'seat', need: 1 },
    build:    { days: 24, title: '营建',   area: 'build', need: 2 },
    convert:  { days: 6,  title: '转职',   area: 'turn', need: 1 },
    recruit:  { days: 15, title: '开山收徒', area: 'recruit', need: 2 },
  },
  /* 阁中并行办几件：底数 + 每名阁老 */
  base: 2,
  perElder: 1,
  max: 14,
  /* 每积压一件，工期顺延几日 */
  backlogDelay: 2,
  /* 积压到几件开始提醒 */
  warn: 3,
};

export const ELDER = {
  base: 3,
  perLayers: 2,          // 每开 2 层加 1 席
  max: 12,
  rotateDays: 120,       // 轮值周期
  tiers: [               // 递补阶梯：第 1 档起，效力递减
    { step: 9, name: '亲传', eff: 1 },
    { step: 8, name: '核心', eff: 1 },
    { step: 7, name: '内门（降格）', eff: 0.8 },
  ],
  quorum: 1,             // 法定人数：至少一名阁老在任才叫"阁中有主"
  idleMul: 3,            // 无阁老时办事周期拉长倍数（变慢，但不停办）
};

/* ---------- 破天阁自决范围 ----------
 * 祖师只留五件：亲传册封、开山收徒、政策、重大异动、处决流放。
 * 其余全部交阁中按策自办，只在待处理里报备一行。
 * log 是宗门史里的题头，报备从这里归拢，不另存副本。
 */
export const AREAS = [
  { key: 'seat', name: '补缺', log: '破天阁·补缺', desc: '席位空缺时由阁议推举' },
  { key: 'recruit', name: '招揽', log: '破天阁·招揽', desc: '杂役不足时自行招收' },
  { key: 'heal', name: '疗养', log: '破天阁·疗养', desc: '伤者康复后归队' },
  { key: 'assign', name: '分派', log: '破天阁·分派', desc: '闲置弟子按例接任务' },
  { key: 'build', name: '营建', log: '破天阁·营建', desc: '库房有余时排期营建' },
  { key: 'turn', name: '转职', log: '破天阁·转职', desc: '晋升无望的老弟子转任执事' },
  { key: 'punish', name: '刑赏', log: '破天阁·刑赏', desc: '门规小过由阁中处置' },
  { key: 'prod', name: '排产', log: '破天阁·排产', desc: '灵田与工坊按例开工' },
];
export const AREA_BY_KEY = Object.fromEntries(AREAS.map((a) => [a.key, a]));

/* ---------- 道号 ---------- */
export const DAOHAO_HEAD = ['玄', '清', '虚', '云', '无', '太', '守', '明', '静', '长'];
export const DAOHAO_BODY = ['真', '微', '一', '元', '素', '和', '寂', '照', '朴', '冲'];
export const DAOHAO_TAIL = ['子', '道人', '真人', '上人', '散人'];
/* 道号是内门以上的体面，第七步起才赐 */
export const DAOHAO_MIN_STEP = 7;
