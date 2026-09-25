(() => {
  'use strict';

  const STORAGE_KEY = 'money_manage.settings.v3';

  const $ = (id) => document.getElementById(id);
  const yen = (n) => (n < 0 ? '-' : '') + '¥' + Math.abs(n).toLocaleString('ja-JP');
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
    const empty = { balance: '', payday: 25, salary: '', withdrawDay: 27, withdrawals: {} };
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

  // 今日から1ヶ月後までの毎日の残高
  function buildDays() {
    const t = today();
    const [w1, w2] = nextWithdrawDates();
    // 1ヶ月後まで。ただし次の月の引き落とし日が入るところまでは表示する
    let end = new Date(t.getFullYear(), t.getMonth() + 1, t.getDate());
    if (w2 > end) end = w2;
    const p1 = (() => {
      let d = dayIn(t.getFullYear(), t.getMonth(), state.payday);
      if (d <= t) d = dayIn(t.getFullYear(), t.getMonth() + 1, state.payday);
      return d;
    })();
    // 次に来るのが給料日なら、今は「引き落とし後〜給料日」の期間
    let period = p1 <= w1 ? 'low' : 'high';

    let total = num(state.balance);
    const days = [];
    for (let d = new Date(t); d <= end; d = addDays(d, 1)) {
      const events = [];
      if (d > t) {
        if (hits(d, state.withdrawDay)) {
          const amt = num(state.withdrawals[monthKey(d)]);
          total -= amt;
          events.push({ type: 'out', amt });
          period = 'low';
        }
        if (hits(d, state.payday)) {
          const amt = num(state.salary);
          total += amt;
          events.push({ type: 'in', amt });
          period = 'high';
        }
      }
      days.push({ date: new Date(d), total, period, events });
    }
    return days;
  }

  function renderSummary(days) {
    let low = days[0];
    for (const d of days) if (d.total < low.total) low = d;
    const el = $('canSpend');
    el.textContent = low.total < 0 ? `${yen(-low.total)} 足りません` : yen(low.total);
    el.classList.toggle('minus', low.total < 0);
    $('lowestNote').textContent = `いちばん少ない日: ${md(low.date)}（${yen(low.total)}）`;
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
      const cell = document.createElement('div');
      cell.className = `day ${d.period}`;
      if (d.total < 0) cell.classList.add('minus');
      if (i === 0) cell.classList.add('today');

      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = i === 0 || d.date.getDate() === 1 ? md(d.date) : d.date.getDate();
      cell.appendChild(date);

      const amt = document.createElement('div');
      amt.className = 'amt';
      amt.textContent = comma(d.total);
      cell.appendChild(amt);

      for (const e of d.events) {
        const ev = document.createElement('div');
        ev.className = `ev ${e.type}`;
        ev.textContent = e.type === 'in' ? '給料' : '引落';
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
    const days = buildDays();
    renderSummary(days);
    renderCalendar(days);
  }

  function dayOptions(select, selected) {
    for (let i = 1; i <= 31; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}日`;
      select.appendChild(opt);
    }
    select.value = selected;
  }

  // 初期表示
  $('balance').value = state.balance;
  $('salary').value = state.salary;
  dayOptions($('payday'), state.payday);
  dayOptions($('withdrawDay'), state.withdrawDay);

  const bind = (id, ev, fn) => $(id).addEventListener(ev, (e) => { fn(e.target.value); save(); render(); });
  bind('balance', 'input', (v) => { state.balance = v; });
  bind('salary', 'input', (v) => { state.salary = v; });
  bind('payday', 'change', (v) => { state.payday = Number(v); });
  bind('withdrawDay', 'change', (v) => { state.withdrawDay = Number(v); renderLabels(); });
  bind('nextAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[0])] = v; });
  bind('afterAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[1])] = v; });

  // ローカルで直接開いた場合（未デプロイ）はプレースホルダーを置き換える
  const ver = $('versionInfo');
  if (ver.textContent.includes('__VERSION__')) ver.textContent = 'ローカル（未デプロイ）';

  renderLabels();
  render();
})();
