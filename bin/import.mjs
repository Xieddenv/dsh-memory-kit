#!/usr/bin/env node
// import.mjs —— 把别的记忆目录迁移进 dsh-memory-kit。
//
// 两种用法：
//   1) 自动探测（推荐给普通用户）：
//        node bin/import.mjs
//      会在常见位置找"看起来像记忆目录"的地方（含 persona.md + diary/ 等特征），
//      列出来让你选一个；加 --yes 直接选得分最高的那个。
//   2) 指定路径（老用法）：
//        node bin/import.mjs --from "D:\...\qq-bridge\state\memory" [--to <目标目录>] [--force]
//
// 合并规则（默认不破坏已有内容）：
//   persona.md     目标还是空白模板时才覆盖
//   style.md       按行去重后追加
//   open-loops.md  按行去重后追加
//   diary/         缺哪份复制哪份（同日期不覆盖）
//   session-log/   同上
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// 中文路径下 new URL(import.meta.url).pathname 会被 percent-encode（E:\%E7%A8%8B%E5%BA%8F\…），
// 必须用 fileURLToPath，否则这里探测的锚点目录根本不存在。
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const FORCE = args.includes('--force');
const YES = args.includes('--yes') || args.includes('-y');
const LIST_ONLY = args.includes('--list');
const DEFAULT_TO = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'memory-kit', 'memory');
const TO = path.resolve(getArg('--to', DEFAULT_TO));
const FROM = getArg('--from', '');

// ── 探测 ────────────────────────────────────────────────────────────────────
const SIGNATURE = ['persona.md', 'style.md', 'open-loops.md'];

const looksLikeMemory = (dir) => {
  try {
    const names = new Set(fs.readdirSync(dir));
    const hitSig = SIGNATURE.filter((f) => names.has(f)).length;
    const hasDiary = names.has('diary') && fs.statSync(path.join(dir, 'diary')).isDirectory();
    const hasLog = names.has('session-log') && fs.statSync(path.join(dir, 'session-log')).isDirectory();
    return hitSig >= 2 || (hitSig >= 1 && (hasDiary || hasLog));
  } catch { return false; }
};

const stats = (dir) => {
  const n = (p) => { try { return fs.readdirSync(p).filter((f) => f.endsWith('.md')).length; } catch { return 0; } };
  const chars = (p) => { try { return fs.readFileSync(p, 'utf8').length; } catch { return 0; } };
  const styleLines = (() => { try { return fs.readFileSync(path.join(dir, 'style.md'), 'utf8').split('\n').filter((l) => /^-\s/.test(l.trim())).length; } catch { return 0; } })();
  return {
    personaChars: chars(path.join(dir, 'persona.md')),
    styleLines,
    diary: n(path.join(dir, 'diary')),
    logs: n(path.join(dir, 'session-log'))
  };
};

/** 兜底：在指定根目录做有预算的 DFS，找名字叫 memory / state\memory 且"像记忆目录"的文件夹。 */
function scanForMemory(root, budgetMs = 8000, maxDepth = 6) {
  const hits = [];
  const skip = new Set(['node_modules', '.git', 'Windows', 'System32', '$Recycle.Bin', 'AppData', 'ProgramData', 'WinSxS', 'Temp', 'cache', '.pnpm-store']);
  const start = Date.now();
  let visited = 0;
  const walk = (dir, depth) => {
    if (Date.now() - start > budgetMs || visited > 40000 || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      visited++;
      if ((e.name === 'memory' || e.name === 'memories') && looksLikeMemory(p)) { hits.push(p); continue; }
      // 常见结构：<某项目>/state/memory
      if (e.name === 'state') {
        const m = path.join(p, 'memory');
        if (fs.existsSync(m) && looksLikeMemory(m)) { hits.push(m); continue; }
      }
      walk(p, depth + 1);
    }
  };
  walk(path.resolve(root), 0);
  return [...new Set(hits)];
}

