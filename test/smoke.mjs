#!/usr/bin/env node
// smoke.mjs —— 不依赖任何人，自动验证"装完就能用"。
//
// 模拟一次全新安装：给插件一个空目录 + 假的 ctx，然后断言：
//   1. 五层记忆文件/目录都建出来了
//   2. 注入文本里有人设、日记、规则、未了结、记忆维护指引
//   3. 全新安装时带【第一次见面】引导；填完人设+日记后引导消失
//   4. 三个工具都注册成功（含 output 声明，否则 DSH 会拒）
//   5. memory_write → memory_read → memory_search 闭环能跑通
//
// 用法：node test/smoke.mjs
// 退出码 0 = 全过。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ⚠️ 别用 new URL(import.meta.url).pathname：中文路径会被 percent-encode（E:\%E7%A8%8B%E5%BA%8F\…），
// 导致 lib/index.js 找不到。必须用 fileURLToPath。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'lib', 'index.js');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`); }
};

function makeCtx() {
  const sections = [];
  const tools = [];
  const ctx = {
    systemPrompt: { section: (s) => { sections.push(s); return () => { sections.pop(); }; } },
    tools: { register: (t) => { tools.push(t); return () => { tools.pop(); }; } }
  };
  return { ctx, sections, tools };
}

console.log('dsh-memory-kit smoke test\n');
const mod = await import(pathToFileURL(ENTRY).href + '?t=' + Date.now());
ok('模块导出 name / apply / inject', mod.name === 'dsh-memory-kit' && typeof mod.apply === 'function' && Array.isArray(mod.inject), `inject=${JSON.stringify(mod.inject)}`);

// ── 场景 1：全新安装 ──────────────────────────────────────────────────────
const MEM = path.join(os.tmpdir(), 'mk-smoke-' + Date.now());
fs.rmSync(MEM, { recursive: true, force: true });
const A = makeCtx();
mod.apply(A.ctx, { dir: MEM, refreshSeconds: 999999 });

console.log('\n[1] 全新安装');
ok('persona.md 已建', fs.existsSync(path.join(MEM, 'persona.md')));
ok('style.md 已建', fs.existsSync(path.join(MEM, 'style.md')));
ok('open-loops.md 已建', fs.existsSync(path.join(MEM, 'open-loops.md')));
ok('diary/ 已建', fs.existsSync(path.join(MEM, 'diary')) && fs.statSync(path.join(MEM, 'diary')).isDirectory());
ok('session-log/ 已建', fs.existsSync(path.join(MEM, 'session-log')) && fs.statSync(path.join(MEM, 'session-log')).isDirectory());

const text1 = A.sections[0]?.text ?? '';
ok('注入了人设段', text1.includes('【长期记忆 · 人设卡】'));
ok('注入了日记段', text1.includes('【最近日记】'));
ok('注入了规则段', text1.includes('【风格笔记】'));
ok('注入了未了结段', text1.includes('【还没了结的事】'));
ok('注入了记忆维护指引', text1.includes('【记忆维护'));
ok('全新安装带【第一次见面】引导', text1.includes('【第一次见面'));
ok('三个工具都注册了', A.tools.length === 3, A.tools.map((t) => t.name).join(','));
ok('工具都带 output 声明', A.tools.every((t) => t.output && t.output.schema && typeof t.output.render === 'function'));

// ── 场景 2：工具闭环 ──────────────────────────────────────────────────────
console.log('\n[2] 工具闭环');
const write = A.tools.find((t) => t.name === 'memory_write');
const read = A.tools.find((t) => t.name === 'memory_read');
const search = A.tools.find((t) => t.name === 'memory_search');

const w1 = await write.execute({ what: 'persona', content: '# 她是谁\n\n- 名字：小鲸\n- 我叫：谢哥\n- 绝对不要：用感叹号刷屏' });
ok('memory_write(persona)', w1.ok === true);
const w2 = await write.execute({ what: 'diary', content: '今天认识了谢哥，他让我别刷屏。' });
ok('memory_write(diary)', w2.ok === true);
const w3 = await write.execute({ what: 'style', content: '他嫌啰嗦时，一句话给结论就停' });
ok('memory_write(style)', w3.ok === true);
const w4 = await write.execute({ what: 'loops', content: '约定：明天提醒他带伞' });
ok('memory_write(loops)', w4.ok === true);

const r1 = await read.execute({ what: 'diary' });
ok('memory_read(diary) 能读回刚写的内容', r1.ok && r1.content.includes('谢哥'));
const s1 = await search.execute({ query: '谢哥 伞' });
ok('memory_search 能搜到（≥2 条）', s1.ok && s1.total >= 2, `total=${s1.total}`);

// ── 场景 3：填过记忆之后，首次引导应消失 ─────────────────────────────────
console.log('\n[3] 二次加载（已有记忆）');
const B = makeCtx();
mod.apply(B.ctx, { dir: MEM, refreshSeconds: 999999 });
const text2 = B.sections[0]?.text ?? '';
ok('不再提示【第一次见面】', !text2.includes('【第一次见面'));
ok('人设已替换成真实内容', text2.includes('小鲸') && !text2.includes('（填她的名字）'));
ok('风格规则已注入', text2.includes('一句话给结论就停'));
ok('未了结事项已注入', text2.includes('约定：明天提醒他带伞'));
ok('第二次注入比第一次短或相当', text2.length <= text1.length + 200, `${text1.length} → ${text2.length} 字`);

// 清理
try { fs.rmSync(MEM, { recursive: true, force: true }); } catch {}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
