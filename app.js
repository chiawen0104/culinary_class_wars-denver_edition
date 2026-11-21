(() => {
  'use strict';

  const STORE_KEY = 'ccw-denver-v3';

  const STEPS = [
    { title: '參賽者設定', desc: '輸入參賽者姓名，指定或抽籤選出 2 位評審，其餘抽籤分成黑隊、白隊' },
    { title: '採購戰', desc: '評審指定個人戰主食材，兩隊一起採買兩輪食材，比較總花費' },
    { title: '採購戰抽卡', desc: '總花費較少的隊伍抽一張團體賽用的特權卡' },
    { title: '第一輪：1v1 個人戰', desc: '不限時，一對一 PK，每人煮一道 1–2 人份的菜／前菜／湯／甜點' },
    { title: '個人戰盲測評分', desc: '兩位評審各自打分，計算各場結果與隊伍戰績' },
    { title: '個人戰抽卡', desc: '2:1 勝隊抽 1 張；3:0 勝隊抽 2 張' },
    { title: '第二輪：團體戰', desc: '不限時，全隊完成 4 人份主食（飯／麵／肉），可隨時使用特權卡' },
    { title: '最終評分及冠軍揭曉', desc: '兩位評審打分，公布黑白大廚總冠軍' },
  ];

  const DEFAULT_SETTINGS = {
    criteria: [
      { name: '味道', weight: 50, hint: '風味、調味、口感與整體平衡' },
      { name: '創意', weight: 20, hint: '原創性、料理巧思與特色' },
      { name: '食材運用', weight: 20, hint: '食材處理、烹飪技巧、搭配合理性' },
      { name: '擺盤', weight: 10, hint: '視覺美感、整潔度、呈現方式' },
    ],
    deck: [
      { icon: '🎁', title: '神祕食材', desc: '對手的料理必須額外加入一樣評審事先準備的食材。', note: '必須於團體戰開始前使用。', duration: 0 },
      { icon: '🥩', title: '食材搶奪權', desc: '要求對手提出 3 種可被搶走的非必要食材，從中選擇 1 種奪取。', note: '必須於團體戰開始前使用。', duration: 0 },
      { icon: '🤐', title: '主廚禁言令', desc: '指定對手一位選手，禁止說話 5 分鐘，只能用手勢溝通。', note: '團體戰進行中使用。', duration: 5 },
      { icon: '🧑‍🍳', title: '評審幫手', desc: '指定一位評審協助洗菜、切菜或備料 5 分鐘。', note: '評審不可調味、烹飪或代替選手決策。', duration: 5 },
    ],
    r1Min: 50,
    r2Min: 40,
  };

  const TEAM_NAME = { black: '黑隊', white: '白隊' };
  const TEAM_EN = { black: 'BLACK', white: 'WHITE' };

  // ---------------- utils ----------------
  const $ = (s) => document.querySelector(s);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rand = () => {
    try { return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; } catch (e) { return Math.random(); }
  };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const other = (t) => (t === 'black' ? 'white' : 'black');
  const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const pill = (t) => `<span class="pill ${t}">${TEAM_NAME[t]}</span>`;

  // ---------------- state ----------------
  function freshState(settings) {
    return {
      step: 0,
      maxStep: 0,
      players: ['', '', '', ''],
      judgeMode: 'random',
      judgeFlags: [],
      assigned: false,
      judges: [],
      black: [],
      white: [],
      ingredients: [],
      spend: { black: '', white: '' },
      purchaseWinner: null,
      draws: {},
      timers: {},
      used: {},
      blind: [],
      scores: { r1: [{}, {}], r2: [{}, {}] },
      submitted: { r1: [false, false], r2: [false, false] },
      revealed: false,
      settings: settings ? clone(settings) : clone(DEFAULT_SETTINGS),
    };
  }

  let state;
  try {
    state = JSON.parse(localStorage.getItem(STORE_KEY)) || freshState();
  } catch (e) {
    state = freshState();
  }
  state = Object.assign(freshState(), state);
  // migrate saved decks: replace the retired time-based cards with the new defaults
  (function migrateDeck() {
    const swap = { '時間先鋒': 0, '時間凍結': 2 };
    (state.settings.deck || []).forEach((c, i, deck) => {
      if (c.title in swap) deck[i] = clone(DEFAULT_SETTINGS.deck[swap[c.title]]);
    });
  })();
  // migrate saved settings to the current scoring hints (keeps custom hints)
  (function migrateHints() {
    const OLD = ['', '① 主食材突出程度　② 烹飪方式是否適合　③ 食材、調味搭配是否合理'];
    const byName = Object.fromEntries(DEFAULT_SETTINGS.criteria.map((c) => [c.name, c.hint]));
    (state.settings.criteria || []).forEach((c) => {
      if (byName[c.name] && OLD.includes(c.hint || '')) c.hint = byName[c.name];
    });
  })();

  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  };

  const ui = { tab: { r1: 0, r2: 0 }, error: '', fullscreen: false };

  // ---------------- derived ----------------
  const matchCount = () => Math.min(state.black.length, state.white.length);
  const crit = () => state.settings.criteria;

  function getVals(round, j, id) {
    const v = (state.scores[round][j] || {})[id] || [];
    return crit().map((_, k) => (typeof v[k] === 'number' ? v[k] : 5));
  }
  function dishScore(round, j, id) {
    const vals = getVals(round, j, id);
    const totalW = crit().reduce((s, c) => s + Number(c.weight || 0), 0) || 1;
    return (vals.reduce((s, v, k) => s + v * Number(crit()[k].weight || 0), 0) / totalW) * 10;
  }
  const teamOfDish = (i, label) => (state.blind[i] ? (label === 'A' ? 'black' : 'white') : (label === 'A' ? 'white' : 'black'));
  const dishOfTeam = (i, team) => (teamOfDish(i, 'A') === team ? 'A' : 'B');

  function r1Results() {
    const rows = [];
    let bw = 0, ww = 0;
    for (let i = 0; i < matchCount(); i++) {
      const b = dishOfTeam(i, 'black'), w = dishOfTeam(i, 'white');
      const bj = [0, 1].map((j) => dishScore('r1', j, i + b));
      const wj = [0, 1].map((j) => dishScore('r1', j, i + w));
      const bt = bj[0] + bj[1], wt = wj[0] + wj[1];
      const winner = Math.abs(bt - wt) < 1e-9 ? null : bt > wt ? 'black' : 'white';
      if (winner === 'black') bw++;
      if (winner === 'white') ww++;
      rows.push({ i, bj, wj, bt, wt, winner, bLabel: b, wLabel: w });
    }
    const n = matchCount();
    let team = null, count = 0;
    if (bw !== ww) {
      team = bw > ww ? 'black' : 'white';
      const wins = Math.max(bw, ww);
      count = n >= 2 && wins === n ? 2 : 1;
    }
    return { rows, bw, ww, team, count };
  }

  function r2Results() {
    const bj = [0, 1].map((j) => dishScore('r2', j, 'black'));
    const wj = [0, 1].map((j) => dishScore('r2', j, 'white'));
    const bt = bj[0] + bj[1], wt = wj[0] + wj[1];
    const winner = Math.abs(bt - wt) < 1e-9 ? null : bt > wt ? 'black' : 'white';
    return { bj, wj, bt, wt, winner };
  }

  function heldCards(team) {
    const out = [];
    Object.entries(state.draws).forEach(([key, d]) => {
      if (d.team === team) d.picked.forEach((p) => out.push(Object.assign({ id: key + '-' + p }, d.cards[p])));
    });
    return out;
  }


  // ---------------- rules text ----------------
  const critListHtml = () => `
    <ul class="rules">${crit().map((c) => `<li><b>${esc(c.name)} ${c.weight}%</b>${c.hint ? `<div class="muted small">${esc(c.hint)}</div>` : ''}</li>`).join('')}</ul>`;
  const cardListHtml = () => `
    <ul class="rules cards">${state.settings.deck.map((c) => `
      <li><span class="ic">${esc(c.icon || '🃏')}</span><div><b>${esc(c.title)}</b>${Number(c.duration) > 0 ? ` <span class="pill gray">${c.duration} 分鐘</span>` : ''}
      <div class="small">${esc(c.desc)}</div>${c.note ? `<div class="muted small">${esc(c.note)}</div>` : ''}</div></li>`).join('')}</ul>`;

  function overviewHtml() {
    return `
      <h3>📖 比賽規則</h3>
      <ol class="rules">
        <li><b>參賽者設定</b>：2 位評審可以<b>指定</b>，也可以<b>隨機抽籤</b>選出；其餘參賽者抽籤分成黑隊、白隊。</li>
        <li><b>採購戰</b>：評審指定第一輪個人戰每場的主食材；兩輪食材一起採買，以隊為單位。總花費較少的隊伍可抽取一張團體賽用的特權卡。</li>
        <li><b>第一輪：1v1 個人戰</b>：黑白兩隊選手一對一 PK，每人煮一道 <b>1–2 人份</b>的菜／前菜／湯／甜點，必須使用評審指定的主食材。</li>
        <li><b>盲測評分</b>：評審不知道料理是哪位選手做的，兩位評審分數加總，高者贏得該場。</li>
        <li><b>個人戰抽卡</b>：2:1 勝隊抽 1 張特權卡；3:0 勝隊抽 2 張。</li>
        <li><b>第二輪：團體戰</b>：全隊合作完成 <b>4 人份主食</b>（飯／麵／肉），可使用特權卡。</li>
        <li><b>最終評分</b>：兩位評審打分，總分高的隊伍成為黑白大廚總冠軍！</li>
      </ol>
      <p class="muted small">評分比例：${crit().map((c) => `${esc(c.name)} ${c.weight}%`).join('、')}</p>`;
  }

  function procureRulesHtml() {
    return `
      <h3>📋 採購戰規則</h3>
      <ul class="rules">
        <li>評審指定<b>第一輪個人戰每一場</b>的主食材。</li>
        <li>兩輪（個人戰＋團體戰）的食材<b>一起採買</b>，以<b>隊</b>為單位。</li>
        <li>總花費較少的隊伍，可抽取一張<b>團體賽用</b>的特權卡；花費相同由評審決定。</li>
      </ul>`;
  }

  const STEP_RULES = [
    () => overviewHtml(),
    () => procureRulesHtml(),
    () => `<ul class="rules"><li>採購戰總花費較少的隊伍，從四張蓋著的特權卡中翻開一張。</li><li>特權卡在<b>第二輪團體戰</b>使用。</li></ul><h3>四張特權卡</h3>${cardListHtml()}`,
    () => `<ul class="rules">
        <li>黑白兩隊選手<b>一對一 PK</b>，每場使用評審指定的主食材。</li>
        <li>每人煮一道 <b>1–2 人份</b>的菜／前菜／湯／甜點。</li>
        <li><b>不限時</b>，慢慢煮、好好享受，完成後進入評分。</li>
      </ul>`,
    () => `<ul class="rules">
        <li>料理只標示「料理 N（黑隊／白隊）」，不顯示選手姓名。</li>
        <li>兩位評審各自評分，送出後分數會隱藏；兩人都送出後才揭曉。</li>
        <li>每道料理依下列比例換算成 100 分，兩位評審分數加總，高者贏得該場。</li>
      </ul><h3>評分比例</h3>${critListHtml()}`,
    () => `<ul class="rules"><li>個人戰 2:1 勝隊抽 <b>1 張</b>；3:0 勝隊抽 <b>2 張</b>；平手不抽。</li><li>特權卡在第二輪團體戰使用。</li></ul><h3>四張特權卡</h3>${cardListHtml()}`,
    () => `<ul class="rules">
        <li>全隊合作完成 <b>4 人份主食</b>（飯／麵／肉）。</li>
        <li><b>不限時</b>，兩隊都完成後進入最終評分。</li>
        <li>隊伍要使用特權卡時，評審在這一頁按該隊的「使用」，畫面會出現說明與效果倒數。</li>
      </ul><h3>特權卡</h3>${cardListHtml()}`,
    () => `<ul class="rules"><li>兩位評審分別為兩隊主食打分，送出後隱藏。</li><li>兩位評審分數加總，總分高的隊伍為總冠軍。</li></ul><h3>評分比例</h3>${critListHtml()}`,
  ];

  function cardUsePanel() {
    const fx = Object.entries(state.used).filter(([, u]) => !u.dismissed).map(([id, u]) => `
      <div class="effect ${u.team}">
        <div class="ic">${esc(u.card.icon || '🃏')}</div>
        <div class="body">
          <div><b>${TEAM_NAME[u.team]}</b> 使用「${esc(u.card.title)}」</div>
          <div class="small">${esc(u.card.desc)}</div>
          ${u.card.note ? `<div class="small op">${esc(u.card.note)}</div>` : ''}
        </div>
        ${u.endAt ? `<div class="fx-cd" data-end="${u.endAt}">--:--</div>` : ''}
        <button class="ghost" onclick="A.dismissFx('${id}')">關閉</button>
      </div>`).join('');
    const cols = ['black', 'white'].map((t) => {
      const cards = heldCards(t);
      return `
        <div class="use-col">
          <div class="use-head">${pill(t)} 特權卡</div>
          ${cards.length ? cards.map((c) => {
            const u = state.used[c.id];
            return `
              <div class="use-row ${u ? 'used' : ''}">
                <span>${esc(c.icon || '🃏')} ${esc(c.title)}</span>
                ${u ? `<button class="ghost small" onclick="A.undoCard('${c.id}')">已使用 · 復原</button>`
                    : `<button class="gold" onclick="A.useCard('${t}', '${c.id}')">使用</button>`}
              </div>`;
          }).join('') : '<div class="muted small">沒有特權卡</div>'}
        </div>`;
    }).join('');
    return `<div class="card-use">${fx ? `<div class="effects">${fx}</div>` : ''}<div class="use-grid">${cols}</div></div>`;
  }

  // ---------------- render ----------------
  function render() {
    renderStepper();
    const pages = [pageSetup, pageProcure, pageDrawPurchase, pageRound1, pageScoreR1, pageDrawR1, pageRound2, pageFinal];
    $('#app').innerHTML = `
      <div class="page-head">
        <div class="num">STEP ${String(state.step + 1).padStart(2, '0')}</div>
        <h1>${STEPS[state.step].title}</h1>
        <p>${STEPS[state.step].desc}</p>
      </div>
      ${pages[state.step]()}
    `;
    tickTimer();
  }

  function renderStepper() {
    $('#stepper').innerHTML = STEPS.map((s, i) => {
      const cls = i === state.step ? 'active' : i <= state.maxStep ? 'done' : '';
      const click = i <= state.maxStep ? `onclick="A.go(${i})" style="cursor:pointer"` : '';
      return `<div class="s ${cls}" ${click}><b>${String(i + 1).padStart(2, '0')}</b>${s.title}</div>`;
    }).join('');
  }

  const nav = (canNext = true, nextLabel = '下一步 →') => `
    <div class="actions">
      ${state.step > 0 ? `<button onclick="A.go(${state.step - 1})">← 上一步</button>` : ''}
      ${state.step < STEPS.length - 1 ? `<button class="primary" id="btn-next" ${canNext ? '' : 'disabled'} onclick="A.next()">${nextLabel}</button>` : ''}
    </div>`;

  // ---- Step 1: setup ----
  function pageSetup() {
    if (!state.assigned) {
      return `
        <div class="card rule-card">${overviewHtml()}</div>
        <div class="card">
          <h3>參賽者名單 <span class="muted small">（至少 4 人，其中 2 人會成為評審）</span></h3>
          <div class="judge-mode">
            <span>評審產生方式：</span>
            <button class="${state.judgeMode !== 'pick' ? 'on' : ''}" onclick="A.setJudgeMode('random')">🎲 隨機抽 2 位</button>
            <button class="${state.judgeMode === 'pick' ? 'on' : ''}" onclick="A.setJudgeMode('pick')">👆 指定 2 位</button>
            ${state.judgeMode === 'pick' ? `<span class="muted small">勾選名字旁的「評審」（已選 ${state.judgeFlags.filter(Boolean).length}/2）</span>` : ''}
          </div>
          <div class="player-list">
            ${state.players.map((p, i) => `
              <div class="player-row">
                <span class="idx">${i + 1}</span>
                ${state.judgeMode === 'pick' ? `<label class="jflag ${state.judgeFlags[i] ? 'on' : ''}"><input type="checkbox" ${state.judgeFlags[i] ? 'checked' : ''} onchange="A.toggleJudge(${i})">評審</label>` : ''}
                <input type="text" value="${esc(p)}" placeholder="姓名" oninput="A.setPlayer(${i}, this.value)" onkeydown="if(event.key==='Enter' && !event.isComposing && event.keyCode!==229){A.addPlayer()}" data-player="${i}">
                ${state.players.length > 4 ? `<button class="ghost danger" title="移除" onclick="A.removePlayer(${i})">✕</button>` : ''}
              </div>`).join('')}
          </div>
          <div style="margin-top:12px"><button class="add-btn" onclick="A.addPlayer()">＋ 新增參賽者</button></div>
          ${ui.error ? `<div class="error">${esc(ui.error)}</div>` : ''}
        </div>
        <div class="actions center">
          <button class="gold big" onclick="A.assign()">🎲 抽籤分組</button>
        </div>`;
    }
    const n = matchCount();
    return `
      <div class="grid-3">
        ${teamBox('judges', 'JUDGES', '評審', state.judges, 0)}
        ${teamBox('black', 'BLACK', '黑隊', state.black, 1)}
        ${teamBox('white', 'WHITE', '白隊', state.white, 2)}
      </div>
      <div class="card" style="margin-top:16px">
        <h3>1v1 對戰組合（共 ${n} 場）</h3>
        ${matchupList()}
        ${state.black.length !== state.white.length ? `<div class="hint">兩隊人數不同，多出的成員在個人戰中擔任助手，團體戰一起上場。</div>` : ''}
      </div>
      <div class="actions">
        <button onclick="A.editPlayers()">✎ 修改名單</button>
        <button onclick="A.assign()">🎲 重新抽籤</button>
        <button class="primary" onclick="A.next()">下一步 →</button>
      </div>`;
  }

  function teamBox(cls, en, zh, members, delay) {
    return `
      <div class="team ${cls} reveal" style="animation-delay:${delay * 0.25}s">
        <div class="label">${en}<small>${zh}</small></div>
        <ul>${members.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </div>`;
  }

  function matchupList(showIngredients = false) {
    let html = '';
    for (let i = 0; i < matchCount(); i++) {
      html += `
        <div class="match">
          <div class="side"><span class="pill black">黑</span> ${esc(state.black[i])}</div>
          <div class="vs">${showIngredients && state.ingredients[i] ? `<span style="font-family:'Noto Sans TC';font-size:.95rem">第 ${i + 1} 場 · ${esc(state.ingredients[i])}</span>` : `VS`}</div>
          <div class="side right">${esc(state.white[i])} <span class="pill white">白</span></div>
        </div>`;
    }
    return html;
  }

  // ---- Step 2: procurement ----
  function pageProcure() {
    const n = matchCount();
    const filled = state.ingredients.slice(0, n).filter((x) => x && x.trim()).length === n;
    const spendOk = state.spend.black !== '' && state.spend.white !== '';
    let result = '';
    if (spendOk) {
      const b = Number(state.spend.black), w = Number(state.spend.white);
      if (b === w) {
        result = `
          <div class="result-banner">
            <div class="big">平手！</div>
            <p class="muted">兩隊花費相同，請評審決定由哪一隊抽卡</p>
            <div class="actions center">
              <button class="${state.purchaseWinner === 'black' ? 'gold' : ''}" onclick="A.setPurchaseWinner('black')">黑隊</button>
              <button class="${state.purchaseWinner === 'white' ? 'gold' : ''}" onclick="A.setPurchaseWinner('white')">白隊</button>
            </div>
          </div>`;
      } else {
        const win = b < w ? 'black' : 'white';
        result = `
          <div class="result-banner reveal">
            <div class="muted">採購戰勝隊</div>
            <div class="big">${TEAM_NAME[win]} 🛒</div>
            <p class="muted">花費少 $${Math.abs(b - w).toLocaleString()}，可抽取一張團體賽用的特權卡</p>
          </div>`;
      }
    }
    const canNext = filled && spendOk && state.purchaseWinner;
    return `
      <div class="card rule-card">${procureRulesHtml()}</div>
      <div class="card">
        <h3>評審指定第一輪個人戰主食材</h3>
        ${Array.from({ length: n }, (_, i) => `
          <div class="ingredient-row">
            <label>第 ${i + 1} 場</label>
            <input type="text" placeholder="${esc(state.black[i])} vs ${esc(state.white[i])} 的主食材" value="${esc(state.ingredients[i] || '')}" oninput="A.setIngredient(${i}, this.value)">
          </div>`).join('')}
      </div>
      <div class="grid-2">
        ${['black', 'white'].map((t) => `
          <div class="team ${t}">
            <div class="label">${TEAM_EN[t]}<small>${TEAM_NAME[t]}總花費</small></div>
            <div class="spend-input">
              <span>$</span>
              <input type="number" min="0" step="0.01" inputmode="decimal" value="${esc(state.spend[t])}" onchange="A.setSpend('${t}', this.value)" placeholder="0">
            </div>
          </div>`).join('')}
      </div>
      ${result}
      <div class="hint" id="ing-hint" style="text-align:right;${filled ? 'display:none' : ''}">請先填完每場的主食材</div>
      ${nav(canNext)}`;
  }

  // ---- Draw pages ----
  function ensureDraw(key, team, count) {
    const d = state.draws[key];
    if (!d || d.team !== team || d.count !== count) {
      if (!team || !count) {
        delete state.draws[key];
      } else {
        state.draws[key] = { team, count, cards: shuffle(clone(state.settings.deck)), picked: [] };
      }
      save();
    }
    return state.draws[key];
  }

  function drawPage(key, team, count, intro) {
    if (!team || !count) {
      delete state.draws[key];
      save();
      return `
        <div class="result-banner">
          <div class="big">本階段無人抽卡</div>
          <p class="muted">${intro}</p>
        </div>
        ${nav(true)}`;
    }
    const d = ensureDraw(key, team, count);
    const done = d.picked.length >= d.count;
    return `
      <div class="result-banner" style="margin-top:0">
        <div>${intro}</div>
        <div class="big">${TEAM_NAME[team]} 抽 ${count} 張</div>
        <p class="muted">${done ? '抽卡完成！' : `請 ${TEAM_NAME[team]} 點選卡片翻開（還剩 ${count - d.picked.length} 張）`}</p>
      </div>
      <div class="deck">
        ${d.cards.map((c, p) => {
          const mine = d.picked.includes(p);
          const flipped = mine || done;
          return `
            <button class="pcard ${flipped ? 'flipped' : ''} ${mine ? 'mine' : done ? 'other' : ''}" ${done || mine ? 'disabled' : ''} onclick="A.pick('${key}', ${p})">
              <div class="inner">
                <div class="face back">?</div>
                <div class="face front">
                  ${c.icon ? `<div class="ic">${esc(c.icon)}</div>` : ''}
                  <div class="t">${esc(c.title)}</div>
                  <div class="d">${esc(c.desc)}</div>
                  ${c.note ? `<div class="n">${esc(c.note)}</div>` : ''}
                </div>
              </div>
            </button>`;
        }).join('')}
      </div>
      ${heldSummary()}
      ${nav(done)}`;
  }

  function heldSummary() {
    return `
      <div class="grid-2" style="margin-top:20px">
        ${['black', 'white'].map((t) => {
          const cards = heldCards(t);
          return `
            <div class="card" style="margin:0">
              <h3>${pill(t)} 持有特權卡（${cards.length}）</h3>
              ${cards.length ? cards.map((c) => `
                <div class="held-card">
                  <div class="ic">${esc(c.icon || '🃏')}</div>
                  <div><b>${esc(c.title)}</b><div class="small">${esc(c.desc)}</div>${c.note ? `<div class="small muted">${esc(c.note)}</div>` : ''}</div>
                </div>`).join('') : '<span class="muted small">尚無</span>'}
            </div>`;
        }).join('')}
      </div>`;
  }

  function pageDrawPurchase() {
    return drawPage('purchase', state.purchaseWinner, 1, '採購戰勝隊');
  }

  function pageDrawR1() {
    const r = r1Results();
    const intro = r.team
      ? `個人戰結果 ${TEAM_NAME[r.team]} ${Math.max(r.bw, r.ww)} : ${Math.min(r.bw, r.ww)} 獲勝`
      : `個人戰結果 ${r.bw} : ${r.ww} 平手`;
    return drawPage('r1', r.team, r.count, intro);
  }

  // ---- Timer pages ----
  function getTimer(key, minutes) {
    if (!state.timers[key]) {
      state.timers[key] = { total: minutes * 60, remaining: minutes * 60, endAt: null, beeped: false };
      save();
    }
    return state.timers[key];
  }
  const timerRemaining = (t) => (t.endAt ? Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)) : t.remaining);

  function timerBlock(key, minutes, extra = '') {
    const t = getTimer(key, minutes);
    const running = !!t.endAt;
    if (!t.started) {
      return `
        <div class="card timer-wrap" id="timer-wrap" data-key="${key}">
          <div class="timer" id="timer-display">--:--</div>
          <div class="timer-setup">
            <label for="timer-min">評審設定倒數時間</label>
            <input type="number" id="timer-min" min="1" max="600" value="${Math.round(t.total / 60)}" oninput="A.timerSet('${key}', this.value)">
            <span>分鐘</span>
          </div>
          <div class="timer-controls">
            <button class="gold big" onclick="A.timerToggle('${key}')">▶ 開始倒數</button>
          </div>
          ${extra}
        </div>`;
    }
    return `
      <div class="card timer-wrap ${ui.fullscreen ? 'fs' : ''}" id="timer-wrap" data-key="${key}">
        <div class="timer" id="timer-display">--:--</div>
        <div class="progress"><div id="timer-bar"></div></div>
        <div class="muted" id="timer-msg" style="margin-top:10px">&nbsp;</div>
        <div class="timer-controls">
          <button class="${running ? '' : 'gold'} big" onclick="A.timerToggle('${key}')">${running ? '⏸ 暫停' : '▶ 繼續'}</button>
          <button onclick="A.timerAdd('${key}', -60)">−1 分</button>
          <button onclick="A.timerAdd('${key}', 60)">＋1 分</button>
          <button onclick="A.timerReset('${key}')">↺ 重新設定時間</button>
          <button onclick="A.toggleFs()">${ui.fullscreen ? '⤡ 離開全螢幕' : '⤢ 全螢幕'}</button>
        </div>
        ${extra}
      </div>`;
  }

  function pageRound1() {
    return `
      <div class="card no-timer"><div class="nt-icon">🍳</div><div><b>不限時，慢慢煮！</b><div class="muted small">選手完成料理後，按「進入評分」。</div></div></div>
      <div class="card">
        <h3>本輪對戰與主食材</h3>
        ${matchupList(true)}
      </div>
      ${heldSummary()}
      ${nav(true, '進入評分 →')}`;
  }

  function pageRound2() {
    return `
      <div class="card no-timer"><div class="nt-icon">🍳</div><div><b>不限時，全隊一起完成主食！</b><div class="muted small">兩隊都完成後，按「進入最終評分」。</div></div></div>
      <div class="card"><h3>特權卡使用</h3>${cardUsePanel()}</div>
      <div class="grid-2">
        ${['black', 'white'].map((t) => `
          <div class="team ${t}">
            <div class="label">${TEAM_EN[t]}<small>${TEAM_NAME[t]}</small></div>
            <ul>${state[t].map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
          </div>`).join('')}
      </div>
      ${nav(true, '進入最終評分 →')}`;
  }

  // ---- Scoring ----
  function scoringTabs(round, extraTabLabel) {
    const both = state.submitted[round][0] && state.submitted[round][1];
    const tab = ui.tab[round];
    return `
      <div class="tabs">
        ${[0, 1].map((j) => `<button class="${tab === j ? 'on' : ''}" onclick="A.tab('${round}', ${j})">評審：${esc(state.judges[j])} ${state.submitted[round][j] ? '✓' : ''}</button>`).join('')}
        <button class="${tab === 2 ? 'on' : ''}" ${both ? '' : 'disabled'} onclick="A.tab('${round}', 2)">${extraTabLabel}</button>
      </div>`;
  }

  function dishCard(round, j, id, title, sub) {
    const vals = getVals(round, j, id);
    return `
      <div class="dish">
        <h4>${title}</h4>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
        ${crit().map((c, k) => `
          <div class="crit">
            <label>${esc(c.name)} <small>${c.weight}%</small></label>
            <input type="range" min="0" max="10" step="0.5" value="${vals[k]}" oninput="A.score('${round}', ${j}, '${id}', ${k}, this.value)">
            <output id="o-${round}-${j}-${id}-${k}">${vals[k]}</output>
          </div>
          ${c.hint ? `<div class="crit-hint">${esc(c.hint)}</div>` : ''}`).join('')}
        <div class="total">加權總分 <b id="t-${round}-${j}-${id}">${fmt(dishScore(round, j, id))}</b> / 100</div>
      </div>`;
  }

  function judgePanel(round, j, dishesHtml) {
    if (state.submitted[round][j]) {
      return `
        <div class="card locked">
          <div class="icon">🔒</div>
          <p>評審 <b>${esc(state.judges[j])}</b> 已送出評分（分數已隱藏）</p>
          <button onclick="A.unsubmit('${round}', ${j})">解鎖修改</button>
        </div>`;
    }
    return `
      <div class="card">
        <p class="muted small" style="margin-top:0">每項 0–10 分，依權重換算為 100 分制。送出後分數會隱藏，避免另一位評審看到。</p>
        ${dishesHtml}
        <div class="actions"><button class="gold" onclick="A.submit('${round}', ${j})">送出 ${esc(state.judges[j])} 的評分</button></div>
      </div>`;
  }

  function pageScoreR1() {
    if (state.blind.length !== matchCount()) {
      state.blind = Array.from({ length: matchCount() }, () => Math.random() < 0.5);
      save();
    }
    const tab = ui.tab.r1;
    const both = state.submitted.r1[0] && state.submitted.r1[1];
    let body;
    if (tab < 2) {
      const dishes = Array.from({ length: matchCount() }, (_, i) => `
        <h3 style="margin:${i ? '24px' : '0'} 0 10px">第 ${i + 1} 場 · 主食材：${esc(state.ingredients[i] || '—')}</h3>
        <div class="grid-2">
          ${dishCard('r1', tab, i + dishOfTeam(i, 'black'), `料理 ${i * 2 + 1}（黑隊）`, '不顯示選手姓名')}
          ${dishCard('r1', tab, i + dishOfTeam(i, 'white'), `料理 ${i * 2 + 2}（白隊）`, '不顯示選手姓名')}
        </div>`).join('');
      body = judgePanel('r1', tab, dishes);
    } else {
      const r = r1Results();
      body = `
        <div class="card">
          <div class="scoreline">
            <span class="pill black" style="font-size:1rem">黑隊</span>
            <span class="n">${r.bw}</span><span class="dash">:</span><span class="n">${r.ww}</span>
            <span class="pill white" style="font-size:1rem">白隊</span>
          </div>
          <div style="overflow-x:auto">
          <table class="results">
            <tr><th>場次</th><th>主食材</th><th>黑隊選手</th><th>${esc(state.judges[0])}</th><th>${esc(state.judges[1])}</th><th>黑隊合計</th><th>白隊合計</th><th>${esc(state.judges[1])}</th><th>${esc(state.judges[0])}</th><th>白隊選手</th></tr>
            ${r.rows.map((x) => `
              <tr>
                <td>${x.i + 1}</td>
                <td>${esc(state.ingredients[x.i] || '')}</td>
                <td class="${x.winner === 'black' ? 'win' : ''}">${esc(state.black[x.i])}<div class="muted small">料理 ${x.i * 2 + 1}</div></td>
                <td>${fmt(x.bj[0])}</td><td>${fmt(x.bj[1])}</td>
                <td class="${x.winner === 'black' ? 'win' : ''}">${fmt(x.bt)}</td>
                <td class="${x.winner === 'white' ? 'win' : ''}">${fmt(x.wt)}</td>
                <td>${fmt(x.wj[1])}</td><td>${fmt(x.wj[0])}</td>
                <td class="${x.winner === 'white' ? 'win' : ''}">${esc(state.white[x.i])}<div class="muted small">料理 ${x.i * 2 + 2}</div></td>
              </tr>`).join('')}
          </table>
          </div>
          <div class="result-banner">
            ${r.team
              ? `<div class="big">${TEAM_NAME[r.team]} 勝出 ${Math.max(r.bw, r.ww)} : ${Math.min(r.bw, r.ww)}</div><p class="muted">可抽 ${r.count} 張特權卡</p>`
              : `<div class="big">平手 ${r.bw} : ${r.ww}</div><p class="muted">本階段無人抽卡</p>`}
          </div>
        </div>`;
    }
    return `${scoringTabs('r1', '📊 揭曉結果')}${body}${nav(both)}`;
  }

  function pageFinal() {
    const tab = ui.tab.r2;
    let body;
    if (tab < 2) {
      const dishes = `
        <div class="grid-2">
          ${dishCard('r2', tab, 'black', '黑隊主餐', esc(state.black.join('、')))}
          ${dishCard('r2', tab, 'white', '白隊主餐', esc(state.white.join('、')))}
        </div>`;
      body = judgePanel('r2', tab, dishes);
    } else if (!state.revealed) {
      body = `
        <div class="card curtain">
          <div class="q">?</div>
          <p>兩位評審皆已完成評分</p>
          <button class="gold big" onclick="A.revealChampion()">🏆 揭曉黑白大廚總冠軍</button>
        </div>`;
    } else {
      const r = r2Results();
      const w = r.winner;
      body = `
        <div class="champion ${w || 'tie'} reveal">
          <div class="trophy">🏆</div>
          <div class="muted" style="color:inherit;opacity:.7">黑白大廚：丹佛版 總冠軍</div>
          <div class="title">${w ? `${TEAM_EN[w]} TEAM` : 'DRAW'}</div>
          <div class="members">${w ? esc(state[w].join('、')) : '黑白不分勝負！'}</div>
        </div>
        <div class="card" style="margin-top:16px">
          <h3>最終評分</h3>
          <table class="results">
            <tr><th></th><th>${esc(state.judges[0])}</th><th>${esc(state.judges[1])}</th><th>合計</th></tr>
            <tr><td>${pill('black')}</td><td>${fmt(r.bj[0])}</td><td>${fmt(r.bj[1])}</td><td class="${w === 'black' ? 'win' : ''}">${fmt(r.bt)}</td></tr>
            <tr><td>${pill('white')}</td><td>${fmt(r.wj[0])}</td><td>${fmt(r.wj[1])}</td><td class="${w === 'white' ? 'win' : ''}">${fmt(r.wt)}</td></tr>
          </table>
          <p class="muted small">個人戰戰績：黑隊 ${r1Results().bw} : ${r1Results().ww} 白隊</p>
        </div>
        <div class="actions center"><button onclick="A.newGame()">🔁 開新的一局</button></div>`;
    }
    return `${scoringTabs('r2', '🏆 冠軍揭曉')}${body}${nav(false)}`;
  }

  // ---------------- timer engine ----------------
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function tickTimer() {
    document.querySelectorAll('.fx-cd').forEach((el) => {
      const rem = Math.max(0, Math.ceil((Number(el.dataset.end) - Date.now()) / 1000));
      el.textContent = rem ? fmtTime(rem) : '時間到';
      el.classList.toggle('done', !rem);
    });
    Object.values(state.used || {}).forEach((u) => {
      if (u.endAt && !u.beeped && Date.now() >= u.endAt) { u.beeped = true; beep(); save(); }
    });
    // beep check for any running timer
    Object.values(state.timers).forEach((t) => {
      if (t.endAt && timerRemaining(t) <= 0) {
        t.remaining = 0;
        t.endAt = null;
        if (!t.beeped) { t.beeped = true; beep(); }
        save();
        if ($('#timer-wrap')) render();
      }
    });
    const wrap = $('#timer-wrap');
    if (!wrap) return;
    const t = state.timers[wrap.dataset.key];
    if (!t) return;
    const rem = timerRemaining(t);
    const el = $('#timer-display');
    el.textContent = fmtTime(rem);
    el.className = 'timer' + (rem === 0 ? ' over' : rem <= 60 ? ' danger' : rem <= 300 ? ' warn' : '');
    if (!t.started) return;
    $('#timer-bar').style.width = `${t.total ? (rem / t.total) * 100 : 0}%`;
    $('#timer-msg').textContent = rem === 0 ? '⏰ 時間到！請停止料理' : t.endAt ? '料理進行中…' : rem === t.total ? '準備好就按開始' : '已暫停';
  }
  setInterval(tickTimer, 250);

  let audioCtx;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < 3; i++) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880;
        o.connect(g); g.connect(audioCtx.destination);
        const t0 = audioCtx.currentTime + i * 0.5;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        o.start(t0); o.stop(t0 + 0.4);
      }
    } catch (e) { /* ignore */ }
  }

  function confetti() {
    const colors = ['#161513', '#ffffff', '#161513', '#cfc4ad'];
    for (let i = 0; i < 140; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.border = '1px solid rgba(128,128,128,.4)';
      c.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
      c.style.animationDelay = Math.random() * 0.8 + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 6000);
    }
  }

  // ---------------- actions ----------------
  const A = {
    go(i) {
      state.step = Math.max(0, Math.min(i, STEPS.length - 1));
      // every time a draw page is opened, deal the 4 cards in a fresh random order
      // (kept only once a card has been flipped, so results can't be re-rolled)
      const drawKey = { 2: 'purchase', 5: 'r1' }[state.step];
      if (drawKey && state.draws[drawKey] && state.draws[drawKey].picked.length === 0) delete state.draws[drawKey];
      state.maxStep = Math.max(state.maxStep, state.step);
      ui.fullscreen = false;
      save(); render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    next() {
      if (state.step === 0 && !state.assigned) return;
      A.go(state.step + 1);
    },
    setPlayer(i, v) { state.players[i] = v; ui.error = ''; save(); },
    addPlayer() {
      state.players.push('');
      save(); render();
      const inputs = document.querySelectorAll('[data-player]');
      inputs[inputs.length - 1]?.focus();
    },
    removePlayer(i) { state.players.splice(i, 1); state.judgeFlags.splice(i, 1); save(); render(); },
    setJudgeMode(m) { state.judgeMode = m; ui.error = ''; save(); render(); },
    toggleJudge(i) {
      if (!state.judgeFlags[i] && state.judgeFlags.filter(Boolean).length >= 2) {
        ui.error = '最多只能指定 2 位評審，請先取消另一位';
      } else {
        state.judgeFlags[i] = !state.judgeFlags[i];
        ui.error = '';
      }
      save(); render();
    },
    assign() {
      const names = state.players.map((s) => s.trim()).filter(Boolean);
      if (names.length < 4) { ui.error = '至少需要 4 位參賽者'; render(); return; }
      if (new Set(names).size !== names.length) { ui.error = '有重複的姓名，請修改'; render(); return; }
      let judges, rest;
      if (state.judgeMode === 'pick') {
        judges = state.players.map((s, i) => (state.judgeFlags[i] ? s.trim() : '')).filter(Boolean);
        if (judges.length !== 2) { ui.error = '請勾選 2 位有填姓名的評審'; render(); return; }
        rest = shuffle(names.filter((n) => !judges.includes(n)));
      } else {
        const s = shuffle(names);
        judges = s.slice(0, 2);
        rest = s.slice(2);
      }
      state.judges = judges;
      const firstTeam = Math.random() < 0.5 ? 'black' : 'white';
      state.black = []; state.white = [];
      rest.forEach((n, k) => state[k % 2 === 0 ? firstTeam : other(firstTeam)].push(n));
      state.assigned = true;
      // reset everything downstream
      Object.assign(state, {
        maxStep: 0, ingredients: [], spend: { black: '', white: '' }, purchaseWinner: null,
        draws: {}, timers: {}, used: {}, blind: [], scores: { r1: [{}, {}], r2: [{}, {}] },
        submitted: { r1: [false, false], r2: [false, false] }, revealed: false,
      });
      ui.error = '';
      save(); render();
    },
    editPlayers() { state.assigned = false; save(); render(); },
    setIngredient(i, v) {
      // never re-render here: it would break Chinese IME (注音) composition
      state.ingredients[i] = v; save();
      const n = matchCount();
      const filled = state.ingredients.slice(0, n).filter((x) => x && x.trim()).length === n;
      const hint = $('#ing-hint'); if (hint) hint.style.display = filled ? 'none' : '';
      const btn = $('#btn-next');
      if (btn) btn.disabled = !(filled && state.spend.black !== '' && state.spend.white !== '' && state.purchaseWinner);
    },
    setSpend(t, v) {
      state.spend[t] = v;
      const b = state.spend.black, w = state.spend.white;
      state.purchaseWinner = b !== '' && w !== '' && Number(b) !== Number(w) ? (Number(b) < Number(w) ? 'black' : 'white') : null;
      save(); render();
    },
    setPurchaseWinner(t) { state.purchaseWinner = t; save(); render(); },
    pick(key, p) {
      const d = state.draws[key];
      if (!d || d.picked.includes(p) || d.picked.length >= d.count) return;
      d.picked.push(p);
      save(); render();
    },
    timerToggle(key) {
      const t = state.timers[key];
      if (t.endAt) { t.remaining = timerRemaining(t); t.endAt = null; }
      else if (t.remaining > 0) { t.endAt = Date.now() + t.remaining * 1000; t.beeped = false; t.started = true; }
      // unlock audio on user gesture
      try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) { /* ignore */ }
      save(); render();
    },
    timerAdd(key, sec) {
      const t = state.timers[key];
      if (t.endAt) t.endAt = Math.max(Date.now(), t.endAt + sec * 1000);
      else t.remaining = Math.max(0, t.remaining + sec);
      if (sec > 0) { t.beeped = false; t.total = Math.max(t.total, timerRemaining(t)); }
      save(); render();
    },
    timerSet(key, v) {
      const m = Math.max(1, Math.min(600, Math.round(Number(v)) || 1));
      const t = state.timers[key];
      t.total = t.remaining = m * 60;
      state.settings[key + 'Min'] = m; // remember as default for next game
      save(); tickTimer();
    },
    timerReset(key) {
      if (!confirm('確定要停止計時並重新設定時間嗎？')) return;
      const t = state.timers[key];
      const m = Math.round(t.total / 60) || 1;
      state.timers[key] = { total: m * 60, remaining: m * 60, endAt: null, beeped: false, started: false };
      ui.fullscreen = false;
      save(); render();
    },
    useCard(team, id) {
      const c = heldCards(team).find((x) => x.id === id);
      if (!c || !confirm(`${TEAM_NAME[team]} 使用「${c.title}」？`)) return;
      const d = Number(c.duration) || 0;
      state.used[id] = { team, card: c, endAt: d > 0 ? Date.now() + d * 60000 : null, beeped: false, dismissed: false };
      try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) { /* ignore */ }
      save(); render();
    },
    undoCard(id) {
      if (!confirm('復原這張卡（視為未使用）？')) return;
      delete state.used[id]; save(); render();
    },
    dismissFx(id) { state.used[id].dismissed = true; save(); render(); },
    toggleFs() { ui.fullscreen = !ui.fullscreen; render(); },
    tab(round, j) { ui.tab[round] = j; render(); },
    score(round, j, id, k, v) {
      const vals = getVals(round, j, id);
      vals[k] = Number(v);
      state.scores[round][j] = state.scores[round][j] || {};
      state.scores[round][j][id] = vals;
      save();
      $(`#o-${round}-${j}-${id}-${k}`).textContent = v;
      $(`#t-${round}-${j}-${id}`).textContent = fmt(dishScore(round, j, id));
    },
    submit(round, j) {
      if (!confirm(`確認送出評審「${state.judges[j]}」的評分？`)) return;
      state.submitted[round][j] = true;
      // make sure defaults are stored
      state.scores[round][j] = state.scores[round][j] || {};
      ui.tab[round] = state.submitted[round][1 - j] ? 2 : 1 - j;
      save(); render();
    },
    unsubmit(round, j) {
      if (!confirm('解鎖後分數會顯示在畫面上，確定嗎？')) return;
      state.submitted[round][j] = false;
      if (round === 'r2') state.revealed = false;
      save(); render();
    },
    revealChampion() {
      state.revealed = true;
      save(); render();
      confetti();
      beep();
    },
    newGame() {
      if (!confirm('開新的一局？（保留參賽者名單與設定）')) return;
      const players = state.players.slice();
      const prev = state;
      state = freshState(state.settings);
      state.players = players;
      state.judgeMode = prev.judgeMode;
      state.judgeFlags = prev.judgeFlags;
      ui.tab = { r1: 0, r2: 0 };
      save(); render();
    },
    reset() {
      if (!confirm('確定要清除所有資料重新開始嗎？')) return;
      state = freshState(state.settings);
      ui.tab = { r1: 0, r2: 0 };
      save(); render();
    },
  };
  window.A = A;

  // ---------------- settings dialog ----------------
  function critRow(c) {
    return `
      <div class="set-card">
        <div class="set-row" style="margin:0">
          <input type="text" name="cname" value="${esc(c.name)}" placeholder="項目名稱">
          <input type="number" min="0" name="cweight" value="${c.weight}">
        </div>
        <input type="text" name="chint" value="${esc(c.hint || '')}" placeholder="評分說明（選填）">
      </div>`;
  }

  function openSettings() {
    const s = state.settings;
    $('#settings-form').innerHTML = `
      <h2>⚙ 設定</h2>
      <h3>評分項目與權重（%）</h3>
      <div id="crit-list">
        ${s.criteria.map((c) => critRow(c)).join('')}
      </div>
      <button type="button" class="add-btn" id="add-crit">＋ 新增評分項目</button>
      <p class="hint">名稱留空即刪除該項目。權重會自動依比例換算成 100 分制。比賽不限時。</p>
      <h3>四張特權卡</h3>
      ${s.deck.map((c) => `
        <div class="set-card">
          <div class="set-row" style="grid-template-columns:60px 1fr;margin:0">
            <input type="text" name="dicon" value="${esc(c.icon || '')}" placeholder="圖示" style="text-align:center">
            <input type="text" name="dtitle" value="${esc(c.title)}" placeholder="卡片名稱">
          </div>
          <textarea name="ddesc" placeholder="卡片效果">${esc(c.desc)}</textarea>
          <input type="text" name="dnote" value="${esc(c.note || '')}" placeholder="補充規則（選填）">
          <label class="small muted">效果倒數（分鐘，0 = 不倒數）<input type="number" min="0" name="ddur" value="${Number(c.duration) || 0}"></label>
        </div>`).join('')}
      <div class="actions">
        <button type="button" id="restore-defaults" class="ghost">恢復預設</button>
        <button value="cancel" formnovalidate>取消</button>
        <button value="save" class="primary">儲存</button>
      </div>`;
    $('#add-crit').onclick = () => {
      $('#crit-list').insertAdjacentHTML('beforeend', critRow({ name: '', weight: 10, hint: '' }));
    };
    $('#restore-defaults').onclick = () => {
      if (!confirm('恢復預設設定？')) return;
      state.settings = clone(DEFAULT_SETTINGS);
      save(); $('#settings').close(); render();
    };
    $('#settings').showModal();
  }

  $('#settings').addEventListener('close', () => {
    if ($('#settings').returnValue !== 'save') return;
    const f = $('#settings-form');
    const names = [...f.querySelectorAll('[name=cname]')].map((e) => e.value.trim());
    const weights = [...f.querySelectorAll('[name=cweight]')].map((e) => Number(e.value) || 0);
    const hints = [...f.querySelectorAll('[name=chint]')].map((e) => e.value.trim());
    const criteria = names.map((n, i) => ({ name: n, weight: weights[i], hint: hints[i] })).filter((c) => c.name);
    const val = (n) => [...f.querySelectorAll(`[name=${n}]`)].map((e) => e.value.trim());
    const icons = val('dicon'), titles = val('dtitle'), descs = val('ddesc'), notes = val('dnote');
    state.settings = {
      r1Min: state.settings.r1Min,
      r2Min: state.settings.r2Min,
      criteria: criteria.length ? criteria : clone(DEFAULT_SETTINGS.criteria),
      deck: titles.map((t, i) => ({ icon: icons[i], title: t || `特權卡 ${i + 1}`, desc: descs[i], note: notes[i], duration: Number(val('ddur')[i]) || 0 })),
    };
    save(); render();
  });

  $('#btn-settings').onclick = openSettings;
  $('#btn-rules').onclick = () => {
    $('#rules-body').innerHTML = `
      <div class="num">STEP ${String(state.step + 1).padStart(2, '0')} · 規則說明</div>
      <h2>${STEPS[state.step].title}</h2>
      ${STEP_RULES[state.step]()}
      <div class="actions"><button class="primary" onclick="document.getElementById('rules').close()">我知道了</button></div>`;
    $('#rules').showModal();
  };
  $('#btn-reset').onclick = A.reset;

  render();
})();
