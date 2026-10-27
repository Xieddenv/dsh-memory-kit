# 参与贡献

谢谢愿意帮忙。这个项目很小，规则也简单。

## 提 Issue 之前

1. 先跑 `node test/smoke.mjs`，看是不是 25 项全过
2. 看一眼 `README.md` 的「已知限制」，避免重复
3. 带上这些信息：
   - DSH 版本（设置页能看到）
   - `node --version`
   - 记忆目录位置（`<DSH_HOME>/memory-kit/memory`）
   - `<DSH_HOME>/memory-kit/memory-kit.log` 的最后 20 行

## 提 PR

- 一个 PR 只做一件事
- 必须让 `node test/smoke.mjs` 保持 25 项全过（新功能请顺手加断言）
- 代码风格跟着现有文件走：2 空格缩进、单引号、注释写"为什么"不是"是什么"
- 不要引入依赖（这个插件的卖点就是零依赖、纯 node 内置模块）

## 本地调试

```bash
# 直接跑插件逻辑（不装进 DSH，用假 ctx）
node test/smoke.mjs

# 装到某个 profile 试
install.cmd -Profile <profile>

# 卸载：删掉 profile 里的 junction + package.json 里的 dsh-memory-kit
```

## 代码里几条硬规矩

- **任何 IO 都要 try 包住**：插件出错不能拖垮宿主
- **不要 `import` DSH 内部包**：`@deepseek-ai/*` 在插件目录里解析不到（踩过）
- **中文路径别用 `new URL(import.meta.url).pathname`**：会被 percent-encode，必须 `fileURLToPath`
- **工具必须声明 `output: { schema, render }`**，否则 DSH 直接拒收
