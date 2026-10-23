/* SpeakBand motion layer — scroll-driven 3D (progressive enhancement).
 *
 * Only initializes when ALL of these hold:
 *   - GSAP + ScrollTrigger loaded from CDN
 *   - no prefers-reduced-motion
 *   - viewport wider than 768px (mobile keeps the static design)
 * Anything failing -> the site works exactly as before. Motion never
 * blocks content: scripts are deferred and every effect is transform/
 * opacity-only (compositor cost), per the gsap-performance playbook.
 *
 * Layering (tasteful, not gimmicky): the hero reads as three depth
 * planes — arc (far, fast), text (mid), fragment (near, pointer-tilted
 * with children at different z). Scrubbed parallax keeps everything
 * glued to scroll position; nothing loops except the rings drawing once.
 */
(function () {
  'use strict';

  function eligible() {
    if (!window.gsap || !window.ScrollTrigger) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (window.innerWidth <= 768) return false;
    return true;
  }

  function finePointer() {
    return window.matchMedia('(pointer: fine)').matches;
  }

  /* Atmosphere: inject glow blobs (styled in CSS) so the page has
     light to move through. Each drifts at its own scroll rate —
     foreground/mid/background planes. aria-hidden, zero interaction. */
  function addGlow(parent, cls, top, left) {
    if (!parent) return null;
    var g = document.createElement('div');
    g.className = 'glow-blob ' + cls;
    g.setAttribute('aria-hidden', 'true');
    g.style.top = top;
    g.style.left = left;
    parent.style.position = parent.style.position || 'relative';
    parent.insertBefore(g, parent.firstChild);
    return g;
  }

  function init() {
    if (!eligible()) return;
    try {
      gsap.registerPlugin(ScrollTrigger);
      document.documentElement.classList.add('motion-on');

      var hero = document.querySelector('.hero');
      var arc = document.querySelector('.hero-arc');
      var heroText = document.querySelector('.hero-text');
      var stage = document.querySelector('.stage');

      /* 1. Arc depth: parallax drift + slow rotation + GROWTH, scrubbed.
         The arc travels toward the viewer as you scroll — a journey,
         not a wobble. Takes over the arc's transform (disables CSS loop). */
      if (hero && arc) {
        arc.style.animation = 'none';
        gsap.timeline({
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1.3 }
        })
        .to(arc, { yPercent: 24, ease: 'none' }, 0)
        .to(arc, { rotation: 30, ease: 'none' }, 0)
        .to(arc, { scale: 1.28, ease: 'none' }, 0);
      }

      /* 1c. Scroll-as-camera: each section dollies in — a subtle push
         toward the viewer as it arrives. Buttery scrub. */
      document.querySelectorAll('.section').forEach(function (sec) {
        gsap.fromTo(sec, { scale: 0.965, transformOrigin: '50% 18%' }, {
          scale: 1,
          ease: 'none',
          scrollTrigger: { trigger: sec, start: 'top bottom', end: 'top 30%', scrub: 1.4 }
        });
      });

      /* 1d. Monumental outlined indices (01–04): injected, then drifting
         slower than the content — deep background plane. */
      var numerals = { sample: '01', how: '02', faq: '03', pricing: '04' };
      Object.keys(numerals).forEach(function (id) {
        var sec = document.getElementById(id);
        if (!sec) return;
        var n = document.createElement('div');
        n.className = 'section-numeral';
        n.textContent = numerals[id];
        n.setAttribute('aria-hidden', 'true');
        sec.insertBefore(n, sec.firstChild);
        gsap.to(n, {
          yPercent: 34,
          ease: 'none',
          scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: 1.5 }
        });
      });
      /* 1b. Atmosphere: coral glow behind the hero text (slow plane),
         amber glow near the stage (faster plane). They counter-drift —
         the light itself has depth. */
      var heroGlow = addGlow(hero, 'glow-coral', '-12vmin', '52%');
      var stageGlow = addGlow(stage ? stage.parentElement : hero, 'glow-amber', '30%', '8%');
      if (heroGlow) {
        gsap.to(heroGlow, {
          yPercent: 42, ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1.2 }
        });
      }
      if (stageGlow) {
        gsap.to(stageGlow, {
          yPercent: -30, ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.8 }
        });
      }

      /* 2. Hero text counter-drifts against the arc — mid plane.
         Targets the wrapper (no .reveal on it) so the reveal
         transition on the h1/lede is never fought. */
      if (hero && heroText) {
        gsap.to(heroText, {
          yPercent: -12,
          ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1.3 }
        });
      }

      /* 3. Fragment inner depth: children float at different z inside
         the stage's 3D space (preserve-3d comes from CSS .motion-on). */
      var testCard = document.querySelector('.test-card');
      var scoreSide = document.querySelector('.score-side');
      if (stage && testCard) gsap.set(testCard, { z: 34 });
      if (stage && scoreSide) gsap.set(scoreSide, { z: 68 });

      /* 4. Motif divider parallax + slow rotation — the band breathes. */
      var motif = document.querySelector('.motif-band svg');
      if (motif) {
        gsap.fromTo(motif, { y: -36, rotation: -1.5 }, {
          y: 36,
          rotation: 1.5,
          ease: 'none',
          scrollTrigger: { trigger: '.motif-band', start: 'top bottom', end: 'bottom top', scrub: 1 }
        });
      }

      /* 5. Pointer-driven 3D tilt on the hero product fragment.
         quickTo reuses one tween per axis (no per-move allocations). */
      if (stage && finePointer()) {
        stage.parentElement.style.perspective = '1400px';
        var rX = gsap.quickTo(stage, 'rotationX', { duration: 0.7, ease: 'power3' });
        var rY = gsap.quickTo(stage, 'rotationY', { duration: 0.7, ease: 'power3' });
        stage.addEventListener('pointermove', function (e) {
          var r = stage.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          rY(px * 6);
          rX(-py * 6);
        });
        stage.addEventListener('pointerleave', function () { rX(0); rY(0); });
      }

      /* 6. Pointer-driven 3D tilt on the proof tiles — same language,
         smaller amplitude. Tiles carry no .reveal, so no conflict.
         Hover also lifts the tile toward the viewer (z) — the card
         physically rises off the page. */
      var grid = document.querySelector('.proof-grid');
      if (grid && finePointer()) {
        grid.querySelectorAll('.proof-tile').forEach(function (tile) {
          var tX = gsap.quickTo(tile, 'rotationX', { duration: 0.6, ease: 'power3' });
          var tY = gsap.quickTo(tile, 'rotationY', { duration: 0.6, ease: 'power3' });
          var tZ = gsap.quickTo(tile, 'z', { duration: 0.5, ease: 'power3' });
          tile.addEventListener('pointermove', function (e) {
            var r = tile.getBoundingClientRect();
            var px = (e.clientX - r.left) / r.width - 0.5;
            var py = (e.clientY - r.top) / r.height - 0.5;
            tY(px * 7);
            tX(-py * 7);
          });
          tile.addEventListener('pointerenter', function () { tZ(18); });
          tile.addEventListener('pointerleave', function () { tX(0); tY(0); tZ(0); });
        });
      }

      /* 7. Score rings draw themselves when scrolled into view. */
      document.querySelectorAll('.proof-tile .ring').forEach(function (ring) {
        var fg = ring.querySelectorAll('circle')[1];
        if (!fg) return;
        var target = parseFloat(fg.getAttribute('stroke-dashoffset')) || 0;
        gsap.fromTo(fg,
          { strokeDashoffset: 326.7 },
          {
            strokeDashoffset: target,
            duration: 1.5,
            ease: 'power2.out',
            scrollTrigger: { trigger: ring, start: 'top 88%', once: true }
          });
      });

      /* 8. CTA block glides against the scroll — near plane, subtle.
         An amber glow breathes behind it at its own rate. */
      var ctaGrid = document.querySelector('.cta-grid');
      var cta = document.querySelector('.cta');
      var ctaGlow = addGlow(cta, 'glow-amber', '10%', '60%');
      if (ctaGrid) {
        gsap.fromTo(ctaGrid, { y: 46 }, {
          y: -30,
          ease: 'none',
          scrollTrigger: { trigger: '.cta', start: 'top bottom', end: 'bottom top', scrub: 1 }
        });
      }
      if (ctaGlow && cta) {
        gsap.fromTo(ctaGlow, { yPercent: 20 }, {
          yPercent: -25,
          ease: 'none',
          scrollTrigger: { trigger: '.cta', start: 'top bottom', end: 'bottom top', scrub: 1.4 }
        });
      }

      /* 9. Footer wordmark drifts sideways — the name exits in motion. */
      var giant = document.querySelector('footer.site .giant');
      if (giant) {
        gsap.fromTo(giant, { xPercent: 2 }, {
          xPercent: -7,
          ease: 'none',
          scrollTrigger: { trigger: 'footer.site', start: 'top bottom', end: 'bottom top', scrub: 1 }
        });
      }

      /* 10. SITE-WIDE layer: every page gets the same craft, tuned for
         readability. Inner pages have no .hero/.stage, so they get:
         atmosphere, outlined numerals, depth reveals, and card tilt —
         all guarded by element presence, all no-ops where irrelevant. */
      var isInner = !hero;

      /* 10a. Atmosphere on inner pages: coral light behind the first
         block, amber behind the last — each drifting at its own rate.
         (Index gets its glows from 1b.) */
      if (isInner) {
        var blocks = document.querySelectorAll('main .section, main.legal, .app-hero');
        if (blocks.length) {
          var gTop = addGlow(blocks[0], 'glow-coral', '-8vmin', '58%');
          var gBot = addGlow(blocks[blocks.length - 1], 'glow-amber', '30%', '4%');
          if (gTop) gsap.to(gTop, {
            yPercent: 36, ease: 'none',
            scrollTrigger: { trigger: blocks[0], start: 'top bottom', end: 'bottom top', scrub: 1.2 }
          });
          if (gBot) gsap.to(gBot, {
            yPercent: -28, ease: 'none',
            scrollTrigger: { trigger: blocks[blocks.length - 1], start: 'top bottom', end: 'bottom top', scrub: 1 }
          });
        }
      }

      /* 10b. Outlined numerals on inner pages: each content section gets
         its studio number (01, 02…), drifting slower than the content. */
      if (isInner) {
        var nIdx = 0;
        document.querySelectorAll('main .section').forEach(function (sec) {
          if (!sec.querySelector('.section-head') || sec.querySelector('.section-numeral')) return;
          nIdx++;
          var nn = document.createElement('div');
          nn.className = 'section-numeral';
          nn.textContent = ('0' + nIdx).slice(-2);
          nn.setAttribute('aria-hidden', 'true');
          sec.insertBefore(nn, sec.firstChild);
          gsap.to(nn, {
            yPercent: 34, ease: 'none',
            scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: 1.5 }
          });
        });
      }

      /* 10c. Auto-tag depth entrances: section heads, card grids, sitemap
         groups, footer columns enter through translateZ.
         Containers (not individual tilt cards) are tagged so the CSS
         reveal transition never fights GSAP's pointer transforms.
         Hand-placed .reveal keeps its own timing (existing --d is
         never overwritten). */
      var tagged = [];
      document.querySelectorAll(
        '.section-head, .section-sub, .price-grid, .mode-grid, .sitemap ul, .sitemap h2, .f-col'
      ).forEach(function (el) {
        if (el.classList.contains('reveal')) return;
        /* never tag elements inside hidden views (practice app views
           toggle .hidden — a tagged-but-never-revealed element would
           stay invisible when its view opens). */
        if (el.closest('.hidden')) return;
        el.classList.add('reveal');
        tagged.push(el);
      });
      tagged.forEach(function (el, i) {
        if (!el.style.getPropertyValue('--d')) {
          el.style.setProperty('--d', (Math.min(i, 8) * 0.06).toFixed(2) + 's');
        }
      });

      /* 10d. One reveal observer for the whole site (index had its own;
         this is idempotent there). */
      var revealEls = document.querySelectorAll('.reveal:not(.in)');
      if (revealEls.length && 'IntersectionObserver' in window) {
        var rio = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { en.target.classList.add('in'); rio.unobserve(en.target); }
          });
        }, { threshold: 0.12 });
        revealEls.forEach(function (el) { rio.observe(el); });
      } else {
        revealEls.forEach(function (el) { el.classList.add('in'); });
      }

      /* 10e. 3D tilt on price cards + practice mode choosers — the same
         pointer language as the proof tiles, smaller amplitude.
         The z-lift on hover is done in JS (it supersedes the CSS
         :hover lift, which an inline transform would override). */
      if (finePointer()) {
        document.querySelectorAll('.price-card, .mode').forEach(function (card) {
          var cX = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3' });
          var cY = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3' });
          var cZ = gsap.quickTo(card, 'z', { duration: 0.5, ease: 'power3' });
          card.addEventListener('pointermove', function (e) {
            var r = card.getBoundingClientRect();
            var px = (e.clientX - r.left) / r.width - 0.5;
            var py = (e.clientY - r.top) / r.height - 0.5;
            cY(px * 6);
            cX(-py * 6);
          });
          card.addEventListener('pointerenter', function () { cZ(14); });
          card.addEventListener('pointerleave', function () { cX(0); cY(0); cZ(0); });
        });
        /* .price-grid and .mode-grid need perspective for the tilt. */
        document.querySelectorAll('.price-grid, .mode-grid').forEach(function (gr) {
          gr.style.perspective = '1200px';
        });
        document.querySelectorAll('.price-card, .mode').forEach(function (card) {
          card.style.transformStyle = 'preserve-3d';
        });
      }

      /* Refresh after fonts settle so trigger positions are exact. */
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
      }
    } catch (e) {
      /* Motion is enhancement-only: never break the page. */
    }
  }

  /* Deferred scripts run in order; DOM is ready. */
  init();
})();
