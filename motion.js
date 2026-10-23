/* SpeakBand motion layer — tasteful scroll-driven 3D (progressive enhancement).
 *
 * Only initializes when ALL of these hold:
 *   - GSAP + ScrollTrigger loaded from CDN
 *   - no prefers-reduced-motion
 *   - viewport wider than 768px (mobile keeps the static design)
 * Anything failing -> the site works exactly as before. Motion never
 * blocks content: scripts are deferred and every effect is transform/
 * opacity-only (compositor cost), per the gsap-performance playbook.
 */
(function () {
  'use strict';

  function eligible() {
    if (!window.gsap || !window.ScrollTrigger) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (window.innerWidth <= 768) return false;
    return true;
  }

  function init() {
    if (!eligible()) return;
    try {
      gsap.registerPlugin(ScrollTrigger);
      document.documentElement.classList.add('motion-on');

      var hero = document.querySelector('.hero');
      var arc = document.querySelector('.hero-arc');

      /* 1+2. Arc depth: parallax drift + slow rotation, scrubbed to scroll.
         Takes over the arc's transform (disables the CSS drift loop). */
      if (hero && arc) {
        arc.style.animation = 'none';
        gsap.to(arc, {
          yPercent: 22,
          rotation: 26,
          ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1 }
        });
      }

      /* 3. Motif divider parallax — the band breathes as it crosses. */
      var motif = document.querySelector('.motif-band svg');
      if (motif) {
        gsap.fromTo(motif, { y: -34 }, {
          y: 34,
          ease: 'none',
          scrollTrigger: { trigger: '.motif-band', start: 'top bottom', end: 'bottom top', scrub: 1 }
        });
      }

      /* 4. Pointer-driven 3D tilt on the hero product fragment.
         quickTo reuses one tween per axis (no per-move allocations). */
      var stage = document.querySelector('.stage');
      if (stage && window.matchMedia('(pointer: fine)').matches) {
        stage.style.transformStyle = 'preserve-3d';
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

      /* 5. Score rings draw themselves when scrolled into view. */
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
