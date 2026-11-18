#!/usr/bin/env node
/*
 * 블로그 빌드 — posts/*.md(원본) 로부터
 *   - posts/<slug>.html   글 페이지 (본문 HTML은 기존 파일의 POST:BODY 영역 또는 새로 받은 본문)
 *   - index.html          대문의 글 목록 / 카테고리 / 태그 영역
 *   - sitemap.xml, feed.xml
 * 을 다시 만듭니다.
 *
 *   직접 실행:  node tools/blog/build.js
 *   (편집 서버에서 글을 발행·삭제하면 자동으로 실행됩니다)
 *
 * 글 원본 형식 (posts/<slug>.md):
 *   ---
 *   {"title": "...", "date": "2026-11-18", "category": "Unity", "tags": ["C#"], "summary": "", "cover": "", "draft": false}
 *   ---
 *   마크다운 본문...
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const POSTS_DIR = path.join(ROOT, 'posts');
const SITE = 'https://koseongboy.github.io';
const BLOG_NAME = 'KOSEONGBOY.DEV';
const AUTHOR = '고성현 (Ko Seonghyeon)';

const SLUG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u;

/* ---------------- 유틸 ---------------- */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (html) => String(html || '')
  .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const fmtDate = (d) => String(d || '').replace(/-/g, '.');
const write = (abs, text) => {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const prev = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (prev !== text) fs.writeFileSync(abs, text, 'utf8');
};

/** 글 원본(.md) 읽기/쓰기 */
function parseSource(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, markdown: text };
  let meta = {};
  try { meta = JSON.parse(m[1]); } catch { meta = {}; }
  return { meta, markdown: m[2] };
}
function serializeSource(meta, markdown) {
  return '---\n' + JSON.stringify(meta, null, 2) + '\n---\n' + String(markdown || '').replace(/\r\n/g, '\n');
}
function normalizeMeta(meta) {
  const tags = Array.isArray(meta.tags) ? meta.tags : String(meta.tags || '').split(',');
  return {
    title: String(meta.title || '').trim() || '제목 없음',
    date: /^\d{4}-\d{2}-\d{2}$/.test(meta.date || '') ? meta.date : new Date().toISOString().slice(0, 10),
    category: String(meta.category || '').trim(),
    tags: [...new Set(tags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean))],
    summary: String(meta.summary || '').trim(),
    cover: String(meta.cover || '').trim(),
    draft: !!meta.draft,
  };
}

/** 글 페이지 HTML에서 본문 영역만 꺼내기 */
function extractBody(html) {
  const m = String(html || '').match(/<!-- POST:BODY -->([\s\S]*?)<!-- \/POST:BODY -->/);
  return m ? m[1].trim() : null;
}

/** 본문 HTML 안의 이미지 경로(../assets/...)를 사이트 루트 기준(assets/...)으로 */
const toRootPath = (src) => String(src || '').replace(/^(\.\.\/)+/, '').replace(/^\//, '');
function firstImage(bodyHtml) {
  const m = String(bodyHtml || '').match(/<img[^>]+src="([^"]+)"/i);
  return m ? toRootPath(m[1]) : '';
}

/* ---------------- 글 목록 읽기 ---------------- */
function readPosts(overrides = {}) {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const posts = [];
  for (const file of fs.readdirSync(POSTS_DIR)) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);
    if (!SLUG_RE.test(slug)) continue;
    const { meta, markdown } = parseSource(fs.readFileSync(path.join(POSTS_DIR, file), 'utf8'));
    const m = normalizeMeta(meta);
    const htmlPath = path.join(POSTS_DIR, slug + '.html');
    const body = overrides[slug] != null ? overrides[slug]
      : fs.existsSync(htmlPath) ? extractBody(fs.readFileSync(htmlPath, 'utf8')) : null;
    const text = stripTags(body);
    posts.push({
      slug, ...m, markdown, body,
      summaryText: m.summary || (text.length > 140 ? text.slice(0, 140) + '…' : text),
      coverPath: m.cover || firstImage(body),
      readMin: Math.max(1, Math.round(text.length / 500)),
    });
  }
  return posts.sort((a, b) => (b.date.localeCompare(a.date)) || a.title.localeCompare(b.title));
}

