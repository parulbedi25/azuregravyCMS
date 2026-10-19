/* Gravy — public site interactions. No dependencies. */
(function () {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const html = document.documentElement;
  html.classList.add('js');

  /* ------------------------------------------------------------- toasts */
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
    el.innerHTML = `<span>${message}</span><button class="toast__close" data-toast-close aria-label="Dismiss">✕</button>`;
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

  /* -------------------------------------------------------------- header */
  const header = $('#siteHeader');
  if (header) {
    const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* --------------------------------------------------------------- theme */
  const themeMeta = $('meta[name="theme-color"]');
  function applyTheme(theme) {
    html.dataset.theme = theme;
    try { localStorage.setItem('gravy-theme', theme); } catch (error) { /* ignore */ }
    if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
    $$('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('title', theme === 'dark' ? 'Light mode' : 'Dark mode');
    });
  }
  /* A short cross-fade so switching modes feels smooth rather than abrupt. */
  function crossFade(apply) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();
      return;
    }
    html.classList.add('theme-anim');
    apply();
    window.clearTimeout(window.__themeAnim);
    window.__themeAnim = window.setTimeout(() => html.classList.remove('theme-anim'), 460);
  }
  $$('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
      crossFade(() => applyTheme(next));
    });
  });
  if (html.dataset.theme === 'dark') applyTheme('dark');

  /* ----------------------------------------------------------- mobile nav */
  const mobileNav = $('#mobileNav');
  function openMenu() {
    if (!mobileNav) return;
    mobileNav.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    const first = $('.mobile-nav__links a', mobileNav);
    if (first) first.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (!mobileNav) return;
    mobileNav.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  $$('[data-open-menu]').forEach((button) => button.addEventListener('click', openMenu));
  $$('[data-close-menu]').forEach((button) => button.addEventListener('click', closeMenu));

  /* -------------------------------------------------------------- search */
  const overlay = $('#searchOverlay');
  const searchInput = $('#searchInput');
  const results = $('#searchResults');
  let searchTimer = null;
  let searchRequest = null;

  function openSearch() {
    if (!overlay) return;
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => searchInput && searchInput.focus(), 30);
  }
  function closeSearch() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    if (results) results.innerHTML = '';
  }
  $$('[data-open-search]').forEach((button) => button.addEventListener('click', openSearch));
  if (overlay) {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeSearch();
    });
  }

  document.addEventListener('keydown', (event) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (event.key === 'Escape') {
      closeSearch();
      closeMenu();
    }
    if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
      event.preventDefault();
      openSearch();
    }
  });

  function renderResults(items, query) {
    if (!results) return;
    if (!items.length) {
      results.innerHTML = `<div class="search-result"><span class="muted small">No stories matched “${escapeHtml(query)}”. Try another word.</span></div>`;
      return;
    }
    results.innerHTML = items
      .map(
        (item) => `<a class="search-result" href="${item.url}">
          ${item.image ? `<img src="${item.image}" alt="" loading="lazy">` : ''}
          <span>
            <span class="latest-item__cat">${escapeHtml(item.category || 'Story')}</span>
            <b style="display:block;font-size:.9rem;font-weight:560;line-height:1.35">${escapeHtml(item.title)}</b>
            <span class="muted small">${escapeHtml(item.excerpt || '')}</span>
          </span>
        </a>`,
      )
      .join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  if (searchInput && results) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      clearTimeout(searchTimer);
      if (query.length < 2) {
        results.innerHTML = '';
        return;
      }
      searchTimer = setTimeout(async () => {
        try {
          if (searchRequest) searchRequest.abort();
          searchRequest = new AbortController();
          const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: searchRequest.signal });
          if (!response.ok) throw new Error('search failed');
          const data = await response.json();
          renderResults(data.results || [], query);
        } catch (error) {
          if (error.name !== 'AbortError') results.innerHTML = '<div class="search-result"><span class="muted small">Search is unavailable right now.</span></div>';
        }
      }, 200);
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        window.location.href = `/search?q=${encodeURIComponent(searchInput.value.trim())}`;
      }
    });
  }

  /* ----------------------------------------------------- reading progress */
  const article = $('#articleBody');
  const progress = $('#readingProgress');
  if (article && progress) {
    progress.hidden = false;
    const update = () => {
      const rect = article.getBoundingClientRect();
      const start = window.scrollY + rect.top - 120;
      const total = article.offsetHeight - window.innerHeight * 0.4;
      const value = Math.min(1, Math.max(0, (window.scrollY - start) / Math.max(total, 1)));
      progress.style.width = `${value * 100}%`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }

  /* ------------------------------------------------------------- toc spy */
  const tocLinks = $$('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const map = new Map();
    tocLinks.forEach((link) => {
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      const target = document.getElementById(id);
      if (target) map.set(target, link);
    });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          tocLinks.forEach((link) => link.classList.remove('is-active'));
          const active = map.get(entry.target);
          if (active) active.classList.add('is-active');
        });
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    map.forEach((_link, target) => observer.observe(target));
  }

  /* --------------------------------------------------------- scroll reveal */
  const revealables = $$('[data-reveal]');
  if (revealables.length) {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      revealables.forEach((el) => el.classList.add('is-visible'));
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        },
        { rootMargin: '200px 0px 0px 0px', threshold: 0 },
      );
      revealables.forEach((el) => observer.observe(el));
      // Safety net: nothing should stay invisible for more than a moment.
      setTimeout(() => revealables.forEach((el) => el.classList.add('is-visible')), 2500);
    }
  }

  /* --------------------------------------------------------------- sharing */
  $$('[data-copy-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        toast('Link copied to clipboard.', 'success');
      } catch (error) {
        toast('Could not copy the link — copy it from the address bar.', 'error');
      }
    });
  });

  /* ------------------------------------------------------------ bookmarking */
  const bookmarks = (() => {
    try { return JSON.parse(localStorage.getItem('gravy-saved') || '[]'); } catch (error) { return []; }
  })();
  $$('[data-bookmark]').forEach((button) => {
    const key = window.location.pathname;
    const sync = () => {
      const saved = bookmarks.includes(key);
      button.classList.toggle('is-saved', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.style.color = saved ? 'var(--accent)' : '';
    };
    sync();
    button.addEventListener('click', () => {
      const index = bookmarks.indexOf(key);
      if (index >= 0) {
        bookmarks.splice(index, 1);
        toast('Removed from your reading list.', 'info');
      } else {
        bookmarks.push(key);
        toast('Saved to your reading list on this device.', 'success');
      }
      try { localStorage.setItem('gravy-saved', JSON.stringify(bookmarks)); } catch (error) { /* ignore */ }
      sync();
    });
  });

  /* -------------------------------------------------------------- replies */
  const parentField = $('#commentParent');
  const replyNotice = $('#replyNotice');
  if (parentField) {
    $$('[data-reply-to]').forEach((button) => {
      button.addEventListener('click', () => {
        parentField.value = button.dataset.replyTo;
        if (replyNotice) {
          replyNotice.classList.remove('hide');
          replyNotice.querySelector('span').firstChild.textContent = `Replying to ${button.dataset.replyName}. `;
        }
        $('#commentForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
        const textarea = $('#commentForm textarea');
        if (textarea) setTimeout(() => textarea.focus(), 300);
      });
    });
    const cancel = $('[data-cancel-reply]');
    if (cancel) {
      cancel.addEventListener('click', () => {
        parentField.value = '';
        if (replyNotice) replyNotice.classList.add('hide');
      });
    }
  }

  /* --------------------------------------------------------- code copybtn */
  $$('.prose pre').forEach((pre) => {
    const button = document.createElement('button');
    button.className = 'code-copy';
    button.type = 'button';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      const code = pre.querySelector('code');
      try {
        await navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = 'Copy'), 1600);
      } catch (error) {
        button.textContent = 'Press ⌘C';
      }
    });
    pre.appendChild(button);
  });

  /* ------------------------------------------------------------ back to top */
  $$('[data-to-top]').forEach((button) => {
    button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  });

  /* ------------------------------------------------------- newsletter ajax */
  $$('form.newsletter-form').forEach((form) => {
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = true;
        button.innerHTML = 'Subscribing…';
      }
    });
  });
})();
