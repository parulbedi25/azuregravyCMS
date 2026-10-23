/* Gravy Studio — admin interactions. No dependencies. */
(function () {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const csrf = ($('input[name="_csrf"]') || {}).value || '';
  const root = document.documentElement;

  /* ---------------------------------------------------------------- toasts */
  function toast(message, type = 'info') {
    let stack = $('#toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.id = 'toastStack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', 'status');
    const messageEl = document.createElement('span');
    messageEl.textContent = message;
    const close = document.createElement('button');
    close.className = 'toast__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    el.append(messageEl, close);
    stack.appendChild(el);
    setTimeout(() => dismiss(el), 4200);
  }
  function dismiss(el) {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }
  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-toast-close]');
    if (close) dismiss(close.closest('.toast'));
  });

  /* ----------------------------------------------------------------- theme */
  function applyTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem('gravy-theme', theme); } catch (error) { /* ignore */ }
    $$('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }
  function crossFade(apply) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();
      return;
    }
    root.classList.add('theme-anim');
    apply();
    window.clearTimeout(window.__themeAnim);
    window.__themeAnim = window.setTimeout(() => root.classList.remove('theme-anim'), 460);
  }
  $$('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      crossFade(() => applyTheme(next));
    });
  });
  if (root.dataset.theme === 'dark') applyTheme('dark');

  /* --------------------------------------------------------------- sidebar */
  const sidebar = $('#sidebar');
  $$('[data-open-sidebar]').forEach((button) =>
    button.addEventListener('click', () => sidebar && sidebar.classList.add('is-open')),
  );
  $$('[data-close-sidebar]').forEach((button) =>
    button.addEventListener('click', () => sidebar && sidebar.classList.remove('is-open')),
  );

  /* -------------------------------------------------------------- confirms */
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-confirm]');
    if (!trigger) return;
    if (!window.confirm(trigger.dataset.confirm)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  /* --------------------------------------------------------- bulk selection */
  const table = $('[data-bulk-table]');
  const bulkBar = $('#bulkBar');
  const bulkCount = $('#bulkCount');
  if (table && bulkBar) {
    const checkboxes = () => $$('tbody input[type="checkbox"][name="ids"]', table);
    const sync = () => {
      const selected = checkboxes().filter((box) => box.checked);
      if (bulkCount) bulkCount.textContent = `${selected.length} selected`;
      bulkBar.classList.toggle('is-visible', selected.length > 0);
      const all = $('thead input[type="checkbox"]', table);
      if (all) {
        all.checked = selected.length === checkboxes().length && selected.length > 0;
        all.indeterminate = selected.length > 0 && selected.length < checkboxes().length;
      }
    };
    table.addEventListener('change', (event) => {
      if (event.target.matches('input[type="checkbox"]')) {
        const all = $('thead input[type="checkbox"]', table);
        if (event.target === all) {
          checkboxes().forEach((box) => (box.checked = event.target.checked));
        }
        sync();
      }
    });
    sync();

    const apply = $('#bulkApply');
    if (apply) {
      apply.addEventListener('click', () => {
        const action = $('#bulkAction').value;
        const ids = checkboxes().filter((box) => box.checked).map((box) => box.value);
        if (!ids.length) return;
        if (action === 'delete' && !window.confirm(`Permanently delete ${ids.length} item(s)? This cannot be undone.`)) return;
        $('#bulkFormAction').value = action;
        $('#bulkFormIds').value = ids.join(',');
        $('#bulkForm').submit();
      });
    }
  }

  /* ------------------------------------------------------- auto-submitting */
  $$('[data-auto-submit]').forEach((field) => {
    field.addEventListener('change', () => field.form && field.form.submit());
  });

  /* ------------------------------------------------------------ media modal */
  const modal = $('#mediaModal');
  const modalGrid = $('#modalMediaGrid');
  const modalSearch = $('#modalMediaSearch');
  let mediaTarget = null;
  let mediaItems = [];

  function renderModalMedia() {
    if (!modalGrid) return;
    if (!mediaItems.length) {
      modalGrid.innerHTML = '<p class="text-sm text-muted">No images yet. Upload one above.</p>';
      return;
    }
    modalGrid.innerHTML = mediaItems
      .map(
        (item) => `<button type="button" class="media-item" data-pick="${item.id}" data-path="${item.path}" title="${item.original_name}">
          <span class="media-item__thumb"><img src="${item.path}" alt="" loading="lazy"></span>
          <span class="media-item__meta"><b>${item.original_name}</b><span>${item.width || '?'} × ${item.height || '?'}</span></span>
        </button>`,
      )
      .join('');
  }

  async function loadMedia(query = '') {
    try {
      const response = await fetch(`/admin/api/media?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      mediaItems = data.media || [];
      renderModalMedia();
    } catch (error) {
      toast('Could not load the library.', 'error');
    }
  }

  function openMediaModal(target) {
    if (!modal) return;
    mediaTarget = target;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    if (!mediaItems.length) loadMedia();
  }
  function closeMediaModal() {
    if (!modal) return;
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  /**
   * Point a media field at an image and reflect it immediately, without saving.
   *
   * Shared by the library modal and the quick-pick thumbnails so both behave the
   * same. Two things here are load-bearing:
   *  - the preview <img> is permanent markup, so visibility is driven by the
   *    .has-image class and never by an inline display:none. The old empty state
   *    carried an inline display:none that nothing ever cleared, so choosing an
   *    image updated src but left it invisible until the page reloaded;
   *  - nothing is removed from the DOM. The old remove handler deleted the <img>,
   *    after which the pick handler could not restore it (its fallback was gated
   *    on a wrapper derived from the very element that had just gone), so
   *    pick -> remove -> pick showed no image at all.
   */
  function applyMediaSelection(target, id, path) {
    const field = document.getElementById(target);
    if (field) field.value = id == null ? '' : String(id);

    const preview = document.getElementById(`${target}-preview`);
    if (preview) {
      preview.src = path || '';
      preview.style.display = '';
      preview.hidden = false;
    }

    const wrap = preview ? preview.closest('.image-picker') : null;
    if (wrap) {
      wrap.classList.toggle('has-image', !!path);
    } else if (preview) {
      // The social-image thumbnail is not inside an .image-picker, so it has no
      // class-driven visibility and needs its own switch.
      preview.style.display = path ? '' : 'none';
    }

    $$(`[data-quick-pick="${target}"]`).forEach((button) => {
      const on = id != null && id !== '' && String(button.dataset.id) === String(id);
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function clearMediaSelection(target) {
    applyMediaSelection(target, '', '');
  }

  $$('[data-pick-media]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      openMediaModal(button.dataset.pickMedia);
    });
  });

  /* Quick-pick thumbnails select straight away — no modal round trip. */
  $$('[data-quick-pick]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      applyMediaSelection(button.dataset.quickPick, button.dataset.id, button.dataset.path);
      toast('Featured image set.', 'success');
    });
  });

  $$('[data-remove-media]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      clearMediaSelection(button.dataset.removeMedia);
    });
  });

  if (modal) {
    $$('[data-close-modal]', modal).forEach((button) => button.addEventListener('click', closeMediaModal));
    modal.addEventListener('click', (event) => {
      const pick = event.target.closest('[data-pick]');
      if (!pick) return;
      applyMediaSelection(mediaTarget, pick.dataset.pick, pick.dataset.path);
      closeMediaModal();
      toast('Image selected.', 'success');
    });
    if (modalSearch) {
      let timer;
      modalSearch.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => loadMedia(modalSearch.value.trim()), 220);
      });
    }
    const uploadInput = $('#modalMediaUpload');
    if (uploadInput) {
      uploadInput.addEventListener('change', async () => {
        if (!uploadInput.files.length) return;
        const body = new FormData();
        Array.from(uploadInput.files).forEach((file) => body.append('files', file));
        try {
          const response = await fetch('/admin/api/media/upload', {
            method: 'POST',
            headers: { 'x-csrf-token': csrf },
            body,
          });
          if (!response.ok) throw new Error('upload failed');
          await loadMedia();
          toast('Image uploaded.', 'success');
        } catch (error) {
          toast('Upload failed — check the file type and size.', 'error');
        }
      });
    }
  }

  /* ------------------------------------------------------------- media page */
  const dropzone = $('#dropzone');
  if (dropzone) {
    const input = $('#mediaFileInput');
    dropzone.addEventListener('click', () => input && input.click());
    ['dragenter', 'dragover'].forEach((type) =>
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-dragover');
      }),
    );
    ['dragleave', 'drop'].forEach((type) =>
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-dragover');
      }),
    );
    dropzone.addEventListener('drop', (event) => {
      if (event.dataTransfer.files.length && input) {
        input.files = event.dataTransfer.files;
        input.form.submit();
      }
    });
    if (input) {
      input.addEventListener('change', () => {
        if (input.files.length) input.form.submit();
      });
    }
  }

  $$('[data-copy]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        toast('Copied to clipboard.', 'success');
      } catch (error) {
        toast('Copy failed.', 'error');
      }
    });
  });

  /* -------------------------------------------------------------- side cards */
  $$('.side-card--collapsible .side-card__head').forEach((head) => {
    head.addEventListener('click', (event) => {
      if (event.target.closest('button[type="submit"]')) return;
      head.closest('.side-card').classList.toggle('side-card--open');
    });
  });

  /* ------------------------------------------------------------- SEO counts */
  $$('[data-counter]').forEach((field) => {
    const output = document.getElementById(field.dataset.counter);
    const ideal = Number(field.dataset.ideal || 60);
    const max = Number(field.dataset.max || 160);
    const update = () => {
      if (!output) return;
      const length = field.value.length;
      output.textContent = `${length} / ${max}`;
      output.classList.toggle('is-warn', length > 0 && length < ideal);
      output.classList.toggle('is-over', length > max);
    };
    field.addEventListener('input', update);
    update();
  });

  /* ------------------------------------------------------- colour swatches */
  $$('[data-swatch]').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      const input = document.getElementById(swatch.dataset.swatch);
      if (!input) return;
      input.value = swatch.dataset.color;
      $$(`[data-swatch="${swatch.dataset.swatch}"]`).forEach((el) => el.classList.remove('is-active'));
      swatch.classList.add('is-active');
      if (swatch.dataset.swatch === 'accent_color') liveAccent(swatch.dataset.color);
    });
  });

  /* Preview an accent colour before saving it. */
  function liveAccent(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color || '')) return;
    document.documentElement.style.setProperty('--admin-accent', color);
    const label = document.querySelector('[data-accent-label]');
    if (label) label.textContent = color;
    const picker = document.getElementById('accent_color');
    if (picker && picker.value !== color) picker.value = color;
  }
  const accentInput = document.getElementById('accent_color');
  if (accentInput) {
    accentInput.addEventListener('input', () => liveAccent(accentInput.value));
    accentInput.addEventListener('change', () => liveAccent(accentInput.value));
  }

  /* ------------------------------------------------------------- editor */
  const editorForm = $('#editorForm');
  if (editorForm) {
    initEditor(editorForm);
  }

  function initEditor(form) {
    const textarea = $('#content', form);
    const title = $('#title', form);
    const slug = $('#slug', form);
    const slugLocked = $('#slugLocked', form);
    const preview = $('#editorPreview');
    const wordCount = $('#wordCount');
    const readTime = $('#readTime');
    const charCount = $('#charCount');
    const tabButtons = $$('[data-editor-tab]');
    const panes = { write: $('#paneWrite'), preview: $('#panePreview') };
    const postKey = `gravy-draft-${form.dataset.postId || 'new'}`;

    const slugify = (value) =>
      value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’"]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);

    function stats() {
      if (!textarea) return;
      const text = textarea.value;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const minutes = Math.max(1, Math.round(words / 220));
      if (wordCount) wordCount.textContent = `${words} words`;
      if (charCount) charCount.textContent = `${text.length} characters`;
      if (readTime) readTime.textContent = `${minutes} min read`;
    }

    function renderPreview() {
      if (!preview || !textarea) return;
      const markdown = textarea.value.trim();
      if (!markdown) {
        preview.innerHTML = '<div class="editor-preview__empty">Start writing — the preview will build itself.</div>';
        return;
      }
      preview.innerHTML = '<div class="editor-preview__empty">Rendering…</div>';
      fetch('/admin/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ markdown: textarea.value }),
      })
        .then((response) => response.json())
        .then((data) => {
          preview.innerHTML = `<div class="prose">${data.html}</div>`;
        })
        .catch(() => {
          preview.innerHTML = '<div class="editor-preview__empty">Preview unavailable. Your text is still safe.</div>';
        });
    }

    function setTab(tab) {
      tabButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.editorTab === tab));
      Object.entries(panes).forEach(([key, pane]) => pane && pane.classList.toggle('is-active', key === tab));
      if (tab === 'preview') renderPreview();
    }
    tabButtons.forEach((button) => button.addEventListener('click', () => setTab(button.dataset.editorTab)));

    /* toolbar */
    $$('[data-insert]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (!textarea) return;
        const type = button.dataset.insert;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.slice(start, end);
        const wrappers = {
          bold: ['**', '**', 'bold text'],
          italic: ['*', '*', 'italic text'],
          h2: ['\n## ', '\n', 'Section heading'],
          h3: ['\n### ', '\n', 'Sub heading'],
          quote: ['\n> ', '\n', 'A line worth quoting'],
          code: ['\n```js\n', '\n```\n', 'console.log("hello")'],
          ul: ['\n- ', '\n', 'List item'],
          ol: ['\n1. ', '\n', 'List item'],
          link: ['[', '](https://)', 'link text'],
          image: ['\n![', '](/uploads/your-image.jpg)\n', 'Describe the image'],
          hr: ['\n\n---\n\n', '', ''],
        };
        const [before, after, placeholder] = wrappers[type] || ['', '', ''];
        const text = selected || placeholder;
        textarea.setRangeText(before + text + after, start, end, 'end');
        if (!selected) {
          const cursor = start + before.length;
          textarea.setSelectionRange(cursor, cursor + text.length);
        }
        textarea.focus();
        updateDirty();
        stats();
        if (panes.preview && panes.preview.classList.contains('is-active')) renderPreview();
      });
    });

    /* slug */
    if (title && slug && slugLocked) {
      slugLocked.addEventListener('change', () => {
        if (slugLocked.checked && title) slug.value = slugify(title.value);
      });
      title.addEventListener('input', () => {
        if (slugLocked.checked) slug.value = slugify(title.value);
      });
      slug.addEventListener('input', () => {
        if (slugLocked.checked && slug.value !== slugify(title.value)) slugLocked.checked = false;
      });
      if (!slug.value && title.value) slug.value = slugify(title.value);
    }

    /* tags */
    const tagWrap = $('#tagInput');
    if (tagWrap) {
      const hidden = $('#tagsValue');
      const input = $('#tagEntry', tagWrap);
      const chips = $('#tagChips', tagWrap);
      const read = () =>
        (hidden.value || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
      const write = (tags) => {
        hidden.value = tags.join(', ');
        chips.innerHTML = tags
          .map(
            (tag, index) =>
              `<span class="tag-input__chip">${tag.replace(/</g, '&lt;')}<button type="button" data-remove-tag="${index}" aria-label="Remove ${tag}">✕</button></span>`,
          )
          .join('');
      };
      const add = (value) => {
        const tags = read();
        value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .forEach((tag) => {
            if (!tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
          });
        write(tags);
        input.value = '';
      };
      write(read());
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          add(input.value);
        }
        if (event.key === 'Backspace' && !input.value) {
          const tags = read();
          tags.pop();
          write(tags);
        }
      });
      input.addEventListener('blur', () => input.value && add(input.value));
      tagWrap.addEventListener('click', (event) => {
        const remove = event.target.closest('[data-remove-tag]');
        if (!remove) return;
        const tags = read();
        tags.splice(Number(remove.dataset.removeTag), 1);
        write(tags);
      });
    }

    /* autosave to localStorage */
    let dirty = false;
    const updateDirty = () => {
      dirty = true;
      const indicator = $('#saveState');
      if (indicator) indicator.textContent = 'Unsaved changes';
    };
    function snapshot() {
      try {
        localStorage.setItem(
          postKey,
          JSON.stringify({ title: title ? title.value : '', content: textarea ? textarea.value : '', at: Date.now() }),
        );
      } catch (error) { /* ignore */ }
    }
    if (textarea) {
      textarea.addEventListener('input', () => {
        updateDirty();
        stats();
        clearTimeout(window.__autosave);
        window.__autosave = setTimeout(snapshot, 900);
      });
    }
    if (title) title.addEventListener('input', updateDirty);

    /* restore autosave */
    try {
      const saved = JSON.parse(localStorage.getItem(postKey) || 'null');
      if (saved && textarea && saved.content && saved.content !== textarea.value) {
        const restore = window.confirm(
          `An unsaved draft from ${new Date(saved.at).toLocaleString()} was found. Restore it?`,
        );
        if (restore) {
          textarea.value = saved.content;
          if (title && saved.title) title.value = saved.title;
          stats();
        }
      }
    } catch (error) { /* ignore */ }

    form.addEventListener('submit', () => {
      dirty = false;
      try { localStorage.removeItem(postKey); } catch (error) { /* ignore */ }
    });
    window.addEventListener('beforeunload', (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });

    /* keyboard save */
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        const submitter = form.querySelector('[data-save-button]');
        if (submitter) submitter.click();
        else form.requestSubmit();
      }
    });

    /* publish intent buttons */
    $$('[data-intent]').forEach((button) => {
      button.addEventListener('click', () => {
        const field = $('#intentField');
        if (field) field.value = button.dataset.intent;
      });
    });

    stats();
  }

  /* --------------------------------------------------- settings tab memory */
  $$('[data-tab-link]').forEach((link) => {
    link.addEventListener('click', () => {
      $$('[data-tab-link]').forEach((item) => item.classList.remove('is-active'));
      link.classList.add('is-active');
    });
  });

  /* ---------------------------------------------------- topbar keyboard "/" */
  document.addEventListener('keydown', (event) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (event.key === '/' && !typing) {
      const search = $('.topbar-search input');
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
    if (event.key === 'Escape') {
      closeMediaModal();
      if (sidebar) sidebar.classList.remove('is-open');
    }
  });

  /* Expose a tiny API for inline view scripts. */
  window.GravyStudio = { toast };
})();
