// dsh-memory-kit —— 让 DSH 里的机器人不再健忘（完整版）。
//
// 五层记忆（纯文本、不联网、无数据库）：
//   persona.md      她是谁（注入 ≤700 字）
//   style.md        说话规则（注入最后 12 条）
//   diary/<日期>.md  情节记忆（注入最近 7 天索引）
//   session-log/    会话存档（注入最近一份的要点 + 尾部）
//   open-loops.md   还没了结的事（注入最后 5 条）
//
// 装完就灵：启动时建目录 + 模板；可选 importFrom 从旧记忆目录迁移；
// 把记忆拼进 system prompt；给模型 memory_read / memory_write / memory_search 三个工具。
//
// 设计原则：插件出任何错都不能拖垮宿主——所有 IO 都包 try，失败只写诊断日志。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const name = 'dsh-memory-kit';
// 只注入真正用到的两个服务（访问未注入的服务在 cordis 里会直接抛错——踩过）
export const inject = ['systemPrompt', 'tools'];

const SECTION_ORDER = 120;

const TPL_PERSONA = `# 她是谁

- 名字：（填她的名字）
- 我叫：（填你的称呼）
- 关系：（朋友 / 助手 / 伴侣…，一句话）
- 说话风格：（举例：懒散、短句、不客服腔）
- 绝对不要：（举例：别用感叹号刷屏、别叫「主人」）

## 最近的背景

（1~3 条现在还没过期的背景：在赶什么项目、最近有什么约定）
`;

const TPL_STYLE = `# 风格笔记（模型自己往这里加规则）

# 每行一条，格式：- [MM-DD] 一条能照着做的规则
# 好例：- [10-26] 他问推荐时先反问一句，别立刻给清单
# 坏例：- [10-26] 要更自然
`;

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true };
// render 必须返回「内容块数组」——宿主会对它做 content.some(...)，
// 返回裸字符串会抛 "content.some is not a function"（调用工具时踩过）。
const render = (args, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return [{ type: 'text', text: text ?? '' }];
};

