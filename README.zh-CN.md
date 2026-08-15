# Herdr Agent Title Sync

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

让 Herdr 窗格标签与 Claude Code、Codex、Kimi Code 和 OpenCode 生成的会话标题保持同步。插件只读取本地 Agent 状态并使用 Herdr 内置 CLI；它不会发起网络请求，也没有运行时 npm 依赖。

与 [herdr-agent-watcher](https://github.com/winoooops/herdr-agent-watcher) 搭配使用：后者为 Herdr 提供编码 Agent 可观测性，包括实时侧边栏卡片、生命周期通知和每个窗格的 Agent 元数据。

## 从 GitHub 安装

需要 Herdr 0.7.5+ 和 Node.js 22.18+。

```sh
herdr plugin install winoooops/herdr-agent-title-sync
herdr plugin action invoke install-integrations --plugin herdr-agent-title-sync
herdr plugin action invoke start-watcher --plugin herdr-agent-title-sync
```

请重启一次已经运行的 Agent，让 Herdr 能够获取其会话 ID。Watcher 每秒检查一次本地窗格和会话状态，随 Herdr 启动，并在插件被禁用或 Herdr 不可用时退出。再次启动 Watcher 会替换旧实例，因此只会保留一个实例。

手动设置的窗格标签始终优先；清除该标签后即可恢复自动标题。

## 本地开发

```sh
git clone https://github.com/winoooops/herdr-agent-title-sync.git
cd herdr-agent-title-sync
npm ci
herdr plugin link "$PWD"
herdr plugin action invoke install-integrations --plugin herdr-agent-title-sync
herdr plugin action invoke start-watcher --plugin herdr-agent-title-sync
```

## 配置

`HERDR_AGENT_TITLE_SYNC_INTERVAL_MS` 用于设置轮询间隔（毫秒）。该值必须为正数，默认值为 `1000`。修改后需要重启 Watcher：

```sh
HERDR_AGENT_TITLE_SYNC_INTERVAL_MS=2000 \
  herdr plugin action invoke start-watcher --plugin herdr-agent-title-sync
```

如果希望 Herdr 自动启动 Watcher 时也使用相同的值，请在启动 Herdr 的环境中设置该变量。

## Marketplace

本仓库带有 `herdr-plugin` topic，因此会被 [Herdr Marketplace](https://herdr.dev/plugins/) 自动收录。

## 标题来源

- Claude Code：会话记录中的 `ai-title` / `custom-title`，然后回退到终端标题
- Codex：`~/.codex/session_index.jsonl` 中的 `thread_name`；当 Herdr 尚未报告会话时，通过精确匹配 `codex resume <session-id>` 进程回退
- Kimi Code：会话 `state.json` 中的标题；对于不再持久化生成标题的版本，回退到第一条用户提示词
- OpenCode：`opencode.db` 中的会话标题，然后回退到终端标题

没有专用标题读取器的 Agent 会自动使用其终端标题。添加新的读取器只需在 `src/adapter/` 下增加一个文件，并在 `src/adapter/index.ts` 的 `TITLE_READERS` map 中增加一项。共享的解析和安全辅助函数位于 `src/adapter/utils.ts`。

默认 Agent 数据目录支持 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`KIMI_CODE_HOME`、`OPENCODE_DB_PATH` 以及 XDG 数据和状态环境变量。

## 验证

```sh
npm test
npm run typecheck
herdr plugin list --json
herdr plugin log list --plugin herdr-agent-title-sync --limit 20
```

停止后台 Watcher：

```sh
herdr plugin action invoke stop-watcher --plugin herdr-agent-title-sync
```
