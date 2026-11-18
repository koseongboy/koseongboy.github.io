/* 블로그 글쓰기 페이지 (/__editor/write) */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const titleEl = $('w-post-title');
  const catEl = $('w-category');
  const tagsEl = $('w-tags');
  const dateEl = $('w-date');
  const summaryEl = $('w-summary');
  const slugEl = $('w-slug');
  const slugPreview = $('w-slug-preview');
  const statusEl = $('w-status');
  const loadEl = $('w-load');
  const btnDraft = $('w-draft');
  const btnPublish = $('w-publish');
  const btnDelete = $('w-delete');
  const coverPreview = $('w-cover-preview');
  const coverFile = $('w-cover-file');
  const coverClear = $('w-cover-clear');
  const toastEl = $('w-toast');

  // 현재 편집 중인 글 상태
  let originalSlug = '';      // 저장된 글이면 그 주소 (없으면 새 글)
  let published = false;      // 현재 공개(발행) 상태인지
  let cover = '';             // 대표 이미지 경로 (assets/img/... , 루트 기준)
  let slugTouched = false;    // 글 주소를 직접 고쳤는지
  let dirty = false;
  let loading = false;

  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  /* ---------------- 알림 ---------------- */
  let toastTimer;
  function toast(msg, opts = {}) {
    toastEl.textContent = msg;
    if (opts.link) {
      const a = document.createElement('a');
      a.href = opts.link.href;
      a.textContent = opts.link.text;
      toastEl.append(a);
    }
    toastEl.classList.toggle('error', !!opts.error);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), opts.error ? 6000 : opts.link ? 8000 : 2500);
  }

  /* ---------------- 에디터 ---------------- */
  if (!window.toastui) {
    document.getElementById('w-editor').innerHTML = '<p style="padding:24px">편집기를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.</p>';
    return;
  }

  async function uploadImage(blob) {
    const name = blob.name || 'image.png';
    const res = await fetch('/__editor/upload?dir=posts&name=' + encodeURIComponent(name), { method: 'POST', body: blob });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || '업로드 실패');
    return json.path; // assets/img/posts/...
  }

  const editor = new toastui.Editor({
    el: $('w-editor'),
    height: 'max(560px, 70vh)',
    initialEditType: 'wysiwyg',
    previewStyle: 'vertical',
    theme: 'dark',
    language: 'ko-KR',
    usageStatistics: false,
    placeholder: '내용을 입력하세요',
    hooks: {
      async addImageBlobHook(blob, callback) {
        try {
          toast('이미지 올리는 중…');
          const p = await uploadImage(blob);
          // 글 페이지(posts/*.html) 기준 상대 경로. 이 글쓰기 화면에서도 같은 경로로 보여요.
          callback('../' + p, (blob.name || '').replace(/\.[^.]+$/, ''));
          toast('이미지를 넣었어요');
        } catch (err) {
          toast('이미지를 넣지 못했어요: ' + err.message, { error: true });
        }
      },
    },
  });

  /* ---------------- 상태 표시 ---------------- */
  function setDirty(v) {
    if (loading) return;
    dirty = v;
    renderStatus();
  }
  function renderStatus() {
    const base = !originalSlug ? '새 글' : published ? '발행됨' : '임시저장됨';
    statusEl.textContent = dirty ? base + ' · 저장 안 됨' : base;
    statusEl.classList.toggle('dirty', dirty);
    btnPublish.textContent = published ? '수정 발행' : '발행';
    btnDraft.textContent = published ? '발행 취소(임시저장)' : '임시저장';
    btnDelete.hidden = !originalSlug;
  }

  /* ---------------- 글 주소 ---------------- */
  function slugify(s) {
    return String(s || '').normalize('NFC').toLowerCase().trim()
      .replace(/[\s/]+/g, '-')
      .replace(/[^\p{L}\p{N}_-]+/gu, '')
      .replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 60);
  }
  // 새 글을 시작한 시각 (HHmm). 같은 날 여러 글을 써도 주소가 겹치지 않게 날짜 뒤에 붙임
  let slugTime = '';
  const nowHHmm = () => {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  };
  function autoSlug() {
    if (slugTouched || originalSlug) return;
    if (!slugTime) slugTime = nowHHmm();
    const t = slugify(titleEl.value);
    slugEl.value = (dateEl.value || today()) + '-' + slugTime + (t ? '-' + t : '');
    renderSlug();
  }
  function renderSlug() { slugPreview.textContent = slugEl.value || '…'; }

  /* ---------------- 대표 이미지 ---------------- */
  function renderCover() {
    coverPreview.textContent = '';
    if (cover) {
      const img = document.createElement('img');
      img.src = '/' + cover;
      img.alt = '대표 이미지 미리보기';
      coverPreview.append(img);
    } else coverPreview.textContent = '대표 이미지 없음';
    coverClear.hidden = !cover;
  }
  $('w-cover-pick').addEventListener('click', () => coverFile.click());
  coverFile.addEventListener('change', async () => {
    const f = coverFile.files && coverFile.files[0];
    coverFile.value = '';
    if (!f) return;
    try { cover = await uploadImage(f); renderCover(); setDirty(true); }
    catch (err) { toast('이미지를 넣지 못했어요: ' + err.message, { error: true }); }
  });
  coverClear.addEventListener('click', () => { cover = ''; renderCover(); setDirty(true); });

  /* ---------------- 입력 감지 ---------------- */
  titleEl.addEventListener('input', () => { autoSlug(); setDirty(true); });
  dateEl.addEventListener('input', () => { autoSlug(); setDirty(true); });
  for (const el of [catEl, tagsEl, summaryEl]) el.addEventListener('input', () => setDirty(true));
  slugEl.addEventListener('input', () => { slugTouched = true; renderSlug(); setDirty(true); });
  editor.on('change', () => setDirty(true));

  /* ---------------- 글 목록 / 불러오기 ---------------- */
  async function refreshList() {
    const posts = await (await fetch('/__editor/posts')).json();
    const keep = loadEl.value;
    loadEl.length = 1;
    for (const p of posts) {
      const opt = document.createElement('option');
      opt.value = p.slug;
      opt.textContent = (p.draft ? '[임시] ' : '') + p.title + '  (' + p.date + ')';
      loadEl.append(opt);
    }
    loadEl.value = originalSlug || keep || '';
    const cats = [...new Set(posts.map((p) => p.category).filter(Boolean))].sort();
    $('w-category-list').replaceChildren(...cats.map((c) => Object.assign(document.createElement('option'), { value: c })));
  }

  function fillForm(data) {
    loading = true;
    const m = data ? data.meta : {};
    originalSlug = data ? data.slug : '';
    published = data ? !m.draft : false;
    titleEl.value = m.title || '';
    catEl.value = m.category || '';
    tagsEl.value = (m.tags || []).join(', ');
    dateEl.value = m.date || today();
    summaryEl.value = m.summary || '';
    cover = m.cover || '';
    slugEl.value = originalSlug;
    slugTouched = !!originalSlug;
    slugTime = originalSlug ? '' : nowHHmm();
    editor.setMarkdown(data ? data.markdown : '', false);
    loadEl.value = originalSlug;
    renderCover();
    if (!originalSlug) autoSlug(); else renderSlug();
    const url = new URL(location.href);
    if (originalSlug) url.searchParams.set('slug', originalSlug); else url.searchParams.delete('slug');
    history.replaceState(null, '', url);
    document.title = (m.title ? m.title + ' - ' : '') + '글쓰기 | KOSEONGBOY.DEV 편집기';
    loading = false;
    dirty = false;
    renderStatus();
  }

  async function loadPost(slug) {
    if (!slug) { fillForm(null); titleEl.focus(); return; }
    const res = await fetch('/__editor/post?slug=' + encodeURIComponent(slug));
    const json = await res.json();
    if (!res.ok) { toast(json.error || '글을 불러오지 못했어요', { error: true }); fillForm(null); return; }
    fillForm(json);
  }

  loadEl.addEventListener('change', async () => {
    if (dirty && !confirm('저장하지 않은 내용이 있어요. 버리고 다른 글을 열까요?')) { loadEl.value = originalSlug; return; }
    await loadPost(loadEl.value);
  });

  /* ---------------- 저장 ---------------- */
  let saving = false;
  async function save(draft) {
    if (saving) return;
    if (!titleEl.value.trim()) { toast('제목을 입력해 주세요', { error: true }); titleEl.focus(); return; }
    if (!slugEl.value.trim()) autoSlug();
    saving = true;
    btnDraft.disabled = btnPublish.disabled = true;
    try {
      const res = await fetch('/__editor/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalSlug,
          slug: slugEl.value.trim(),
          draft,
          meta: {
            title: titleEl.value.trim(),
            category: catEl.value.trim(),
            tags: tagsEl.value.split(',').map((t) => t.trim()).filter(Boolean),
            date: dateEl.value || today(),
            summary: summaryEl.value.trim(),
            cover,
          },
          markdown: editor.getMarkdown(),
          html: editor.getHTML(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '저장 실패');
      originalSlug = json.slug;
      slugEl.value = json.slug;
      slugTouched = true;
      published = !draft;
      dirty = false;
      renderStatus();
      renderSlug();
      const url = new URL(location.href);
      url.searchParams.set('slug', originalSlug);
      history.replaceState(null, '', url);
      await refreshList();
      if (draft) toast('임시저장했어요. 임시저장 글은 블로그에 보이지 않아요.');
      else toast('발행했어요 ✓', { link: { href: json.url, text: '글 보기 ▶' } });
    } catch (err) {
      toast('저장하지 못했어요: ' + err.message, { error: true });
    } finally {
      saving = false;
      btnDraft.disabled = btnPublish.disabled = false;
    }
  }
  btnPublish.addEventListener('click', () => save(false));
  btnDraft.addEventListener('click', () => {
    if (published && !confirm('발행을 취소하고 임시저장할까요? 블로그에서 이 글이 사라져요.')) return;
    save(true);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(!published);   // 발행된 글은 발행 상태 그대로, 아니면 임시저장
    }
  });

  /* ---------------- 삭제 ---------------- */
  btnDelete.addEventListener('click', async () => {
    if (!originalSlug) return;
    if (!confirm('"' + (titleEl.value || originalSlug) + '" 글을 삭제할까요? 되돌릴 수 없어요.')) return;
    const res = await fetch('/__editor/post/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: originalSlug }) });
    const json = await res.json();
    if (!res.ok) { toast(json.error || '삭제하지 못했어요', { error: true }); return; }
    fillForm(null);
    await refreshList();
    toast('삭제했어요');
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- 시작 ---------------- */
  (async () => {
    await refreshList().catch(() => {});
    await loadPost(new URLSearchParams(location.search).get('slug') || '');
  })();
})();
