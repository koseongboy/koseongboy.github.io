#!/usr/bin/env node
/*
 * 포트폴리오 빌드 — portfolio/projects/<slug>.json (원본 데이터) 로부터
 *   - portfolio/projects/<slug>.html    프로젝트 상세 페이지
 *   - portfolio/index.html              Selected Work 카드 / 연도 / Troubleshooting / Skills(설계 항목) 영역
 * 을 다시 만듭니다. 순서는 최신순(진행 중 → 끝난 날짜가 늦은 순)으로 자동 정렬됩니다.
 *
 *   직접 실행:  node tools/portfolio/build.js
 *   (편집 서버의 프로젝트 편집기에서 저장·삭제하면 자동으로 실행됩니다)
 *
 * 글자 꾸미기:  `코드`  **굵게**
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS_DIR = path.join(ROOT, 'portfolio', 'projects');
const PORTFOLIO_INDEX = path.join(ROOT, 'portfolio', 'index.html');
const SITE = 'https://koseongboy.github.io';
const OWNER = '고성현';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/* ---------------- 유틸 ---------------- */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 일반 텍스트 + `코드` + **굵게** → HTML */
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // [글자](https://주소) → 새 탭 링크 (http/https만)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1 ↗</a>');
}
// 코드 블록용 간단한 C# 문법 강조 (빌드 시점에 처리, 외부 스크립트 없음)
const KEYWORDS = 'abstract|async|await|base|bool|break|byte|case|catch|class|const|continue|default|else|enum|false|float|for|foreach|if|in|int|interface|internal|is|new|null|out|override|private|protected|public|readonly|return|static|string|struct|switch|this|throw|true|try|ulong|using|var|virtual|void|while|yield';
const TOKEN_RE = new RegExp(String.raw`(\/\/[^\n]*)|(\$?"(?:[^"\\\n]|\\.)*")|\b(${KEYWORDS})\b|(\[[A-Z][A-Za-z]*(?:\([^)\n]*\))?\])`, 'g');
function highlight(src) {
  let out = '', last = 0, m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src))) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : 'a';
    out += `<span class="tok-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}
const pad2 = (n) => String(n).padStart(2, '0');
const nonEmpty = (a) => (Array.isArray(a) ? a : []).filter((x) => x != null && String(x).trim() !== '');

/* ---------------- 데이터 ---------------- */
function emptyProject() {
  return {
    status: 'done', title: '', subtitle: '', tagline: '', note: '', description: '',
    thumbnail: { src: '', alt: '', top: false, width: 0, height: 0, blackout: '' },
    period: { start: '', end: '' }, team: '', role: '', stack: [], info: [],
    links: [], sections: [],
    troubleshooting: { title: 'TROUBLESHOOTING', items: [] },
    retrospective: [],
    skills: [],
    scope: { mine: [], team: [], together: [] },
    card: { summary: '', keywords: '', team: '' },
  };
}

/** 저장 전에 모양을 맞추고 빈 값 정리 */
function normalize(d) {
  const e = emptyProject();
  const s = (v) => String(v == null ? '' : v).trim();
  const out = {
    status: d.status === 'progress' ? 'progress' : 'done',
    title: s(d.title), subtitle: s(d.subtitle), tagline: s(d.tagline), note: s(d.note), description: s(d.description),
    thumbnail: {
      src: s(d.thumbnail && d.thumbnail.src), alt: s(d.thumbnail && d.thumbnail.alt), top: !!(d.thumbnail && d.thumbnail.top),
      width: Number(d.thumbnail && d.thumbnail.width) || 0, height: Number(d.thumbnail && d.thumbnail.height) || 0,
      blackout: s(d.thumbnail && d.thumbnail.blackout),
    },
    period: { start: s(d.period && d.period.start), end: s(d.period && d.period.end) },
    team: s(d.team), role: s(d.role),
    stack: nonEmpty(Array.isArray(d.stack) ? d.stack : String(d.stack || '').split(',')).map(s),
    info: (d.info || []).map((r) => ({ label: s(r.label), value: s(r.value) })).filter((r) => r.label && r.value),
    links: (d.links || []).map((l) => ({ label: s(l.label), url: s(l.url) })).filter((l) => l.label && l.url),
    sections: (d.sections || []).map((sec) => ({
      title: s(sec.title),
      stats: (sec.stats || []).map((x) => ({ value: s(x.value), label: s(x.label) })).filter((x) => x.value),
      blocks: (sec.blocks || []).map((b) => ({
        heading: s(b.heading), items: nonEmpty(b.items).map(s),
        code: String(b.code || '').replace(/\s+$/, ''), codeNote: s(b.codeNote),
        diagram: String(b.diagram || '').trim(),
        images: Array.isArray(b.images) ? b.images.filter((im) => im && im.src).map((im) => ({ src: String(im.src), alt: String(im.alt || ''), caption: String(im.caption || ''), width: im.width, height: im.height })) : [],
      })).filter((b) => b.heading || b.items.length || b.code || b.diagram),
    })).filter((sec) => sec.title || sec.stats.length || sec.blocks.length),
    troubleshooting: {
      title: s(d.troubleshooting && d.troubleshooting.title) || e.troubleshooting.title,
      items: ((d.troubleshooting && d.troubleshooting.items) || []).map((t) => ({
        title: s(t.title), issue: s(t.issue), decision: s(t.decision), result: s(t.result), learned: s(t.learned),
        main: {
          show: !(t.main && t.main.show === false),
          title: s(t.main && t.main.title), issue: s(t.main && t.main.issue), decision: s(t.main && t.main.decision), result: s(t.main && t.main.result),
        },
      })).filter((t) => t.title || t.issue || t.decision || t.result),
    },
    // 프로젝트 회고: 해결하지 못했거나 끝난 뒤 정리한 개선 구상 (상세 페이지에만)
    retrospective: (d.retrospective || []).map((r) => ({
      title: s(r.title), context: s(r.context), idea: s(r.idea), learned: s(r.learned),
    })).filter((r) => r.title || r.context || r.idea || r.learned),
    scope: {
      mine: nonEmpty(d.scope && d.scope.mine).map(s),
      team: nonEmpty(d.scope && d.scope.team).map(s),
      together: nonEmpty(d.scope && d.scope.together).map(s),
    },
    skills: (d.skills || []).map((k) => ({ kind: k.kind === 'structure' ? 'structure' : 'pattern', name: s(k.name), where: s(k.where), why: s(k.why) })).filter((k) => k.name),
    card: { summary: s(d.card && d.card.summary), keywords: s(d.card && d.card.keywords), team: s(d.card && d.card.team) },
  };
  if (out.status === 'progress') out.period.end = '';
  return out;
}

function readProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const list = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const slug = f.replace(/\.json$/, '');
    const data = normalize(JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8')));
    return { slug, ...data };
  });
  // 최신순: 진행 중이 먼저, 그다음 끝난 날짜 → 시작 날짜가 늦은 순
  const key = (p) => (p.status === 'progress' || !p.period.end ? '9999.99' : p.period.end) + '|' + (p.period.start || '');
  list.sort((a, b) => key(b).localeCompare(key(a)) || a.title.localeCompare(b.title));
  list.forEach((p, i) => { p.num = pad2(i + 1); });
  return list;
}

/* ---------------- 공통 조각 ---------------- */
const statusBadge = (p) => p.status === 'progress'
  ? '<span class="status status-progress">진행 중</span>'
  : '<span class="status status-done">완료</span>';
const fullTitle = (p) => (p.subtitle ? p.subtitle + ' ' : '') + p.title;
const titleHtml = (p) => (p.subtitle ? `<span class="partner-tag">${esc(p.subtitle)}</span> ` : '') + esc(p.title);
const periodDetail = (p) => `${p.period.start || '?'} ~ ${p.status === 'progress' ? '진행 중' : p.period.end || '?'}`;
const periodCard = (p) => `${p.period.start || '?'} — ${p.status === 'progress' ? '' : p.period.end || '?'}`.trim();
const placeholderText = (p) => `[ ${p.title} 스크린샷 준비 중 ]`;
const metaDescription = (p) => p.description || p.tagline;

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%231f3fd1'/%3E%3Crect x='3' y='3' width='3' height='10' fill='white'/%3E%3Cpath d='M7 8L11.5 3H14L9.5 8L14 13H11.5Z' fill='white'/%3E%3C/svg%3E";
const THEME_TOGGLE = '<button type="button" class="theme-toggle" aria-label="라이트/다크 모드 전환"><svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>';
const THEME_INIT = `<script>try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>`;

/* ---------------- 상세 페이지 ---------------- */
// 썸네일에 마우스를 올리면 화면이 서서히 까맣게 가려지는 효과 (thumbnail.blackout = 가려진 뒤 보일 문구)
function blackoutWrap(t, img) {
  if (!t.blackout) return img;
  return `<div class="blackout-thumb">${img}<span class="blackout-hint" aria-hidden="true"><span class="hint-hover">마우스를 올려 보세요</span><span class="hint-touch">길게 눌러 보세요</span></span><span class="blackout-cover" aria-hidden="true"><span class="blackout-badge">SPOILER</span><span>${esc(t.blackout)}</span></span></div>`;
}

function detailPage(p, all) {
  const url = `${SITE}/portfolio/projects/${p.slug}.html`;
  const pageTitle = `${fullTitle(p)} | ${OWNER} 포트폴리오`;
  const desc = metaDescription(p);
  const t = p.thumbnail;
  const cover = t.src
    ? blackoutWrap(t, `<img class="detail-cover${t.top ? ' top' : ''}" src="../../${esc(t.src)}" alt="${esc(t.alt)}"${t.width && t.height ? ` width="${t.width}" height="${t.height}"` : ''}>`)
    : `<div class="detail-cover-placeholder">${esc(placeholderText(p))}</div>`;

  const specRows = [
    ...p.info.map((r) => `      <dt>${esc(r.label)}</dt><dd>${inline(r.value)}</dd>`),
    `      <dt>Period</dt><dd>${esc(periodDetail(p))}</dd>`,
    p.team ? `      <dt>Team</dt><dd>${inline(p.team)}</dd>` : '',
    p.role ? `      <dt>Role</dt><dd>${inline(p.role)}</dd>` : '',
    p.stack.length ? `      <dt>Stack</dt><dd><ul class="chips">${p.stack.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd>` : '',
  ].filter(Boolean).join('\n');

  const links = p.links.length ? `
  <div class="detail-links">
${p.links.map((l, i) => `    <a href="${esc(l.url)}" class="btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}"${/^https?:/.test(l.url) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label.toUpperCase())} ↗</a>`).join('\n')}
  </div>
` : '';

  // 작업 범위: 내가 한 것 / 팀이 한 것 / 함께 정한 것
  const scopeCols = [['mine', '내가 한 것'], ['team', '팀이 한 것'], ['together', '함께 정한 것']]
    .filter(([k]) => p.scope[k].length)
    .map(([k, label]) => `      <div class="scope-col${k === 'mine' ? ' mine' : ''}">
        <h3>${label}</h3>
        <ul>
${p.scope[k].map((it) => `          <li>${inline(it)}</li>`).join('\n')}
        </ul>
      </div>`);
  const scope = scopeCols.length ? `
  <section class="section" aria-labelledby="scope">
    <h2 id="scope" class="section-title">Scope · 작업 범위</h2>
    <div class="scope-grid">
${scopeCols.join('\n')}
    </div>
  </section>
` : '';

  let n = 0;
  const sections = p.sections.map((sec) => {
    n++;
    const stats = sec.stats.length ? `
    <div class="highlight-stat">
${sec.stats.map((x) => `      <div><strong>${inline(x.value)}</strong><span>${inline(x.label)}</span></div>`).join('\n')}
    </div>` : '';
    const blocks = sec.blocks.length ? `
    <div class="prose-block">
${sec.blocks.map((b) => `      <div>
${b.heading ? `        <h3>${inline(b.heading)}</h3>\n` : ''}${b.items.length ? `        <ul>
${b.items.map((it) => `          <li>${inline(it)}</li>`).join('\n')}
        </ul>\n` : ''}${b.code ? `        <figure class="code-figure">${b.codeNote ? `<figcaption>${inline(b.codeNote)}</figcaption>` : ''}<pre class="code-block"><code>${highlight(b.code)}</code></pre></figure>\n` : ''}${b.images.length ? `        <figure class="slide-viewer"><div class="slide-scroll" tabindex="0" aria-label="슬라이드 ${b.images.length}장, 스크롤해서 보기">${b.images.map((im) => `<img src="../../${esc(im.src)}" alt="${esc(im.alt)}" loading="lazy"${im.width && im.height ? ` width="${im.width}" height="${im.height}"` : ""}>`).join("")}</div>${b.images.some((im) => im.caption) ? `<figcaption>${b.images.filter((im) => im.caption).map((im) => inline(im.caption)).join(" ")} · 스크롤해서 ${b.images.length}장 보기</figcaption>` : ""}</figure>
` : ""}${b.diagram ? `        <figure class="diagram"><pre class="mermaid">${esc(b.diagram)}</pre></figure>\n` : ''}      </div>`).join('\n')}
    </div>` : '';
    return `
  <section class="section" aria-labelledby="s${n}">
    <h2 id="s${n}" class="section-title">${pad2(n)} · ${esc(sec.title)}</h2>${stats}${blocks}
  </section>
`;
  }).join('');

  const tr = p.troubleshooting;
  let trouble = '';
  if (tr.items.length) {
    n++;
    trouble = `
  <section class="section" aria-labelledby="troubleshooting">
    <h2 id="troubleshooting" class="section-title">${pad2(n)} · ${esc(tr.title)}</h2>
${tr.items.map((it) => `    <div class="boss-log">
      <h3>${inline(it.title)}</h3>
      <dl>
        <dt class="dt-encounter">ISSUE</dt><dd>${inline(it.issue)}</dd>
        <dt class="dt-action">DECISION</dt><dd>${inline(it.decision)}</dd>
        <dt class="dt-result">RESULT</dt><dd>${inline(it.result)}</dd>${it.learned ? `
        <dt class="dt-learned">LEARNED</dt><dd>${inline(it.learned)}</dd>` : ''}
      </dl>
    </div>`).join('\n')}
  </section>
`;
  }

  let retro = '';
  if (p.retrospective.length) {
    n++;
    retro = `
  <section class="section" aria-labelledby="retrospective">
    <h2 id="retrospective" class="section-title">${pad2(n)} · RETROSPECTIVE</h2>
${p.retrospective.map((it) => `    <div class="boss-log">
      <h3>${inline(it.title)}</h3>
      <dl>${it.context ? `
        <dt class="dt-encounter">CONTEXT</dt><dd>${inline(it.context)}</dd>` : ''}${it.idea ? `
        <dt class="dt-action">IDEA</dt><dd>${inline(it.idea)}</dd>` : ''}${it.learned ? `
        <dt class="dt-learned">LEARNED</dt><dd>${inline(it.learned)}</dd>` : ''}
      </dl>
    </div>`).join('\n')}
  </section>
`;
  }

  const others = all.filter((o) => o.slug !== p.slug);
  const more = others.length ? `
  <section class="section" aria-labelledby="more">
    <h2 id="more" class="section-title">Other Projects</h2>
    <div class="next-quests">
${others.map((o) => `      <a href="${esc(o.slug)}.html"><small>Project ${o.num}${o.info.some((r) => /^partner$/i.test(r.label)) ? ' · Partner' : ''}</small><span>${esc(fullTitle(o))}</span></a>`).join('\n')}
    </div>
  </section>
` : '';

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="KOSEONGBOY.DEV">
<meta property="og:image" content="${SITE}/assets/img/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="KOSEONGBOY.DEV — 고성보이 Game Client Engineer 개발 블로그 &amp; 포트폴리오">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/assets/img/og-image.png">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e0f12" media="(prefers-color-scheme: dark)">
${THEME_INIT}
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&amp;family=Space+Grotesk:wght@400;500;700&amp;family=JetBrains+Mono:wght@400&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../assets/css/style.css">
<script src="../../assets/js/theme.js" defer></script>
${p.sections.some((sec) => sec.blocks.some((b) => b.diagram)) ? '<script src="../../assets/js/diagram.js" type="module"></script>\n' : ''}</head>
<body data-page="project" data-slug="${esc(p.slug)}">

<header class="site-header">
  <nav class="container" aria-label="주요 메뉴">
    <a href="../" class="logo">KO SEONGHYEON</a>
    <div class="nav-links">
      <a href="../../">Blog</a>
      <a href="../#work">Work</a>
      <a href="../#troubleshooting">Troubleshooting</a>
      <a href="../#skills">Skills</a>
      <a href="../#contact">Contact</a>
      ${THEME_TOGGLE}
    </div>
  </nav>
</header>

<main class="container">
  <div class="breadcrumb"><a href="../#work">← Selected Work</a></div>

  <section class="detail-hero">
    <div class="quest-meta"><span class="quest-num">${p.num}</span>${statusBadge(p)}${p.note ? `<span>${esc(p.note)}</span>` : ''}</div>
    <h1>${titleHtml(p)}</h1>
    ${p.tagline ? `<p class="tagline">${inline(p.tagline)}</p>` : ''}
  </section>

  ${cover}

  <div class="spec">
    <dl>
${specRows}
    </dl>
  </div>
${links}${scope}${sections}${trouble}${retro}${more}</main>

<footer class="site-footer"><p class="copyright">© 2026 Ko Seonghyeon</p></footer>
</body>
</html>
`;
}

