(() => {
  'use strict';

  const STORAGE_KEY = 'money_manage.settings.v3';
  const MONTHS = 3; // 今月を含めて表示する月数

  const $ = (id) => document.getElementById(id);
  const comma = (n) => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ja-JP');
  const pad = (n) => String(n).padStart(2, '0');
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const dateStr = (d) => `${monthKey(d)}-${pad(d.getDate())}`;
  const parseDate = (s) => new Date(s + 'T00:00:00');
  const num = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : 0;
  };

  // withdrawals: { 'YYYY-MM': 金額 } … その月の引き落とし額
  // fixedCosts: [{ id, name, day, amount, paid: ['YYYY-MM', ...], credit }]
  //   paid は支払済みの月。credit = クレジットで払う（その月の締めの分として引き落とし日に引かれる）
  const state = load();
  let viewMonth = 0; // 0 = 今月

  function load() {
    const empty = {
      balance: 222823,
      balanceDate: '2026-09-25', // 今の残高を入力した日。この日より後の給料・引き落とし・固定費を反映する
      payday: 31,
      salary: 240000,
      closingDay: 31,
      withdrawDay: 27,
      withdrawals: { '2026-09': 220258, '2026-10': 196099, '2026-11': 68943 },
      fixedCosts: [
        { id: 'rent', name: '家賃', day: 31, amount: 35000, paid: [] },
        { id: 'utility', name: '光熱費', day: 31, amount: 5000, paid: [] },
        { id: 'transport', name: '交通費', day: 31, amount: 39000, paid: [], credit: true },
        { id: 'scholarship', name: '奨学金返済', day: 27, amount: 7500, paid: [], credit: false },
      ],
      migrations: ['nov-withdrawal', 'scholarship'],
    };
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored) return empty;
      const data = { ...empty, ...stored };
      // 交通費はクレジット払い
      for (const fc of data.fixedCosts) {
        if (fc.credit === undefined) fc.credit = fc.id === 'transport';
      }
      // 後から追加したデフォルト値を、保存済みのデータにも一度だけ入れる
      data.migrations = stored.migrations || [];
      if (!data.balanceDate) data.balanceDate = dateStr(today());
      if (!data.migrations.includes('nov-withdrawal')) {
        if (data.withdrawals['2026-11'] === undefined) data.withdrawals['2026-11'] = 68943;
        data.migrations.push('nov-withdrawal');
      }
      if (!data.migrations.includes('scholarship')) {
        if (!data.fixedCosts.some((fc) => fc.id === 'scholarship')) {
          data.fixedCosts.push({ id: 'scholarship', name: '奨学金返済', day: 27, amount: 7500, paid: [], credit: false });
        }
        data.migrations.push('scholarship');
      }
      return data;
    } catch {
      return empty;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 保存できなくても表示は続ける
    }
  }

  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  // 月末より大きい日は、その月の末日として扱う（例: 31日 → 2月は28日）
  function dayIn(year, month, day) {
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, last));
  }

  function hits(d, day) {
    return d.getTime() === dayIn(d.getFullYear(), d.getMonth(), day).getTime();
  }

  // 明日以降で最初の引き落とし日から3回分
  function nextWithdrawDates() {
    const t = today();
    let d = dayIn(t.getFullYear(), t.getMonth(), state.withdrawDay);
    if (d <= t) d = dayIn(t.getFullYear(), t.getMonth() + 1, state.withdrawDay);
    return [0, 1, 2].map((i) => dayIn(d.getFullYear(), d.getMonth() + i, state.withdrawDay));
  }

  // 次に来る給料日（明日以降）
  function nextPayday(t) {
    let d = dayIn(t.getFullYear(), t.getMonth(), state.payday);
    if (d <= t) d = dayIn(t.getFullYear(), t.getMonth() + 1, state.payday);
    return d;
  }

  // その日にカードで使った分が引き落とされる日（締日の翌月の引き落とし日）
  function billedOn(d) {
    let close = dayIn(d.getFullYear(), d.getMonth(), state.closingDay);
    if (d > close) close = dayIn(d.getFullYear(), d.getMonth() + 1, state.closingDay);
    return dayIn(close.getFullYear(), close.getMonth() + 1, state.withdrawDay);
  }

  // 固定費をその日に払う（カードなら使う）か。t = 残高を入力した日
  // 残高を入力した時点で今月分が未払いのまま支払日を過ぎていたら、入力した日に払う扱いにする
  function fixedCostDue(fc, d, t) {
    if (fc.paid.includes(monthKey(d))) return false;
    const due = dayIn(d.getFullYear(), d.getMonth(), fc.day);
    if (due.getTime() === d.getTime()) return d >= t;
    return d.getTime() === t.getTime() && due < t;
  }

  // 残高を入力した日 t から end までの毎日の残高（t までの給料・引き落としは入力した残高に含まれている前提）
  function simulate(t, end) {
    let nextWithdraw = dayIn(t.getFullYear(), t.getMonth(), state.withdrawDay);
    if (nextWithdraw <= t) nextWithdraw = dayIn(t.getFullYear(), t.getMonth() + 1, state.withdrawDay);
    let period = nextPayday(t) <= nextWithdraw ? 'low' : 'high';
    let total = num(state.balance);
    const days = [];
    // カード払いの固定費: 引き落とし日（時刻）→ 追加で引き落とされる金額
    // 残高を入力した日より前に使った分は、入力した引き落とし額に含まれている前提
    const cardExtra = new Map();
    for (let d = new Date(t); d <= end; d = addDays(d, 1)) {
      const events = [];
      if (d > t) {
        if (hits(d, state.withdrawDay)) {
          total -= num(state.withdrawals[monthKey(d)]) + (cardExtra.get(d.getTime()) || 0);
          events.push({ type: 'out', label: '引落' });
          period = 'low';
        }
        if (hits(d, state.payday)) {
          total += num(state.salary);
          events.push({ type: 'in', label: '給料' });
          period = 'high';
        }
      }
      const due = state.fixedCosts.filter((fc) => fixedCostDue(fc, d, t));
      const cash = due.filter((fc) => !fc.credit);
      const card = due.filter((fc) => fc.credit);
      if (cash.length) {
        for (const fc of cash) total -= num(fc.amount);
        events.push({ type: 'fix', label: cash.length === 1 ? cash[0].name || '固定費' : '固定費' });
      }
      if (card.length) {
        const billed = billedOn(d).getTime();
        for (const fc of card) cardExtra.set(billed, (cardExtra.get(billed) || 0) + num(fc.amount));
        events.push({ type: 'card', label: `💳${card.length === 1 ? card[0].name || '固定費' : '固定費'}` });
      }
      if (hits(d, state.closingDay)) events.push({ type: 'close', label: '締日' });
      days.push({ date: new Date(d), total, period, events });
    }
    return days;
  }

  // 今日から3ヶ月目の月末までの毎日の残高と使っていい金額
  function buildDays() {
    const now = today();
    const end = new Date(now.getFullYear(), now.getMonth() + MONTHS, 0);
    // 残高を入力した日から計算する（日付が変わっても、次に残高を変えるまで入力した値を元に進める）
    let t = parseDate(state.balanceDate);
    if (!(t <= now)) t = now;

    // 使っていい金額の計算用に、最後の引き落としの後の給料日まで先まで計算する
    const horizon = addDays(billedOn(end), 40);
    const all = simulate(t, horizon);

    const index = (d) => Math.round((d - t) / 86400000);

    // その日に使った分が引き落とされた後〜次の給料日の前日（本当の貯金の期間）でいちばん少ない残高
    // それより先の引き落とし（分割の先の分など）は含めない
    const lowestAfter = (w) => {
      const from = index(w);
      const to = index(nextPayday(w));
      let m = Infinity;
      for (let i = from; i < Math.max(to, from + 1); i++) m = Math.min(m, all[i].total);
      return m;
    };

    return all.filter((d) => d.date >= now && d.date <= end).map((d) => ({
      ...d,
      canUse: lowestAfter(billedOn(d.date)),
    }));
  }

  function renderCalendar(days) {
    const t = today();
    const first = new Date(t.getFullYear(), t.getMonth() + viewMonth, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    $('monthTitle').textContent = `${first.getFullYear()}年${first.getMonth() + 1}月`;

    const byTime = new Map(days.map((d, i) => [d.date.getTime(), i]));

    const cal = $('calendar');
    cal.innerHTML = '';
    for (const w of '日月火水木金土') {
      const h = document.createElement('div');
      h.className = 'wd';
      h.textContent = w;
      cal.appendChild(h);
    }
    for (let i = 0; i < first.getDay(); i++) {
      cal.appendChild(document.createElement('div'));
    }
    for (let date = new Date(first); date <= last; date = addDays(date, 1)) {
      const cell = document.createElement('div');
      const dateEl = document.createElement('div');
      dateEl.className = 'date';
      dateEl.textContent = date.getDate();
      cell.appendChild(dateEl);

      const i = byTime.get(date.getTime());
      if (i === undefined) {
        // 今日より前の日
        cell.className = 'day past';
        cal.appendChild(cell);
        continue;
      }
      const d = days[i];
      // 月の1日は必ず金額を出す。同じ金額が続くときは変わった日だけ表示する
      const prev = date.getDate() === 1 ? null : days[i - 1];
      cell.className = `day ${d.period}`;
      if (i === 0) cell.classList.add('today');

      if (!prev || prev.total !== d.total) {
        const amt = document.createElement('div');
        amt.className = 'amt';
        if (d.total < 0) amt.classList.add('neg');
        amt.textContent = comma(d.total);
        cell.appendChild(amt);
      }
      if (!prev || prev.canUse !== d.canUse) {
        const use = document.createElement('div');
        use.className = 'use';
        if (d.canUse < 0) use.classList.add('neg');
        use.append('使える', document.createElement('br'), comma(d.canUse));
        cell.appendChild(use);
      }

      for (const e of d.events) {
        const ev = document.createElement('div');
        ev.className = `ev ${e.type}`;
        ev.textContent = e.label;
        cell.appendChild(ev);
      }
      cal.appendChild(cell);
    }
  }

  function renderLabels() {
    const [w1, w2, w3] = nextWithdrawDates();
    $('nextText').textContent = `${md(w1)}の引き落とし額`;
    $('afterText').textContent = `${md(w2)}の引き落とし額`;
    $('thirdText').textContent = `${md(w3)}の引き落とし額`;
    $('nextAmount').value = state.withdrawals[monthKey(w1)] ?? '';
    $('afterAmount').value = state.withdrawals[monthKey(w2)] ?? '';
    $('thirdAmount').value = state.withdrawals[monthKey(w3)] ?? '';
  }

  function renderFixedCosts() {
    const t = today();
    const key = monthKey(t);
    const ul = $('fixedList');
    ul.innerHTML = '';
    state.fixedCosts.forEach((fc, idx) => {
      const li = document.createElement('li');
      li.className = 'fixed';

      const name = document.createElement('input');
      name.type = 'text';
      name.placeholder = '名前';
      name.value = fc.name;
      name.oninput = () => { fc.name = name.value; save(); render(); };

      const day = document.createElement('select');
      dayOptions(day, fc.day);
      day.onchange = () => { fc.day = Number(day.value); save(); render(); };

      const amount = document.createElement('input');
      amount.type = 'number';
      amount.inputMode = 'numeric';
      amount.min = '0';
      amount.step = '1';
      amount.placeholder = '金額';
      amount.value = fc.amount;
      amount.oninput = () => { fc.amount = amount.value; save(); render(); };

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '削除';
      del.onclick = () => {
        state.fixedCosts.splice(idx, 1);
        save();
        renderFixedCosts();
        render();
      };

      const paid = document.createElement('label');
      paid.className = 'paid';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = fc.paid.includes(key);
      check.onchange = () => {
        fc.paid = fc.paid.filter((m) => m !== key);
        if (check.checked) fc.paid.push(key);
        save();
        render();
      };
      paid.append(check, `${t.getMonth() + 1}月分 支払済み`);

      const credit = document.createElement('label');
      credit.className = 'paid';
      const creditCheck = document.createElement('input');
      creditCheck.type = 'checkbox';
      creditCheck.checked = !!fc.credit;
      creditCheck.onchange = () => { fc.credit = creditCheck.checked; save(); render(); };
      credit.append(creditCheck, 'クレジットで払う');

      const dayLabel = document.createElement('label');
      dayLabel.className = 'fc-day';
      dayLabel.append('支払日（毎月）', day);
      const amountLabel = document.createElement('label');
      amountLabel.className = 'fc-amount';
      amountLabel.append('金額（円）', amount);

      const checks = document.createElement('div');
      checks.className = 'checks';
      checks.append(credit, paid);

      li.append(name, del, dayLabel, amountLabel, checks);
      ul.appendChild(li);
    });
  }

  function render() {
    renderCalendar(buildDays());
  }

  function dayOptions(select, selected) {
    for (let i = 1; i <= 31; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i === 31 ? '末日' : `${i}日`;
      select.appendChild(opt);
    }
    select.value = selected;
  }

  // 初期表示
  $('balance').value = state.balance;
  $('salary').value = state.salary;
  dayOptions($('payday'), state.payday);
  dayOptions($('closingDay'), state.closingDay);
  dayOptions($('withdrawDay'), state.withdrawDay);

  const bind = (id, ev, fn) => $(id).addEventListener(ev, (e) => { fn(e.target.value); save(); render(); });
  bind('balance', 'input', (v) => { state.balance = v; state.balanceDate = dateStr(today()); });
  bind('salary', 'input', (v) => { state.salary = v; });
  bind('payday', 'change', (v) => { state.payday = Number(v); });
  bind('closingDay', 'change', (v) => { state.closingDay = Number(v); });
  bind('withdrawDay', 'change', (v) => { state.withdrawDay = Number(v); renderLabels(); });
  bind('nextAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[0])] = v; });
  bind('afterAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[1])] = v; });
  bind('thirdAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[2])] = v; });

  const changeMonth = (delta) => {
    const next = Math.min(MONTHS - 1, Math.max(0, viewMonth + delta));
    if (next === viewMonth) return;
    viewMonth = next;
    render();
  };
  // カレンダーの左右の端（それぞれ幅の1/4）をタップして月を切り替える
  $('calendar').addEventListener('click', (e) => {
    const rect = $('calendar').getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.25) changeMonth(-1);
    else if (x > 0.75) changeMonth(1);
  });

  // カレンダーを左右にスワイプして月を切り替える
  let touchStart = null;
  $('calendar').addEventListener('touchstart', (e) => {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  $('calendar').addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) changeMonth(dx < 0 ? 1 : -1);
  });
  $('addFixed').addEventListener('click', () => {
    state.fixedCosts.push({ id: Date.now().toString(36), name: '', day: 31, amount: '', paid: [], credit: false });
    save();
    renderFixedCosts();
    render();
  });

  // ローカルで直接開いた場合（未デプロイ）はプレースホルダーを置き換える
  const ver = $('versionInfo');
  if (ver.textContent.includes('__VERSION__')) ver.textContent = 'ローカル（未デプロイ）';

  // 日付が変わったら（開いたままでも）表示を今日基準に更新する。月が変わると表示する3ヶ月も進む
  let shownDay = dateStr(today());
  const refreshIfDayChanged = () => {
    if (dateStr(today()) === shownDay) return;
    shownDay = dateStr(today());
    viewMonth = 0;
    renderLabels();
    renderFixedCosts();
    render();
  };
  setInterval(refreshIfDayChanged, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfDayChanged(); });
  window.addEventListener('pageshow', refreshIfDayChanged);

  // 入力内容がブラウザに消されにくいよう、永続保存をお願いする
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  renderLabels();
  renderFixedCosts();
  render();
})();
