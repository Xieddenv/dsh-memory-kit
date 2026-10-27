#!/usr/bin/env node
// import.mjs —— 把别的记忆目录迁移进 dsh-memory-kit。
//
// 典型场景：你以前用 qq-bridge 那套记忆（persona/style/diary/session-log/open-loops），
// 现在装了插件，想把老记忆搬过来，让"装完就能直接聊"。
//
// 用法：
//   node bin/import.mjs --from "D:\...\qq-bridge\state\memory"
//   node bin/import.mjs --from <旧目录> --to <插件记忆目录> [--force]
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

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const FROM = getArg('--from', '');
const FORCE = args.includes('--force');
const DEFAULT_TO = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'memory-kit', 'memory');
const TO = path.resolve(getArg('--to', DEFAULT_TO));

if (!FROM) {
  console.error('用法：node bin/import.mjs --from <旧记忆目录> [--to <目标目录>] [--force]');
  process.exit(2);
}
const SRC = path.resolve(FROM);
if (!fs.existsSync(SRC)) { console.error(`源目录不存在：${SRC}`); process.exit(1); }
if (!fs.existsSync(TO)) { fs.mkdirSync(TO, { recursive: true }); console.log(`已建目标目录：${TO}`); }

const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };
const copied = [];

// 1) persona
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

// 2) style / open-loops 追加去重
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

// 3) diary / session-log
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
