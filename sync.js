// Firebase（Google ログイン + Firestore）でデータを保存・同期する
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDrPUI_ZF0OcDJqlyv9JiRwYHdHz7CT_gg',
  authDomain: 'moneymanage-2b6dc.firebaseapp.com',
  projectId: 'moneymanage-2b6dc',
  storageBucket: 'moneymanage-2b6dc.firebasestorage.app',
  messagingSenderId: '981925974937',
  appId: '1:981925974937:web:65182dc8cce93b8893f908',
};

const app = window.moneyApp;
const button = document.getElementById('syncButton');
// 状態ごとの小さなアイコン（絵文字は使わない）
const SYNC_ICONS = {
  ok: '<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18z"/><path d="M9.5 13.2l1.8 1.8 3.4-3.4"/>',
  busy: '<path d="M12 4a8 8 0 1 1-8 8"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/>',
  login: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4"/>',
};
const setStatus = (text, cls) => {
  button.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${SYNC_ICONS[cls] || ''}</svg><span>${text}</span>`;
  button.className = `sync ${cls}`;
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

// この端末の印（自分が書いた変更を、自分で読み込み直さないため）
const device = Math.random().toString(36).slice(2);
let user = null;
let unsubscribe = null;
let timer = null;

async function upload() {
  if (!user) return;
  setStatus('保存中', 'busy');
  try {
    await setDoc(doc(db, 'users', user.uid), {
      data: JSON.stringify(app.getData()),
      updatedAt: Date.now(),
      device,
    });
    setStatus('保存済み', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('保存できません', 'error');
  }
}

// 入力が変わったら少し待ってからデータベースに保存する
app.onChange(() => {
  if (!user) return;
  setStatus('保存中', 'busy');
  clearTimeout(timer);
  timer = setTimeout(upload, 800);
});

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!u) {
    setStatus('ログイン', 'login');
    return;
  }
  setStatus('読み込み中', 'busy');
  const ref = doc(db, 'users', u.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      app.applyData(JSON.parse(snap.data().data));
      setStatus('保存済み', 'ok');
    } else {
      // 初めてのログイン: 今この端末にあるデータをデータベースに移す
      await upload();
    }
    // ほかの端末で変えた内容を反映する
    unsubscribe = onSnapshot(ref, (s) => {
      if (!s.exists() || s.metadata.hasPendingWrites) return;
      const d = s.data();
      if (d.device === device) return;
      app.applyData(JSON.parse(d.data));
      setStatus('保存済み', 'ok');
    });
  } catch (e) {
    console.error(e);
    setStatus('読み込めません', 'error');
  }
});

button.addEventListener('click', async () => {
  if (user) {
    if (confirm(`${user.email} でログイン中です。ログアウトしますか？\n（データはデータベースに残ります）`)) await signOut(auth);
    return;
  }
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      alert(`ログインできませんでした（${e.code || e.message}）`);
    }
  }
});

setStatus('ログイン', 'login');
button.hidden = false;