/* ---------------- 포트폴리오 메인 영역 ---------------- */
function workCards(all) {
  if (!all.length) return '    <div class="work-list" data-generated><p class="hero-sub">아직 등록한 프로젝트가 없어요.</p></div>';
  const cards = all.map((p) => {
    const t = p.thumbnail;
    const thumb = t.src
      ? blackoutWrap(t, `<img class="quest-thumb${t.top ? ' top' : ''}" src="../${esc(t.src)}" alt="${esc(t.alt)}" loading="lazy"${t.width && t.height ? ` width="${t.width}" height="${t.height}"` : ''}>`)
      : `<div class="quest-thumb-placeholder">${esc(placeholderText(p))}</div>`;
    const meta = [periodCard(p), p.card.team || p.team, p.note].filter(Boolean).join(' · ');
    const summary = p.card.summary || p.tagline;
    const keywords = p.card.keywords || p.stack.join(' · ');
    const links = p.links.map((l) => `<a href="${esc(l.url)}"${/^https?:/.test(l.url) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)} ↗</a>`).join('');
    return `      <article class="quest">
        <div class="quest-body">
          <div class="quest-meta"><span class="quest-num">${p.num}</span>${statusBadge(p)}<span>${esc(meta)}</span></div>
          <h3><a href="projects/${esc(p.slug)}.html" class="quest-link">${titleHtml(p)}</a></h3>
          ${summary ? `<p>${inline(summary)}</p>` : ''}
          ${keywords ? `<div class="stack-line">${esc(keywords)}</div>` : ''}
          <div class="quest-links"><span class="quest-more">자세히 보기 →</span>${links}</div>
        </div>
        ${thumb}
      </article>`;
  });
  return `    <div class="work-list" data-generated>\n${cards.join('\n\n')}\n    </div>`;
}

