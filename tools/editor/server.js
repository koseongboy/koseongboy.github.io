#!/usr/bin/env node
/*
 * 로컬 편집 서버 — 포트폴리오 내용을 브라우저에서 직접 수정합니다.
 *
 *   실행:  node tools/editor/server.js   (또는 루트의 edit.cmd 더블클릭)
 *   접속:  http://localhost:4000
 *
 * - HTML 페이지에 편집기 스크립트를 주입해서 보여줍니다 (원본 파일에는 넣지 않음).
 * - 보기 모드 / 편집 모드 전환. 파일이 바뀌면(직접 수정, Claude 수정 등) 열린 화면에 바로 반영됩니다.
 * - 저장하면 해당 .html 파일을 덮어쓰고, 업로드한 이미지는 assets/img/ 에 저장합니다.
 * - 외부 의존성 없음. 내 컴퓨터(127.0.0.1)에서만 접속됩니다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const blog = require('../blog/build.js');

const ROOT = path.resolve(__dirname, '..', '..');
const EDITOR_DIR = __dirname;
const IMG_DIR = path.join(ROOT, 'assets', 'img');
const PORT = Number(process.env.PORT) || 4000;
const HOST = '127.0.0.1';
const MAX_UPLOAD = 20 * 1024 * 1024;

const BLOCKED_DIRS = ['.git', 'references', 'tools', 'node_modules', '_site'];
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const INJECT =
  '<link rel="stylesheet" href="/__editor/editor.css" data-editor>\n' +
  '<script src="/__editor/editor.js" data-editor defer></script>\n';

/** URL 경로를 저장소 안의 실제 파일 경로로 바꿉니다. 저장소 밖이나 막힌 폴더면 null. */
function resolveSitePath(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  const abs = path.resolve(ROOT, '.' + path.posix.normalize('/' + p));
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const first = rel.split(path.sep)[0];
  if (BLOCKED_DIRS.includes(first)) return null;
  return abs;
}