/* ---------------- 템플릿 ---------------- */
// 공유(임베드) 미리보기는 모든 페이지에서 공통 이미지 하나만 사용 (tools/og/og-image.html 로 생성)
const OG_IMAGE = `${SITE}/assets/img/og-image.png`;
const OG_META = [
  `<meta property="og:site_name" content="${BLOG_NAME}">`,
  `<meta property="og:image" content="${OG_IMAGE}">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="KOSEONGBOY.DEV — 고성현 Game Client Engineer 개발 블로그 &amp; 포트폴리오">',
  '<meta name="twitter:card" content="summary_large_image">',
  `<meta name="twitter:image" content="${OG_IMAGE}">`,
].join('\n');

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%230f1328'/%3E%3Crect x='3' y='3' width='10' height='10' fill='%23f5c451'/%3E%3Crect x='6' y='6' width='4' height='4' fill='%230f1328'/%3E%3C/svg%3E";

function postPage(p, prev, next) {
  const url = `${SITE}/posts/${encodeURIComponent(p.slug)}.html`;
  const cover = p.coverPath ? `${SITE}/${p.coverPath}` : '';
  const catHref = p.category ? `../?category=${encodeURIComponent(p.category)}` : '';
  const ld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: p.title, datePublished: p.date, author: { '@type': 'Person', name: '고성현' },
    description: p.summaryText, mainEntityOfPage: url, ...(cover ? { image: cover } : {}),
  };
  const navLink = (x, label, cls) => x
    ? `<a class="${cls}" href="${esc(encodeURIComponent(x.slug))}.html"><small>${label}</small><span>${esc(x.title)}</span></a>`
    : '<span class="spacer"></span>';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} | ${BLOG_NAME}</title>
<meta name="description" content="${esc(p.summaryText)}">
<meta name="author" content="${esc(AUTHOR)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.summaryText)}">
<meta property="og:url" content="${esc(url)}">
${OG_META}
<meta property="article:published_time" content="${esc(p.date)}">
<meta name="theme-color" content="#0f1328">
<link rel="alternate" type="application/rss+xml" title="${BLOG_NAME}" href="../feed.xml">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Do+Hyeon&amp;family=JetBrains+Mono:wght@400;600&amp;family=Noto+Sans+KR:wght@400;500;700&amp;family=Silkscreen:wght@400;700&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<link rel="stylesheet" href="../assets/css/style.css">
<link rel="stylesheet" href="../assets/css/blog.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body data-page="post" data-slug="${esc(p.slug)}">

<header class="site-header">
  <nav class="container" aria-label="주요 메뉴">
    <a href="../" class="logo">${BLOG_NAME}</a>
    <div class="nav-links">
      <a href="../" aria-current="page">BLOG</a>
      <a href="../portfolio/">PORTFOLIO</a>
      <a href="https://github.com/koseongboy" target="_blank" rel="noopener">GITHUB</a>
    </div>
  </nav>
</header>

<main class="container">
  <div class="post-wrap">
    <div class="breadcrumb"><a href="../">◀ BLOG</a></div>
    <article>
      <header class="post-header">
        ${p.category ? `<div><a class="cat-badge" href="${esc(catHref)}">${esc(p.category)}</a></div>` : ''}
        <h1>${esc(p.title)}</h1>
        <div class="post-meta"><time datetime="${esc(p.date)}">${esc(fmtDate(p.date))}</time><span>·</span><span>${p.readMin}분 읽기</span></div>
        ${p.tags.length ? `<ul class="post-tags">${p.tags.map((t) => `<li><a href="../?tag=${esc(encodeURIComponent(t))}">#${esc(t)}</a></li>`).join('')}</ul>` : ''}
      </header>
      ${p.cover ? `<img class="post-cover" src="../${esc(p.cover)}" alt="${esc(p.title)} 대표 이미지">` : ''}
      <div class="post-body">
<!-- POST:BODY -->
${p.body || ''}
<!-- /POST:BODY -->
      </div>
    </article>
    <nav class="post-nav" aria-label="이전 글 / 다음 글">
      ${navLink(prev, '◀ PREV', 'prev')}
      ${navLink(next, 'NEXT ▶', 'next')}
    </nav>
  </div>
</main>

<footer class="site-footer"><p class="copyright">© 2026 KO SEONGHYEON · <a href="../feed.xml">RSS</a></p></footer>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>if (window.hljs) document.querySelectorAll('.post-body pre code').forEach(function (el) { hljs.highlightElement(el); });</script>
</body>
</html>
`;
}

function homePosts(posts) {
  if (!posts.length) {
    return `      <div class="panel empty-state" data-generated>
        <strong>NO POSTS YET</strong>
        <span>아직 작성한 글이 없어요.</span>
      </div>`;
  }
  const items = posts.map((p) => {
    const href = `posts/${encodeURIComponent(p.slug)}.html`;
    return `        <li class="post-card" data-category="${esc(p.category)}" data-tags="${esc(p.tags.join('|'))}">
          ${p.coverPath ? `<div class="post-card-thumb"><img src="${esc(p.coverPath)}" alt="" loading="lazy"></div>` : ''}
          <div class="post-card-body">
            <div class="post-meta">${p.category ? `<a class="cat-badge cat-link" href="?category=${esc(encodeURIComponent(p.category))}">${esc(p.category)}</a>` : ''}<time datetime="${esc(p.date)}">${esc(fmtDate(p.date))}</time><span>· ${p.readMin}분</span></div>
            <h3><a href="${esc(href)}">${esc(p.title)}</a></h3>
            ${p.summaryText ? `<p>${esc(p.summaryText)}</p>` : ''}
            ${p.tags.length ? `<div class="post-meta">${p.tags.map((t) => `<a class="tag-link" href="?tag=${esc(encodeURIComponent(t))}">#${esc(t)}</a>`).join('')}</div>` : ''}
          </div>
        </li>`;
  });
  return `      <ul class="post-list" data-generated>\n${items.join('\n')}\n      </ul>`;
}

