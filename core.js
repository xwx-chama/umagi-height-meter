/*
 * うまぎ身長計 — 計算・読み取りのコア処理
 * ブラウザでは window.UmagiCore、Node では module.exports として使える。
 */
(function (root) {
  'use strict';

  // ===== 設定値（ここだけ直せば全体に反映される） =====
  var CONFIG = {
    base: {
      male:   { M0: 480, H0: 171, W0: 68 },   // 牡馬・セン馬
      female: { M0: 460, H0: 158, W0: 53.5 }  // 牝馬
    },
    // 計算方法ごとの指数 p（r>=1 のとき up、r<1 のとき down）
    methods: {
      original: { up: 1.75, down: 1.24 },
      simple:   { up: 2,    down: 2 },
      mild:     { up: 1,    down: 1 }
    },
    // 体型ごとの標準BMIからの差
    bodyOffsets: { slim: -0.5, standard: 0, sturdy: 0.5 },
    recentNDefault: 5,
    adjust: { min: -20, max: 20, step: 0.5 },
    fewDataThreshold: 3
  };

  function standardBmi(sex) {
    var b = CONFIG.base[sex];
    return b.W0 / Math.pow(b.H0 / 100, 2);
  }

  /**
   * 身長を計算する（丸めなし）
   * @param {number} M 平均馬体重
   * @param {'male'|'female'} sex
   * @param {'original'|'simple'|'mild'} method
   * @param {'slim'|'standard'|'sturdy'} body
   * @param {number} adjust 手動微調整 cm
   */
  function calcHeight(M, sex, method, body, adjust) {
    var b = CONFIG.base[sex];
    var m = CONFIG.methods[method];
    var r = M / b.M0;
    var p = r >= 1 ? m.up : m.down;
    var W = b.W0 * Math.pow(r, p);
    var B = standardBmi(sex) + CONFIG.bodyOffsets[body];
    var rawH = 100 * Math.sqrt(W / B);
    var a = adjust || 0;
    return { r: r, p: p, W: W, B: B, rawHeight: rawH, height: rawH + a };
  }

  // ===== 貼り付けの読み取り =====

  var RE_PC_DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})[\t ]/;
  var RE_SP_DATE = /^(\d{2})\/(\d{1,2})\/(\d{1,2})\s+\S+\s+\d+R\s*$/;
  var RE_DIST = /^(芝|ダ|障)\d{3,4}$/;
  var RE_WEIGHT = /^(\d{3,4})\s*(\([^)]*\))?$/;

  function normalize(text) {
    var t = String(text || '');
    if (t.normalize) t = t.normalize('NFKC');
    return t.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  }

  function detectFormat(text) {
    var lines = normalize(text).split('\n');
    var pc = 0, sp = 0;
    for (var i = 0; i < lines.length; i++) {
      if (RE_PC_DATE.test(lines[i])) pc++;
      else if (RE_SP_DATE.test(lines[i].trim())) sp++;
    }
    if (pc > 0 && sp === 0) return 'pc';
    if (sp > 0 && pc === 0) return 'sp';
    return null;
  }

  function splitCells(s) {
    if (s.indexOf('\t') >= 0) return s.split('\t').map(function (c) { return c.trim(); });
    return s.trim().split(/\s+/);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function makeDate(y, m, d) {
    y = +y; m = +m; d = +d;
    return { key: y * 10000 + m * 100 + d, year: y, text: y + '/' + pad2(m) + '/' + pad2(d) };
  }

  function parseRank(cell) {
    var c = (cell || '').trim();
    var m = c.match(/^(\d+)/);
    if (m) return { rank: parseInt(m[1], 10), rankText: c };
    return { rank: null, rankText: c };
  }

  function findWeight(cells, from) {
    for (var i = from; i < cells.length; i++) {
      var m = cells[i].match(RE_WEIGHT);
      if (m && cells[i].indexOf('(') >= 0) return parseInt(m[1], 10);
    }
    return null;
  }

  function indexOfDist(cells, from) {
    for (var i = from || 0; i < cells.length; i++) {
      if (RE_DIST.test(cells[i])) return i;
    }
    return -1;
  }

  function parsePC(text) {
    var lines = normalize(text).split('\n');
    var records = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(RE_PC_DATE);
      if (m) {
        cur = { date: makeDate(m[1], m[2], m[3]), lines: [lines[i]] };
        records.push(cur);
      } else if (cur) {
        cur.lines.push(lines[i]);
      }
    }
    return records.map(function (rec) {
      var joined = rec.lines.join('\t');
      var cells = splitCells(joined);
      var d = indexOfDist(cells, 1);
      var rank = { rank: null, rankText: '' };
      var weight = null;
      if (d >= 0) {
        if (d - 3 >= 0) rank = parseRank(cells[d - 3]);
        weight = findWeight(cells, d + 1);
      }
      return { date: rec.date, rank: rank.rank, rankText: rank.rankText, weight: weight };
    });
  }

  // スマホ版の2桁の年を4桁に直す（今年の下2桁より大きければ1900年代。例：99→1999、24→2024）
  function fullYear(yy) {
    yy = +yy;
    return yy > new Date().getFullYear() % 100 ? 1900 + yy : 2000 + yy;
  }

  function parseSP(text) {
    var lines = normalize(text).split('\n');
    var map = {};
    var order = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var m = line.match(RE_SP_DATE);
      if (m) {
        var key = line.replace(/\s+/g, ' ');
        if (!map[key]) {
          map[key] = { date: makeDate(fullYear(m[1]), m[2], m[3]), rank: null, rankText: '', weight: null, hasData: false };
          order.push(key);
        }
        cur = map[key];
        continue;
      }
      if (!cur || cur.hasData) continue;
      var cells = splitCells(lines[i]);
      var d = indexOfDist(cells, 0);
      if (d < 0) continue;
      var tabbed = lines[i].indexOf('\t') >= 0;
      var rk = tabbed ? (d - 7 >= 0 ? cells[d - 7] : '') : (cells[1] || '');
      var r = parseRank(rk);
      cur.rank = r.rank;
      cur.rankText = r.rankText;
      cur.weight = findWeight(cells, d + 1);
      cur.hasData = true;
    }
    return order.map(function (k) {
      var x = map[k];
      return { date: x.date, rank: x.rank, rankText: x.rankText, weight: x.weight };
    });
  }

  /**
   * 貼り付けを読み取る
   * @param {string} text
   * @param {'auto'|'pc'|'sp'} format
   * @returns {{format: string|null, detected: string|null, rows: Array}}
   */
  function parse(text, format) {
    var detected = detectFormat(text);
    var use = format === 'pc' || format === 'sp' ? format : detected;
    var rows = [];
    if (use === 'pc') rows = parsePC(text);
    else if (use === 'sp') rows = parseSP(text);
    rows.sort(function (a, b) { return b.date.key - a.date.key; });
    return { format: use, detected: detected, rows: rows };
  }

  // ===== 絞り込み =====

  /**
   * @param {Array} rows 新しい順の行
   * @param {{excludeDebutYear:boolean, top3Only:boolean, minWeight:number|null, maxWeight:number|null, recentN:number|null}} opt
   */
  function selectRows(rows, opt) {
    var total = rows.length;
    var debutYear = null;
    for (var i = 0; i < rows.length; i++) {
      if (debutYear === null || rows[i].date.year < debutYear) debutYear = rows[i].date.year;
    }
    var missing = 0;
    var adopted = [];
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      if (row.weight === null) { missing++; continue; }
      if (opt.excludeDebutYear && row.date.year === debutYear) continue;
      if (opt.top3Only && !(row.rank >= 1 && row.rank <= 3)) continue;
      if (opt.minWeight !== null && opt.minWeight !== undefined && row.weight < opt.minWeight) continue;
      if (opt.maxWeight !== null && opt.maxWeight !== undefined && row.weight > opt.maxWeight) continue;
      adopted.push(row);
      if (opt.recentN && adopted.length >= opt.recentN) break;
    }
    var sum = 0;
    for (var k = 0; k < adopted.length; k++) sum += adopted[k].weight;
    // 「馬体重なし」の件数は、件数制限で打ち切った場合も全体で数える
    if (opt.recentN) {
      missing = 0;
      for (var q = 0; q < rows.length; q++) if (rows[q].weight === null) missing++;
    }
    return {
      total: total,
      debutYear: debutYear,
      missing: missing,
      adopted: adopted,
      average: adopted.length ? sum / adopted.length : null
    };
  }

  var api = {
    CONFIG: CONFIG,
    standardBmi: standardBmi,
    calcHeight: calcHeight,
    detectFormat: detectFormat,
    parse: parse,
    selectRows: selectRows
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UmagiCore = api;
})(this);
