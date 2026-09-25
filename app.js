(() => {
  'use strict';

  const STORAGE_KEY = 'money_manage.entries.v1';
  const CATEGORIES = {
    expense: ['食費', '日用品', '交通費', '住居費', '水道光熱費', '通信費', '娯楽', '衣服', '医療', '交際費', 'その他'],
    income: ['給与', '賞与', '副業', 'お小遣い', 'その他'],
  };

  const $ = (id) => document.getElementById(id);
  const yen = (n) => (n < 0 ? '-' : '') + '¥' + Math.abs(n).toLocaleString('ja-JP');
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  let entries = load();
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth(); // 0-based
  let editingId = null;

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      alert('保存に失敗しました。ブラウザの設定を確認してください。');
    }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function currentType() {
    return document.querySelector('input[name="type"]:checked').value;
  }

  function fillCategories(type, selected) {
    const sel = $('category');
    sel.innerHTML = '';
    for (const c of CATEGORIES[type]) {
      const opt = document.createElement('option');
      opt.value = opt.textContent = c;
      sel.appendChild(opt);
    }
    if (selected && !CATEGORIES[type].includes(selected)) {
      const opt = document.createElement('option');
      opt.value = opt.textContent = selected;
      sel.appendChild(opt);
    }
    if (selected) sel.value = selected;
  }

  function monthEntries() {
    const prefix = `${viewYear}-${pad(viewMonth + 1)}`;
    return entries
      .filter((e) => e.date.startsWith(prefix))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  function render() {
    $('currentMonth').textContent = `${viewYear}年${viewMonth + 1}月`;
    const list = monthEntries();

    let income = 0;
    let expense = 0;
    const byCat = {};
    for (const e of list) {
      if (e.type === 'income') income += e.amount;
      else {
        expense += e.amount;
        byCat[e.category] = (byCat[e.category] || 0) + e.amount;
      }
    }
    $('sumIncome').textContent = yen(income);
    $('sumExpense').textContent = yen(expense);
    const bal = $('sumBalance');
    bal.textContent = yen(income - expense);
    bal.style.color = income - expense < 0 ? 'var(--expense)' : 'var(--income)';

    renderChart(byCat);
    renderList(list);
  }

  function renderChart(byCat) {
    const chart = $('categoryChart');
    chart.innerHTML = '';
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    if (!rows.length) {
      chart.innerHTML = '<div class="empty">この月の支出はまだありません</div>';
      return;
    }
    const max = rows[0][1];
    for (const [cat, amt] of rows) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      const name = document.createElement('span');
      name.textContent = cat;
      const track = document.createElement('div');
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.width = `${(amt / max) * 100}%`;
      track.appendChild(bar);
      const val = document.createElement('span');
      val.className = 'amount';
      val.textContent = yen(amt);
      row.append(name, track, val);
      chart.appendChild(row);
    }
  }

  function renderList(list) {
    const ul = $('entryList');
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="empty">記録がありません</li>';
      return;
    }
    let lastDate = null;
    for (const e of list) {
      if (e.date !== lastDate) {
        lastDate = e.date;
        const head = document.createElement('li');
        head.className = 'date-head';
        const d = new Date(e.date + 'T00:00:00');
        head.textContent = `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
        ul.appendChild(head);
      }
      const li = document.createElement('li');
      li.className = 'entry';

      const info = document.createElement('div');
      const cat = document.createElement('div');
      cat.className = 'cat';
      cat.textContent = e.category;
      info.appendChild(cat);
      if (e.memo) {
        const memo = document.createElement('div');
        memo.className = 'memo';
        memo.textContent = e.memo;
        info.appendChild(memo);
      }

      const amt = document.createElement('div');
      amt.className = `amt ${e.type}`;
      amt.textContent = (e.type === 'income' ? '+' : '-') + yen(e.amount);

      const ops = document.createElement('div');
      ops.className = 'ops';
      const editBtn = document.createElement('button');
      editBtn.textContent = '編集';
      editBtn.onclick = () => startEdit(e.id);
      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.onclick = () => remove(e.id);
      ops.append(editBtn, delBtn);

      li.append(info, amt, ops);
      ul.appendChild(li);
    }
  }

  function resetForm() {
    editingId = null;
    $('entryForm').reset();
    $('date').value = todayStr();
    fillCategories(currentType());
    $('formTitle').textContent = '記録する';
    $('submitBtn').textContent = '追加';
    $('cancelEdit').hidden = true;
  }

  function startEdit(id) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    editingId = id;
    document.querySelector(`input[name="type"][value="${e.type}"]`).checked = true;
    fillCategories(e.type, e.category);
    $('date').value = e.date;
    $('amount').value = e.amount;
    $('memo').value = e.memo || '';
    $('formTitle').textContent = '編集中';
    $('submitBtn').textContent = '更新';
    $('cancelEdit').hidden = false;
    $('entryForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function remove(id) {
    if (!confirm('この記録を削除しますか？')) return;
    entries = entries.filter((e) => e.id !== id);
    if (editingId === id) resetForm();
    save();
    render();
  }

  function onSubmit(ev) {
    ev.preventDefault();
    const amount = Math.round(Number($('amount').value));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('金額を正しく入力してください');
      return;
    }
    const data = {
      type: currentType(),
      date: $('date').value,
      amount,
      category: $('category').value,
      memo: $('memo').value.trim(),
    };
    if (editingId) {
      entries = entries.map((e) => (e.id === editingId ? { ...e, ...data } : e));
    } else {
      entries.push({ id: newId(), createdAt: Date.now(), ...data });
    }
    save();
    // 記録した月を表示する
    const [y, m] = data.date.split('-').map(Number);
    viewYear = y;
    viewMonth = m - 1;
    resetForm();
    render();
  }

  function shiftMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    render();
  }

  function csvEscape(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    const header = ['日付', '種別', 'カテゴリ', '金額', 'メモ'];
    const rows = [...entries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => [e.date, e.type === 'income' ? '収入' : '支出', e.category, e.amount, e.memo]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `money_${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  async function importCsv(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const rows = parseCsv((await file.text()).replace(/^﻿/, ''));
    let added = 0;
    for (const [date, type, category, amount, memo] of rows.slice(1)) {
      const amt = Math.round(Number(amount));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(amt) || amt <= 0) continue;
      entries.push({
        id: newId(),
        createdAt: Date.now() + added,
        type: type === '収入' ? 'income' : 'expense',
        date,
        category: category || 'その他',
        amount: amt,
        memo: memo || '',
      });
      added++;
    }
    save();
    render();
    alert(`${added}件を取り込みました`);
  }

  document.querySelectorAll('input[name="type"]').forEach((r) =>
    r.addEventListener('change', () => fillCategories(currentType()))
  );
  $('entryForm').addEventListener('submit', onSubmit);
  $('cancelEdit').addEventListener('click', resetForm);
  $('prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('nextMonth').addEventListener('click', () => shiftMonth(1));
  $('exportCsv').addEventListener('click', exportCsv);
  $('importCsv').addEventListener('change', importCsv);

  // ローカルで直接開いた場合（未デプロイ）はプレースホルダーを置き換える
  const ver = $('versionInfo');
  if (ver.textContent.includes('__VERSION__')) ver.textContent = 'ローカル（未デプロイ）';

  resetForm();
  render();
})();
