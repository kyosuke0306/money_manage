# money_manage

お金の管理アプリ（静的サイト: `index.html` / `style.css` / `app.js`、データはブラウザの localStorage に保存）。

## デプロイ
- GitHub Pages で公開。`.github/workflows/deploy.yml` が push 時に自動デプロイする。
- **修正したらすぐ commit & push してデプロイすること。**
- 画面右下にバージョン（`VERSION` のメジャー.マイナー + ワークフロー実行番号）とデプロイ時刻（JST）・コミットSHAが表示される。
  大きな変更のときは `VERSION` を上げる。
