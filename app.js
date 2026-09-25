(() => {
  'use strict';

  const STORAGE_KEY = 'money_manage.settings.v3';

  const $ = (id) => document.getElementById(id);
  const comma = (n) => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ja-JP');
  const pad = (n) => String(n).padStart(2, '0');
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const num = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : 0;
  };

  // withdrawals: { 'YYYY-MM': 金額 } … その月の引き落とし額
  const state = load();

  function load() {
    const empty = {
      balance: 222823,
      payday: 31,
      salary: 240000,
      closingDay: 31,
      withdrawDay: 27,
      withdrawals: { '2026-09': 220258, '2026-10': 196099 },
    };
    try {
      return { ...empty, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
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

  // 明日以降で最初の引き落とし日と、その次の引き落とし日
  function nextWithdrawDates() {
    const t = today();
    let d = dayIn(t.getFullYear(), t.getMonth(), state.withdrawDay);
    if (d <= t) d = dayIn(t.getFullYear(), t.getMonth() + 1, state.withdrawDay);
    const d2 = dayIn(d.getFullYear(), d.getMonth() + 1, state.withdrawDay);
    return [d, d2];
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

  // 今日から end までの毎日の残高（今日の分は今の残高に含まれている前提）
  function simulate(t, end) {
    let period = nextPayday(t) <= nextWithdrawDates()[0] ? 'low' : 'high';
    let total = num(state.balance);
    const days = [];
    for (let d = new Date(t); d <= end; d = addDays(d, 1)) {
      const events = [];
      if (d > t) {
        if (hits(d, state.withdrawDay)) {
          total -= num(state.withdrawals[monthKey(d)]);
          events.push('out');
          period = 'low';
        }
        if (hits(d, state.payday)) {
          total += num(state.salary);
          events.push('in');
          period = 'high';
        }
      }
      if (hits(d, state.closingDay)) events.push('close');
      days.push({ date: new Date(d), total, period, events });
    }
    return days;
  }

  // 1ヶ月後まで（次の月の引き落とし日が入るところまで）の毎日の残高と使っていい金額
  function buildDays() {
    const t = today();
    let end = new Date(t.getFullYear(), t.getMonth() + 1, t.getDate());
    const w2 = nextWithdrawDates()[1];
    if (w2 > end) end = w2;

    // 使っていい金額の計算用に、最後の引き落としの後の給料日まで先まで計算する
    const horizon = addDays(billedOn(end), 40);
    const all = simulate(t, horizon);

    // minFrom[i] = i日目以降でいちばん少ない残高
    const minFrom = new Array(all.length);
    for (let i = all.length - 1, m = Infinity; i >= 0; i--) {
      m = Math.min(m, all[i].total);
      minFrom[i] = m;
    }
    const index = (d) => Math.round((d - t) / 86400000);

    return all.filter((d) => d.date <= end).map((d) => ({
      ...d,
      // その日に使うと引き落とし日以降の残高が減る → 引き落とし日以降の最小残高まで使える
      canUse: minFrom[index(billedOn(d.date))],
    }));
  }

  function renderCalendar(days) {
    const cal = $('calendar');
    cal.innerHTML = '';
    for (const w of '日月火水木金土') {
      const h = document.createElement('div');
      h.className = 'wd';
      h.textContent = w;
      cal.appendChild(h);
    }
    for (let i = 0; i < days[0].date.getDay(); i++) {
      cal.appendChild(document.createElement('div'));
    }
    days.forEach((d, i) => {
      const prev = days[i - 1];
      const cell = document.createElement('div');
      cell.className = `day ${d.period}`;
      if (i === 0) cell.classList.add('today');

      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = i === 0 || d.date.getDate() === 1 ? md(d.date) : d.date.getDate();
      cell.appendChild(date);

      // 同じ金額が続くときは、変わった日だけ表示する
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

      const labels = { in: '給料', out: '引落', close: '締日' };
      for (const e of d.events) {
        const ev = document.createElement('div');
        ev.className = `ev ${e}`;
        ev.textContent = labels[e];
        cell.appendChild(ev);
      }
      cal.appendChild(cell);
    });
  }

  function renderLabels() {
    const [w1, w2] = nextWithdrawDates();
    $('nextText').textContent = `次の引き落とし額（${md(w1)}）`;
    $('afterText').textContent = `次の月の引き落とし額（${md(w2)}）`;
    $('nextAmount').value = state.withdrawals[monthKey(w1)] ?? '';
    $('afterAmount').value = state.withdrawals[monthKey(w2)] ?? '';
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
  bind('balance', 'input', (v) => { state.balance = v; });
  bind('salary', 'input', (v) => { state.salary = v; });
  bind('payday', 'change', (v) => { state.payday = Number(v); });
  bind('closingDay', 'change', (v) => { state.closingDay = Number(v); });
  bind('withdrawDay', 'change', (v) => { state.withdrawDay = Number(v); renderLabels(); });
  bind('nextAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[0])] = v; });
  bind('afterAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[1])] = v; });

  // ローカルで直接開いた場合（未デプロイ）はプレースホルダーを置き換える
  const ver = $('versionInfo');
  if (ver.textContent.includes('__VERSION__')) ver.textContent = 'ローカル（未デプロイ）';

  renderLabels();
  render();
})();
