# あそびば — ブラウザゲーム集

静的ファイルとlocalStorageで動くゲームを、同じリポジトリで管理します。ゲームごとに本体・テスト・説明を分け、公開用ファイルだけを `dist/` にまとめます。

## フォルダ構成

```text
.
├── games.json                   # 公開するゲームと一覧の表示情報
├── games/
│   └── airport/
│       ├── public/              # 公開するHTML・JS・CSS・画像等
│       │   ├── index.html
│       │   ├── game.js
│       │   ├── simulation.js
│       │   └── style.css
│       ├── tests/               # このゲームのテスト
│       └── README.md            # 遊び方・ゲーム固有の仕様
├── site/index.html              # ゲーム一覧のテンプレート
├── scripts/
│   ├── build.py                 # ゲームを集めてdistを生成
│   └── test_browser.py          # ブラウザでゲームをテスト
├── tests/                       # ビルド処理のテスト
├── docs/                        # 公開成果物とCDの接続方針
├── .github/workflows/ci.yml      # テスト・ビルド・成果物の保存
└── dist/                        # 生成物（Git管理外）
```

## ローカル起動

ローカルでのビルドと確認にはPython 3.10以上を使います。Python標準ライブラリだけで動き、Node.js・npm・追加パッケージは不要です。公開済みゲームはブラウザだけで遊べます。

```sh
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
```

- 一覧：http://localhost:8000/
- 空港ゲーム：http://localhost:8000/airport/index.html

ファイルを編集したら `python3 scripts/build.py` を再実行し、ブラウザを再読み込みしてください。

## テスト・ビルド

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/build.py
```

ゲームの動作テストはブラウザで実行します。リポジトリルートで `python3 -m http.server 8001` を起動し、http://localhost:8001/games/airport/tests/index.html を開いてください。

Chromium系ブラウザがインストール済みなら、自動実行もできます。CIも同じ方法を使います。

```sh
python3 scripts/test_browser.py
# 実行ファイルを指定する場合
python3 scripts/test_browser.py --browser /path/to/chrome
```

`dist/` は毎回作り直します。`games/<id>/public/` の通常ファイルのみをコピーし、一覧ページを生成します。隠しファイルは公開せず、シンボリックリンクはエラーにします。ゲームごとのREADMEやテストは公開物に含まれません。

## ゲームを追加する

1. `games/<id>/public/index.html` と、そのゲームのJS・CSS・画像を用意します。
2. `games/<id>/tests/index.html` にブラウザで動くテストを用意します。`python3 scripts/test_browser.py` で自動検出します。
3. `games/<id>/README.md` に遊び方を記載します。
4. `games.json` に次のような項目を追加します。

```json
{
  "id": "train",
  "title": "ちいさな でんしゃ",
  "description": "でんしゃを はしらせよう。",
  "icon": "🚃"
}
```

IDは英小文字から始まる英小文字・数字・ハイフンです。ビルド後は `/train/index.html` で公開され、ゲーム一覧にも追加されます。

各ゲームは相対パスで素材を参照してください。localStorageは同じオリジン内で共有されるため、保存キーにゲームID等を含めて衝突を避けます。空港ゲームは既存の保存を引き継ぐため `little-airport-v1` を維持しています。

## GitHub Pagesで公開

GitHubリポジトリの **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選択します。

`.github/workflows/ci.yml` がテスト・Pythonでのビルド後、既定ブランチへのpushで `dist/` をGitHub Pagesへ自動公開します。現在のローカルブランチ `master` と `main` のpushを検知し、そのうちGitHub側の既定ブランチだけを公開対象とします。PRは検証のみ、手動実行は既定ブランチを選んだ場合のみ公開します。

公開成功後のURL（独自ドメイン未設定の場合）：

- 一覧：https://tj8000rpm.github.io/asobi/
- 空港ゲーム：https://tj8000rpm.github.io/asobi/airport/index.html

GitHubのActionsまたは `github-pages` Environmentに実際の公開URLが表示されます。認証はGitHub標準のトークンを使うため、公開用のSecrets追加は不要です。

ゲームは相対パスで素材を読むため、`/asobi/` 配下でも動作します。公開先を変える場合も同じ `dist/` を利用できます。

[初回設定と公開手順](docs/deployment.md)を参照してください。

## ゲーム

- [ちいさな くうこう](games/airport/README.md)
