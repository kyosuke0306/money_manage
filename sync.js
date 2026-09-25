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
const setStatus = (text, cls) => {
  button.textContent = text;
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
  setStatus('☁️ 保存中…', 'busy');
  try {
    await setDoc(doc(db, 'users', user.uid), {
      data: JSON.stringify(app.getData()),
      updatedAt: Date.now(),
      device,
    });
    setStatus('☁️ 保存済み', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('⚠️ 保存できません', 'error');
  }
}

// 入力が変わったら少し待ってからデータベースに保存する
app.onChange(() => {
  if (!user) return;
  setStatus('☁️ 保存中…', 'busy');
  clearTimeout(timer);
  timer = setTimeout(upload, 800);
});

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!u) {
    setStatus('Googleでログイン', 'login');
    return;
  }
  setStatus('☁️ 読み込み中…', 'busy');
  const ref = doc(db, 'users', u.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      app.applyData(JSON.parse(snap.data().data));
      setStatus('☁️ 保存済み', 'ok');
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
      setStatus('☁️ 保存済み', 'ok');
    });
  } catch (e) {
    console.error(e);
    setStatus('⚠️ 読み込めません', 'error');
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

setStatus('Googleでログイン', 'login');
button.hidden = false;
