(() => {
  'use strict';

  const STORAGE_KEY = 'money_manage.settings.v2';

  const $ = (id) => document.getElementById(id);
  const yen = (n) => (n < 0 ? '-' : '') + '¥' + Math.abs(n).toLocaleString('ja-JP');
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const num = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : 0;
  };

  const state = load();

  function load() {
    const empty = { balance: '', payday: 25, salary: '', items: [], target: '' };
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
      // 保存できなくても計算は続ける
    }
  }

  // 月末より大きい日は、その月の末日として扱う（例: 31日 → 2月は28日）
  function hits(date, day) {
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return date.getDate() === Math.min(day, last);
  }

  // 今日の翌日から見たい日付までの給料・引き落としを反映した残高
  function calc() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = state.target ? new Date(state.target + 'T00:00:00') : today;
    let total = num(state.balance);
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    while (d <= target) {
      if (hits(d, state.payday)) total += num(state.salary);
      for (const it of state.items) {
        if (hits(d, it.day)) total -= num(it.amount);
      }
      d.setDate(d.getDate() + 1);
    }
    return total;
  }

  function renderResult() {
    const total = calc();
    const el = $('remain');
    el.textContent = yen(total);
    el.classList.toggle('minus', total < 0);
    const t = state.target ? new Date(state.target + 'T00:00:00') : new Date();
    $('remainLabel').textContent = `${t.getMonth() + 1}月${t.getDate()}日 時点の残り`;
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

  function renderItems() {
    const ul = $('itemList');
    ul.innerHTML = '';
    state.items.forEach((it, idx) => {
      const li = document.createElement('li');
      li.className = 'item';

      const name = document.createElement('input');
      name.type = 'text';
      name.placeholder = '名前（例: 家賃）';
      name.value = it.name;
      name.oninput = () => { it.name = name.value; save(); };

      const day = document.createElement('select');
      dayOptions(day, it.day);
      day.onchange = () => { it.day = Number(day.value); save(); renderResult(); };

      const amount = document.createElement('input');
      amount.type = 'number';
      amount.inputMode = 'numeric';
      amount.min = '0';
      amount.step = '1';
      amount.placeholder = '金額';
      amount.value = it.amount;
      amount.oninput = () => { it.amount = amount.value; save(); renderResult(); };

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '削除';
      del.onclick = () => {
        state.items.splice(idx, 1);
        save();
        renderItems();
        renderResult();
      };

      li.append(name, day, amount, del);
      ul.appendChild(li);
    });
  }

  // 初期表示
  if (!state.target) state.target = dateStr(new Date());
  $('targetDate').value = state.target;
  $('balance').value = state.balance;
  $('salary').value = state.salary;
  dayOptions($('payday'), state.payday);

  $('targetDate').addEventListener('input', (e) => { state.target = e.target.value; save(); renderResult(); });
  $('balance').addEventListener('input', (e) => { state.balance = e.target.value; save(); renderResult(); });
  $('salary').addEventListener('input', (e) => { state.salary = e.target.value; save(); renderResult(); });
  $('payday').addEventListener('change', (e) => { state.payday = Number(e.target.value); save(); renderResult(); });
  $('addItem').addEventListener('click', () => {
    state.items.push({ name: '', day: 27, amount: '' });
    save();
    renderItems();
    renderResult();
    const inputs = $('itemList').querySelectorAll('input[type="text"]');
    inputs[inputs.length - 1].focus();
  });

  // ローカルで直接開いた場合（未デプロイ）はプレースホルダーを置き換える
  const ver = $('versionInfo');
  if (ver.textContent.includes('__VERSION__')) ver.textContent = 'ローカル（未デプロイ）';

  renderItems();
  renderResult();
})();