function workYears(all) {
  const years = [];
  for (const p of all) {
    for (const d of [p.period.start, p.period.end]) { const y = parseInt(d, 10); if (y > 1900) years.push(y); }
    if (p.status === 'progress') years.push(new Date().getFullYear());
  }
  if (!years.length) return '      <span data-generated></span>';
  const a = Math.min(...years), b = Math.max(...years);
  return `      <span data-generated>${a === b ? a : `${a} — ${b}`}</span>`;
}

function troubleCases(all) {
  const cases = [];
  for (const p of all) {
    for (const it of p.troubleshooting.items) {
      if (!it.main.show) continue;
      const m = it.main;
      // "프로젝트 — 제목" 의 앞부분(프로젝트 이름)을 상세 페이지 트러블슈팅 위치로 연결
      const fullTitle = m.title || `${p.title} — ${it.title}`;
      const href = `projects/${esc(p.slug)}.html#troubleshooting`;
      const cut = fullTitle.indexOf(' — ');
      const heading = cut > 0
        ? `<a class="skill-proj" href="${href}">${inline(fullTitle.slice(0, cut))}</a> — ${inline(fullTitle.slice(cut + 3))}`
        : `<a class="skill-proj" href="${href}">${inline(fullTitle)}</a>`;
      cases.push(`    <article class="case">
      <h3>${heading}</h3>
      <div class="case-grid">
        <div class="case-col issue"><span>ISSUE</span><p>${inline(m.issue || it.issue)}</p></div>
        <div class="case-col"><span>DECISION</span><p>${inline(m.decision || it.decision)}</p></div>
        <div class="case-col"><span>RESULT</span><p>${inline(m.result || it.result)}</p></div>
      </div>
    </article>`);
    }
  }
  if (!cases.length) return '    <div class="case-list" data-generated><p class="hero-sub">아직 등록한 트러블슈팅이 없어요.</p></div>';
  return `    <div class="case-list" data-generated>\n${cases.join('\n\n')}\n    </div>`;
}

