/* 포트폴리오 프로젝트 편집 페이지 (/__editor/project) */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null && c !== false) el.append(c);
    return el;
  };

  const loadEl = $('p-load');
  const statusEl = $('p-status');
  const saveBtn = $('p-save');
  const delBtn = $('p-delete');
  const viewLink = $('p-view');
  const toastEl = $('p-toast');
  const F = {
    title: $('p-title'), subtitle: $('p-subtitle'), tagline: $('p-tagline'),
    thumbAlt: $('p-thumb-alt'), thumbTop: $('p-thumb-top'), thumbVideo: $('p-thumb-video'),
    start: $('p-start'), end: $('p-end'), team: $('p-team'), role: $('p-role'), stack: $('p-stack'),
    troubleTitle: $('p-trouble-title'),
    note: $('p-note'), slug: $('p-slug'), desc: $('p-desc'),
    cardSummary: $('p-card-summary'), cardKeywords: $('p-card-keywords'), cardTeam: $('p-card-team'),
  };
  const lists = { links: $('p-links'), sections: $('p-sections'), troubles: $('p-troubles'), info: $('p-info'), skills: $('p-skills'), retros: $('p-retros') };

  let originalSlug = '';
  let thumb = { src: '', width: 0, height: 0 };
  let slugTouched = false;
  let dirty = false;
  let loading = false;

  /* ---------------- 알림 ---------------- */
  let toastTimer;
  function toast(msg, opts = {}) {
    toastEl.textContent = msg;
    if (opts.link) toastEl.append(h('a', { href: opts.link.href }, opts.link.text));
    toastEl.classList.toggle('error', !!opts.error);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), opts.error ? 6000 : opts.link ? 8000 : 2500);
  }
  function setDirty(v) {
    if (loading) return;
    dirty = v;
    statusEl.textContent = v ? '저장 안 된 변경사항 있음' : originalSlug ? '저장됨' : '새 프로젝트';
    statusEl.classList.toggle('dirty', v);
  }
  document.addEventListener('input', (e) => { if (e.target.closest('.p-main')) setDirty(true); });
  document.addEventListener('change', (e) => { if (e.target.closest('.p-main')) setDirty(true); });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- 공통 입력 조각 ---------------- */
  let uid = 0;
  function field(label, value, opts = {}) {
    const id = 'f' + (++uid);
    const input = opts.multiline
      ? h('textarea', { id, rows: opts.rows || 2, placeholder: opts.placeholder || '' })
      : h('input', { id, type: 'text', autocomplete: 'off', placeholder: opts.placeholder || '' });
    input.value = value || '';
    const wrap = h('div', { class: 'w-field' + (opts.wide ? ' w-field-wide' : '') },
      h('label', { for: id }, label, opts.hint ? h('small', {}, ' ' + opts.hint) : null), input);
    wrap.input = input;
    return wrap;
  }

  /** 순서 바꾸기 / 삭제 버튼. 행(row) 요소에 붙임 */
  function rowTools(row, list, onChange) {
    const up = h('button', { type: 'button', class: 'p-icon', title: '위로', 'aria-label': '위로 이동' }, '↑');
    const down = h('button', { type: 'button', class: 'p-icon', title: '아래로', 'aria-label': '아래로 이동' }, '↓');
    const del = h('button', { type: 'button', class: 'p-icon danger', title: '삭제', 'aria-label': '삭제' }, '✕');
    up.addEventListener('click', () => { if (row.previousElementSibling) { list.insertBefore(row, row.previousElementSibling); changed(); } });
    down.addEventListener('click', () => { if (row.nextElementSibling) { list.insertBefore(row.nextElementSibling, row); changed(); } });
    del.addEventListener('click', () => { row.remove(); changed(); });
    function changed() { setDirty(true); renumber(list); if (onChange) onChange(); }
    return h('span', { class: 'p-tools' }, up, down, del);
  }
  function renumber(list) {
    [...list.children].forEach((row, i, arr) => {
      const num = row.querySelector(':scope > .p-row-head .p-num');
      if (num) num.textContent = String(i + 1).padStart(2, '0');
      const btns = row.querySelectorAll(':scope > .p-row-head .p-tools .p-icon, :scope > .p-inline .p-tools .p-icon');
      if (btns.length >= 2) { btns[0].disabled = i === 0; btns[1].disabled = i === arr.length - 1; }
    });
  }

  /* ---------------- 반복 항목 ---------------- */
  function linkRow(l = {}) {
    const list = lists.links;
    const row = h('div', { class: 'p-row' });
    const name = field('이름', l.label, { placeholder: 'GitHub' });
    const url = field('주소', l.url, { placeholder: 'https://', wide: true });
    row.append(h('div', { class: 'p-inline' }, name, url, rowTools(row, list)));
    row.get = () => ({ label: name.input.value, url: url.input.value });
    return row;
  }

  function infoRow(r = {}) {
    const list = lists.info;
    const row = h('div', { class: 'p-row' });
    const label = field('항목', r.label, { placeholder: 'Partner' });
    const value = field('내용', r.value, { placeholder: '**엘에스웨어** — 외부 모듈 통합 검증', wide: true });
    row.append(h('div', { class: 'p-inline' }, label, value, rowTools(row, list)));
    row.get = () => ({ label: label.input.value, value: value.input.value });
    return row;
  }

  function retroRow(r = {}) {
    const list = lists.retros;
    const row = h('div', { class: 'p-row' });
    const title = field('제목', r.title, { placeholder: '예: 무음 · 잡음 입력으로 인한 LLM 환각' });
    const context = field('CONTEXT · 상황', r.context, { multiline: true, rows: 3, placeholder: '어떤 문제가 있었고 당시 무엇을 했는지' });
    const idea = field('IDEA · 개선 구상', r.idea, { multiline: true, rows: 3, placeholder: '다시 한다면 어떻게 할지 (적용 여부도 함께)' });
    const learned = field('LEARNED · 배운 점', r.learned, { multiline: true, rows: 2 });
    row.append(h('div', { class: 'p-row-head' }, h('span', { class: 'p-num' }), title, rowTools(row, list)), context, idea, learned);
    row.get = () => ({ title: title.input.value, context: context.input.value, idea: idea.input.value, learned: learned.input.value });
    return row;
  }

  function skillRow(k = {}) {
    const list = lists.skills;
    const row = h('div', { class: 'p-row' });
    const id = 'f' + (++uid);
    const kind = h('select', { id });
    [['pattern', '설계 패턴'], ['structure', '구조 설계']].forEach(([v, t]) => kind.append(h('option', { value: v }, t)));
    kind.value = k.kind === 'structure' ? 'structure' : 'pattern';
    const kindWrap = h('div', { class: 'w-field' }, h('label', { for: id }, '분류'), kind);
    const name = field('이름', k.name, { placeholder: 'Strategy / 상태 머신' });
    const where = field('어디에', k.where, { placeholder: '장비별 좌클릭 액션', wide: true });
    const why = field('왜 · 어떻게', k.why, { multiline: true, rows: 2, placeholder: '장비마다 다른 동작을 조건문 대신 장비 클래스로 나눠, 새 장비를 클래스 추가로 붙일 수 있게' });
    row.append(h('div', { class: 'p-inline' }, kindWrap, name, where, rowTools(row, list)), why);
    row.get = () => ({ kind: kind.value, name: name.input.value, where: where.input.value, why: why.input.value });
    return row;
  }

  function statRow(list, s = {}) {
    const row = h('div', { class: 'p-row' });
    const value = field('큰 글씨', s.value, { placeholder: '130종' });
    const label = field('설명', s.label, { placeholder: '구현한 카드', wide: true });
    row.append(h('div', { class: 'p-inline' }, value, label, rowTools(row, list)));
    row.get = () => ({ value: value.input.value, label: label.input.value });
    return row;
  }

  function blockRow(list, b = {}) {
    const row = h('div', { class: 'p-row' });
    const heading = field('내부 소제목', b.heading, { placeholder: '예: 데이터 주도 카드 효과 엔진 구축' });
    const items = field('리스트', (b.items || []).join('\n'), { multiline: true, rows: 4, hint: '한 줄에 하나씩' });
    const diagram = field('다이어그램 (선택)', b.diagram || '', { multiline: true, rows: b.diagram ? 10 : 2, hint: 'Mermaid 코드 · 리스트 아래에 그림으로 표시' });
    diagram.input.spellcheck = false;
    diagram.input.style.fontFamily = 'var(--font-mono)';
    const code = field('코드 (선택)', b.code || '', { multiline: true, rows: b.code ? 14 : 2, hint: 'C# 코드 · 리스트 아래에 코드 블록으로 표시' });
    code.input.spellcheck = false;
    code.input.style.fontFamily = 'var(--font-mono)';
    const codeNote = field('코드 설명', b.codeNote || '', { placeholder: '예: SpellController.EndRecording() · [전체 코드](https://github.com/...)' });
    row.append(h('div', { class: 'p-inline' }, heading, rowTools(row, list)), items, code, codeNote, diagram);
    row.get = () => ({
      ...b, // 편집 화면에 없는 값(이미지 · 타임라인 등)은 그대로 보존
      heading: heading.input.value,
      items: items.input.value.split('\n').map((x) => x.trim()).filter(Boolean),
      code: code.input.value.replace(/\s+$/, ''), codeNote: codeNote.input.value.trim(),
      diagram: diagram.input.value.trim(),
    });
    return row;
  }

  function sectionRow(sec = {}) {
    const list = lists.sections;
    const row = h('div', { class: 'p-row' });
    const title = field('소제목', sec.title, { placeholder: '예: SPELLBOOK ENGINEERING' });
    const stats = h('div', { class: 'p-list' });
    const blocks = h('div', { class: 'p-list' });
    (sec.stats || []).forEach((s) => stats.append(statRow(stats, s)));
    (sec.blocks || []).forEach((b) => blocks.append(blockRow(blocks, b)));
    const addStat = h('button', { type: 'button', class: 'w-btn p-add', onclick: () => { stats.append(statRow(stats)); renumber(stats); setDirty(true); } }, '+ 숫자 강조 추가');
    const addBlock = h('button', { type: 'button', class: 'w-btn p-add', onclick: () => { const r = blockRow(blocks); blocks.append(r); renumber(blocks); r.querySelector('input').focus(); setDirty(true); } }, '+ 내부 소제목·리스트 추가');
    row.append(
      h('div', { class: 'p-row-head' }, h('span', { class: 'p-num' }), title, rowTools(row, list)),
      h('p', { class: 'p-sub' }, '숫자 강조 (예: 130종 / 구현한 카드)'), stats, addStat,
      h('p', { class: 'p-sub' }, '내용'), blocks, addBlock,
    );
    renumber(stats); renumber(blocks);
    row.get = () => ({ title: title.input.value, stats: [...stats.children].map((r) => r.get()), blocks: [...blocks.children].map((r) => r.get()) });
    return row;
  }

  function troubleRow(t = {}) {
    const list = lists.troubles;
    const m = t.main || { show: true };
    const row = h('div', { class: 'p-row' });
    const title = field('제목', t.title, { placeholder: '예: 단일 API 의존의 한계' });
    const issue = field('ISSUE · 문제', t.issue, { multiline: true, rows: 3 });
    const decision = field('DECISION · 해결', t.decision, { multiline: true, rows: 3 });
    const result = field('RESULT · 결과', t.result, { multiline: true, rows: 3, placeholder: '숫자나 실제로 바뀐 것만' });
    const learned = field('LEARNED · 배운 점 (선택, 상세 페이지에만)', t.learned, { multiline: true, rows: 2, placeholder: '느낀 점·다음 과제는 여기에' });
    const show = h('input', { type: 'checkbox', checked: m.show !== false });
    const mTitle = field('메인용 제목', m.title, { placeholder: '비우면 “게임 이름 — 제목”' });
    const mIssue = field('메인용 ISSUE', m.issue, { multiline: true, placeholder: '비우면 위 내용 그대로' });
    const mDecision = field('메인용 DECISION', m.decision, { multiline: true, placeholder: '비우면 위 내용 그대로' });
    const mResult = field('메인용 RESULT', m.result, { multiline: true, placeholder: '비우면 위 내용 그대로' });
    const hasShort = !!(m.title || m.issue || m.decision || m.result);
    const details = h('details', { class: 'p-main-summary', open: hasShort },
      h('summary', {}, '메인 페이지용 짧은 버전 (선택)'), mTitle, mIssue, mDecision, mResult);
    row.append(
      h('div', { class: 'p-row-head' }, h('span', { class: 'p-num' }), title, rowTools(row, list)),
      issue, decision, result, learned,
      h('label', { class: 'p-check' }, show, ' 포트폴리오 메인의 Troubleshooting에도 표시'),
      details,
    );
    const sync = () => { details.hidden = !show.checked; };
    show.addEventListener('change', sync); sync();
    row.get = () => ({
      ...t, // 편집 화면에 없는 값(다이어그램 등)은 그대로 보존
      title: title.input.value, issue: issue.input.value, decision: decision.input.value, result: result.input.value, learned: learned.input.value,
      main: { show: show.checked, title: mTitle.input.value, issue: mIssue.input.value, decision: mDecision.input.value, result: mResult.input.value },
    });
    return row;
  }

  const makers = { links: linkRow, sections: sectionRow, troubles: troubleRow, info: infoRow, skills: skillRow, retros: retroRow };
  document.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.add;
    const row = makers[key]();
    lists[key].append(row);
    renumber(lists[key]);
    setDirty(true);
    const first = row.querySelector('input, textarea');
    if (first) first.focus();
  }));

  /* ---------------- 상태 / 기간 ---------------- */
  const statusRadios = [...document.querySelectorAll('input[name="p-status"]')];
  const getStatus = () => (statusRadios.find((r) => r.checked) || {}).value || 'done';
  function syncStatus() {
    const prog = getStatus() === 'progress';
    F.end.disabled = prog;
    $('p-end-note').textContent = prog ? '개발 중이면 “진행 중”으로 표시돼요' : '예: 2026.07';
  }
  statusRadios.forEach((r) => r.addEventListener('change', syncStatus));

  /* ---------------- 썸네일 ---------------- */
  const thumbPreview = $('p-thumb-preview');
  const thumbFile = $('p-thumb-file');
  const thumbClear = $('p-thumb-clear');
  function renderThumb() {
    thumbPreview.textContent = '';
    if (thumb.src) {
      const img = h('img', { src: '/' + thumb.src, alt: '' });
      img.style.objectPosition = F.thumbTop.checked ? 'center top' : 'center';
      thumbPreview.append(img);
    } else thumbPreview.textContent = '이미지 없음';
    thumbClear.hidden = !thumb.src;
  }
  F.thumbTop.addEventListener('change', renderThumb);
  $('p-thumb-pick').addEventListener('click', () => thumbFile.click());
  thumbClear.addEventListener('click', () => { thumb = { src: '', width: 0, height: 0 }; renderThumb(); setDirty(true); });
  thumbFile.addEventListener('change', async () => {
    const file = thumbFile.files[0];
    thumbFile.value = '';
    if (!file) return;
    try {
      const res = await fetch('/__editor/upload?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '업로드 실패');
      const size = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = '/' + json.path;
      });
      thumb = { src: json.path, ...size };
      if (!F.thumbAlt.value) F.thumbAlt.value = (F.title.value || '프로젝트') + ' 스크린샷';
      renderThumb();
      setDirty(true);
    } catch (err) { toast(err.message, { error: true }); }
  });

  /* ---------------- 페이지 주소 ---------------- */
  const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  function syncSlug() {
    if (!slugTouched && !originalSlug) F.slug.value = slugify(F.title.value);
    $('p-slug-preview').textContent = F.slug.value || '(주소)';
  }
  F.title.addEventListener('input', syncSlug);
  F.slug.addEventListener('input', () => { slugTouched = true; syncSlug(); });

  /* ---------------- 불러오기 / 채우기 ---------------- */
  function fill(slug, d) {
    loading = true;
    originalSlug = slug || '';
    slugTouched = !!slug;
    statusRadios.forEach((r) => { r.checked = r.value === (d.status || 'done'); });
    F.title.value = d.title || ''; F.subtitle.value = d.subtitle || ''; F.tagline.value = d.tagline || '';
    thumb = { src: (d.thumbnail || {}).src || '', width: (d.thumbnail || {}).width || 0, height: (d.thumbnail || {}).height || 0, blackout: (d.thumbnail || {}).blackout || '' };
    F.thumbAlt.value = (d.thumbnail || {}).alt || ''; F.thumbTop.checked = !!(d.thumbnail || {}).top; F.thumbVideo.value = (d.thumbnail || {}).video || '';
    F.start.value = (d.period || {}).start || ''; F.end.value = (d.period || {}).end || '';
    F.team.value = d.team || ''; F.role.value = d.role || ''; F.stack.value = (d.stack || []).join(', ');
    F.troubleTitle.value = (d.troubleshooting || {}).title || '';
    F.note.value = d.note || ''; F.slug.value = slug || ''; F.desc.value = d.description || '';
    F.cardSummary.value = (d.card || {}).summary || ''; F.cardKeywords.value = (d.card || {}).keywords || ''; F.cardTeam.value = (d.card || {}).team || '';
    for (const k of Object.keys(lists)) lists[k].textContent = '';
    (d.links || []).forEach((x) => lists.links.append(linkRow(x)));
    (d.info || []).forEach((x) => lists.info.append(infoRow(x)));
    (d.sections || []).forEach((x) => lists.sections.append(sectionRow(x)));
    ((d.troubleshooting || {}).items || []).forEach((x) => lists.troubles.append(troubleRow(x)));
    (d.skills || []).forEach((x) => lists.skills.append(skillRow(x)));
    (d.retrospective || []).forEach((x) => lists.retros.append(retroRow(x)));
    const sc = d.scope || {};
    ['mine', 'team', 'together'].forEach((k) => { $('p-scope-' + k).value = (sc[k] || []).join('\n'); });
    Object.values(lists).forEach(renumber);
    renderThumb(); syncStatus(); syncSlug();
    delBtn.hidden = !slug;
    viewLink.hidden = !slug;
    if (slug) viewLink.href = '/portfolio/projects/' + slug + '.html';
    loadEl.value = slug || '';
    loading = false;
    setDirty(false);
  }

  function collect() {
    return {
      status: getStatus(),
      title: F.title.value, subtitle: F.subtitle.value, tagline: F.tagline.value,
      note: F.note.value, description: F.desc.value,
      thumbnail: { src: thumb.src, alt: F.thumbAlt.value, top: F.thumbTop.checked, width: thumb.width, height: thumb.height, ...(thumb.blackout ? { blackout: thumb.blackout } : {}), ...(F.thumbVideo.value.trim() ? { video: F.thumbVideo.value.trim() } : {}) },
      period: { start: F.start.value, end: F.end.value },
      team: F.team.value, role: F.role.value, stack: F.stack.value.split(',').map((x) => x.trim()).filter(Boolean),
      info: [...lists.info.children].map((r) => r.get()),
      links: [...lists.links.children].map((r) => r.get()),
      sections: [...lists.sections.children].map((r) => r.get()),
      troubleshooting: { title: F.troubleTitle.value, items: [...lists.troubles.children].map((r) => r.get()) },
      skills: [...lists.skills.children].map((r) => r.get()),
      retrospective: [...lists.retros.children].map((r) => r.get()),
      scope: Object.fromEntries(['mine', 'team', 'together'].map((k) => [k, $('p-scope-' + k).value.split('\n').map((x) => x.trim()).filter(Boolean)])),
      card: { summary: F.cardSummary.value, keywords: F.cardKeywords.value, team: F.cardTeam.value },
    };
  }

  async function refreshList() {
    const res = await fetch('/__editor/projects');
    const list = await res.json();
    loadEl.textContent = '';
    loadEl.append(h('option', { value: '' }, '+ 새 프로젝트'));
    for (const p of list) loadEl.append(h('option', { value: p.slug }, `${p.num} · ${p.subtitle ? p.subtitle + ' ' : ''}${p.title}${p.status === 'progress' ? ' (개발 중)' : ''}`));
    loadEl.value = originalSlug;
  }

  async function load(slug) {
    if (!slug) {
      fill('', { status: 'done', troubleshooting: { title: 'TROUBLESHOOTING', items: [] }, sections: [{ title: '', stats: [], blocks: [{ heading: '', items: [] }] }], links: [{ label: 'GitHub', url: '' }] });
      history.replaceState(null, '', '/__editor/project');
      F.title.focus();
      return;
    }
    const res = await fetch('/__editor/project-data?slug=' + encodeURIComponent(slug));
    const json = await res.json();
    if (!res.ok) { toast(json.error, { error: true }); return load(''); }
    fill(json.slug, json.data);
    history.replaceState(null, '', '/__editor/project?slug=' + encodeURIComponent(slug));
  }

  loadEl.addEventListener('change', () => {
    if (dirty && !confirm('저장 안 한 변경사항이 사라져요. 다른 프로젝트를 열까요?')) { loadEl.value = originalSlug; return; }
    load(loadEl.value);
  });

  /* ---------------- 저장 / 삭제 ---------------- */
  async function save() {
    const data = collect();
    if (!data.title.trim()) { toast('게임 이름을 입력해 주세요', { error: true }); F.title.focus(); return; }
    const slug = F.slug.value.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      toast('추가 설정에서 페이지 주소(영문 소문자·숫자·-)를 정해 주세요', { error: true });
      document.querySelector('.p-card-more').open = true; F.slug.focus(); return;
    }
    saveBtn.disabled = true;
    try {
      const res = await fetch('/__editor/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalSlug, slug, data }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      originalSlug = json.slug;
      slugTouched = true;
      delBtn.hidden = false; viewLink.hidden = false; viewLink.href = json.url;
      setDirty(false);
      await refreshList();
      history.replaceState(null, '', '/__editor/project?slug=' + encodeURIComponent(json.slug));
      toast('저장했어요. 포트폴리오 메인과 상세 페이지에 반영됐어요.', { link: { href: json.url, text: '페이지 보기 →' } });
    } catch (err) { toast(err.message, { error: true }); }
    finally { saveBtn.disabled = false; }
  }
  saveBtn.addEventListener('click', save);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });

  delBtn.addEventListener('click', async () => {
    if (!originalSlug) return;
    if (!confirm(`“${F.title.value}” 프로젝트를 삭제할까요? 상세 페이지와 메인 카드, 트러블슈팅이 모두 사라져요.`)) return;
    const res = await fetch('/__editor/project/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: originalSlug }) });
    const json = await res.json();
    if (!res.ok) { toast(json.error, { error: true }); return; }
    dirty = false;
    originalSlug = '';
    await refreshList();
    load('');
    toast('삭제했어요.');
  });

  /* ---------------- 시작 ---------------- */
  (async () => {
    await refreshList();
    await load(new URLSearchParams(location.search).get('slug') || '');
  })();
})();
