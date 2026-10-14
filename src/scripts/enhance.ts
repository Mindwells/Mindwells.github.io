/**
 * Progressive enhancements.
 *
 * Kept as one small module rather than a component-per-behaviour: the whole
 * file is a few KB, runs once on load, and degrades to a fully functional
 * static page if any single feature fails.
 *
 * Everything here respects `prefers-reduced-motion`.
 */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------
   Scroll reveal
   Elements opt in with `data-reveal`. Stagger is expressed in the markup via
   `data-reveal-delay` so the rhythm is authored, not guessed at runtime.
   ------------------------------------------------------------------------- */

function initReveal(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (targets.length === 0) return;

  // No IntersectionObserver (or motion is unwelcome): show everything now.
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-revealed'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        const delay = el.dataset.revealDelay;
        if (delay) el.style.setProperty('--reveal-delay', `${delay}ms`);
        el.classList.add('is-revealed');
        // Reveal is one-way: re-animating on scroll-up reads as a glitch.
        observer.unobserve(el);
      }
    },
    {
      // Trigger slightly before the element is fully on screen so the motion
      // finishes as the reader arrives at the content.
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.05,
    },
  );

  targets.forEach((el) => observer.observe(el));

  /**
   * Safety net.
   *
   * The trigger margin deliberately holds elements back until they are ~12%
   * into the viewport. On a short page — or on the last section — content can
   * live permanently inside that sliver and would never appear. Reaching the
   * bottom of the document reveals whatever is left, so nothing can stay
   * invisible.
   */
  let swept = false;
  const sweep = (): void => {
    if (swept) return;
    const atBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (!atBottom) return;
    swept = true;
    for (const el of targets) {
      el.classList.add('is-revealed');
      observer.unobserve(el);
    }
    window.removeEventListener('scroll', sweep);
  };

  window.addEventListener('scroll', sweep, { passive: true });
  sweep();
}

/* -------------------------------------------------------------------------
   Header state
   Adds a compact/solid treatment once the hero has scrolled past, and
   highlights the section currently in view.
   ------------------------------------------------------------------------- */

function initHeader(): void {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;

  const sentinel = document.querySelector<HTMLElement>('[data-header-sentinel]');

  if (sentinel && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      ([entry]) => header.classList.toggle('is-condensed', !entry.isIntersecting),
      { threshold: 0 },
    ).observe(sentinel);
  }

  // Active-section highlighting.
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('[data-nav-link][href^="#"]'),
  );
  const sections = links
    .map((link) => {
      const id = link.getAttribute('href')?.slice(1);
      return id ? document.getElementById(id) : null;
    })
    .filter((el): el is HTMLElement => el !== null);

  if (sections.length === 0 || !('IntersectionObserver' in window)) return;

  const visible = new Set<string>();

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = entry.target.id;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }

      // Pick the topmost visible section so the highlight never flickers
      // between two sections that are both on screen.
      let active: string | null = null;
      for (const section of sections) {
        if (visible.has(section.id)) {
          active = section.id;
          break;
        }
      }

      links.forEach((link) => {
        const isActive = active !== null && link.getAttribute('href') === `#${active}`;
        link.classList.toggle('is-active', isActive);
        if (isActive) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    },
    { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
  );

  sections.forEach((section) => sectionObserver.observe(section));
}

/* -------------------------------------------------------------------------
   Theme toggle
   The initial theme is applied by an inline script in <head> to avoid a
   flash; this only handles the user's explicit choice.
   ------------------------------------------------------------------------- */

function initTheme(): void {
  const toggles = document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]');
  if (toggles.length === 0) return;

  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const current = (): 'light' | 'dark' => {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return media.matches ? 'dark' : 'light';
  };

  const sync = (): void => {
    const theme = current();
    toggles.forEach((toggle) => {
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
      toggle.dataset.currentTheme = theme;
      const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
    });
  };

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* private mode — the choice just won't persist */
      }
      sync();
    });
  });

  media.addEventListener('change', sync);
  sync();
}

/* -------------------------------------------------------------------------
   Copy-to-clipboard
   Applied to the email affordance so a recruiter can grab the address in one
   click; the confirmation is announced politely for screen readers.
   ------------------------------------------------------------------------- */

function initCopy(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-copy]');
  if (buttons.length === 0) return;

  buttons.forEach((button) => {
    const status = button.parentElement?.querySelector<HTMLElement>('[data-copy-status]');
    const original = button.dataset.copyLabel ?? '';

    button.addEventListener('click', async () => {
      const value = button.dataset.copy;
      if (!value) return;

      try {
        await navigator.clipboard.writeText(value);
      } catch {
        // Clipboard API needs a secure context; fall back to a selection hack.
        const field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'absolute';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        try {
          document.execCommand('copy');
        } catch {
          /* nothing more we can do */
        }
        document.body.removeChild(field);
      }

      button.classList.add('is-copied');
      if (status) status.textContent = 'Copied to clipboard';
      window.setTimeout(() => {
        button.classList.remove('is-copied');
        if (status) status.textContent = '';
        if (original) button.setAttribute('aria-label', original);
      }, 2000);
    });
  });
}

/* -------------------------------------------------------------------------
   Footer year
   ------------------------------------------------------------------------- */

function initYear(): void {
  const year = String(new Date().getFullYear());
  document.querySelectorAll<HTMLElement>('[data-year]').forEach((el) => {
    el.textContent = year;
  });
}

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */

function boot(): void {
  // Each feature is isolated so a failure in one cannot take down the rest.
  for (const init of [initReveal, initHeader, initTheme, initCopy, initYear]) {
    try {
      init();
    } catch (error) {
      console.error('[mindwells] enhancement failed:', error);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
