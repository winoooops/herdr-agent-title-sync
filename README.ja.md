# Agent Title Sync for Herdr

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Herdr のペインラベルを、Claude Code、Codex、Kimi Code、OpenCode が生成するセッションタイトルと同期します。このプラグインはローカルの Agent 状態のみを読み取り、Herdr の組み込み CLI を使用します。ネットワーク通信は行わず、実行時の npm 依存関係もありません。

[herdr-agent-watcher](https://github.com/winoooops/herdr-agent-watcher) と組み合わせて使用できます。こちらは Herdr にコーディング Agent のオブザーバビリティを追加し、ライブサイドバーカード、ライフサイクル通知、ペインごとの Agent メタデータを提供します。

## GitHub からインストール

Herdr 0.7.5 以降と Node.js 22.18 以降が必要です。

```sh
herdr plugin install winoooops/herdr-agent-title-sync
herdr plugin action invoke install-integrations --plugin herdr-agent-title-sync
herdr plugin action invoke start-watcher --plugin herdr-agent-title-sync
```

すでに実行中の Agent は一度再起動し、Herdr がセッション ID を取得できるようにしてください。Watcher はローカルのペインとセッション状態を 1 秒ごとに確認し、Herdr とともに起動します。プラグインが無効になった場合、または Herdr が利用できなくなった場合は終了します。Watcher を再度起動すると古いインスタンスが置き換わるため、常に 1 つのインスタンスだけが残ります。

手動で設定したペインラベルは常に優先されます。自動タイトルに戻すには、そのラベルを消去してください。

## ローカル開発

```sh
git clone https://github.com/winoooops/herdr-agent-title-sync.git
cd herdr-agent-title-sync
npm ci
herdr plugin link "$PWD"
herdr plugin action invoke install-integrations --plugin herdr-agent-title-sync
herdr plugin action invoke start-watcher --plugin herdr-agent-title-sync
```

## 設定

`HERDR_AGENT_TITLE_SYNC_INTERVAL_MS` はポーリング間隔をミリ秒単位で指定します。正の数である必要があり、デフォルトは `1000` です。変更後は Watcher を再起動してください。

```sh
HERDR_AGENT_TITLE_SYNC_INTERVAL_MS=2000 \
  herdr plugin action invoke start-watcher --plugin herdr-agent-title-sync
```

Herdr が Watcher を自動起動するときにも同じ値を適用するには、Herdr を起動する環境でこの変数を設定してください。

## Marketplace

このリポジトリには `herdr-plugin` topic が設定されているため、[Herdr Marketplace](https://herdr.dev/plugins/) に自動的に掲載されます。

## タイトルの取得元

- Claude Code：トランスクリプト内の `ai-title` / `custom-title`。取得できない場合はターミナルタイトル
- Codex：`~/.codex/session_index.jsonl` の `thread_name`。Herdr がまだセッションを報告していない場合は、`codex resume <session-id>` プロセスの完全一致を使用
- Kimi Code：セッションの `state.json` に保存されたタイトル。生成タイトルを保存しないバージョンでは、最初のユーザープロンプトを使用
- OpenCode：`opencode.db` のセッションタイトル。取得できない場合はターミナルタイトル

専用のタイトルリーダーがない Agent では、ターミナルタイトルが自動的に使用されます。新しいリーダーを追加するには、`src/adapter/` にファイルを 1 つ追加し、`src/adapter/index.ts` の `TITLE_READERS` map に 1 エントリを追加します。共通の解析および安全性ヘルパーは `src/adapter/utils.ts` にあります。

Agent データのデフォルトルートは、`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`KIMI_CODE_HOME`、`OPENCODE_DB_PATH`、および XDG のデータ・状態環境変数を尊重します。

## 検証

```sh
npm test
npm run typecheck
herdr plugin list --json
herdr plugin log list --plugin herdr-agent-title-sync --limit 20
```

バックグラウンドの Watcher を停止するには、次を実行します。

```sh
herdr plugin action invoke stop-watcher --plugin herdr-agent-title-sync
```