/** Skills 의 '설계 패턴 / 구조 설계' 목록 — 프로젝트마다 적은 항목을 모아 만들고 프로젝트 이름에 상세 페이지 링크 */
function skillGroups(all) {
  const groups = [['pattern', '설계 패턴 — 어디에, 왜 썼는지'], ['structure', '구조 설계']];
  const out = [];
  for (const [kind, label] of groups) {
    const rows = [];
    for (const p of all) {
      for (const k of p.skills) {
        if (k.kind !== kind) continue;
        const proj = `<a class="skill-proj" href="projects/${esc(p.slug)}.html">${esc(p.title)}</a>`;
        rows.push(`          <li><span class="resume-date">${esc(k.name)}</span><div class="resume-main"><strong>${proj}${k.where ? ' · ' + inline(k.where) : ''}</strong>${k.why ? `<span>${inline(k.why)}</span>` : ''}</div></li>`);
      }
    }
    if (rows.length) out.push(`    <div class="resume-group" data-generated>
      <h3 class="resume-label">${label}</h3>
      <ul class="resume-list">
${rows.join('\n')}
      </ul>
    </div>`);
  }
  return out.join('\n');
}

function replaceRegion(html, name, content) {
  const re = new RegExp(`(<!-- PORTFOLIO:${name} -->)[\\s\\S]*?(<!-- /PORTFOLIO:${name} -->)`);
  if (!re.test(html)) throw new Error(`portfolio/index.html 에 <!-- PORTFOLIO:${name} --> 영역이 없어요`);
  return html.replace(re, `$1\n${content}\n$2`);
}