/** 사이트 안의 모든 .html 페이지 목록 (편집기 페이지 이동 메뉴용). */
function listPages() {
  const pages = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || BLOCKED_DIRS.includes(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.name.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(ent.name)) {
        const html = fs.readFileSync(abs, 'utf8');
        const m = html.match(/<title>([^<]*)<\/title>/i);
        pages.push({ path: '/' + path.relative(ROOT, abs).split(path.sep).join('/'), title: m ? m[1] : ent.name });
      }
    }
  };
  walk(ROOT);
  return pages.sort((a, b) => (a.path === '/index.html' ? -1 : b.path === '/index.html' ? 1 : a.path.localeCompare(b.path)));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('파일이 너무 큽니다 (최대 20MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

/** 업로드 파일명을 안전하게 정리하고, 같은 이름이 있으면 -1, -2 ... 를 붙입니다. */
function uniqueImageName(original, dir = IMG_DIR) {
  const ext = path.extname(original).toLowerCase();
  let base = path.basename(original, path.extname(original))
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image';
  // 붙여넣기한 이미지는 이름이 'image.png' 라서 날짜를 붙여 구분
  if (base === 'image') base = 'image-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  let name = base + ext;
  for (let i = 1; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}${ext}`;
  return name;
}

/* ---------------- 실시간 반영: 파일 변경 감지 → 브라우저에 알림 (Server-Sent Events) ---------------- */
const sseClients = new Set();
const selfWrites = new Map();          // '/path' → { by: clientId, t } : 편집기가 직접 저장한 파일 표시
const WATCH_EXT = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
let pendingChanges = new Set();
let flushTimer = null;

function markSelfWrite(abs, clientId) {
  if (!clientId) return;
  selfWrites.set('/' + path.relative(ROOT, abs).split(path.sep).join('/'), { by: String(clientId), t: Date.now() });
}

function broadcastChanges() {
  flushTimer = null;
  const files = [...pendingChanges].map((p) => {
    const w = selfWrites.get(p);
    return { path: p, by: w && Date.now() - w.t < 3000 ? w.by : null };
  });
  pendingChanges = new Set();
  if (!files.length) return;
  const msg = `event: change\ndata: ${JSON.stringify(files)}\n\n`;
  for (const res of sseClients) res.write(msg);
  console.log('  변경 감지  ' + files.map((f) => f.path.slice(1)).join(', '));
}

function startWatcher() {
  try {
    fs.watch(ROOT, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.split(path.sep).join('/');
      const first = rel.split('/')[0];
      const isEditorFile = rel.startsWith('tools/editor/') && /\.(js|css)$/.test(rel) && !rel.endsWith('server.js');
      if (!isEditorFile && (first.startsWith('.') || BLOCKED_DIRS.includes(first))) return;
      if (!WATCH_EXT.has(path.extname(rel).toLowerCase())) return;
      // 편집기 자체 파일(editor.js/css)은 브라우저에서 /__editor/ 경로로 불러오므로 그 경로로 알림
      pendingChanges.add(isEditorFile ? '/__editor/' + path.basename(rel) : '/' + rel);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(broadcastChanges, 150);
    });
  } catch (err) {
    console.warn('  (파일 변경 감지를 켤 수 없어요: ' + err.message + ')');
  }
}

/* ---------------- Git (커밋 & 푸시) ---------------- */
function git(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split('\n').slice(-3).join(' ')));
      else resolve(stdout);
    });
  });
}

/** 바뀐 파일 목록. suggested = 기본으로 체크할지 (임시저장 글·관련 없는 새 파일은 기본 해제) */
async function gitStatus() {
  const [branchOut, raw] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['status', '--porcelain=v1', '-z', '-uall']),
  ]);
  const parts = raw.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const code = e.slice(0, 2);
    const p = e.slice(3);
    if (code[0] === 'R' || code[0] === 'C') i++;          // 이름 변경: 다음 항목은 옛 경로
    const untracked = code === '??';
    let kind = untracked ? '새 파일' : code.includes('D') ? '삭제' : '수정';
    let suggested = true;
    let note = '';
    if (p.startsWith('posts/') && p.endsWith('.md')) {
      try {
        const { meta } = blog.parseSource(fs.readFileSync(path.join(ROOT, p), 'utf8'));
        if (meta.draft) { suggested = false; note = '임시저장 글 (공개 저장소에 올라가요)'; }
      } catch {}
    } else if (untracked && !p.startsWith('posts/') && !p.startsWith('assets/img/posts/')) {
      // 글/글 이미지 말고 새로 생긴 파일은 직접 확인하고 체크하도록
      suggested = IMAGE_EXT.has(path.extname(p).toLowerCase()) ? isReferenced(p) : false;
      if (!suggested) note = '어느 페이지에서도 쓰지 않는 새 파일';
    }
    files.push({ path: p, code, kind, suggested, note });
  }
  return { branch: branchOut.trim(), files };
}

/** 새 이미지가 사이트 HTML 어딘가에서 쓰이는지 */
function isReferenced(rel) {
  const name = path.basename(rel);
  return listPages().some((page) => {
    try { return fs.readFileSync(path.join(ROOT, page.path), 'utf8').includes(name); } catch { return false; }
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/__editor/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    sseClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  /* ---------- 블로그 글쓰기 ---------- */
  if (req.method === 'GET' && (url.pathname === '/__editor/write' || url.pathname === '/__editor/write/')) {
    return send(res, 200, fs.readFileSync(path.join(EDITOR_DIR, 'write.html')), MIME['.html']);
  }

  if (req.method === 'GET' && url.pathname === '/__editor/posts') {
    const posts = blog.readPosts().map((p) => ({
      slug: p.slug, title: p.title, date: p.date, category: p.category, tags: p.tags, draft: p.draft,
      published: !p.draft && p.body != null,
    }));
    return send(res, 200, posts);
  }

  if (req.method === 'GET' && url.pathname === '/__editor/post') {
    const slug = url.searchParams.get('slug') || '';
    const file = path.join(blog.POSTS_DIR, slug + '.md');
    if (!blog.SLUG_RE.test(slug) || !fs.existsSync(file)) return send(res, 404, { error: '글을 찾을 수 없어요: ' + slug });
    const { meta, markdown } = blog.parseSource(fs.readFileSync(file, 'utf8'));
    return send(res, 200, { slug, meta: blog.normalizeMeta(meta), markdown });
  }

  if (req.method === 'POST' && url.pathname === '/__editor/post') {
    const body = JSON.parse((await readBody(req, 10 * 1024 * 1024)).toString('utf8'));
    const slug = String(body.slug || '').normalize('NFC').trim();
    const original = String(body.originalSlug || '').normalize('NFC').trim();
    if (!blog.SLUG_RE.test(slug)) return send(res, 400, { error: '글 주소는 한글·영문·숫자·-·_ 만 쓸 수 있어요 (공백 불가)' });
    if (original && !blog.SLUG_RE.test(original)) return send(res, 400, { error: '잘못된 원래 주소' });
    const mdPath = path.join(blog.POSTS_DIR, slug + '.md');
    if (slug !== original && fs.existsSync(mdPath)) return send(res, 409, { error: '같은 주소의 글이 이미 있어요: ' + slug });
    const meta = blog.normalizeMeta({ ...body.meta, draft: !!body.draft });
    if (!String(body.meta && body.meta.title || '').trim()) return send(res, 400, { error: '제목을 입력해 주세요' });
    fs.mkdirSync(blog.POSTS_DIR, { recursive: true });
    fs.writeFileSync(mdPath, blog.serializeSource(meta, body.markdown), 'utf8');
    if (original && original !== slug) {
      for (const ext of ['.md', '.html']) {
        const old = path.join(blog.POSTS_DIR, original + ext);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }
    }
    const result = blog.buildAll({ bodies: { [slug]: String(body.html || '') } });
    console.log(`  글 ${meta.draft ? '임시저장' : '발행'}  posts/${slug}  (발행 ${result.published}개)`);
    return send(res, 200, { ok: true, slug, url: meta.draft ? null : `/posts/${encodeURIComponent(slug)}.html` });
  }

  if (req.method === 'POST' && url.pathname === '/__editor/post/delete') {
    const { slug } = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
    if (!blog.SLUG_RE.test(String(slug || ''))) return send(res, 400, { error: '잘못된 주소' });
    for (const ext of ['.md', '.html']) {
      const f = path.join(blog.POSTS_DIR, slug + ext);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    blog.buildAll();
    console.log('  글 삭제  posts/' + slug);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/__editor/pages') {
    return send(res, 200, listPages());
  }

  if (req.method === 'POST' && url.pathname === '/__editor/save') {
    const { page, html, clientId } = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8'));
    const abs = resolveSitePath(page === '/' ? '/index.html' : page);
    if (!abs || !abs.endsWith('.html') || !fs.existsSync(abs)) return send(res, 400, { error: '저장할 수 없는 경로입니다: ' + page });
    if (typeof html !== 'string' || !/^<!doctype html>/i.test(html)) return send(res, 400, { error: 'HTML 형식이 올바르지 않습니다' });
    const clean = html.split(INJECT).join('');
    markSelfWrite(abs, clientId);
    fs.writeFileSync(abs, clean, 'utf8');
    console.log('  저장됨  ' + path.relative(ROOT, abs));
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/__editor/upload') {
    const original = url.searchParams.get('name') || 'image.png';
    if (!IMAGE_EXT.has(path.extname(original).toLowerCase())) return send(res, 400, { error: 'png, jpg, gif, webp 이미지만 넣을 수 있어요' });
    const data = await readBody(req, MAX_UPLOAD);
    const sub = url.searchParams.get('dir') === 'posts' ? 'posts' : '';   // 블로그 글 이미지는 assets/img/posts/
    const dir = sub ? path.join(IMG_DIR, sub) : IMG_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const name = uniqueImageName(original, dir);
    markSelfWrite(path.join(dir, name), url.searchParams.get('clientId'));
    fs.writeFileSync(path.join(dir, name), data);
    const rel = 'assets/img/' + (sub ? sub + '/' : '') + name;
    console.log('  이미지  ' + rel);
    return send(res, 200, { path: rel });
  }

  if (req.method === 'GET' && url.pathname === '/__editor/git/status') {
    return send(res, 200, await gitStatus());
  }

  if (req.method === 'POST' && url.pathname === '/__editor/git/publish') {
    const { files, message } = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
    const msg = String(message || '').trim();
    if (!msg) return send(res, 400, { error: '커밋 메시지를 입력해 주세요' });
    if (!Array.isArray(files) || !files.length) return send(res, 400, { error: '올릴 파일을 하나 이상 골라 주세요' });
    // 지금 실제로 바뀐 파일만 허용 (임의 경로 커밋 방지)
    const changed = new Set((await gitStatus()).files.map((f) => f.path));
    const bad = files.filter((f) => !changed.has(f));
    if (bad.length) return send(res, 400, { error: '변경 목록에 없는 파일이에요: ' + bad.join(', ') });
    try {
      await git(['add', '-A', '--', ...files]);
      await git(['commit', '-m', msg, '--', ...files]);
      const head = (await git(['log', '-1', '--format=%h'])).trim();
      console.log(`  커밋됨  ${head}  ${msg}`);
      try {
        await git(['push', 'origin', 'HEAD']);
      } catch (err) {
        return send(res, 500, { error: `커밋(${head})은 됐지만 푸시에 실패했어요: ${err.message}`, committed: head });
      }
      console.log('  푸시 완료');
      return send(res, 200, { ok: true, commit: head });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  if (req.method === 'GET' && /^\/__editor\/(editor|write)\.(js|css)$/.test(url.pathname)) {
    const file = path.join(EDITOR_DIR, path.basename(url.pathname));
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)]);
  }

  return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/__editor/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', 'text/plain');

    let abs = resolveSitePath(url.pathname);
    if (abs && fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html');
    if (!abs || !fs.existsSync(abs)) return send(res, 404, '404 Not Found', 'text/plain; charset=utf-8');

    const ext = path.extname(abs).toLowerCase();
    if (ext === '.html') {
      const html = fs.readFileSync(abs, 'utf8');
      const out = html.includes('</body>') ? html.replace('</body>', INJECT + '</body>') : html + INJECT;
      return send(res, 200, out, MIME['.html']);
    }
    return send(res, 200, fs.readFileSync(abs), MIME[ext] || 'application/octet-stream');
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: String(err.message || err) });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n포트 ${PORT} 이 이미 사용 중이에요. 다른 포트로 실행하려면:  set PORT=4001 && node tools/editor/server.js\n`);
  } else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  startWatcher();
  const link = `http://localhost:${PORT}/`;
  console.log('\n  포트폴리오 편집 서버 실행 중 (보기 / 편집 모드, 실시간 반영)');
  console.log('  ' + link);
  console.log('  종료: Ctrl+C\n');
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
    exec(cmd, () => {});
  }
});
