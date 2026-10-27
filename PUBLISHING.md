# 发布指南（给你自己看的）

这台机器上 **没有 git 和 npm**（`git --version` / `npm --version` 都找不到），所以下面第 1、2 步需要在别的地方做，或者先装工具。

---

## 1. 发到 GitHub（不用 git 也行）

**方式 A：网页上传（最快，零安装）**

1. 打开 https://github.com/new，仓库名 `@xie/dsh-memory-kit`，公开，不要勾 README
2. 进仓库 → **Add file → Upload files** → 把本目录下这些**拖进去**：
   ```
   lib/  bin/  test/  .github/  .gitignore
   package.json  cordis.patch.yml  install.cmd  install.ps1
   README.md  CHANGELOG.md  CONTRIBUTING.md  LICENSE
   ```
3. Commit 后，把 `package.json` 里的 `Xieddenv` 换成你的用户名（网页编辑器直接改）
4. 顺手在 Settings → 里确认 Actions 能跑（`.github/workflows/ci.yml` 会跑 smoke）

**方式 B：装了 git 之后**

```bash
cd dsh-memory-kit
git init && git add -A
git commit -m "feat: dsh-memory-kit v0.1.0"
git branch -M main
git remote add origin https://github.com/Xieddenv/dsh-memory-kit.git
git push -u origin main
```

---

## 2. 发到 npm（market 装的通常就是 npm 包）

要求：装 Node（带 npm）+ 一个 npm 账号。

```bash
npm login
cd dsh-memory-kit
npm test                 # 先确认 25 项全过
npm pack --dry-run       # 看看会打包哪些文件
npm publish --access public
```

`package.json` 已经准备好：
- 无任何运行时依赖（纯 node 内置模块）
- `files` 白名单只带 `lib/bin/test/cordis.patch.yml/README/LICENSE`
- `engines.dsh: ">=0.2.0-rc.2 <0.3.0"`（market 会读它判断兼容性）

发完验证：

```bash
npm view @xie/dsh-memory-kit version
```

---

## 3. 上架插件市场（dshmarket）

市场读的是 **[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com/plugins.json)** 这份索引。上架 = 让对方索引里有一条你的条目。

**入口**：那个站点/它的仓库收 PR（提交一个 registry 条目）。条目字段参考下面这份模板（我按 dshmarket 源码里读取的字段推的：`name / version / description / keywords / repository / engines / screenshots`）：

```json
{
  "name": "@xie/dsh-memory-kit",
  "version": "0.1.0",
  "description": "让 DSH 里的机器人不再健忘：五层记忆（人设/规则/日记/会话存档/未了结的事）自动注入 + 三个记忆工具，装完即用。",
  "keywords": ["memory", "persona", "chatbot", "agent"],
  "repository": "https://github.com/Xieddenv/dsh-memory-kit",
  "homepage": "https://github.com/Xieddenv/dsh-memory-kit#readme",
  "license": "MIT",
  "engines": { "dsh": ">=0.2.0-rc.2 <0.3.0" },
  "screenshots": []
}
```

> `screenshots` 留空也能上；填的话把图片传到你仓库（如 `assets/shot-1.png`）再写 URL，市场卡片会直接显示。

**提交前自查**（都是我之前踩过的坑）：

| 检查 | 为什么 |
|---|---|
| `package.json` 能被 `JSON.parse` 且**无 BOM** | DSH 读过带 BOM 的 package.json 会报 `Unexpected token ﻿`（本机 dsh-gui-url 就这么挂的） |
| `engines.dsh` 写的是**合法 semver range** | 市场用它判断"这个插件跟当前宿主兼不兼容"，写错会被当成不兼容 |
| 包里没有私人数据 | 跑一遍 `node test/smoke.mjs`，再 grep 一次人名/本机路径 |
| `install.cmd` 是 **GBK 编码**（内容纯 ASCII） | 中文路径下 UTF-8 的 cmd 会被读歪 |

---

## 4. 发出去之后的最小运营

- README 顶部留一句"装不上/不生效先跑 `node test/smoke.mjs` 把结果贴 issue"
- issue 模板已经写好了（`.github/ISSUE_TEMPLATE/`），要求对方贴 DSH 版本 + node 版本 + `memory-kit.log` 最后 20 行
- 版本号规则：加功能 → `0.2.0`；修 bug → `0.1.1`；改行为/改存储格式 → 升 minor 并在 CHANGELOG 写清迁移办法

---

## 附：当前包清单

```
dsh-memory-kit/
├── lib/index.js            插件本体（注入 + 3 工具 + 首次引导 + 迁移）
├── bin/import.mjs          老记忆迁移 CLI
├── test/smoke.mjs          25 项自检（CI 也跑它）
├── cordis.patch.yml        bundle 装配入口
├── package.json
├── install.cmd / install.ps1   一键安装
├── README.md / CHANGELOG.md / CONTRIBUTING.md / LICENSE
└── .github/                 CI + issue 模板
```
