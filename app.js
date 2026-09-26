(() => {
  'use strict';

  const STORAGE_KEY = 'money_manage.settings.v3';
  const ACCOUNTS = { yucho: 'ゆうちょ', mufg: '三菱' };
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

  // accounts: { yucho, mufg } … 口座ごとの今の残高（合計が今の残高）
  // salaryAccount / cardAccount / fixedCosts[].account … 入金・引き落としされる口座
  // withdrawals: { 'YYYY-MM': 金額 } … その月の引き落とし額
  // fixedCosts: [{ id, name, day, amount, paid: ['YYYY-MM', ...], credit }]
  //   paid は支払済みの月。credit = クレジットで払う（その月の締めの分として引き落とし日に引かれる）
  const state = load();
  let viewMonth = 0; // 0 = 今月

  function defaults() {
    return {
      accounts: { yucho: '', mufg: 222823 },
      balanceDate: '2026-09-25', // 今の残高を入力した日。この日より後の給料・引き落とし・固定費を反映する
      payday: 31,
      salary: 240000,
      salaryAccount: 'mufg',
      closingDay: 31,
      withdrawDay: 27,
      confirmDay: 12, // クレジットの支払い金額が確定する日（これより後は分割にできない）
      cardAccount: 'mufg',
      withdrawals: { '2026-09': 220258, '2026-10': 196099, '2026-11': 68943 },
      fixedCosts: [
        { id: 'rent', name: '家賃', day: 31, amount: 35000, paid: [], account: 'mufg' },
        { id: 'utility', name: '光熱費', day: 31, amount: 5000, paid: [], account: 'mufg' },
        { id: 'transport', name: '交通費', day: 31, amount: 39000, paid: [], credit: true, account: 'mufg' },
        { id: 'scholarship', name: '奨学金返済', day: 27, amount: 7500, paid: [], credit: false, account: 'yucho' },
      ],
      migrations: ['nov-withdrawal', 'scholarship'],
      statements: { current: null, history: {} }, // 財務諸表の記録（確定した月を残す）
    };
  }

  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch {
      return defaults();
    }
  }

  // 保存されていたデータ（ブラウザ・データベース）を今の形にそろえる
  function normalize(stored) {
    if (!stored) return defaults();
    const data = { ...defaults(), ...stored };
    // 交通費はクレジット払い
    for (const fc of data.fixedCosts) {
      if (fc.credit === undefined) fc.credit = fc.id === 'transport';
    }
    // 後から追加したデフォルト値を、保存済みのデータにも一度だけ入れる
    data.migrations = stored.migrations || [];
    if (!data.balanceDate) data.balanceDate = dateStr(today());
    data.statements = { current: null, history: {}, ...stored.statements };
    // 残高を口座ごとに分けた。これまでの残高は三菱に入れ、奨学金はゆうちょから引く
    if (!stored.accounts) data.accounts = { yucho: '', mufg: stored.balance ?? 222823 };
    for (const fc of data.fixedCosts) {
      if (!fc.account) fc.account = fc.id === 'scholarship' ? 'yucho' : 'mufg';
    }
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
  }

  const changeListeners = [];

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 保存できなくても表示は続ける
    }
  }

  function save() {
    saveLocal();
    for (const fn of changeListeners) fn();
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
  // transfer = true のときは、ゆうちょで足りない分を三菱から送金した場合として計算する
  function simulate(t, end, transfer = false) {
    let nextWithdraw = dayIn(t.getFullYear(), t.getMonth(), state.withdrawDay);
    if (nextWithdraw <= t) nextWithdraw = dayIn(t.getFullYear(), t.getMonth() + 1, state.withdrawDay);
    let period = nextPayday(t) <= nextWithdraw ? 'low' : 'high';
    // 口座ごとの残高。total はその合計
    const bal = { yucho: num(state.accounts.yucho), mufg: num(state.accounts.mufg) };
    let total = bal.yucho + bal.mufg;
    const move = (account, amt) => { bal[account] += amt; total += amt; };
    // 支払う。ゆうちょで足りなければ（transfer のとき）三菱から足りない分を送金する
    const payFrom = (pays, account, amt, info) => {
      move(account, -amt);
      let sent = 0;
      if (transfer && account === 'yucho' && bal.yucho < 0 && bal.mufg > 0) {
        sent = Math.min(-bal.yucho, bal.mufg);
        bal.mufg -= sent;
        bal.yucho += sent;
      }
      if (amt) pays.push({ ...info, amt, account, after: bal[account], sent });
    };
    const days = [];
    // カード払いの固定費: 引き落とし日（時刻）→ 追加で引き落とされる金額
    // 残高を入力した日より前に使った分は、入力した引き落とし額に含まれている前提
    const cardExtra = new Map();
    for (let d = new Date(t); d <= end; d = addDays(d, 1)) {
      const events = [];
      // 財務諸表用: その日の給料・カード引き落とし・口座払いの固定費、カードで使った固定費
      const flow = { salary: 0, card: 0, fixed: 0, cardUse: 0, billed: null };
      // その日の支払い（払った直後のその口座の残高 after がマイナスなら払えない）
      const pays = [];
      if (d > t) {
        if (hits(d, state.withdrawDay)) {
          const amt = num(state.withdrawals[monthKey(d)]) + (cardExtra.get(d.getTime()) || 0);
          payFrom(pays, state.cardAccount, amt, { name: 'カードの引き落とし', card: true });
          flow.card = amt;
          events.push({ type: 'out', label: '引落' });
          period = 'low';
        }
        if (hits(d, state.payday)) {
          move(state.salaryAccount, num(state.salary));
          flow.salary = num(state.salary);
          events.push({ type: 'in', label: '給料' });
          period = 'high';
        }
      }
      const due = state.fixedCosts.filter((fc) => fixedCostDue(fc, d, t));
      const cash = due.filter((fc) => !fc.credit);
      const card = due.filter((fc) => fc.credit);
      if (cash.length) {
        for (const fc of cash) {
          payFrom(pays, fc.account, num(fc.amount), { name: fc.name || '固定費' });
          flow.fixed += num(fc.amount);
        }
        events.push({ type: 'fix', label: cash.length === 1 ? cash[0].name || '固定費' : '固定費' });
      }
      if (card.length) {
        const billed = billedOn(d).getTime();
        for (const fc of card) cardExtra.set(billed, (cardExtra.get(billed) || 0) + num(fc.amount));
        flow.cardUse = card.reduce((sum, fc) => sum + num(fc.amount), 0);
        flow.billed = billed;
        events.push({ type: 'card', label: `💳${card.length === 1 ? card[0].name || '固定費' : '固定費'}` });
      }
      if (hits(d, state.closingDay)) events.push({ type: 'close', label: '締日' });
      days.push({ date: new Date(d), total, bal: { ...bal }, period, events, pays, flow });
    }
    return days;
  }

  // 今日から3ヶ月目の月末までの毎日の残高と使っていい金額
  function buildDays(transfer = false) {
    const now = today();
    const end = new Date(now.getFullYear(), now.getMonth() + MONTHS, 0);
    // 残高を入力した日から計算する（日付が変わっても、次に残高を変えるまで入力した値を元に進める）
    let t = parseDate(state.balanceDate);
    if (!(t <= now)) t = now;

    // 使っていい金額の計算用に、最後の引き落としの後の給料日まで先まで計算する
    const horizon = addDays(billedOn(end), 40);
    const all = simulate(t, horizon, transfer);

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

    const days = all.filter((d) => d.date >= now && d.date <= end).map((d) => ({
      ...d,
      canUse: lowestAfter(billedOn(d.date)),
    }));
    // 現時点の本当の貯金: 今が引き落とし後〜給料日なら今から、そうでなければ次の引き落とし日から、次の給料日の前日までの最小残高
    let from = now;
    if (days[0].period !== 'low') {
      from = dayIn(now.getFullYear(), now.getMonth(), state.withdrawDay);
      if (from <= now) from = dayIn(now.getFullYear(), now.getMonth() + 1, state.withdrawDay);
    }
    days.trueSavings = { amount: lowestAfter(from) };
    return days;
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
    // 支払い金額確定日が過ぎていたら「確定済み」を付ける
    const label = (id, w) => {
      const el = $(id);
      el.textContent = `${md(w)}の引き落とし額`;
      if (confirmDateFor(w) < today()) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '確定済み';
        el.append(badge);
      }
    };
    label('nextText', w1);
    label('afterText', w2);
    label('thirdText', w3);
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
      creditCheck.onchange = () => {
        fc.credit = creditCheck.checked;
        accountLabel.hidden = fc.credit;
        save();
        render();
      };
      credit.append(creditCheck, 'クレジットで払う');

      const account = document.createElement('select');
      accountOptions(account, fc.account);
      account.onchange = () => { fc.account = account.value; save(); render(); };
      const accountLabel = document.createElement('label');
      accountLabel.className = 'fc-account';
      accountLabel.append('引き落とし口座', account);
      accountLabel.hidden = !!fc.credit;

      const dayLabel = document.createElement('label');
      dayLabel.className = 'fc-day';
      dayLabel.append('支払日（毎月）', day);
      const amountLabel = document.createElement('label');
      amountLabel.className = 'fc-amount';
      amountLabel.append('金額（円）', amount);

      const checks = document.createElement('div');
      checks.className = 'checks';
      checks.append(credit, paid);

      li.append(name, del, dayLabel, amountLabel, accountLabel, checks);
      ul.appendChild(li);
    });
  }

  // 引き落とし日 w の支払い金額が確定する日（確定日が引き落とし日より後なら前の月）
  function confirmDateFor(w) {
    let c = dayIn(w.getFullYear(), w.getMonth(), state.confirmDay);
    if (c >= w) c = dayIn(w.getFullYear(), w.getMonth() - 1, state.confirmDay);
    return c;
  }

  // マイナスになるとき、いつ・何が・いくら足りなくて払えないか
  function renderShortage(days, transferDays) {
    const box = $('shortage');
    const list = $('shortageList');
    list.innerHTML = '';
    // 三菱からゆうちょへ送金した場合の支払い（日付・名前・口座で対応させる）
    const key = (d, p) => `${d.date.getTime()}|${p.name}|${p.account}`;
    const withTransfer = new Map();
    const baseShort = new Set();
    for (const d of days) for (const p of d.pays) if (p.after < 0) baseShort.add(key(d, p));
    // 送金したことで新しく三菱で足りなくなる支払い
    const newMufgShort = [];
    for (const d of transferDays) {
      for (const p of d.pays) {
        withTransfer.set(key(d, p), p);
        if (p.account === 'mufg' && p.after < 0 && !baseShort.has(key(d, p))) newMufgShort.push({ date: d.date, p });
      }
    }
    for (const d of days) {
      for (const p of d.pays) {
        if (p.after >= 0) continue;
        const short = Math.min(p.amt, -p.after);
        const li = document.createElement('li');
        const when = document.createElement('b');
        when.textContent = `${md(d.date)}（${'日月火水木金土'[d.date.getDay()]}）`;
        const what = document.createElement('span');
        what.textContent = `${p.name} ${comma(p.amt)}円`;
        const lack = document.createElement('span');
        lack.className = 'lack';
        lack.textContent = `${ACCOUNTS[p.account]}の残高が` + (short === p.amt ? `足りず全額 ${comma(short)}円 払えない` : `${comma(short)}円 足りない`);
        li.append(when, what, lack);
        if (p.account === 'yucho') {
          const tp = withTransfer.get(key(d, p));
          const note = document.createElement('div');
          note.className = 'transfer';
          if (tp && tp.after >= 0) {
            const later = newMufgShort.filter((x) => x.date >= d.date);
            note.textContent = `→ 三菱から ${comma(tp.sent)}円 送金すれば払えます` + (tp.sent > p.amt ? '（それまでの不足分を含む）' : '');
            if (later.length) {
              note.classList.add('warn');
              note.textContent += `。ただし送金すると ${later.map((x) => `${md(x.date)}の${x.p.name}`).join('、')} が三菱で足りなくなります`;
            }
          } else {
            note.classList.add('warn');
            note.textContent = `→ 三菱から送金しても ${comma(tp ? -tp.after : short)}円 足りません（三菱の残高も足りないため）`;
          }
          li.appendChild(note);
        }
        if (p.card) {
          // 支払い金額が確定する日までに分割にしないと払えない
          const deadline = confirmDateFor(d.date);
          const note = document.createElement('div');
          note.className = 'deadline';
          note.textContent = deadline >= today()
            ? `→ ${md(deadline)}（${'日月火水木金土'[deadline.getDay()]}）の支払い金額確定までに分割しないと払えません`
            : `→ ${md(deadline)} に支払い金額が確定済みのため、分割にはできません`;
          li.appendChild(note);
        }
        list.appendChild(li);
      }
    }
    box.hidden = !list.children.length;
  }

  // 表に1行追加する。cls: 'head' 見出し / 'sum' 合計 / 'sub' 内訳
  function addRow(table, cells, cls = '') {
    const tr = table.insertRow();
    if (cls) tr.className = cls;
    cells.forEach((c, i) => {
      const td = tr.insertCell();
      if (typeof c === 'number') {
        td.textContent = comma(c);
        td.className = 'num' + (c < 0 ? ' neg' : '');
      } else {
        td.textContent = c;
        if (i > 0) td.className = 'num';
      }
    });
    return tr;
  }

  // 財務諸表（おまけ）: 貸借対照表・損益計算書・キャッシュフロー計算書
  // statements.current … 今月の記録（毎回の計算で更新）。月が終わると statements.history[月] に確定として残す

  // date 時点のカードの未払い分: [['YYYY-MM-DD'（引き落とし日）, 金額], ...]
  // 入力済みの引き落とし額 + date までにカードで払った固定費（まだ引き落とされていない分）
  function debtsAt(date) {
    const debts = new Map();
    for (const [key, v] of Object.entries(state.withdrawals)) {
      const [y, m] = key.split('-').map(Number);
      const w = dayIn(y, m - 1, state.withdrawDay);
      if (w > date && num(v)) debts.set(w.getTime(), (debts.get(w.getTime()) || 0) + num(v));
    }
    let t = parseDate(state.balanceDate);
    if (!(t <= today())) t = today();
    if (t <= date) {
      for (const d of simulate(t, date)) {
        if (d.flow.cardUse && d.flow.billed > date.getTime()) {
          debts.set(d.flow.billed, (debts.get(d.flow.billed) || 0) + d.flow.cardUse);
        }
      }
    }
    return [...debts].sort((a, b) => a[0] - b[0]).map(([time, amt]) => [dateStr(new Date(time)), amt]);
  }

  const bsOf = (day) => ({
    date: dateStr(day.date), bal: { ...day.bal }, total: day.total, debts: debtsAt(day.date),
  });
  const plOf = () => ({
    salary: num(state.salary),
    costs: state.fixedCosts.map((fc) => ({ name: fc.name || '固定費', amount: num(fc.amount), credit: !!fc.credit })),
  });
  // その日の出入りの前の残高
  const before = (d) => d.total - d.flow.salary + d.flow.card + d.flow.fixed;

  // 今月の記録を更新し、終わった月は確定として残す。変わったら保存する
  function recordStatements(days) {
    const prev = JSON.stringify(state.statements);
    const st = state.statements;
    const key = monthKey(today());
    if (st.current && st.current.key < key) {
      const c = st.current;
      if (!st.history[c.key]) {
        const flows = Object.values(c.days).reduce((a, f) => a.map((x, i) => x + f[i]), [0, 0, 0]);
        const [salary, card, fixed] = flows;
        st.history[c.key] = {
          bs: c.bs,
          pl: c.pl,
          cf: {
            start: c.start, startDate: c.startDate, salary, card, fixed,
            other: c.bs.total - c.start - salary + card + fixed, end: c.bs.total,
          },
        };
      }
      st.current = null;
    }
    const month = days.filter((d) => monthKey(d.date) === key);
    const c = st.current || { key, days: {} };
    // 月の最初に記録した日の、その日の出入りの前の残高（その日のうちは入力の修正に合わせて更新）
    if (!c.startDate || c.startDate === dateStr(month[0].date)) {
      c.start = before(month[0]);
      c.startDate = dateStr(month[0].date);
    }
    // 今日以降の出入りは今の入力で更新し、過ぎた日は記録したまま残す
    for (const d of month) c.days[pad(d.date.getDate())] = [d.flow.salary, d.flow.card, d.flow.fixed];
    c.bs = bsOf(month[month.length - 1]); // 月末時点（見込み）
    c.pl = plOf();
    st.current = c;
    if (JSON.stringify(st) !== prev) save();
  }

  function renderBS(bs) {
    const date = parseDate(bs.date);
    $('bsDate').textContent = `${date.getMonth() + 1}/${date.getDate()} 時点`;
    const assets = $('bsAssets');
    assets.innerHTML = '';
    addRow(assets, ['資産の部', ''], 'head');
    for (const [key, label] of Object.entries(ACCOUNTS)) addRow(assets, [`現金預金（${label}）`, bs.bal[key]], 'sub');
    addRow(assets, ['資産合計', bs.total], 'sum');

    const liab = $('bsLiabilities');
    liab.innerHTML = '';
    addRow(liab, ['負債の部', ''], 'head');
    let debtTotal = 0;
    for (const [w, amt] of bs.debts) {
      addRow(liab, [`未払金（カード ${md(parseDate(w))}引落）`, amt], 'sub');
      debtTotal += amt;
    }
    if (!bs.debts.length) addRow(liab, ['未払金（カード）', 0], 'sub');
    addRow(liab, ['負債合計', debtTotal], 'sum');
    const equity = bs.total - debtTotal;
    addRow(liab, ['純資産の部', ''], 'head');
    addRow(liab, [equity < 0 ? '純資産（債務超過）' : '純資産', equity], 'sub');
    addRow(liab, ['負債・純資産合計', bs.total], 'sum');
  }

  function renderPL(pl, title) {
    $('plTitle').textContent = title;
    const table = $('plTable');
    table.innerHTML = '';
    addRow(table, ['収益', ''], 'head');
    addRow(table, ['給料', pl.salary], 'sub');
    addRow(table, ['費用', ''], 'head');
    let cost = 0;
    for (const fc of pl.costs) {
      addRow(table, [`${fc.name}${fc.credit ? '（カード）' : ''}`, fc.amount], 'sub');
      cost += fc.amount;
    }
    addRow(table, ['費用合計', cost], 'sum');
    addRow(table, ['純利益', pl.salary - cost], 'sum grand');
  }

  // cols: [{ label, start, salary, card, fixed, other?, end }]
  function renderCF(cols, title) {
    $('cfTitle').textContent = title;
    const cf = $('cfTable');
    cf.innerHTML = '';
    const hasOther = cols.some((m) => m.other !== undefined);
    addRow(cf, ['', ...cols.map((m) => m.label)], 'head');
    addRow(cf, ['期首残高', ...cols.map((m) => m.start)]);
    addRow(cf, ['給料', ...cols.map((m) => m.salary)], 'sub');
    addRow(cf, ['カード引落', ...cols.map((m) => -m.card)], 'sub');
    addRow(cf, ['固定費（口座）', ...cols.map((m) => -m.fixed)], 'sub');
    if (hasOther) addRow(cf, ['その他（残高の修正）', ...cols.map((m) => m.other)], 'sub');
    addRow(cf, ['増減', ...cols.map((m) => m.end - m.start)], 'sum');
    addRow(cf, ['期末残高', ...cols.map((m) => m.end)], 'sum grand');
  }

  // 表示する月の選択肢: 今（見込み）と確定した過去の月
  function renderStatementMonths() {
    const select = $('stMonth');
    const keys = Object.keys(state.statements.history).sort().reverse();
    const selected = keys.includes(select.value) ? select.value : 'now';
    select.innerHTML = '';
    const now = document.createElement('option');
    now.value = 'now';
    now.textContent = '今（今日時点・今後の予定）';
    select.appendChild(now);
    for (const key of keys) {
      const opt = document.createElement('option');
      const [y, m] = key.split('-').map(Number);
      opt.value = key;
      opt.textContent = `${y}年${m}月（確定）`;
      select.appendChild(opt);
    }
    select.value = selected;
    return selected;
  }

  function renderStatements(days) {
    const selected = renderStatementMonths();
    if (selected !== 'now') {
      // 確定した過去の月
      const h = state.statements.history[selected];
      const m = Number(selected.split('-')[1]);
      const from = parseDate(h.cf.startDate);
      renderBS(h.bs);
      renderPL(h.pl, `${m}月`);
      renderCF([{ label: `${m}月`, ...h.cf }], `${m}月（${md(from)}からの記録）`);
      return;
    }
    renderBS(bsOf(days[0]));
    renderPL(plOf(), '1ヶ月あたり');
    // 月ごとの口座のお金の出入り
    const months = [];
    for (const d of days) {
      const key = monthKey(d.date);
      let m = months.find((x) => x.key === key);
      if (!m) {
        m = { key, label: `${d.date.getMonth() + 1}月`, start: before(d), salary: 0, card: 0, fixed: 0, end: 0 };
        months.push(m);
      }
      m.salary += d.flow.salary;
      m.card += d.flow.card;
      m.fixed += d.flow.fixed;
      m.end = d.total;
    }
    renderCF(months, '今月から3ヶ月');
  }

  let view = 'main';

  // 閉じた入力項目の見出しに出す値
  function renderSummaries() {
    $('balanceSum').textContent = `${comma(num(state.accounts.yucho) + num(state.accounts.mufg))}円`;
    $('salarySum').textContent = `${comma(num(state.salary))}円`;
    const w = nextWithdrawDates()[0];
    $('cardSum').textContent = `${md(w)} ${comma(num(state.withdrawals[monthKey(w)]))}円`;
    $('fixedSum').textContent = `月 ${comma(state.fixedCosts.reduce((a, fc) => a + num(fc.amount), 0))}円`;
  }

  function renderTrueSavings(days) {
    const show = (id, n) => {
      $(id).textContent = `${comma(n)}円`;
      $(id).classList.toggle('neg', n < 0);
    };
    show('trueSavings', days.trueSavings.amount);
    show('canUseToday', days[0].canUse);
  }

  function render() {
    renderSummaries();
    const days = buildDays();
    renderTrueSavings(days);
    renderShortage(days, buildDays(true));
    renderCalendar(days);
    recordStatements(days);
    if (view === 'statements') renderStatements(days);
  }

  // ハンバーガーメニューで画面を切り替える（メインはカレンダー・入力）
  const menu = $('menu');
  const toggleMenu = (open) => {
    menu.hidden = !open;
    $('menuButton').setAttribute('aria-expanded', String(open));
  };
  $('menuButton').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) toggleMenu(false);
  });
  for (const b of menu.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      view = b.dataset.view;
      $('mainView').hidden = view !== 'main';
      $('statementsView').hidden = view !== 'statements';
      for (const x of menu.querySelectorAll('button')) x.classList.toggle('active', x === b);
      toggleMenu(false);
      window.scrollTo(0, 0);
      render();
    });
  }
  menu.querySelector('[data-view="main"]').classList.add('active');
  $('stMonth').addEventListener('change', () => renderStatements(buildDays()));

  function accountOptions(select, selected) {
    for (const [key, label] of Object.entries(ACCOUNTS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      select.appendChild(opt);
    }
    select.value = selected;
  }

  function renderTotal() {
    $('balanceTotal').textContent = `${comma(num(state.accounts.yucho) + num(state.accounts.mufg))}円`;
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

  // 入力欄に今のデータを入れる
  function fillInputs() {
    $('yucho').value = state.accounts.yucho;
    $('mufg').value = state.accounts.mufg;
    renderTotal();
    $('salary').value = state.salary;
    $('salaryAccount').value = state.salaryAccount;
    $('cardAccount').value = state.cardAccount;
    $('payday').value = state.payday;
    $('closingDay').value = state.closingDay;
    $('withdrawDay').value = state.withdrawDay;
    $('confirmDay').value = state.confirmDay;
  }

  // 初期表示
  accountOptions($('salaryAccount'), state.salaryAccount);
  accountOptions($('cardAccount'), state.cardAccount);
  dayOptions($('payday'), state.payday);
  dayOptions($('closingDay'), state.closingDay);
  dayOptions($('withdrawDay'), state.withdrawDay);
  dayOptions($('confirmDay'), state.confirmDay);
  fillInputs();

  const bind = (id, ev, fn) => $(id).addEventListener(ev, (e) => { fn(e.target.value); save(); render(); });
  for (const key of Object.keys(ACCOUNTS)) {
    bind(key, 'input', (v) => { state.accounts[key] = v; state.balanceDate = dateStr(today()); renderTotal(); });
  }
  bind('salaryAccount', 'change', (v) => { state.salaryAccount = v; });
  bind('cardAccount', 'change', (v) => { state.cardAccount = v; });
  bind('confirmDay', 'change', (v) => { state.confirmDay = Number(v); renderLabels(); });
  bind('salary', 'input', (v) => { state.salary = v; });
  bind('payday', 'change', (v) => { state.payday = Number(v); });
  bind('closingDay', 'change', (v) => { state.closingDay = Number(v); });
  bind('withdrawDay', 'change', (v) => { state.withdrawDay = Number(v); renderLabels(); });
  bind('nextAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[0])] = v; });
  bind('afterAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[1])] = v; });
  bind('thirdAmount', 'input', (v) => { state.withdrawals[monthKey(nextWithdrawDates()[2])] = v; });

  // カレンダーの見方（ヘルプ）は見たいときだけ開く
  $('helpButton').addEventListener('click', () => {
    const open = $('help').hidden;
    $('help').hidden = !open;
    $('helpButton').setAttribute('aria-expanded', String(open));
    $('helpButton').classList.toggle('active', open);
  });

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
    state.fixedCosts.push({ id: Date.now().toString(36), name: '', day: 31, amount: '', paid: [], credit: false, account: 'mufg' });
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

  // データベース同期（sync.js）から使う
  window.moneyApp = {
    getData: () => JSON.parse(JSON.stringify(state)),
    // データベースのデータで置き換える（置き換えたことは同期に通知しない）
    applyData(data) {
      const next = normalize(data);
      // 財務諸表の記録は、この端末にしかない月も残す
      const mine = state.statements;
      next.statements.history = { ...mine.history, ...next.statements.history };
      const c = next.statements.current;
      if (mine.current && (!c || c.key < mine.current.key
        || (c.key === mine.current.key && mine.current.startDate < c.startDate))) {
        next.statements.current = mine.current;
      }
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, next);
      saveLocal();
      fillInputs();
      renderLabels();
      renderFixedCosts();
      render();
    },
    onChange: (fn) => changeListeners.push(fn),
  };

  renderLabels();
  renderFixedCosts();
  render();
})();
