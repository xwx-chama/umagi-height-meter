(function () {
  'use strict';
  var C = window.UmagiCore;
  var $ = function (id) { return document.getElementById(id); };

  var LABELS = {
    sex: { male: '牡馬・セン馬', female: '牝馬' },
    body: { slim: '細身', standard: '標準', sturdy: 'がっちり' },
    method: { original: 'オリジナル計算', simple: 'シンプル計算', mild: 'BMI計算' },
    format: { pc: 'PC版', sp: 'スマホ版' }
  };

  var els = {
    paste: $('paste'), format: $('format'), formatBox: $('formatBox'), status: $('status'),
    excludeDebut: $('excludeDebut'), top3: $('top3'),
    recentBox: $('recentBox'), recentN: $('recentN'),
    avgW: $('avgW'), height: $('height'), meta: $('resultMeta'),
    summary: $('summary'), detailList: $('detailList'), clearBtn: $('clearBtn')
  };

  els.recentN.value = C.CONFIG.recentNDefault;

  function radio(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function num(el) {
    var v = String(el.value).trim();
    if (v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function fmt1(x) { return (Math.round(x * 10) / 10).toFixed(1); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // 読み取り結果は貼り付け・形式が変わったときだけ作り直す
  var parseCache = { key: null, result: null };
  function getParsed() {
    var text = els.paste.value;
    var key = els.format.value + '\u0000' + text;
    if (parseCache.key !== key) {
      parseCache = { key: key, result: text.trim() ? C.parse(text, els.format.value) : null };
    }
    return parseCache.result;
  }

  function setStatus(msg, kind) {
    els.status.textContent = msg;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setBar(avg, height, metaHtml) {
    els.avgW.textContent = avg;
    els.height.textContent = height;
    els.meta.innerHTML = metaHtml;
  }

  // 馬体重を直接入力するモード（フィルタ・参照データ数は使わない）
  function updateManual(sex, body, method) {
    var w = num($('manualW'));
    var valid = w !== null && w > 0;
    var st = $('manualStatus');
    st.textContent = $('manualW').value.trim() !== '' && !valid ? '0より大きい数字を入れてください' : '';
    st.className = 'status' + (st.textContent ? ' warn' : '');
    if (!sex || !valid) {
      var guide = !sex && !valid ? '性別を選んで、馬体重を入力してください'
        : !sex ? '性別を選んでください' : '馬体重を入力してください';
      setBar(valid ? fmt1(w) : '--', '--', esc(guide));
      renderDetails(null);
      return;
    }
    var res = C.calcHeight(w, sex, method, body, 0);
    setBar(fmt1(w), fmt1(res.height), '直接入力');
    renderDetails(res, null);
  }

  function update() {
    var sex = radio('sex');
    var body = radio('body');
    var method = radio('method');
    var limitRecent = radio('limit') === 'recent';
    els.recentBox.classList.toggle('show', limitRecent);

    // 設定の要約（バーの外）
    els.summary.textContent = [
      '性別：' + (sex ? LABELS.sex[sex] : '未選択'),
      '計算方法：' + LABELS.method[method],
      '体型：' + LABELS.body[body]
    ].join(' ／ ');

    var manual = radio('mode') === 'manual';
    $('manualMode').hidden = !manual;
    $('pasteMode').hidden = manual;
    $('dataFields').hidden = manual;
    $('avgLabel').textContent = manual ? '馬体重' : '平均馬体重';
    if (manual) { updateManual(sex, body, method); return; }

    var parsed = getParsed();
    els.formatBox.classList.remove('attention');

    // 貼り付けの確認表示
    if (!parsed) {
      setStatus('', '');
    } else if (parsed.rows.length === 0) {
      setStatus(parsed.format
        ? '読み取れませんでした。形式を選んでください'
        : '形式を自動で判別できませんでした。PC版・スマホ版を選んでください', 'warn');
      els.formatBox.classList.add('attention');
    } else {
      var rows = parsed.rows;
      var fmtNote = els.format.value === 'auto' ? '（' + LABELS.format[parsed.format] + 'として自動判定）' : '';
      setStatus(rows.length + '件読み取りました（最古 ' + rows[rows.length - 1].date.text +
        ' 〜 最新 ' + rows[0].date.text + '）' + fmtNote, 'ok');
    }

    // 結果を出せない状態
    if (!sex || !parsed) {
      var guide = !sex && !parsed ? '性別を選んで、競走成績を貼り付けてください'
        : !sex ? '性別を選んでください' : '競走成績を貼り付けてください';
      setBar('--', '--', esc(guide));
      renderDetails(null);
      return;
    }
    if (parsed.rows.length === 0) {
      setBar('--', '--', '<span class="warn">読み取れませんでした。形式を選んでください</span>');
      renderDetails(null);
      return;
    }

    var nVal = num(els.recentN);
    var recentN = limitRecent ? Math.max(1, Math.floor(nVal || C.CONFIG.recentNDefault)) : null;
    var sel = C.selectRows(parsed.rows, {
      excludeDebutYear: els.excludeDebut.checked,
      top3Only: els.top3.checked,
      minWeight: null,
      maxWeight: null,
      recentN: recentN
    });

    var metaParts = [];
    if (sel.adopted.length === 0) {
      metaParts.push('<span class="warn">条件に合うデータがありません。フィルタをゆるめてください</span>');
      if (els.excludeDebut.checked) metaParts.push('除外中：' + sel.debutYear + '年');
      setBar('--', '--', metaParts.join('<br>'));
      renderDetails(null, sel);
      return;
    }

    var res = C.calcHeight(sel.average, sex, method, body, 0);
    var line1 = '全' + sel.total + '走のうち' + sel.adopted.length + '走を採用';
    if (recentN && sel.adopted.length < recentN) line1 += '（直近' + recentN + '走に満たないため、ある分で計算）';
    if (els.excludeDebut.checked) line1 += ' ／ 除外中：' + sel.debutYear + '年';
    metaParts.push(esc(line1));
    if (sel.adopted.length < C.CONFIG.fewDataThreshold) {
      metaParts.push('<span class="warn">採用件数が少ないので参考値です</span>');
    }
    setBar(fmt1(sel.average), fmt1(res.height), metaParts.join('<br>'));
    renderDetails(res, sel);
  }

  function renderDetails(res, sel) {
    var items = [];
    if (res) {
      items.push(['人間に換算した体重', fmt1(res.W) + ' kg']);
      items.push(['使用したBMI', res.B.toFixed(2)]);
    } else {
      items.push(['人間に換算した体重', '--']);
      items.push(['使用したBMI', '--']);
    }
    if (radio('mode') !== 'manual') items.push(['馬体重なしで除外した走数', sel ? sel.missing + ' 走' : '--']);
    els.detailList.innerHTML = items.map(function (it) {
      return '<dt>' + esc(it[0]) + '</dt><dd>' + esc(it[1]) + '</dd>';
    }).join('');
  }

  els.clearBtn.addEventListener('click', function () {
    els.paste.value = '';
    els.paste.focus();
    update();
  });

  document.addEventListener('input', update);
  document.addEventListener('change', update);
  update();
})();
