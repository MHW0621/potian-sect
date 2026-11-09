/* 破天宗 · 剧情事件链（四幕十六节点）
 * cond(g) 为前置判定，g 为 Game 实例。
 * effect 由引擎 applyEffect 结算。
 */

const count = (g) => g.save.disciples.length;
const servants = (g) => g.save.disciples.filter((d) => d.type === 'servant');
const formals = (g) => g.save.disciples.filter((d) => d.type === 'formal');
const maxStep = (g) => formals(g).reduce((m, d) => Math.max(m, d.step), 0);
const seatFilled = (g, inst) => (g.save.posts[inst] || []).filter(Boolean).length;
const relation = (g, k) => g.save.relations[k] || 0;

export const STORY_NODES = [
  /* ===== 第一幕 立宗 ===== */
  {
    id: 'a1_1', act: 1, title: '破庐第一夜',
    /* 开宗第一夜。V1.6 起新宗开局就有四十余人，再按"宗门空无一人"判定，这一夜永远不会来。 */
    cond: (g) => g.save.day >= 1 && (g.save.sect.stage || 1) === 1,
    text: '草庐外站着三个凡人，两男一女，衣不蔽体。他们说听说这里有人开宗，走了七日山路过来，问还收不收人。其中一人手上有老茧，是常年握刀的；另一个瘦得脱形，眼里却有光。',
    options: [
      {
        label: '全收',
        result: '三人皆入杂役。宗门多三张嘴，工坊却立刻有了人气。',
        apply: (g) => { g.addDisciple('servant'); g.addDisciple('servant'); g.addDisciple('servant'); g.addRes({ liangshi: -60 }); },
      },
      {
        label: '只收那个眼里有光的',
        result: '一人入正式弟子，另两人磕头走了。粮仓没动，可产出慢得像熬药。',
        apply: (g) => { g.addDisciple('formal'); },
      },
      {
        label: '都不收，先看清局势',
        result: '三人走了。第二日山门外多了几拨探头探脑的人。',
        apply: (g) => { g.addFortune(-4); g.save.flags.watched = true; },
      },
    ],
  },
  {
    id: 'a1_2', act: 1, title: '断脉初醒',
    cond: (g) => servants(g).length >= 5 && (g.save.fac.gongfang || 0) >= 1,
    text: '一个杂役在灵田翻土时挖到一段温热的石头，石缝里有微弱的光在流动。他不敢动，跪在田里等到天亮。',
    options: [
      {
        label: '开掘引脉',
        result: '小世界第一至第三层彻底稳固，灵田灵气浓了一截。代价是半年内所有生产减半。',
        apply: (g) => { g.save.flags.slowUntil = g.save.day + 180; g.unlockLayer(3); g.addFortune(6); g.addRes({ kuangshi: 200 }); },
      },
      {
        label: '暂缓，先稳固地面',
        result: '你把石缝重新埋上。下一季的兽潮来得更早，也更凶。',
        apply: (g) => { g.addFortune(3); g.save.flags.beastEarly = true; },
      },
      {
        label: '封住石缝，不让人知道',
        result: '短期无碍。你心里知道，那道缝总有自己裂开的一天。',
        apply: (g) => { g.save.flags.sealedVein = g.save.day; g.addFortune(-2); },
      },
    ],
  },
  {
    id: 'a1_3', act: 1, title: '落雁城的第一笔生意',
    cond: (g) => g.save.day >= 60 && (g.save.res.liangshi < 150 || g.save.day >= 900),
    text: '粮铺掌柜愿以低价售粮，条件是替他护送一批货去邻镇。他没有明说那批货是什么，只说“不太方便打开看”。',
    options: [
      {
        label: '接单',
        result: '途中遇伏，两名弟子重伤，但换回半年口粮。你也第一次与商盟的人照了面。',
        apply: (g) => { g.addRes({ liangshi: 600, lingshi: 120 }); g.hurt(2); g.addRelation('shangmeng', 1); },
      },
      {
        label: '拒单，以低阶丹药抵粮',
        result: '吃亏但干净。掌柜收了丹药，说了句“下次还来”。',
        apply: (g) => { g.addRes({ danyao: -80, liangshi: 400 }); g.addRenown(6); },
      },
      {
        label: '查清货物再决定',
        result: '查明是军械。你退了货，掌柜记恨，此后粮价涨了两成。',
        apply: (g) => { g.save.flags.grainPrice = 1.2; g.addRenown(4); g.addRelation('shangmeng', -1); },
      },
    ],
  },
  {
    id: 'a1_4', act: 1, title: '第一次兽潮',
    cond: (g) => count(g) >= 16 && (g.save.fac.xunshan || 0) >= 1,
    text: '地平线上出现黑压压一片，是被灵气衰减逼出深山的兽群，领头的是一头开了灵智的苍狼。它没有立刻冲，先在山脊上站了很久，看这座山门。',
    options: [
      {
        label: '全军据守山门',
        result: '以守势消耗，弟子伤者众但宗门无虞。苍狼退去后留下内丹。',
        apply: (g) => { g.hurt(4); g.addRes({ yaoshou: 220, qizhen: 1 }); g.addRenown(10); },
      },
      {
        label: '出山迎击，斩首领',
        result: '高风险也高收益。此战之后，落雁原上再无人小看这座山门。',
        apply: (g) => {
          const p = g.teamPower();
          if (p > 260) { g.addRes({ yaoshou: 420, qizhen: 2 }); g.addRenown(26); g.addFortune(6); }
          else { g.hurt(8); g.addRes({ lingzhi: -200, liangshi: -150 }); g.addRenown(4); g.addFortune(-4); }
        },
      },
      {
        label: '以粮换退兵',
        result: '三成粮食投下山，兽群散去。宗门保全体力，却错过了那颗内丹。',
        apply: (g) => { g.addRes({ liangshi: Math.floor(-g.save.res.liangshi * 0.3) }); g.addFortune(-3); g.addRenown(3); },
      },
    ],
  },

  /* ===== 第二幕 开山 ===== */
  {
    id: 'a2_1', act: 2, title: '三晋四·弃徒之乱',
    cond: (g) => g.save.sect.stage >= 2 && formals(g).filter((d) => d.step === 3 && d.tries3 >= 3 && !d.passed4).length >= 1,
    text: '落选的弟子堵在第三层任务大厅门口。他们说不是不服规矩，是不服“只给三次机会”这个规矩。有人喊了一句“我们也是宗门的弟子”，人群就静了下来。',
    options: [
      {
        label: '依制遣散',
        result: '给盘缠遣返。宗门失了人心，但制度立住了。',
        apply: (g) => { g.clearFailedBatch(); g.addRes({ lingshi: -200 }); g.save.flags.strictRule = true; g.addFortune(3); },
      },
      {
        label: '转外宗执事',
        result: '全部收编。行政人手充足，弟子序列与外宗之间从此有了裂缝。',
        apply: (g) => { g.convertFailedBatch('waizong'); g.save.flags.outerSplit = true; },
      },
      {
        label: '破例再给一次机会',
        result: '制度被撕开一道口子。此后考核结果里，会有人情判定。',
        apply: (g) => { g.grantExtraChance(); g.save.flags.humanFactor = true; g.addFortune(-2); },
      },
    ],
  },
  {
    id: 'a2_2', act: 2, title: '护法与长老之争',
    cond: (g) => g.save.sect.stage >= 2 && seatFilled(g, 'hufatang') >= 3 && seatFilled(g, 'zhanglaohui') >= 3,
    text: '一位第六步弟子想转职，护法堂要他，长老会也要他。两边都不肯让，最后闹到祖师面前。护法堂说：他刀快，该护山门。长老会说：他讲得清道理，该教弟子。',
    options: [
      {
        label: '亲自裁定',
        result: '效率最高。落选一方在半年内任命效率下降。',
        apply: (g) => { g.save.flags.ruling = 'hufatang'; g.addRenown(8); },
      },
      {
        label: '让他自己选',
        result: '该弟子忠诚大增。两堂从此形成了“抢人”的惯例。',
        apply: (g) => { g.loyaltyAll(10); g.save.flags.poachHabit = true; },
      },
      {
        label: '都不给，留任弟子',
        result: '两堂皆不快，但避免了先例。',
        apply: (g) => { g.save.flags.noPrecedent = true; g.addFortune(2); },
      },
    ],
  },
  {
    id: 'a2_3', act: 2, title: '心魔夜谈',
    cond: (g) => formals(g).some((d) => d.step >= 5 && d.demon >= 60),
    text: '夜半，那名弟子坐在第八层的石阶上没有点灯。他说他梦见自己修到了化神，醒来发现还在金丹。他说他知道这是心魔，但他觉得梦里那个自己更像自己。',
    options: [
      {
        label: '祖师亲往开解',
        result: '心魔大幅下降，忠诚上升。此后同类事件，弟子都预期祖师出面。',
        apply: (g) => { g.calmWorst(45); g.loyaltyAll(6); g.save.flags.founderCares = true; },
      },
      {
        label: '命师长前往',
        result: '效果较弱，但守住了层级秩序。',
        apply: (g) => { g.calmWorst(22); g.addRenown(4); },
      },
      {
        label: '赐静心丹，不见面',
        result: '见效快、代价低。但那名弟子会记住“祖师没有来”。',
        apply: (g) => { g.calmWorst(35); g.addRes({ danyao: -30 }); g.loyaltyAll(-4); g.save.flags.founderAbsent = true; },
      },
    ],
  },
  {
    id: 'a2_4', act: 2, title: '小世界封顶',
    cond: (g) => maxStep(g) >= 7 && g.save.layers < 9,
    text: '第七层以上仍是一片混沌，没有路，也没有光。那位弟子站在尽头，回头说：祖师，上面还有地方，只是还没长出来。',
    options: [
      {
        label: '以宗门积累开辟上层',
        result: '灵石与人力倾泻而下，第八、第九层显形。',
        apply: (g) => { g.addRes({ lingshi: -1500, zhenfa: -100 }); g.unlockLayer(9); g.addFortune(6); },
      },
      {
        label: '只开到第八层',
        result: '节省资源，但“亲传之择”会被推迟。',
        apply: (g) => { g.addRes({ lingshi: -800 }); g.unlockLayer(8); g.save.flags.capEight = true; },
      },
      {
        label: '暂不开辟，先充实人口',
        result: '短期资源充裕。高步弟子无处安置，开始有人往外走。',
        apply: (g) => { g.addRes({ liangshi: 400, lingshi: 300 }); g.save.flags.lowCap = true; },
      },
    ],
  },

  /* ===== 第三幕 争锋 ===== */
  {
    id: 'a3_1', act: 3, title: '天枢来使',
    cond: (g) => g.save.sect.stage >= 3 && g.save.sect.renown >= 260,
    text: '天枢剑宗来了一位执事，穿素白剑袍，进门先对着山门行了一礼，然后说：我家宗主的意思是，你们这处山门，可以挂在天枢的名下。挂名之后，无人敢欺。',
    options: [
      {
        label: '接受庇护',
        result: '得安全与通商便利。每年须纳贡，弟子外出须报备，自主性下降。',
        apply: (g) => { g.addRelation('tianshu', 3); g.save.flags.tribute = true; g.addRenown(14); },
      },
      {
        label: '婉拒但送礼',
        result: '维持中立。天枢记下这一笔，往后在秘境分配上使绊。',
        apply: (g) => { g.addRes({ qizhen: -2, lingshi: -400 }); g.addRelation('tianshu', -1); g.addRenown(10); },
      },
      {
        label: '当面回绝',
        result: '声望大涨。天枢将你列入“待整”名单，敌对事件强度提升。',
        apply: (g) => { g.addRenown(40); g.addRelation('tianshu', -3); g.save.flags.targeted = true; },
      },
    ],
  },
  {
    id: 'a3_2', act: 3, title: '落雁城疫',
    cond: (g) => g.save.sect.stage >= 3,
    text: '落雁城起了疫病，城里人开始往城外烧尸体。城主派人来求药，说愿以城中三成存粮换宗门出手。宗内也有人反对：我们的丹药自己的弟子都不够吃。',
    options: [
      {
        label: '全力施救',
        result: '丹药见了底，气运大幅上升。此后来投的弟子成色明显不同。',
        apply: (g) => { g.addRes({ danyao: -300 }); g.addFortune(14); g.addRenown(30); },
      },
      {
        label: '只卖药不派人',
        result: '拿到粮食，但流民随后冲击了山门。',
        apply: (g) => { g.addRes({ danyao: -120, liangshi: 700 }); g.hurt(2); g.addRenown(8); },
      },
      {
        label: '闭门不理',
        result: '保住了资源。此后三年，周边事件偏向负面。',
        apply: (g) => { g.addFortune(-12); g.save.flags.plagueCurse = true; },
      },
    ],
  },
  {
    id: 'a3_3', act: 3, title: '玄阴蛊·叛徒',
    cond: (g) => formals(g).some((d) => d.step >= 6 && d.loyalty < 62),
    text: '一名弟子在深夜打开山门，放进了三个陌生人。他没有反抗，只是站在那里说：他们答应我，让我看一眼化神。',
    options: [
      {
        label: '当场拿下',
        result: '宗内震动，忠诚普遍上升。那名弟子的专属剧情线永久关闭。',
        apply: (g) => { g.punishTraitor('arrest'); g.loyaltyAll(12); g.addRenown(10); },
      },
      {
        label: '留他一命，逐出宗门',
        result: '此人日后会出现在玄阴教一侧，成为对手。',
        apply: (g) => { g.punishTraitor('exile'); g.addRelation('xuanyin', -1); g.addFortune(-2); },
      },
      {
        label: '问清蛊从何来',
        result: '牵出玄阴教在城中的据点，获得情报与一次主动出击的机会。',
        apply: (g) => { g.punishTraitor('interrogate'); g.addRes({ qizhen: 2 }); g.addRelation('xuanyin', -3); g.save.flags.xuanyinLair = true; },
      },
    ],
  },
  {
    id: 'a3_4', act: 3, title: '无归渊秘境',
    cond: (g) => (g.save.flags.shard || 0) >= 1 && maxStep(g) >= 8,
    text: '落雁原以北的荒地上裂开一道口子，风从里面吹出来，带着铁锈味。派去探查的弟子回来时说：里面有很多剑，插在地上，都朝着同一个方向。',
    options: [
      {
        label: '倾力探索',
        result: '遇上前代剑修残留的剑意，伤者众，但第二片碎片到手。',
        apply: (g) => { g.hurt(6); g.save.flags.shard = 2; g.addRes({ qizhen: 2, qicai: 200 }); g.addRenown(30); },
      },
      {
        label: '先探外围',
        result: '收益稳妥，带回大量炼器材料。碎片被天枢取走。',
        apply: (g) => { g.addRes({ qicai: 500, kuangshi: 300 }); g.addRelation('tianshu', 2); },
      },
      {
        label: '与商盟合作分成',
        result: '资源丰厚，但要分出一半，碎片交由商盟保管。',
        apply: (g) => { g.addRes({ lingshi: 2000, qizhen: 4 }); g.addRelation('shangmeng', 3); g.save.flags.shardHeld = true; },
      },
    ],
  },
  {
    id: 'a3_5', act: 3, title: '盟与战',
    cond: (g) => Object.keys(g.save.relations).some((k) => relation(g, k) >= 3)
      && Object.keys(g.save.relations).some((k) => relation(g, k) <= -3),
    text: '天枢的使者与玄阴的使者几乎同时到山门。一个说要联手清剿，一个说要谈个价钱。两条路摆在面前，走哪条都不能回头。',
    options: [
      {
        label: '与天枢共击玄阴',
        result: '得正道声望与军事支援，从此被绑在天枢的战车上。',
        apply: (g) => { g.addRelation('tianshu', 4); g.addRelation('xuanyin', -4); g.addRenown(50); g.save.flags.warChosen = 'tianshu'; },
      },
      {
        label: '与玄阴做交易',
        result: '资源与情报丰厚。正道声望大跌，此后招收正式弟子时天赋上限下降。',
        apply: (g) => { g.addRelation('xuanyin', 4); g.addRelation('tianshu', -4); g.addRes({ qizhen: 6, lingshi: 3000 }); g.save.flags.talentCap = true; },
      },
      {
        label: '谁都不答应',
        result: '声望大涨。两方同时视你为变数，此后双线受压。',
        apply: (g) => { g.addRenown(60); g.addRelation('tianshu', -2); g.addRelation('xuanyin', -2); g.save.flags.doublePressure = true; },
      },
    ],
  },

  /* ===== 第四幕 问天 ===== */
  {
    id: 'a4_1', act: 4, title: '亲传之择',
    cond: (g) => g.save.sect.stage >= 4 && formals(g).filter((d) => d.step === 8).length >= 2 && (g.save.flags.shard || 0) >= 2,
    text: '弟子阁空着三个席位，按规矩该由亲传弟子出任。可亲传弟子不能靠考核产生，只能由祖师点。第八层的石阶上，两个人站得一样直。',
    options: [
      {
        label: '选资历最深者',
        result: '秩序稳固。年轻弟子的升迁预期随之下降。',
        apply: (g) => { g.promoteToHeir('senior'); g.addRenown(20); },
      },
      {
        label: '选战力最强者',
        result: '对外威慑力上升。弟子阁的行政效率下降。',
        apply: (g) => { g.promoteToHeir('power'); g.addRenown(30); },
      },
      {
        label: '选心性最稳者',
        result: '气运上升，长线收益最好。短期战力不足。',
        apply: (g) => { g.promoteToHeir('calm'); g.addFortune(16); },
      },
    ],
  },
  {
    id: 'a4_2', act: 4, title: '道印残缺',
    cond: (g) => (g.save.flags.shard || 0) >= 2,
    text: '把两片碎片嵌进道印之后，印面亮了一夜。天亮时它停了，缺的那一角仍在。祖师看出来：不是碎，是从来没铸全过。',
    options: [
      {
        label: '搜寻第三片的下落',
        result: '开启终局前置任务。需重返古战场深处，风险极高。',
        apply: (g) => { g.save.flags.finalPath = 'search'; g.addFortune(6); },
      },
      {
        label: '以宗门之力补铸',
        result: '消耗大量资源与弟子修为。可能补成，也可能补出一个空壳。',
        apply: (g) => {
          g.addRes({ lingshi: -4000, qizhen: -6 });
          g.save.flags.finalPath = Math.random() < 0.55 ? 'cast' : 'shell';
          if (g.save.flags.finalPath === 'shell') g.addFortune(-10);
        },
      },
      {
        label: '不再追问',
        result: '放弃飞升路线，转入“万古仙宗”分支。',
        apply: (g) => { g.save.flags.finalPath = 'mortal'; g.addFortune(10); g.addRenown(30); },
      },
    ],
  },
  {
    id: 'a4_3', act: 4, title: '渡劫·问天',
    cond: (g) => maxStep(g) >= 9 && (g.save.flags.shard || 0) >= 2 && g.save.sect.renown >= 900,
    text: '云层压得很低，雷在云里滚但不落。祖师站在第十层的檐下，身后是整座宗门。这不是他要渡的劫，是他要替弟子选的路。',
    final: true,
    options: [
      {
        label: '以全宗弟子修为补全道印，独自飞升',
        result: '宗门此后由亲传弟子接掌，境界整体下滑一层。',
        apply: (g) => g.endGame('yirendedao'),
      },
      {
        label: '留下道印，与宗门共存',
        result: '飞升之门永远关闭。宗门还在。',
        apply: (g) => g.endGame('wanggu'),
      },
      {
        label: '把选择交给亲传弟子',
        result: '结局依该弟子的心性与气运分支。',
        apply: (g) => g.endGame('qinzhuan'),
      },
    ],
  },
];

export const STORY_BY_ID = Object.fromEntries(STORY_NODES.map((n) => [n.id, n]));