/** 生成候选目录：显式路径 + 常见位置 + 从 cwd/脚本位置向上找的兄弟目录 */
function candidates() {
  const home = os.homedir();
  const list = [];
  const add = (p) => { if (p) list.push(path.resolve(p)); };

  // 常见位置
  add(path.join(home, '.dsh', 'memory-kit', 'memory'));      // 插件自己的（会作为"当前"排除）
  add(path.join(home, '.dsh', 'memory'));
  add(path.join(process.cwd(), 'memory'));
  add(path.join(process.cwd(), 'state', 'memory'));
  add(path.join(process.cwd(), 'qq-bridge', 'state', 'memory'));

  // 从 cwd 和脚本所在目录向上走 4 层，扫它们的子目录深度 3
  const anchors = [process.cwd(), SCRIPT_DIR];
  for (const anchor of anchors) {
    let cur = anchor;
    for (let up = 0; up < 4; up++) {
      for (const g of ['memory', 'state/memory', 'qq-bridge/state/memory', '.dsh/memory-kit/memory']) {
        add(path.join(cur, g));
      }
      // 扫一层子目录里的 memory
      try {
        for (const d of fs.readdirSync(cur, { withFileTypes: true })) {
          if (d.isDirectory() && !d.name.startsWith('.')) {
            add(path.join(cur, d.name, 'memory'));
            add(path.join(cur, d.name, 'state', 'memory'));
          }
        }
      } catch {}
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return [...new Set(list)];
}

function detect() {
  // 永远排除"插件自己的记忆目录"：既包括当前目标，也包括默认目标。
  // 否则用户用过几天再跑探测，会把插件自己的记忆当成"旧记忆"选出来（自己导自己）。
  const exclude = new Set([
    TO.toLowerCase(),
    path.resolve(DEFAULT_TO).toLowerCase()
  ]);
  const found = [];
  for (const dir of candidates()) {
    const key = dir.toLowerCase();
    if (exclude.has(key)) continue;
    if (!fs.existsSync(dir)) continue;
    if (!looksLikeMemory(dir)) continue;
    const s = stats(dir);
    const score = (s.personaChars > 200 ? 3 : 0) + (s.diary > 0 ? 2 : 0) + (s.logs > 0 ? 1 : 0) + Math.min(2, Math.floor(s.styleLines / 5));
    found.push({ dir, ...s, score });
  }
  return found.sort((a, b) => b.score - a.score);
}

// ── 合并 ────────────────────────────────────────────────────────────────────
const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };

function importFrom(src) {
  const SRC = path.resolve(src);
  if (!fs.existsSync(SRC)) { console.error(`源目录不存在：${SRC}`); process.exit(1); }
  if (!fs.existsSync(TO)) { fs.mkdirSync(TO, { recursive: true }); console.log(`已建目标目录：${TO}`); }
  const copied = [];

  const dstPersona = path.join(TO, 'persona.md');
  const srcPersona = read(path.join(SRC, 'persona.md'));
  const personaIsTemplate = !fs.existsSync(dstPersona) || /（填她的名字）|（填你的称呼）/.test(read(dstPersona));
  if (srcPersona.trim() && (personaIsTemplate || FORCE)) {
    fs.writeFileSync(dstPersona, srcPersona, 'utf8');
    copied.push('persona.md');
    console.log('✓ persona.md 已导入（人设/称呼/禁忌）');
  } else if (srcPersona.trim()) {
    console.log('· persona.md 目标已有人设，跳过（要强制覆盖加 --force）');
  }

  for (const [file, re] of [['style.md', /^-\s/], ['open-loops.md', /^- \[/]]) {
    const srcLines = read(path.join(SRC, file)).split('\n').filter((l) => re.test(l.trim())).map((l) => l.trim());
    if (!srcLines.length) { console.log(`· ${file} 源里没有内容`); continue; }
    const dstFile = path.join(TO, file);
    const have = new Set(read(dstFile).split('\n').map((l) => l.trim()).filter(Boolean));
    const add = srcLines.filter((l) => !have.has(l) || FORCE);
    if (add.length) {
      fs.appendFileSync(dstFile, (fs.existsSync(dstFile) && read(dstFile).trim() ? '\n' : '') + add.join('\n') + '\n', 'utf8');
      copied.push(`${file}(+${add.length})`);
      console.log(`✓ ${file} 追加 ${add.length} 条`);
    } else console.log(`· ${file} 已是最新，无新增`);
  }

  for (const sub of ['diary', 'session-log']) {
    const srcDir = path.join(SRC, sub);
    if (!fs.existsSync(srcDir)) { console.log(`· ${sub}/ 源里没有`); continue; }
    const dstDir = path.join(TO, sub);
    fs.mkdirSync(dstDir, { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith('.md'))) {
      const dst = path.join(dstDir, f);
      if (fs.existsSync(dst) && !FORCE) continue;
      fs.copyFileSync(path.join(srcDir, f), dst);
      n++;
    }
    if (n) { copied.push(`${sub}(+${n})`); console.log(`✓ ${sub}/ 复制 ${n} 份`); }
    else console.log(`· ${sub}/ 已存在，跳过`);
  }

  console.log(`\n完成。来源：${SRC}`);
  console.log(`目标：${TO}`);
  console.log(copied.length ? `导入：${copied.join(', ')}` : '没有可导入的内容');
  console.log('\n重启 DSH 后生效（插件每 60 秒也会自己刷新一次注入）。');
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
function describe(c) {
  return `${c.dir}\n      人设 ${c.personaChars} 字 · 规则 ${c.styleLines} 条 · 日记 ${c.diary} 天 · 存档 ${c.logs} 份`;
}

async function main() {
  if (FROM) return importFrom(FROM);

  // --scan <root>：快速探测找不到时，用有预算的 DFS 深度扫一个盘/目录
  const scanRoot = getArg('--scan', '');
  let found = detect();
  if (scanRoot) {
    console.log(`正在深扫 ${path.resolve(scanRoot)}（有预算，别急）…\n`);
    const deep = scanForMemory(scanRoot).filter((d) => d.toLowerCase() !== path.resolve(DEFAULT_TO).toLowerCase());
    const seen = new Set(found.map((c) => path.resolve(c.dir).toLowerCase()));
    for (const d of deep) {
      if (seen.has(d.toLowerCase())) continue;
      const s = stats(d);
      found.push({ dir: d, ...s, score: (s.personaChars > 200 ? 3 : 0) + (s.diary > 0 ? 2 : 0) + (s.logs > 0 ? 1 : 0) });
    }
    found.sort((a, b) => b.score - a.score);
  }

  console.log(`正在找旧记忆目录…（目标：${TO}）\n`);
  if (!found.length) {
    console.log('没找到任何像"记忆目录"的地方。');
    console.log('三种办法：');
    console.log('  1) 直接指定路径：node bin/import.mjs --from <旧记忆目录>');
    console.log('  2) 深扫一个盘：  node bin/import.mjs --scan D:\\');
    console.log('  3) 先看看常见位置：不加参数再跑一次（本命令就是）\n');
    console.log('一个记忆目录通常长这样：persona.md / style.md / diary/ / session-log/');
    process.exit(0);
  }

  found.slice(0, 8).forEach((c, i) => console.log(`  [${i + 1}] ${describe(c)}\n`));

  if (LIST_ONLY) return;
  const best = found[0];
  if (YES) { console.log(`→ 自动选择得分最高的：${best.dir}\n`); return importFrom(best.dir); }

  if (!process.stdin.isTTY) {
    console.log('（非交互环境）加 --yes 自动导入第一个，或用 --from 指定路径。');
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((res) => rl.question(`选哪个？回车=第 1 个，输入序号，q 退出：`, res));
  rl.close();
  const s = String(ans).trim();
  if (/^q$/i.test(s)) return;
  const idx = s === '' ? 1 : Number(s);
  if (!Number.isFinite(idx) || idx < 1 || idx > found.length) return console.log('序号不对，什么都没做。');
  return importFrom(found[idx - 1].dir);
}

main().catch((e) => { console.error('出错了：', e?.message ?? e); process.exit(1); });
