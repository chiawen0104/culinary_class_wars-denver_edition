(() => {
  'use strict';

  const STORE_KEY = 'ccw-denver-v4';

  const STEPS = [
    { title: '分隊與角色', desc: '8 人輪流輸入自己的名字，偷偷查看自己的隊伍與角色' },
    { title: '採購戰', desc: '兩隊一起採買三道料理的食材，總花費較少的隊伍獲勝' },
    { title: '採購戰抽卡', desc: '花費較少的隊伍抽 2 張特權卡，另一隊抽 1 張' },
    { title: '料理時間', desc: '不限時，每隊完成指定食材料理、自由菜、自由主食各一道' },
    { title: '秘密評審揭曉', desc: '公布兩隊藏著的秘密評審' },
    { title: '評分與冠軍揭曉', desc: '兩位評審為六道料理評分，公布黑白大廚總冠軍' },
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

  const TOTAL_PLAYERS = 8;
  const INGREDIENTS = ['雞蛋', '豆腐', '馬鈴薯', '茄子', '蝦仁', '番茄'];
  const TEAM_NAME = { black: '黑隊', white: '白隊' };
  const DISHES = [
    { key: 'ing', name: '指定食材料理', sub: (t) => `必須使用：${state.ingredientFor[t] || '—'}` },
    { key: 'free', name: '自由菜', sub: () => '菜、肉、湯、甜點都可以' },
    { key: 'staple', name: '自由主食', sub: () => '飯、麵等主食' },
  ];
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
      roleSlots: null,      // 8 shuffled {team, role} slots, dealt in name-entry order
      entries: [],          // [{ name, team, role }]
      revealIdx: null,      // entry whose role card is on screen right now
      ingredientFor: { black: null, white: null },
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
      judgesRevealed: false,
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

  const ui = { tab: { r1: 0, r2: 0 }, error: '', fullscreen: false, peek: null };

  // ---------------- derived ----------------
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
  function finalResults() {
    const rows = [];
    const tot = { black: [0, 0], white: [0, 0] };
    ['black', 'white'].forEach((t) => DISHES.forEach((x) => {
      const js = [0, 1].map((j) => dishScore('r2', j, `${t}-${x.key}`));
      tot[t][0] += js[0]; tot[t][1] += js[1];
      rows.push({ t, x, js });
    }));
    const bt = tot.black[0] + tot.black[1], wt = tot.white[0] + tot.white[1];
    const winner = Math.abs(bt - wt) < 1e-9 ? null : bt > wt ? 'black' : 'white';
    return { rows, tot, bt, wt, winner };
  }

  // purchase-battle draw: winner (lower spend) picks 2, the other team picks 1, from one shared deck of 4
  const drawOrder = () => (state.purchaseWinner ? [state.purchaseWinner, state.purchaseWinner, other(state.purchaseWinner)] : []);

  function heldCards(team) {
    const d = state.draws.purchase;
    if (!d || !d.picks) return [];
    return d.picks.filter((x) => x.team === team).map((x) => Object.assign({ id: 'purchase-' + x.p }, d.cards[x.p]));
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
        <li><b>分隊與角色</b>：8 人輪流輸入自己的名字，隨機分成黑隊、白隊各 4 人。<b>每隊都藏著一位秘密評審</b>，由他為對手隊伍選一樣指定食材。</li>
        <li><b>採購戰</b>：兩隊一起採買三道料理需要的食材，以隊為單位，總花費較少的隊伍獲勝。</li>
        <li><b>採購戰抽卡</b>：採購勝隊從四張特權卡中抽 <b>2 張</b>，另一隊抽 <b>1 張</b>。</li>
        <li><b>料理時間</b>：不限時，每隊完成三道料理：<b>指定食材料理</b>（必須使用指定食材）、<b>自由菜</b>、<b>自由主食</b>，可隨時使用特權卡。</li>
        <li><b>秘密評審揭曉</b>：全部煮完後，公布兩隊的秘密評審。</li>
        <li><b>評分與冠軍揭曉</b>：兩位評審為六道料理評分，總分高的隊伍成為黑白大廚總冠軍！</li>
      </ol>
      <p class="muted small">評分比例：${crit().map((c) => `${esc(c.name)} ${c.weight}%`).join('、')}</p>`;
  }

  function procureRulesHtml() {
    return `
      <h3>📋 採購戰規則</h3>
      <ul class="rules">
        <li>兩隊一起採買<b>三道料理</b>需要的所有食材，以<b>隊</b>為單位。</li>
        <li>別忘了買對手秘密評審幫你們選的<b>指定食材</b>！</li>
        <li>總花費較少的隊伍獲勝，抽 <b>2 張</b>特權卡；另一隊抽 <b>1 張</b>。花費相同時擲硬幣決定。</li>
      </ul>`;
  }

  const STEP_RULES = [
    () => overviewHtml(),
    () => procureRulesHtml(),
    () => `<ul class="rules"><li>採購勝隊先從四張蓋著的特權卡中翻開 <b>2 張</b>，另一隊再從剩下的卡中翻開 <b>1 張</b>。</li><li>最後剩下的一張不使用。</li><li>特權卡在料理時間使用。</li></ul><h3>四張特權卡</h3>${cardListHtml()}`,
    () => `<ul class="rules">
        <li>每隊完成三道料理：</li>
        <li><b>指定食材料理</b>：必須使用對手秘密評審指定的食材。</li>
        <li><b>自由菜</b>：菜、肉、湯、甜點都可以。</li>
        <li><b>自由主食</b>：飯、麵等主食。</li>
        <li><b>不限時</b>，全部煮完後才揭曉秘密評審。</li>
        <li>要使用特權卡時，在這一頁按該隊的「使用」，畫面會出現說明與效果倒數。</li>
      </ul><h3>特權卡</h3>${cardListHtml()}`,
    () => `<ul class="rules"><li>按下按鈕，公布兩隊各自藏著的秘密評審。</li><li>兩位秘密評審接著為六道料理評分。</li></ul>`,
    () => `<ul class="rules"><li>兩位評審各自為六道料理打分，送出後分數會隱藏，兩人都送出才揭曉。</li><li>每道料理依下列比例換算成 100 分，兩位評審的分數全部加總，總分高的隊伍為總冠軍。</li></ul><h3>評分比例</h3>${critListHtml()}`,
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
    const pages = [pageSetup, pageProcure, pageDrawPurchase, pageCook, pageReveal, pageFinal];
    $('#app').innerHTML = `
      <div class="page-head">
        <div class="num">STEP ${String(state.step + 1).padStart(2, '0')}</div>
        <h1>${STEPS[state.step].title}</h1>
        <p>${STEPS[state.step].desc}</p>
      </div>
      ${pages[state.step]()}
    `;
    const en = $('#entry-name'); if (en) en.focus();
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

  // ---- Step 1: name entry + secret roles ----
  function ensureSlots() {
    if (!state.roleSlots || state.roleSlots.length !== TOTAL_PLAYERS) {
      const slots = [];
      ['black', 'white'].forEach((team) => {
        slots.push({ team, role: 'judge' });
        for (let k = 1; k < TOTAL_PLAYERS / 2; k++) slots.push({ team, role: 'member' });
      });
      state.roleSlots = shuffle(slots);
      save();
    }
  }

  function roleCard(i, live) {
    const e = state.entries[i];
    if (!e) return '';
    const opp = other(e.team);
    const isJ = e.role === 'judge';
    const picked = state.ingredientFor[opp];
    const picker = isJ ? `
      <div class="rc-pick">
        <div class="rc-pick-title">請為 <b>${TEAM_NAME[opp]}</b> 選一樣指定食材</div>
        <div class="ing-grid">
          ${INGREDIENTS.map((x) => `<button class="${picked === x ? 'on' : ''}" ${live ? '' : 'disabled'} onclick="A.pickIngredient('${opp}', '${x}')">${x}</button>`).join('')}
        </div>
      </div>` : '';
    const last = state.entries.length >= TOTAL_PLAYERS;
    return `
      <div class="role-screen ${e.team}">
        <div class="rc-inner">
          <div class="rc-hello">${esc(e.name)}，你是</div>
          <div class="rc-team">${TEAM_EN[e.team]}</div>
          <div class="rc-team-zh">${TEAM_NAME[e.team]}</div>
          <div class="rc-role ${isJ ? 'judge' : ''}">${isJ ? '🕵️ 秘密評審' : '👩‍🍳 隊員'}</div>
          <p class="rc-desc">${isJ
            ? '你是隊上的臥底評審：假裝成一般隊員一起料理，最後揭曉身分後負責評分。千萬別被發現！'
            : '和隊友一起合作料理，拿下冠軍！注意：你的隊上藏著一位秘密評審。'}</p>
          ${picker}
          ${live
            ? `<button class="big rc-next" ${isJ && !picked ? 'disabled' : ''} onclick="A.handOff()">${isJ && !picked ? '先選一樣食材' : `我記住了，${last ? '完成分隊' : '交給下一位'} →`}</button>`
            : `<button class="big rc-next" onclick="A.closePeek()">看完了，關閉</button>`}
        </div>
      </div>`;
  }

  function pageSetup() {
    ensureSlots();
    const n = state.entries.length;
    if (state.revealIdx !== null && state.revealIdx !== undefined) return roleCard(state.revealIdx, true);
    if (n < TOTAL_PLAYERS) {
      return `
        <div class="card rule-card">${overviewHtml()}</div>
        <div class="card entry-card">
          <div class="entry-progress"><span>第 <b>${n + 1}</b> / ${TOTAL_PLAYERS} 位</span>
            <span class="dots">${Array.from({ length: TOTAL_PLAYERS }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('')}</span></div>
          <h3>請輸入你的名字</h3>
          <p class="muted small">輸入後畫面會顯示你的隊伍和角色，<b>只有你自己看</b>。看完按「交給下一位」，把電腦交給下一個人。</p>
          <div class="entry-row">
            <input type="text" id="entry-name" placeholder="你的名字" autocomplete="off"
              onkeydown="if(event.key==='Enter' && !event.isComposing && event.keyCode!==229){A.submitName()}">
            <button class="primary" onclick="A.submitName()">看我的角色 →</button>
          </div>
          ${ui.error ? `<div class="error">${esc(ui.error)}</div>` : ''}
          ${n ? `
            <div class="entered">
              <span class="muted small">已加入：</span>
              ${state.entries.map((e) => `<span class="chip">${esc(e.name)}</span>`).join('')}
              <button class="ghost small" onclick="A.undoEntry()">↩ 刪除最後一位</button>
            </div>` : ''}
        </div>`;
    }
    return `
      <div class="result-banner reveal" style="margin-top:0">
        <div class="big">分隊完成！</div>
        <p class="muted">每隊都有一位秘密評審，是誰呢？🤫</p>
      </div>
      <div class="grid-2" style="margin-top:16px">
        ${['black', 'white'].map((t, k) => `
          <div class="team ${t} reveal" style="animation-delay:${0.2 + k * 0.25}s">
            <div class="label">${TEAM_EN[t]}<small>${TEAM_NAME[t]}</small></div>
            <ul>${state[t].map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
            <div class="assigned-ing">指定食材<b>${esc(state.ingredientFor[t] || '—')}</b></div>
          </div>`).join('')}
      </div>
      <div class="card" style="margin-top:16px">
        <h3>🔒 忘記自己的角色？</h3>
        <p class="muted small" style="margin-top:-6px">點自己的名字，偷偷再看一次。</p>
        <div class="peek-list">${state.entries.map((e, i) => `<button onclick="A.peek(${i})">${esc(e.name)}</button>`).join('')}</div>
      </div>
      <div class="actions">
        <button onclick="A.redoTeams()">↺ 重新分隊</button>
        <button class="primary" onclick="A.next()">下一步 →</button>
      </div>
      ${ui.peek !== null && ui.peek !== undefined ? roleCard(ui.peek, false) : ''}`;
  }

  function teamBox(cls, en, zh, members, delay) {
    return `
      <div class="team ${cls} reveal" style="animation-delay:${delay * 0.25}s">
        <div class="label">${en}<small>${zh}</small></div>
        <ul>${members.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </div>`;
  }

  // ---- Step 2: procurement ----
  function pageProcure() {
    const spendOk = state.spend.black !== '' && state.spend.white !== '';
    let result = '';
    if (spendOk) {
      const b = Number(state.spend.black), w = Number(state.spend.white);
      if (b === w) {
        result = `
          <div class="result-banner">
            <div class="big">平手！</div>
            <p class="muted">兩隊花費相同，擲硬幣決定採購勝隊</p>
            ${state.purchaseWinner
              ? `<div class="big reveal">${TEAM_NAME[state.purchaseWinner]} 🪙</div><p class="muted">抽 2 張特權卡；${TEAM_NAME[other(state.purchaseWinner)]}抽 1 張</p>`
              : `<div class="actions center"><button class="primary big" onclick="A.coinFlip()">🪙 擲硬幣</button></div>`}
          </div>`;
      } else {
        const win = b < w ? 'black' : 'white';
        result = `
          <div class="result-banner reveal">
            <div class="muted">採購戰勝隊</div>
            <div class="big">${TEAM_NAME[win]} 🛒</div>
            <p class="muted">花費少 $${Math.abs(b - w).toLocaleString()}，抽 2 張特權卡；${TEAM_NAME[other(win)]}抽 1 張</p>
          </div>`;
      }
    }
    return `
      <div class="card rule-card">${procureRulesHtml()}</div>
      <div class="grid-2">
        ${['black', 'white'].map((t) => `
          <div class="team ${t}">
            <div class="label">${TEAM_EN[t]}<small>${TEAM_NAME[t]}總花費</small></div>
            <div class="spend-input">
              <span>$</span>
              <input type="number" min="0" step="0.01" inputmode="decimal" value="${esc(state.spend[t])}" onchange="A.setSpend('${t}', this.value)" placeholder="0">
            </div>
            <div class="assigned-ing">指定食材<b>${esc(state.ingredientFor[t] || '—')}</b></div>
          </div>`).join('')}
      </div>
      ${result}
      ${nav(spendOk && !!state.purchaseWinner)}`;
  }

  // ---- Step 3: shared draw (winner 2 cards, other team 1) ----
  function pageDrawPurchase() {
    const win = state.purchaseWinner;
    if (!win) return `<div class="result-banner" style="margin-top:0"><div class="big">還沒決定採購勝隊</div><p class="muted">請回上一步輸入兩隊總花費</p></div>${nav(false)}`;
    let d = state.draws.purchase;
    if (!d || !d.picks) { d = state.draws.purchase = { cards: shuffle(clone(state.settings.deck)), picks: [] }; save(); }
    const order = drawOrder();
    const done = d.picks.length >= order.length;
    const turn = done ? null : order[d.picks.length];
    const left = done ? 0 : order.slice(d.picks.length).filter((t) => t === turn).length;
    const ownerOf = (p) => (d.picks.find((x) => x.p === p) || {}).team;
    return `
      <div class="result-banner" style="margin-top:0">
        <div class="muted">${TEAM_NAME[win]}抽 2 張 · ${TEAM_NAME[other(win)]}抽 1 張</div>
        <div class="big">${done ? '抽卡完成！' : `輪到 ${TEAM_NAME[turn]}`}</div>
        <p class="muted">${done ? '最後剩下的一張不使用' : `點一張卡翻開（還剩 ${left} 張）`}</p>
      </div>
      <div class="deck">
        ${d.cards.map((c, p) => {
          const by = ownerOf(p);
          const flipped = !!by || done;
          return `
            <button class="pcard ${flipped ? 'flipped' : ''} ${by ? 'mine owner-' + by : done ? 'other' : ''}" ${flipped ? 'disabled' : ''} onclick="A.pick(${p})">
              <div class="inner">
                <div class="face back">?</div>
                <div class="face front">
                  ${by ? `<span class="pill ${by} owner-tag">${TEAM_NAME[by]}</span>` : ''}
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

  // ---- Step 4: cooking (no time limit) ----
  function pageCook() {
    return `
      <div class="card no-timer"><div class="nt-icon">🍳</div><div><b>不限時，兩隊各完成三道料理！</b><div class="muted small">全部煮完後，按「下一步」揭曉秘密評審。</div></div></div>
      <div class="grid-2">
        ${['black', 'white'].map((t) => `
          <div class="team ${t}">
            <div class="label">${TEAM_EN[t]}<small>${TEAM_NAME[t]}</small></div>
            <div class="members-line">${state[t].map(esc).join('、')}</div>
            <ol class="dish-list">${DISHES.map((x) => `<li><b>${x.name}</b><span>${esc(x.sub(t))}</span></li>`).join('')}</ol>
          </div>`).join('')}
      </div>
      <div class="card" style="margin-top:16px"><h3>特權卡使用</h3>${cardUsePanel()}</div>
      ${nav(true, '全部煮完，下一步 →')}`;
  }

  // ---- Step 5: secret judges reveal ----
  function pageReveal() {
    if (!state.judgesRevealed) {
      return `
        <div class="card curtain">
          <div class="q">🕵️</div>
          <p>兩隊都藏著一位秘密評審……他們是誰？</p>
          <button class="gold big" onclick="A.revealJudges()">揭曉秘密評審</button>
        </div>
        ${nav(false)}`;
    }
    return `
      <div class="grid-2">
        ${['black', 'white'].map((t, k) => `
          <div class="team ${t} reveal judge-reveal" style="animation-delay:${k * 0.7}s">
            <div class="label">${TEAM_EN[t]}<small>${TEAM_NAME[t]}的秘密評審</small></div>
            <div class="jr-name">🕵️ ${esc(state.judges[k])}</div>
            <div class="jr-note">幫${TEAM_NAME[other(t)]}選了「${esc(state.ingredientFor[other(t)] || '—')}」</div>
          </div>`).join('')}
      </div>
      ${nav(true, '進入評分 →')}`;
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

  // ---- Step 6: scoring + champion ----
  function pageFinal() {
    const tab = ui.tab.r2;
    let body;
    if (tab < 2) {
      const dishes = ['black', 'white'].map((t, k) => `
        <h3 style="margin:${k ? '26px' : '0'} 0 10px">${pill(t)} ${TEAM_NAME[t]}的三道料理</h3>
        <div class="grid-3">${DISHES.map((x) => dishCard('r2', tab, `${t}-${x.key}`, x.name, esc(x.sub(t)))).join('')}</div>`).join('');
      body = judgePanel('r2', tab, dishes);
    } else if (!state.revealed) {
      body = `
        <div class="card curtain">
          <div class="q">?</div>
          <p>兩位評審皆已完成評分</p>
          <button class="gold big" onclick="A.revealChampion()">🏆 揭曉黑白大廚總冠軍</button>
        </div>`;
    } else {
      const r = finalResults();
      const w = r.winner;
      const rowsOf = (t) => r.rows.filter((x) => x.t === t).map((x) => `
        <tr><td>${pill(t)} ${x.x.name}</td><td>${fmt(x.js[0])}</td><td>${fmt(x.js[1])}</td><td>${fmt(x.js[0] + x.js[1])}</td></tr>`).join('');
      const totalRow = (t, sum) => `
        <tr class="total-row"><td><b>${TEAM_NAME[t]}總分</b></td><td>${fmt(r.tot[t][0])}</td><td>${fmt(r.tot[t][1])}</td><td class="${w === t ? 'win' : ''}">${fmt(sum)}</td></tr>`;
      body = `
        <div class="champion ${w || 'tie'} reveal">
          <div class="trophy">🏆</div>
          <div class="muted" style="color:inherit;opacity:.7">黑白大廚：丹佛版 總冠軍</div>
          <div class="title">${w ? `${TEAM_EN[w]} TEAM` : 'DRAW'}</div>
          <div class="members">${w ? esc(state[w].join('、')) : '黑白不分勝負！'}</div>
        </div>
        <div class="card" style="margin-top:16px">
          <h3>最終評分</h3>
          <div style="overflow-x:auto">
          <table class="results">
            <tr><th>料理</th><th>${esc(state.judges[0])}</th><th>${esc(state.judges[1])}</th><th>小計</th></tr>
            ${rowsOf('black')}${totalRow('black', r.bt)}
            ${rowsOf('white')}${totalRow('white', r.wt)}
          </table>
          </div>
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
      const dp = state.draws.purchase;
      if (state.step === 2 && dp && (!dp.picks || dp.picks.length === 0)) delete state.draws.purchase;
      state.maxStep = Math.max(state.maxStep, state.step);
      ui.fullscreen = false;
      save(); render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    next() {
      if (state.step === 0 && !state.assigned) return;
      A.go(state.step + 1);
    },
    submitName() {
      const el = $('#entry-name');
      const name = (el ? el.value : '').trim();
      if (!name) { ui.error = '請輸入名字'; render(); return; }
      if (state.entries.some((e) => e.name === name)) { ui.error = '這個名字已經有人用了，請換一個'; render(); return; }
      ensureSlots();
      const slot = state.roleSlots[state.entries.length];
      state.entries.push({ name, team: slot.team, role: slot.role });
      state.revealIdx = state.entries.length - 1;
      ui.error = '';
      save(); render(); window.scrollTo(0, 0);
    },
    pickIngredient(team, x) { state.ingredientFor[team] = x; save(); render(); },
    handOff() {
      state.revealIdx = null;
      if (state.entries.length >= TOTAL_PLAYERS) {
        state.black = state.entries.filter((e) => e.team === 'black').map((e) => e.name);
        state.white = state.entries.filter((e) => e.team === 'white').map((e) => e.name);
        state.judges = ['black', 'white'].map((t) => state.entries.find((e) => e.team === t && e.role === 'judge').name);
        state.assigned = true;
      }
      save(); render(); window.scrollTo(0, 0);
    },
    undoEntry() {
      const e = state.entries[state.entries.length - 1];
      if (!e || !confirm(`刪除「${e.name}」？（他的角色會留給下一位輸入的人）`)) return;
      if (e.role === 'judge') state.ingredientFor[other(e.team)] = null;
      state.entries.pop();
      save(); render();
    },
    peek(i) {
      if (!confirm(`確定是「${state.entries[i].name}」本人在看嗎？`)) return;
      ui.peek = i; render();
    },
    closePeek() { ui.peek = null; render(); },
    redoTeams() {
      if (!confirm('重新分隊？所有人要重新輸入名字，之後的進度也會清除。')) return;
      const settings = state.settings;
      state = freshState(settings);
      ui.peek = null;
      save(); render();
    },
    setSpend(t, v) {
      state.spend[t] = v;
      const b = state.spend.black, w = state.spend.white;
      const before = state.purchaseWinner;
      state.purchaseWinner = b !== '' && w !== '' && Number(b) !== Number(w) ? (Number(b) < Number(w) ? 'black' : 'white') : null;
      if (state.purchaseWinner !== before) delete state.draws.purchase;
      save(); render();
    },
    setPurchaseWinner(t) { state.purchaseWinner = t; save(); render(); },
    coinFlip() { state.purchaseWinner = rand() < 0.5 ? 'black' : 'white'; save(); render(); },
    pick(p) {
      const d = state.draws.purchase;
      const order = drawOrder();
      if (!d || !d.picks || d.picks.length >= order.length || d.picks.some((x) => x.p === p)) return;
      d.picks.push({ team: order[d.picks.length], p });
      save(); render();
    },
    revealJudges() { state.judgesRevealed = true; save(); render(); confetti(); },
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
      if (!confirm('開新的一局？（保留設定，所有人重新輸入名字分隊）')) return;
      state = freshState(state.settings);
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