function homeCategories(posts) {
  const counts = new Map();
  for (const p of posts) if (p.category) counts.set(p.category, (counts.get(p.category) || 0) + 1);
  if (!counts.size) return '        <p class="side-empty" data-generated>카테고리가 없어요.</p>';
  const rows = [`          <li><a href="./">전체<span>${posts.length}</span></a></li>`];
  for (const [c, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push(`          <li><a href="?category=${esc(encodeURIComponent(c))}" data-filter-category="${esc(c)}">${esc(c)}<span>${n}</span></a></li>`);
  }
  return `        <ul class="cat-list" data-generated>\n${rows.join('\n')}\n        </ul>`;
}

function homeTags(posts) {
  const counts = new Map();
  for (const p of posts) for (const t of p.tags) counts.set(t, (counts.get(t) || 0) + 1);
  if (!counts.size) return '        <p class="side-empty" data-generated>태그가 없어요.</p>';
  const items = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => `          <li><a href="?tag=${esc(encodeURIComponent(t))}" data-filter-tag="${esc(t)}">#${esc(t)}</a></li>`);
  return `        <ul class="tag-cloud" data-generated>\n${items.join('\n')}\n        </ul>`;
}

function replaceRegion(html, name, content) {
  const re = new RegExp(`(<!-- BLOG:${name} -->)[\\s\\S]*?(<!-- \\/BLOG:${name} -->)`);
  if (!re.test(html)) throw new Error(`index.html 에 <!-- BLOG:${name} --> 영역이 없어요`);
  return html.replace(re, `$1\n${content}\n$2`);
}

function sitemap(posts) {
  const urls = [`${SITE}/`, `${SITE}/portfolio/`];
  const projDir = path.join(ROOT, 'portfolio', 'projects');
  if (fs.existsSync(projDir)) for (const f of fs.readdirSync(projDir).sort()) if (f.endsWith('.html')) urls.push(`${SITE}/portfolio/projects/${f}`);
  const today = new Date().toISOString().slice(0, 10);
  const rows = urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`);
  for (const p of posts) rows.push(`  <url><loc>${esc(`${SITE}/posts/${encodeURIComponent(p.slug)}.html`)}</loc><lastmod>${p.date}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

function feed(posts) {
  const items = posts.slice(0, 20).map((p) => {
    const url = `${SITE}/posts/${encodeURIComponent(p.slug)}.html`;
    return `  <item>
    <title>${esc(p.title)}</title>
    <link>${esc(url)}</link>
    <guid>${esc(url)}</guid>
    <pubDate>${new Date(p.date + 'T09:00:00+09:00').toUTCString()}</pubDate>
    ${p.category ? `<category>${esc(p.category)}</category>` : ''}
    <description>${esc(p.summaryText)}</description>
  </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${BLOG_NAME}</title>
  <link>${SITE}/</link>
  <description>고성현의 게임 클라이언트 개발 블로그</description>
  <language>ko</language>
${items.join('\n')}
</channel>
</rss>
`;
}

/* ---------------- 전체 빌드 ---------------- */
/**
 * @param {object} [opts]
 * @param {Object<string,string>} [opts.bodies]  slug → 새 본문 HTML (방금 저장한 글)
 */
function buildAll(opts = {}) {
  const all = readPosts(opts.bodies || {});
  const published = all.filter((p) => !p.draft && p.body != null);

  // 글 페이지: 발행 글은 다시 만들고, 임시저장 글의 html 은 지움 (공개되지 않게)
  published.forEach((p, i) => {
    write(path.join(POSTS_DIR, p.slug + '.html'), postPage(p, published[i + 1], published[i - 1]));
  });
  for (const p of all) {
    const htmlPath = path.join(POSTS_DIR, p.slug + '.html');
    if (p.draft && fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
  }
  // .md 가 없는 고아 html 정리
  if (fs.existsSync(POSTS_DIR)) {
    for (const f of fs.readdirSync(POSTS_DIR)) {
      if (f.endsWith('.html') && !fs.existsSync(path.join(POSTS_DIR, f.slice(0, -5) + '.md'))) fs.unlinkSync(path.join(POSTS_DIR, f));
    }
  }

  const indexPath = path.join(ROOT, 'index.html');
  let home = fs.readFileSync(indexPath, 'utf8');
  home = replaceRegion(home, 'POSTS', homePosts(published));
  home = replaceRegion(home, 'CATEGORIES', homeCategories(published));
  home = replaceRegion(home, 'TAGS', homeTags(published));
  write(indexPath, home);

  write(path.join(ROOT, 'sitemap.xml'), sitemap(published));
  write(path.join(ROOT, 'feed.xml'), feed(published));
  return { total: all.length, published: published.length };
}

module.exports = { buildAll, readPosts, parseSource, serializeSource, normalizeMeta, SLUG_RE, POSTS_DIR };

if (require.main === module) {
  const r = buildAll();
  console.log(`블로그 빌드 완료: 발행 ${r.published}개 / 전체 ${r.total}개`);
}