/* ---------------- 빌드 ---------------- */
/** CSS 캐시 무효화: 링크에 내용 해시(?v=)를 붙여, 스타일이 바뀌면 브라우저가 새로 받게 함 */
function bustCss(html) {
  return html.replace(/(assets\/css\/([\w-]+)\.css)(\?v=[0-9a-f]+)?"/g, (m, p, name) => {
    const f = path.join(ROOT, 'assets', 'css', name + '.css');
    if (!fs.existsSync(f)) return m;
    const v = require('crypto').createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
    return p + '?v=' + v + '"';
  });
}

function write(file, content) {
  if (file.endsWith('.html')) content = bustCss(content);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function buildAll() {
  const all = readProjects();
  for (const p of all) write(path.join(PROJECTS_DIR, p.slug + '.html'), detailPage(p, all));
  let index = fs.readFileSync(PORTFOLIO_INDEX, 'utf8');
  index = replaceRegion(index, 'WORK', workCards(all));
  index = replaceRegion(index, 'YEARS', workYears(all));
  index = replaceRegion(index, 'TROUBLESHOOTING', troubleCases(all));
  index = replaceRegion(index, 'SKILLS', skillGroups(all));
  write(PORTFOLIO_INDEX, index);
  return all;
}

function readProject(slug) {
  const f = path.join(PROJECTS_DIR, slug + '.json');
  if (!SLUG_RE.test(slug) || !fs.existsSync(f)) return null;
  return normalize(JSON.parse(fs.readFileSync(f, 'utf8')));
}

function saveProject(slug, data) {
  fs.writeFileSync(path.join(PROJECTS_DIR, slug + '.json'), JSON.stringify(normalize(data), null, 2) + '\n', 'utf8');
}

function deleteProject(slug) {
  for (const ext of ['.json', '.html']) {
    const f = path.join(PROJECTS_DIR, slug + ext);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

module.exports = { buildAll, readProjects, readProject, saveProject, deleteProject, normalize, emptyProject, SLUG_RE, PROJECTS_DIR };

if (require.main === module) {
  const all = buildAll();
  console.log(`포트폴리오 빌드 완료: 프로젝트 ${all.length}개`);
}
