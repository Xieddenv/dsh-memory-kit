# dsh-memory-kit

[![smoke](https://github.com/Xieddenv/dsh-memory-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Xieddenv/dsh-memory-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc.2-4b5563)](package.json)

> 给 DSH 里的机器人装**五层记忆**：会话重置之后，她还记得你是谁、聊过什么、**答应过你什么**。
> 装完就灵——不写配置、不配数据库、不联网、零依赖。

## 为什么不是"又一个 MEMORY.md"

大多数记忆插件给你一个文件（或一个 storage 键）。问题是：**"她是谁"、"她该怎么说话"、"发生过什么"、"答应过什么"** 混在一起，模型每天重读 700 字人设和 30 天流水，注意力全摊薄了。

这套把记忆拆成五层，**每层有独立的注入预算和淘汰规则**：

| 层 | 文件 | 解决什么 | 注入 |
|---|---|---|---|
| 身份 | `persona.md` | 她是谁、你怎么叫她、绝对不要做什么 | ≤700 字 |
| 规矩 | `style.md` | 她该怎么说话（被纠正一次就长一条） | 最后 12 条 |
| 情节 | `diary/<日期>.md` | 发生过什么（越近越细） | 最近 7 天索引 |
| 近期 | `session-log/` | 上次聊到哪（**顶部带"这次聊了什么"要点**） | 最近一份 |
| 约定 | `open-loops.md` | **答应过你、还没做完的事** ← 别家基本没有这层 | 最后 5 条 |

## 装完就灵到什么程度

- 启动即建目录 + 空白模板 + 注入 system prompt + 挂 3 个工具（`memory_read/write/search`）
- **第一次对话她会主动问你叫什么**，然后自己写人设、写第一句日记（不用你教她怎么用）
- 老记忆可一键迁移：`node bin/import.mjs --from <旧目录>`
- 25 项自检：`node test/smoke.mjs` → 全绿

```
✓ 全新安装：五层文件建出、五段注入齐全、首次引导出现、三工具注册
✓ 工具闭环：write → read → search 全通
✓ 二次加载：引导消失、真实人设生效、注入 804 → 488 字
```

> 只分享**记忆方法**，不带任何人设/性格：装完是空白模板，你自己填（或从旧记忆迁移）。

## 装好之后长什么样

不需要截图也能判断它活着——装完重启 DSH，看这三个地方：

**① 日志里有这五行**（`<DSH_HOME>/memory-kit/memory-kit.log`）

```
memory dir = ...\.dsh\memory-kit\memory
prompt section updated（552 字）
tool registered: memory_read
tool registered: memory_write
tool registered: memory_search
dsh-memory-kit ready
```

**② 记忆目录建出来了**

```
<DSH_HOME>/memory-kit/memory/
├─ persona.md       ← 她是谁（还是模板就说明没填）
├─ style.md
├─ open-loops.md
├─ diary/
└─ session-log/
```

**③ 问一句就能验工具**

> 「你还记得我们上次聊了什么吗」→ 她应该先调 `memory_search`，再回答；搜不到会说搜不到，而不是编。

> 想看图？`assets/` 目录留给后续补截图用，现在不放引用，免得 README 显示破图。

## 它解决什么问题

DSH 的会话会被重置（省钱、防跑偏），代价是：

- 昨天聊的事，今天全忘
- 你纠正过的毛病，第二天照犯
- 答应你的事，醒来就没了

这套东西把记忆**搬到磁盘上**，每次唤醒再喂回提示词。

## 五层记忆

| 文件 | 内容 | 注入 |
|---|---|---|
| `persona.md` | 她是谁、你叫什么、绝对不要做什么 | ≤700 字 |
| `style.md` | 她自己复盘学到的说话规则 | 最后 12 条 |
| `diary/<日期>.md` | 每天一两句具体发生的事 | 最近 7 天索引 |
| `session-log/` | 会话存档（重置前写，带要点） | 最近一份 |
| `open-loops.md` | 答应过但还没做的事 | 最后 5 条 |

默认位置：`<DSH_HOME>/memory-kit/memory/`（一般是 `~/.dsh/memory-kit/memory/`）。

> 所有内容都是**你自己硬盘上的纯文本**，没有云端、没有遥测。日记里会有聊天摘要，别把目录传到公开仓库。

---

## 安装

### 方式一：双击安装（Windows，最简单）

**双击 `install.cmd`** 就行（它内部会绕过 PowerShell 执行策略去跑 `install.ps1`）。

脚本做三件事：把包放到 `<DSH_HOME>/plugins/`、在 profile 里建 junction、把 bundle 注册进 profile 的 `package.json`。
装完 **重启一次 DSH**（关掉再打开）就生效。

> 装完想确认没毛病？跑一句自检：
> ```bash
> node test/smoke.mjs
> ```
> 全绿（25 项）说明五层记忆、三个工具、首次引导都正常。

> 想装到别的 profile：`install.cmd -Profile <名字>`。

### 方式二：手动

1. 把本目录复制到 `<DSH_HOME>/plugins/dsh-memory-kit`
2. 建链接：`<DSH_HOME>/profiles/<profile>/node_modules/dsh-memory-kit` → 上面那个目录
3. 编辑 `<DSH_HOME>/profiles/<profile>/package.json`：
   - `dependencies` 加 `"@xie/dsh-memory-kit": "link:<DSH_HOME>/plugins/dsh-memory-kit"`
   - `dsh.profile.bundles` 数组里加 `"dsh-memory-kit"`
4. 重启 DSH

### 验证装好了

重启后应该出现：

```
~/.dsh/memory-kit/memory/{persona.md, style.md, open-loops.md, diary/, session-log/}
~/.dsh/memory-kit/memory-kit.log      ← 插件日志，应含 "prompt section updated" 和 "tool registered"
```

或者问模型一句「用 memory_search 搜"记忆"」，它能调出工具就说明生效了。

---

## 装好之后要做的唯一一件事

**填 `persona.md`**。这是唯一需要你手写的文件：

```markdown
# 她是谁

- 名字：小满
- 我叫：（填你的名字），她可以叫我「阿x」
- 关系：随口聊天的搭子，不是客服
- 说话风格：懒散、短句、偶尔犯困
- 绝对不要：用感叹号刷屏、叫「主人」
```

**500 字以内**，宁短勿长。剩下的 `style.md`、`diary/`、`open-loops.md` 会让模型自己慢慢写。

---

## 三个工具（模型用来自我维护）

| 工具 | 作用 |
|---|---|
| `memory_write(what, content)` | 写日记 / 加一条规则 / 更新人设 / 记一条约定 |
| `memory_read(what, date?)` | 读某一层记忆（日记可指定日期） |
| `memory_search(query)` | 在全部记忆里按关键词检索 |

插件的注入段里带了【记忆维护】指引，模型会自己用这些工具：聊到值得记的就写日记、被纠正就加规则、答应事就记约定。

---

## 配置项

在 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` 里本插件对应的 `config`（或者直接放在 profile `package.json` 的 bundle 配置里）：

```yaml
- insert:
    - id: memory-kit
      name: dsh-memory-kit
      config:
        dir: ''            # 留空 = <DSH_HOME>/memory-kit/memory
        personaMaxChars: 700
        styleTailLines: 12
        diaryIndexDays: 7
        openLoopsTailLines: 5
        refreshSeconds: 60
```

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 纯关键词检索 | 换个说法就搜不到；要更好效果自己换成向量检索 |
| 摘要会衰减 | 对话 → 日记两句话 → 注入再截断，细节仍会丢。靠"写具体一点"缓解 |
| 不含定时复盘 | 目前靠注入段里的【记忆维护】指引让模型随手写；想做 03:30 自动复盘，配一个定时任务调模型即可 |
| 与聊天端无关 | 它只服务 DSH 原生 agent；跑在 qq-bridge / 自建框架上的机器人，需要宿主自己把记忆注入（参考同作者的 `memory-kit` 配方包） |

---

## 许可

MIT。改、商用、二次分发都行，别删版权声明。
