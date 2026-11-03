# GitHub Pagesへの公開

ゲームはPythonで静的ファイルにまとめ、GitHub ActionsからGitHub Pagesへ公開します。ゲームのビルド・テストにNode.jsやnpmは使いません。

## 初回設定

1. リポジトリ `tj8000rpm/asobi` に、この作業フォルダの変更をcommit・pushします。
2. GitHubの **Settings → Pages** を開きます。
3. **Build and deployment → Source** に **GitHub Actions** を選択します。
4. **Actions → Test, build and publish games → Run workflow** でGitHubの既定ブランチを選んで実行します。以降は既定ブランチへのpushで自動更新されます。

GitHub Freeで利用する場合は公開リポジトリが必要です。非公開リポジトリでのPages提供可否はアカウントプランに依存します。

[GitHub公式：公開元の設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## ワークフロー

`.github/workflows/ci.yml` は次を実行します。

1. Pythonのビルド処理テスト。
2. Chromiumでのゲーム動作テスト。
3. `python3 scripts/build.py` による `dist/` の生成。
4. 通常の成果物 `games-dist` の保存（7日間）。
5. 公開対象の場合のみ、Pages用の成果物を作成して公開。

PRでは検証のみを行います。pushは `master` と `main` を検知し、そのうちGitHub側の既定ブランチだけを公開します。手動実行も既定ブランチが対象です。既定ブランチを別名に変える場合はワークフローの `push.branches` も合わせて変更してください。

公開ジョブはビルド成功を待ち、`github-pages` Environmentを利用します。`pages: write` と `id-token: write` は公開ジョブだけに付与しています。専用アクセスキーやSecretsの登録は不要です。

[GitHub公式：カスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 公開URL

独自ドメイン未設定の場合、公開成功後のURLは次のとおりです。

- 一覧：`https://tj8000rpm.github.io/asobi/`
- 空港ゲーム：`https://tj8000rpm.github.io/asobi/airport/index.html`

実際のURLはActionsの公開ジョブと `github-pages` Environmentから確認できます。ゲーム一覧と素材は相対パスで参照し、GitHub Pagesの `/asobi/` 配下でも読み込めます。

## 公開するファイル

```text
dist/
├── index.html
└── airport/
    ├── index.html
    ├── style.css
    ├── simulation.js
    └── game.js
```

`games/<id>/public/` の通常ファイルと生成したゲーム一覧だけを公開します。テスト・README・開発設定は含みません。`dist/` をGitへcommitしたり、公開用ブランチを別途作ったりする必要はありません。

## 公開できないとき

- PagesのSourceが **GitHub Actions** になっているか確認します。
- テストやビルドが失敗している場合は、Actionsのログを確認します。
- `github-pages` Environmentのブランチ制限が、実際の既定ブランチと一致しているか確認します。
- 公開が承認待ちの場合は、Environmentに設定されている承認を行います。

## 公開先を変える場合

`python3 scripts/build.py` の成果物 `dist/` は一般的な静的ファイルです。公開ジョブだけを差し替えれば、ゲームのフォルダ構成やビルド処理を維持したまま別のホスティングへ移行できます。
