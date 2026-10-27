# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-10-27

首个可用版本。

### 新增

- **五层记忆**：`persona.md`（人设）/ `style.md`（说话规则）/ `diary/`（日记）/ `session-log/`（会话存档）/ `open-loops.md`（还没了结的事），全部是磁盘上的纯文本。
- **自动注入**：通过 `systemPrompt.section` 把五层记忆拼进每次唤醒，文件改动 60 秒内自动重建注入段落。
- **三个工具**：`memory_read` / `memory_write` / `memory_search`，让模型自己维护记忆。
- **首次使用引导**：全新安装时（无日记 / 人设为空模板）注入【第一次见面】，要求模型第一轮就问清称呼、写人设、写第一句日记。
- **老记忆迁移**：`bin/import.mjs` 可从别的记忆目录（如 qq-bridge 的 `state/memory`）导入人设、规则、约定、日记、存档。
- **一键安装**：`install.cmd`（双击）/ `install.ps1`（可指定 `-Profile`）。
- **自检**：`test/smoke.mjs`，25 项断言覆盖建目录、注入、工具闭环、二次加载。

### 已知限制

- 纯关键词检索（无向量）。
- 摘要会衰减：对话 → 日记两句话 → 注入再截断。
- 只在 DSH `0.2.0-rc.2` 上验证过，通过 `engines.dsh` 声明兼容范围。
- 不含定时复盘：目前靠注入段里的【记忆维护】指引让模型随手写。
