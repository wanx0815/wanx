/*! 大六壬排盘引擎：天地盘、四课、九宗门三传、十二天将、遁干、空亡、六亲、四时旺相。
 *  规则依据：《六壬大全》起例、袁树珊《大六壬探原》；昼夜贵人按 卯–申 为昼。
 *  不含历法，日期干支与月将由调用方传入。 */
var LiurenEngine = (function () {
  'use strict';

  var STEMS = '甲乙丙丁戊己庚辛壬癸'.split('');
  var BRANCHES = '子丑寅卯辰巳午未申酉戌亥'.split('');
  var ELEM = {
    甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
    子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水'
  };
  // 十干寄宫：甲课寅兮乙课辰，丙戊课巳，丁己课未，庚申，辛戌，壬亥，癸丑。
  var HOME = { 甲: '寅', 乙: '辰', 丙: '巳', 丁: '未', 戊: '巳', 己: '未', 庚: '申', 辛: '戌', 壬: '亥', 癸: '丑' };
  var CONTROLS = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
  var GENERATES = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
  // 中气换将：雨水亥、春分戌、谷雨酉、小满申、夏至未、大暑午、处暑巳、秋分辰、霜降卯、小雪寅、冬至丑、大寒子。
  var QI_JIANG = { 雨水: '亥', 春分: '戌', 谷雨: '酉', 小满: '申', 夏至: '未', 大暑: '午', 处暑: '巳', 秋分: '辰', 霜降: '卯', 小雪: '寅', 冬至: '丑', 大寒: '子' };
  var OFFICIALS = ['贵人', '螣蛇', '朱雀', '六合', '勾陈', '青龙', '天空', '白虎', '太常', '玄武', '太阴', '天后'];
  var DAY_NOBLE = { 甲: '丑', 戊: '丑', 庚: '丑', 乙: '子', 己: '子', 丙: '亥', 丁: '亥', 壬: '巳', 癸: '巳', 辛: '午' };
  var NIGHT_NOBLE = { 甲: '未', 戊: '未', 庚: '未', 乙: '申', 己: '申', 丙: '酉', 丁: '酉', 壬: '卯', 癸: '卯', 辛: '寅' };
  var STEM_UNION = { 甲: '己', 己: '甲', 乙: '庚', 庚: '乙', 丙: '辛', 辛: '丙', 丁: '壬', 壬: '丁', 戊: '癸', 癸: '戊' };
  var THREE_UNION = ['申子辰', '亥卯未', '寅午戌', '巳酉丑'];
  var POST_HORSE = { 申: '寅', 子: '寅', 辰: '寅', 寅: '申', 午: '申', 戌: '申', 巳: '亥', 酉: '亥', 丑: '亥', 亥: '巳', 卯: '巳', 未: '巳' };
  // 相刑：子卯、寅巳申互刑、丑戌未互刑，辰午酉亥自刑。
  var PUNISH = { 子: '卯', 卯: '子', 寅: '巳', 巳: '申', 申: '寅', 丑: '戌', 戌: '未', 未: '丑', 辰: '辰', 午: '午', 酉: '酉', 亥: '亥' };
  var CLASH = { 子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅', 卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳' };
  // 四时旺相休囚死：按月建定季。
  var SEASON_WANG = {
    春: { 旺: '木', 相: '火', 休: '水', 囚: '金', 死: '土' },
    夏: { 旺: '火', 相: '土', 休: '木', 囚: '水', 死: '金' },
    秋: { 旺: '金', 相: '水', 休: '土', 囚: '火', 死: '木' },
    冬: { 旺: '水', 相: '木', 休: '金', 囚: '土', 死: '火' },
    四季: { 旺: '土', 相: '金', 休: '火', 囚: '木', 死: '水' }
  };

  var bi = function (branch) { return BRANCHES.indexOf(branch); };
  var si = function (stem) { return STEMS.indexOf(stem); };
  var isYangStem = function (stem) { return si(stem) % 2 === 0; };
  var isYangBranch = function (branch) { return '子寅辰午申戌'.indexOf(branch) >= 0; };
  var mod = function (n, m) { return ((n % m) + m) % m; };

  function seasonOf(monthBranch) {
    if ('寅卯'.indexOf(monthBranch) >= 0) return '春';
    if ('巳午'.indexOf(monthBranch) >= 0) return '夏';
    if ('申酉'.indexOf(monthBranch) >= 0) return '秋';
    if ('亥子'.indexOf(monthBranch) >= 0) return '冬';
    return '四季';
  }
  function wangState(element, monthBranch) {
    var table = SEASON_WANG[seasonOf(monthBranch)];
    return Object.keys(table).find(function (key) { return table[key] === element; }) || '';
  }

  // 天地盘：月将加占时，地盘 x 的上神 = (x + 月将 - 占时) mod 12。
  function makePlate(moonGeneral, hourBranch) {
    var offset = mod(bi(moonGeneral) - bi(hourBranch), 12);
    var earthToHeaven = {}, heavenToEarth = {};
    BRANCHES.forEach(function (earth, index) {
      var heaven = BRANCHES[(index + offset) % 12];
      earthToHeaven[earth] = heaven;
      heavenToEarth[heaven] = earth;
    });
    return { offset: offset, earthToHeaven: earthToHeaven, heavenToEarth: heavenToEarth };
  }

  // 课体关系：以下临上、上临下判生克。
  function relation(bottomElement, topElement) {
    if (CONTROLS[bottomElement] === topElement) return 'zei';  // 下贼上（重审）
    if (CONTROLS[topElement] === bottomElement) return 'ke';   // 上克下（元首）
    if (GENERATES[bottomElement] === topElement) return 'xsheng';
    if (GENERATES[topElement] === bottomElement) return 'ssheng';
    return 'bi';
  }
  var REL_TEXT = { zei: '下贼上', ke: '上克下', xsheng: '下生上', ssheng: '上生下', bi: '比和' };
  function sixRelative(dayStem, branch) {
    var me = ELEM[dayStem], other = ELEM[branch];
    if (me === other) return '兄弟';
    if (GENERATES[other] === me) return '父母';
    if (GENERATES[me] === other) return '子孙';
    if (CONTROLS[me] === other) return '妻财';
    return '官鬼';
  }

  function buildLessons(dayStem, dayBranch, plate) {
    var ganHome = HOME[dayStem];
    var first = plate.earthToHeaven[ganHome];
    var third = plate.earthToHeaven[dayBranch];
    var specs = [
      [1, '干阳', dayStem, ELEM[dayStem], first],
      [2, '干阴', first, ELEM[first], plate.earthToHeaven[first]],
      [3, '支阳', dayBranch, ELEM[dayBranch], third],
      [4, '支阴', third, ELEM[third], plate.earthToHeaven[third]]
    ];
    return specs.map(function (s) {
      var kind = relation(s[3], ELEM[s[4]]);
      return { no: s[0], name: s[1], bottom: s[2], bottomElem: s[3], top: s[4], topElem: ELEM[s[4]], relation: kind, relationText: REL_TEXT[kind] };
    });
  }

  // 涉害深浅：从上神所临地盘顺行归本家，数途中地盘克天盘（下贼上）的次数。
  function sheHaiDepth(heavenBranch, plate) {
    var start = bi(plate.heavenToEarth[heavenBranch]);
    var home = bi(heavenBranch);
    var count = 0;
    for (var i = 0; i <= 12; i++) {
      var earth = BRANCHES[(start + i) % 12];
      if (CONTROLS[ELEM[earth]] === ELEM[plate.earthToHeaven[earth]]) count++;
      if (bi(earth) === home) break;
    }
    return count;
  }
  var MENG = '寅申巳亥', ZHONG = '子午卯酉';
  function mengDepth(branch) { return MENG.indexOf(branch) >= 0 ? 3 : ZHONG.indexOf(branch) >= 0 ? 2 : 1; }

  function uniqueCandidates(lessons, kind) {
    var seen = {}, list = [];
    lessons.forEach(function (item) {
      if (item.relation === kind && !seen[item.top]) { seen[item.top] = 1; list.push(item); }
    });
    return list;
  }

  function pickAmong(candidates, dayStem, dayBranch, plate, lessons) {
    // 比用：取与日干同阴阳者。
    var same = candidates.filter(function (x) { return isYangBranch(x.top) === isYangStem(dayStem); });
    if (same.length === 1) return { top: same[0].top, principle: '比用' };
    var pool = same.length ? same : candidates;
    // 涉害：归家受克多者为深。
    var scored = pool.map(function (x) { return { top: x.top, depth: sheHaiDepth(x.top, plate) }; });
    var max = Math.max.apply(null, scored.map(function (s) { return s.depth; }));
    var deepest = scored.filter(function (s) { return s.depth === max; });
    if (deepest.length === 1) return { top: deepest[0].top, principle: '涉害' };
    // 见机 / 察微：先取四孟上神，无孟取四仲。
    var byMeng = deepest.slice().sort(function (a, b) { return mengDepth(b.top) - mengDepth(a.top); });
    if (mengDepth(byMeng[0].top) > mengDepth(byMeng[1].top)) {
      return { top: byMeng[0].top, principle: mengDepth(byMeng[0].top) === 3 ? '见机' : '察微' };
    }
    // 缀瑕：阳日取干上神，阴日取支上神。
    var fallback = isYangStem(dayStem) ? lessons[0].top : lessons[2].top;
    var hit = byMeng.find(function (x) { return x.top === fallback; });
    return { top: (hit || byMeng[0]).top, principle: '缀瑕' };
  }

  function normalDirect(lessons, dayStem, dayBranch, plate) {
    var rebels = uniqueCandidates(lessons, 'zei');
    var candidates = rebels.length ? rebels : uniqueCandidates(lessons, 'ke');
    if (!candidates.length) return null;
    if (candidates.length === 1) return { top: candidates[0].top, principle: rebels.length ? '重审' : '元首' };
    return pickAmong(candidates, dayStem, dayBranch, plate, lessons);
  }

  function chainFrom(initial, plate) {
    var middle = plate.earthToHeaven[initial];
    return [initial, middle, plate.earthToHeaven[middle]];
  }

  function derivePasses(dayStem, dayBranch, plate, lessons) {
    var yang = isYangStem(dayStem);
    var stemTop = lessons[0].top, branchTop = lessons[2].top, branchYin = lessons[3].top;
    var offset = plate.offset;

    if (offset === 0) { // 伏吟
      var direct0 = normalDirect(lessons, dayStem, dayBranch, plate);
      var initial0 = direct0 ? direct0.top : (yang ? stemTop : branchTop);
      var middle0 = PUNISH[initial0];
      if (middle0 === initial0) middle0 = yang ? branchTop : stemTop;  // 自刑改取
      var final0 = PUNISH[middle0];
      if (final0 === middle0) final0 = CLASH[middle0];
      return { list: [initial0, middle0, final0], principle: direct0 ? '伏吟·' + direct0.principle : '伏吟', note: '伏吟用刑，自刑改取，末传取冲' };
    }

    if (offset === 6) { // 返吟
      var direct6 = normalDirect(lessons, dayStem, dayBranch, plate);
      if (direct6) return { list: chainFrom(direct6.top, plate), principle: '返吟·' + direct6.principle, note: '返吟有克，依贼克取传' };
      return { list: [POST_HORSE[dayBranch], branchTop, stemTop], principle: '返吟无亲', note: '返吟无克，取日支驿马，中末取支上、干上' };
    }

    var direct = normalDirect(lessons, dayStem, dayBranch, plate);
    if (direct) return { list: chainFrom(direct.top, plate), principle: direct.principle, note: '有贼先取贼，无贼取克' };

    // 遥克：四课无克，取上神遥克日干（蒿矢），或日干遥克上神（弹射）。
    var over = [], from = [], seenOver = {}, seenFrom = {};
    lessons.forEach(function (item) {
      if (CONTROLS[item.topElem] === ELEM[dayStem] && !seenOver[item.top]) { seenOver[item.top] = 1; over.push(item); }
      if (CONTROLS[ELEM[dayStem]] === item.topElem && !seenFrom[item.top]) { seenFrom[item.top] = 1; from.push(item); }
    });
    var distant = over.length ? over : from;
    var uniqueSpirits = Object.keys(lessons.reduce(function (map, item) { map[item.top] = 1; return map; }, {}));

    if (uniqueSpirits.length > 2 && distant.length) {
      var top;
      if (distant.length === 1) top = distant[0].top;
      else {
        var samePolarity = distant.filter(function (x) { return isYangBranch(x.top) === isYangStem(dayStem); });
        top = (samePolarity.length === 1 ? samePolarity[0] : distant[0]).top;
      }
      return { list: chainFrom(top, plate), principle: over.length ? '遥克·蒿矢' : '遥克·弹射', note: '四课无克，取遥克' };
    }

    if (uniqueSpirits.length === 4) { // 昴星
      if (yang) return { list: [plate.earthToHeaven['酉'], branchTop, stemTop], principle: '昴星·虎视', note: '阳日取地盘酉上神，中取支上、末取干上' };
      return { list: [plate.heavenToEarth['酉'], stemTop, branchTop], principle: '昴星·冬蛇', note: '阴日取天盘酉所临地盘支，中取干上、末取支上' };
    }

    if (uniqueSpirits.length === 3) { // 别责
      var initial3;
      if (yang) initial3 = plate.earthToHeaven[HOME[STEM_UNION[dayStem]]];
      else {
        var group = THREE_UNION.find(function (g) { return g.indexOf(dayBranch) >= 0; });
        initial3 = group[(group.indexOf(dayBranch) + 1) % 3];
      }
      return { list: [initial3, stemTop, stemTop], principle: '别责', note: '四课不全，阳取干合寄宫上神，阴取支三合前一辰' };
    }

    if (uniqueSpirits.length === 2) { // 八专
      var initial4 = yang ? BRANCHES[(bi(stemTop) + 2) % 12] : BRANCHES[mod(bi(branchYin) - 2, 12)];
      return { list: [initial4, stemTop, stemTop], principle: '八专', note: '干支同位，阳日干上神顺数三位，阴日四课上神逆数三位' };
    }

    return { list: chainFrom(stemTop, plate), principle: '未定', note: '结构不符合九宗门自动判据，需人工复核' };
  }

  // 十二天将：贵人临地盘 亥子丑寅卯辰 顺布，巳午未申酉戌 逆布。
  function buildOfficials(dayStem, dayNight, plate) {
    var noble = (dayNight === 'night' ? NIGHT_NOBLE : DAY_NOBLE)[dayStem];
    var earthBelow = plate.heavenToEarth[noble];
    var clockwise = '亥子丑寅卯辰'.indexOf(earthBelow) >= 0;
    var step = clockwise ? 1 : -1;
    var start = bi(noble);
    var byHeaven = {};
    OFFICIALS.forEach(function (name, index) {
      byHeaven[BRANCHES[mod(start + step * index, 12)]] = name;
    });
    return { byHeaven: byHeaven, noble: noble, earthBelow: earthBelow, clockwise: clockwise, dayNight: dayNight === 'night' ? '夜' : '昼' };
  }

  // 遁干：按日干支所在旬，给任一地支遁出天干；旬空两支无干。
  function dunGan(dayStem, dayBranch, branch) {
    var dayIndex = 0;
    while (dayIndex < 60 && !(dayIndex % 10 === si(dayStem) && dayIndex % 12 === bi(dayBranch))) dayIndex++;
    var headZhi = dayIndex - (dayIndex % 10);
    var offset = mod(bi(branch) - (headZhi % 12), 12);
    return offset < 10 ? STEMS[offset] : '';
  }
  function xunShou(dayStem, dayBranch) {
    var dayIndex = 0;
    while (dayIndex < 60 && !(dayIndex % 10 === si(dayStem) && dayIndex % 12 === bi(dayBranch))) dayIndex++;
    var head = dayIndex - (dayIndex % 10);
    return [STEMS[head % 10], BRANCHES[head % 12]].join('');
  }

  function build(input) {
    var dayStem = input.dayStem, dayBranch = input.dayBranch, hourBranch = input.hourBranch, moonGeneral = input.moonGeneral;
    var monthBranch = input.monthBranch || dayBranch;
    if (si(dayStem) < 0 || bi(dayBranch) < 0 || bi(hourBranch) < 0 || bi(moonGeneral) < 0) throw new Error('干支或月将不合法');
    if (si(dayStem) % 2 !== bi(dayBranch) % 2) throw new Error('日干与日支阴阳不配，不构成有效日柱');

    var plate = makePlate(moonGeneral, hourBranch);
    var lessons = buildLessons(dayStem, dayBranch, plate);
    var passes = derivePasses(dayStem, dayBranch, plate, lessons);
    var officials = buildOfficials(dayStem, input.dayNight, plate);
    var head = xunShou(dayStem, dayBranch);
    var kong = [BRANCHES[(bi(head[1]) + 10) % 12], BRANCHES[(bi(head[1]) + 11) % 12]];

    var palaces = BRANCHES.map(function (earth) {
      var heaven = plate.earthToHeaven[earth];
      return {
        earth: earth,
        heaven: heaven,
        general: officials.byHeaven[heaven] || '',
        dun: dunGan(dayStem, dayBranch, heaven),
        six: sixRelative(dayStem, heaven),
        kong: kong.indexOf(heaven) >= 0,
        wang: wangState(ELEM[heaven], monthBranch)
      };
    });

    var passList = passes.list.map(function (branch) {
      return {
        branch: branch,
        general: officials.byHeaven[branch] || '',
        dun: dunGan(dayStem, dayBranch, branch),
        six: sixRelative(dayStem, branch),
        kong: kong.indexOf(branch) >= 0
      };
    });

    return {
      input: { dayStem: dayStem, dayBranch: dayBranch, hourBranch: hourBranch, moonGeneral: moonGeneral, monthBranch: monthBranch, dayNight: input.dayNight },
      plate: plate,
      palaces: palaces,
      lessons: lessons,
      passes: passList,
      principle: passes.principle,
      note: passes.note,
      officials: officials,
      xunShou: head,
      kong: kong,
      season: seasonOf(monthBranch),
      wang: SEASON_WANG[seasonOf(monthBranch)]
    };
  }

  return { build: build, QI_JIANG: QI_JIANG, wangState: wangState, seasonOf: seasonOf, SEASON_WANG: SEASON_WANG, BRANCHES: BRANCHES, STEMS: STEMS, ELEM: ELEM };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LiurenEngine;