export function apply(ctx, config) {
  const cfg = {
    dir: config?.dir || '',
    personaMaxChars: Number(config?.personaMaxChars) || 700,
    styleTailLines: Number(config?.styleTailLines) || 12,
    diaryIndexDays: Number(config?.diaryIndexDays) || 7,
    openLoopsTailLines: Number(config?.openLoopsTailLines) || 5,
    refreshSeconds: Math.max(10, Number(config?.refreshSeconds) || 60),
    importFrom: String(config?.importFrom || '')
  };

  const MEM = cfg.dir
    ? path.resolve(cfg.dir)
    : path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'memory-kit', 'memory');
  const DIAG = path.join(path.dirname(MEM), 'memory-kit.log');

  const diag = (msg) => {
    try {
      fs.mkdirSync(path.dirname(DIAG), { recursive: true });
      fs.appendFileSync(DIAG, '[' + new Date().toISOString() + '] ' + msg + '\n');
    } catch {}
  };
  const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };
  const writeIfAbsent = (p, c) => {
    try {
      if (fs.existsSync(p)) return false;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, c, 'utf8');
      return true;
    } catch (e) { diag('init failed ' + p + ': ' + (e?.message ?? e)); return false; }
  };
  const todayKey = (offset = 0) => {
    const d = new Date(Date.now() + offset * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // ── 目录与模板 ──────────────────────────────────────────────────────────
  try {
    fs.mkdirSync(path.join(MEM, 'diary'), { recursive: true });
    fs.mkdirSync(path.join(MEM, 'session-log'), { recursive: true });
    writeIfAbsent(path.join(MEM, 'persona.md'), TPL_PERSONA);
    writeIfAbsent(path.join(MEM, 'style.md'), TPL_STYLE);
    writeIfAbsent(path.join(MEM, 'open-loops.md'), '');
    diag('memory dir = ' + MEM);
  } catch (e) { diag('init dir failed: ' + (e?.message ?? e)); }

  // ── 可选：从旧记忆目录迁移（只补空缺，不覆盖已有内容） ──────────────────
  function importFrom(src) {
    const from = String(src || '').trim();
    if (!from) return { ok: false, reason: 'importFrom 为空' };
    const SRC = path.resolve(from);
    if (!fs.existsSync(SRC)) return { ok: false, reason: '目录不存在：' + SRC };
    const copied = [];
    const isTemplate = (file) => /（填她的名字）|（填你的称呼）/.test(read(file));
    try {
      if (isTemplate(path.join(MEM, 'persona.md'))) {
        const srcPersona = read(path.join(SRC, 'persona.md'));
        if (srcPersona.trim()) {
          fs.writeFileSync(path.join(MEM, 'persona.md'), srcPersona, 'utf8');
          copied.push('persona.md');
        }
      }
    } catch (e) { diag('import persona failed: ' + (e?.message ?? e)); }
    for (const [file, re] of [['style.md', /^-\s/], ['open-loops.md', /^- \[/]]) {
      try {
        const srcLines = read(path.join(SRC, file)).split('\n').filter((l) => re.test(l.trim()));
        if (!srcLines.length) continue;
        const dstFile = path.join(MEM, file);
        const have = new Set(read(dstFile).split('\n').map((l) => l.trim()).filter(Boolean));
        const add = srcLines.map((l) => l.trim()).filter((l) => !have.has(l));
        if (add.length) {
          fs.appendFileSync(dstFile, add.join('\n') + '\n', 'utf8');
          copied.push(file + '(+' + add.length + ')');
        }
      } catch (e) { diag('import ' + file + ' failed: ' + (e?.message ?? e)); }
    }
    for (const sub of ['diary', 'session-log']) {
      try {
        const srcDir = path.join(SRC, sub);
        if (!fs.existsSync(srcDir)) continue;
        const dstDir = path.join(MEM, sub);
        fs.mkdirSync(dstDir, { recursive: true });
        let n = 0;
        for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith('.md'))) {
          const dst = path.join(dstDir, f);
          if (fs.existsSync(dst)) continue;
          fs.copyFileSync(path.join(srcDir, f), dst);
          n++;
        }
        if (n) copied.push(sub + '(+' + n + ')');
      } catch (e) { diag('import ' + sub + ' failed: ' + (e?.message ?? e)); }
    }
    diag('imported from ' + SRC + ': ' + (copied.join(', ') || '没有可导入的内容'));
    return { ok: true, from: SRC, copied };
  }

  if (cfg.importFrom) {
    try { diag('import result: ' + JSON.stringify(importFrom(cfg.importFrom))); }
    catch (e) { diag('import failed: ' + (e?.message ?? e)); }
  }

  // ── 拼注入文本 ──────────────────────────────────────────────────────────
  function compose() {
    const persona = read(path.join(MEM, 'persona.md')).trim().slice(0, cfg.personaMaxChars);
    const style = read(path.join(MEM, 'style.md')).split('\n').filter((l) => /^-\s/.test(l.trim())).slice(-cfg.styleTailLines);
    const loops = read(path.join(MEM, 'open-loops.md')).split('\n').filter((l) => /^- \[/.test(l.trim())).slice(-cfg.openLoopsTailLines);

    const diary = [];
    for (let i = 0; i < cfg.diaryIndexDays; i++) {
      const key = todayKey(-i);
      const text = read(path.join(MEM, 'diary', key + '.md'))
        .replace(/^\s*(?:#[^\n]*\n)+/, '')
        .replace(/\n---[\s\S]*$/, '')
        .trim();
      if (!text) continue;
      diary.push('[' + key.slice(5) + '] ' + text.replace(/\s+/g, ' ').slice(0, i < 2 ? 120 : 48));
    }

    let logTail = '';
    try {
      const dir = path.join(MEM, 'session-log');
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
      if (files.length) {
        const body = read(path.join(dir, files[files.length - 1])).split('\n');
        const i = body.findIndex((l) => l.startsWith('## 这次聊了什么'));
        let kp = [];
        if (i >= 0) {
          const seg = [];
          for (const l of body.slice(i + 1)) { if (/^##\s/.test(l)) break; seg.push(l); }
          kp = seg.filter((l) => l.startsWith('- ')).slice(0, 3);
        }
        const tail = body.filter((l) => l.startsWith('- [')).slice(-10);
        const seen = new Set();
        const merged = [...kp, ...tail].filter((l) => {
          const k = l.trim().replace(/^-?\s*\[\d{2}:\d{2}\]\s*/, '').replace(/^-\s*/, '');
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        if (merged.length) logTail = merged.join('\n');
      }
    } catch {}

    const parts = [];
    parts.push('【长期记忆 · 人设卡】这是你对自己的认知，跨会话不变：\n\n' + (persona || '（还没有人设卡：memory/persona.md）'));
    parts.push('【最近日记】你每天记的一两句，越近越细：\n\n' + (diary.length ? diary.join('\n') : '（还没有日记记录）'));
    if (logTail) parts.push('【上次会话的存档】你换脑子前记下的，可以当真：\n' + logTail);
    parts.push('【风格笔记】你自己复盘时记下的说话规则，照做，别背出来：\n\n' + (style.length ? style.join('\n') : '（还没有规则）'));
    parts.push('【还没了结的事】你答应过 / 提到过、但还没做完的：\n\n' + (loops.length ? loops.join('\n') : '（暂时没有）'));
    parts.push(
'【记忆维护 · 你要自己动手】\n' +
'- 聊到值得记住的事（他的偏好、计划、当时情绪），当天用 memory_write(what="diary") 记一两句具体的。\n' +
'- 他纠正你、或你发现某种说法更管用时，用 memory_write(what="style") 加一条能照着做的规则。\n' +
'- 答应了他什么事，用 memory_write(what="loops") 单独记一行「约定：×月×日帮他做××」。\n' +
'- 想不起细节、或他问"你还记得…"时，先调 memory_search(query) 搜一遍；搜不到就说搜不到，别编。');

    // 首次使用引导：一条日记都没有 = 全新安装。光给工具没用，
    // 得明确要求它"第一轮就动手"，否则大多数模型会一直等别人让它写。
    const hasDiary = (() => {
      try { return fs.readdirSync(path.join(MEM, 'diary')).some((f) => f.endsWith('.md')); } catch { return false; }
    })();
    const personaIsTemplate = /（填她的名字）|（填你的称呼）/.test(persona);
    if (!hasDiary || personaIsTemplate) {
      parts.push(
'【第一次见面 · 现在就做】你还没有完整的记忆，这一轮请顺手完成三件事（别把它们念出来，做完自然接着聊）：\n' +
'1. 问清对方：怎么称呼他、你希望叫什么名字、你们是什么关系（一句话问完，别审问）。\n' +
'2. 拿到答案后用 memory_write(what="persona") 写一版 300 字以内的人设：名字、称呼、关系、说话风格、绝对不要做的事。\n' +
'3. 用 memory_write(what="diary") 写第一句日记：今天认识了谁、聊了什么。\n' +
'做完这些，下次会话你就不再是"刚装好的空壳"了。');
    }

    return parts.join('\n\n');
  }

  let disposeSection = null;
  let lastHash = '';
  function refresh(force) {
    try {
      const text = compose();
      const hash = crypto.createHash('sha1').update(text).digest('hex');
      if (!force && hash === lastHash) return;
      lastHash = hash;
      if (disposeSection) { try { disposeSection(); } catch {} disposeSection = null; }
      disposeSection = ctx.systemPrompt.section({ name: 'dsh-memory-kit', order: SECTION_ORDER, text });
      diag('prompt section updated（' + text.length + ' 字）');
    } catch (e) {
      diag('refresh failed: ' + (e?.stack ?? e?.message ?? e));
    }
  }
  refresh(true);
  try {
    const h = setInterval(() => refresh(false), cfg.refreshSeconds * 1000);
    if (h.unref) h.unref();
  } catch (e) { diag('interval failed: ' + (e?.message ?? e)); }

  // ── 工具 ────────────────────────────────────────────────────────────────
  const fileOf = (what, date) => {
    if (what === 'diary') return path.join(MEM, 'diary', (date || todayKey()) + '.md');
    if (what === 'style') return path.join(MEM, 'style.md');
    if (what === 'persona') return path.join(MEM, 'persona.md');
    if (what === 'loops') return path.join(MEM, 'open-loops.md');
    return null;
  };
  const registerTool = (def) => {
    try { ctx.tools.register({ ...def, output: { schema: OUTPUT_SCHEMA, render } }); diag('tool registered: ' + def.name); }
    catch (e) { diag('tool failed ' + def.name + ': ' + (e?.message ?? e)); }
  };

  registerTool({
    name: 'memory_read',
    description: '读自己的记忆。what 可选 diary / style / persona / loops；读日记可用 date=YYYY-MM-DD 指定日期。',
    parameters: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['diary', 'style', 'persona', 'loops'], description: '读哪一层记忆' },
        date: { type: 'string', description: '读日记时的日期 YYYY-MM-DD；默认今天' }
      },
      required: ['what'],
      additionalProperties: false
    },
    async execute(args = {}) {
      const file = fileOf(String(args.what || 'diary'), args.date);
      if (!file) return { ok: false, error: '未知的记忆层：' + args.what };
      const text = read(file);
      return { ok: true, what: args.what, file, chars: text.length, text: text || '（空）' };
    }
  });

  registerTool({
    name: 'memory_write',
    description: '写记忆。what=diary 写今天（或指定日期）的日记（追加）；style 追加一条说话规则；persona 覆盖人设卡；loops 追加一条「约定：…」。写完立刻生效。',
    parameters: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['diary', 'style', 'persona', 'loops'], description: '写哪一层' },
        content: { type: 'string', description: '要写入的内容' },
        date: { type: 'string', description: '写日记时的日期 YYYY-MM-DD；默认今天' }
      },
      required: ['what', 'content'],
      additionalProperties: false
    },
    async execute(args = {}) {
      const what = String(args.what || '');
      const content = String(args.content || '').trim();
      const file = fileOf(what, args.date);
      if (!file) return { ok: false, error: '未知的记忆层：' + what };
      if (!content) return { ok: false, error: 'content 不能为空' };
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (what === 'persona') {
          fs.writeFileSync(file, content + '\n', 'utf8');
        } else if (what === 'style') {
          const d = todayKey().slice(5);
          fs.appendFileSync(file, (content.startsWith('-') ? content : '- [' + d + '] ' + content) + '\n', 'utf8');
        } else if (what === 'diary') {
          const date = args.date || todayKey();
          const body = fs.existsSync(file) ? read(file) : '# ' + date + ' 日记\n\n';
          fs.writeFileSync(file, body.replace(/\s+$/, '') + '\n\n' + content + '\n\n---\n_' + new Date().toLocaleString('zh-CN') + ' 记_\n', 'utf8');
        } else {
          const date = todayKey();
          fs.appendFileSync(file, (content.startsWith('- [') ? content : '- [' + date + '] ' + content) + '\n', 'utf8');
        }
        refresh(false);
        return { ok: true, what, file, chars: content.length };
      } catch (e) {
        return { ok: false, error: '写入失败：' + (e?.message ?? e) };
      }
    }
  });

  registerTool({
    name: 'memory_search',
    description: '在自己的全部记忆里按关键词检索。回答"你还记得…"这类问题前先用它；多个关键词用空格分隔。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，多个用空格分隔' },
        limit: { type: 'number', description: '最多返回几条，默认 6' }
      },
      required: ['query'],
      additionalProperties: false
    },
    async execute(args = {}) {
      const terms = String(args.query || '').split(/[\s,，、]+/).filter(Boolean).map((t) => t.toLowerCase());
      if (!terms.length) return { ok: false, error: 'query 不能为空' };
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 6));
      const hits = [];
      const walk = (dir) => {
        let out = [];
        try {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) out = out.concat(walk(p));
            else if (e.name.endsWith('.md')) out.push(p);
          }
        } catch {}
        return out;
      };
      for (const file of walk(MEM)) {
        const rel = path.relative(MEM, file);
        read(file).split('\n').forEach((line, i) => {
          const low = line.toLowerCase();
          let score = 0;
          for (const t of terms) if (low.includes(t)) score += 1;
          if (!score) return;
          if (score === terms.length) score += 2;
          if (/style|open-loops|persona/.test(rel)) score += 0.5;
          hits.push({ rel, line: i + 1, text: line.trim().slice(0, 160), score });
        });
      }
      hits.sort((a, b) => b.score - a.score);
      return { ok: true, query: args.query, total: hits.length, hits: hits.slice(0, limit) };
    }
  });

  diag('dsh-memory-kit ready');
}
