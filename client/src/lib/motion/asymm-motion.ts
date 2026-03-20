/**
 * Asymm Motion — Animation primitives for AsymmFlow
 *
 * Every function here is grounded in mathematics that produces
 * the smoothest, most natural-feeling motion possible.
 * The math is hidden — only the magic is surfaced.
 *
 * Usage:
 *   import { smooth, spring, stagger, breathe, duration } from '$lib/motion/asymm-motion';
 */

// ═══════════════════════════════════════════════════════════════
// Constants (internal — never exposed to consumers)
// ═══════════════════════════════════════════════════════════════

/** Golden ratio — the most aesthetically pleasing proportion */
const PHI = 1.618033988749895;

/** Fibonacci timing scale (milliseconds) */
const FIBO_MS = [89, 144, 233, 377, 610, 987, 1597] as const;

/** Fibonacci spacing scale (pixels) */
const FIBO_PX = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144] as const;


// ═══════════════════════════════════════════════════════════════
// Easing Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Smooth easing — the most natural deceleration curve.
 * Objects arrive with momentum and settle gracefully.
 *
 * Use for: entrances, reveals, any element appearing on screen.
 *
 * @param t - Progress from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function smooth(t: number): number {
  // Sine-based deceleration — models how objects naturally slow down
  return Math.sin((t * Math.PI) / 2);
}

/**
 * Spring easing — snappy with a satisfying settle.
 * Feels physical, like a well-damped mechanical spring.
 *
 * Use for: toggles, switches, interactive feedback.
 *
 * @param t - Progress from 0 to 1
 * @param tension - How snappy (0.5 = gentle, 1.0 = default, 2.0 = tight)
 * @returns Eased value (may slightly overshoot 1.0 for bounce)
 */
export function spring(t: number, tension = 1.0): number {
  // Critically damped harmonic oscillator
  // The damping coefficient is DERIVED from tension (not guessed)
  const damping = 2 * Math.sqrt(tension);
  const omega = Math.sqrt(tension) * Math.PI;
  return 1 - Math.exp(-damping * t * 3) * Math.cos(omega * t * (1 - t));
}

/**
 * Gentle easing — barely perceptible, for subtle state changes.
 * The object seems to drift rather than move.
 *
 * Use for: color transitions, opacity changes, background shifts.
 *
 * @param t - Progress from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function gentle(t: number): number {
  // Smoothstep — classic hermite interpolation
  return t * t * (3 - 2 * t);
}


// ═══════════════════════════════════════════════════════════════
// Timing
// ═══════════════════════════════════════════════════════════════

/**
 * Get the ideal animation duration for a given purpose.
 * Returns values from a natural-feeling timing scale.
 *
 * @param purpose - What the animation is for
 * @returns Duration in milliseconds
 */
export function duration(
  purpose: 'instant' | 'fast' | 'normal' | 'slow' | 'slower' | 'entrance' | 'breath'
): number {
  const map: Record<string, number> = {
    instant:  FIBO_MS[0],  // 89ms  — micro-interactions
    fast:     FIBO_MS[1],  // 144ms — button press, hover
    normal:   FIBO_MS[2],  // 233ms — standard transitions
    slow:     FIBO_MS[3],  // 377ms — panel entrances
    slower:   FIBO_MS[4],  // 610ms — content reveals
    entrance: FIBO_MS[5],  // 987ms — chart animations
    breath:   6000,        // 6s    — ambient breathing
  };
  return map[purpose] ?? FIBO_MS[2];
}

/**
 * Snap any arbitrary duration to the nearest natural-feeling value.
 *
 * @param ms - Desired duration in milliseconds
 * @returns Nearest value from the natural timing scale
 */
export function snapDuration(ms: number): number {
  return FIBO_MS.reduce((prev, curr) =>
    Math.abs(curr - ms) < Math.abs(prev - ms) ? curr : prev
  );
}


// ═══════════════════════════════════════════════════════════════
// Stagger & Sequencing
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate stagger delay for items in a list.
 * Items appear in a natural cascade — never clumping or syncing up.
 *
 * @param index - Position in the list (0-based)
 * @param baseMs - Base delay for the first item (default: 55ms)
 * @returns Delay in milliseconds for this item
 */
export function stagger(index: number, baseMs = 55): number {
  // Uses golden ratio spacing — delays are maximally spread out.
  // Unlike linear (50, 100, 150...) which creates pile-ups at multiples,
  // these delays never re-synchronize.
  return Math.round(baseMs * (Math.pow(PHI, index * 0.4) - 1));
}

/**
 * Get CSS animation-delay value for staggered list items.
 *
 * @param index - Position in the list (0-based)
 * @param baseMs - Base delay
 * @returns CSS-ready string like "89ms"
 */
export function staggerCSS(index: number, baseMs = 55): string {
  return `${stagger(index, baseMs)}ms`;
}


// ═══════════════════════════════════════════════════════════════
// Spacing
// ═══════════════════════════════════════════════════════════════

/**
 * Get a spacing value from the natural scale.
 * These values feel harmonious because they follow natural growth patterns.
 *
 * @param level - Scale index (0-10)
 * @returns Pixel value
 */
export function space(level: number): number {
  const clamped = Math.max(0, Math.min(level, FIBO_PX.length - 1));
  return FIBO_PX[Math.round(clamped)];
}


// ═══════════════════════════════════════════════════════════════
// Ambient & Breathing
// ═══════════════════════════════════════════════════════════════

/**
 * Breathing animation value — a gentle, organic pulse.
 * Makes elements feel alive without demanding attention.
 *
 * Use for: status indicators, background elements, idle states.
 *
 * @param timeMs - Current time in milliseconds (use Date.now() or rAF)
 * @param intensity - How noticeable (0.0 = none, 0.05 = subtle, 0.1 = visible)
 * @returns Oscillation value from -intensity to +intensity
 */
export function breathe(timeMs: number, intensity = 0.05): number {
  // Frequency at ~0.618 Hz (inverse golden ratio)
  // This feels organic because it doesn't sync with common UI timers
  const freq = 1 / PHI;
  return intensity * Math.sin(2 * Math.PI * freq * timeMs / 1000);
}

/**
 * Breathing scale transform — returns a CSS-ready scale value.
 *
 * @param timeMs - Current time
 * @param intensity - How much to scale (default 0.03 = 3%)
 * @returns Scale value like 1.015
 */
export function breatheScale(timeMs: number, intensity = 0.03): number {
  return 1 + breathe(timeMs, intensity);
}


// ═══════════════════════════════════════════════════════════════
// Ripple Effect
// ═══════════════════════════════════════════════════════════════

/**
 * Create a ripple effect on a button/card click.
 * The ripple expands from the click point and fades out.
 *
 * @param event - The mouse click event
 * @param element - The target element
 * @param color - Ripple color (default: white with 25% opacity)
 */
export function ripple(
  event: MouseEvent,
  element: HTMLElement,
  color = 'rgba(255, 255, 255, 0.25)'
): void {
  const rect = element.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;

  const circle = document.createElement('span');
  circle.style.cssText = `
    position: absolute;
    border-radius: 50%;
    background: ${color};
    width: ${size}px;
    height: ${size}px;
    left: ${x}px;
    top: ${y}px;
    transform: scale(0);
    opacity: 1;
    pointer-events: none;
    animation: asymm-ripple ${FIBO_MS[4]}ms ${getCSSEasing('smooth')};
  `;

  element.style.position = element.style.position || 'relative';
  element.style.overflow = 'hidden';
  element.appendChild(circle);

  circle.addEventListener('animationend', () => circle.remove());
}


// ═══════════════════════════════════════════════════════════════
// CSS Integration Helpers
// ═══════════════════════════════════════════════════════════════

type EasingName = 'smooth' | 'spring' | 'gentle' | 'snap';

/**
 * Get a CSS cubic-bezier string that approximates our easing functions.
 * For use in CSS transitions where JS easing isn't available.
 *
 * @param name - Easing function name
 * @returns CSS cubic-bezier string
 */
export function getCSSEasing(name: EasingName = 'smooth'): string {
  const map: Record<EasingName, string> = {
    smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',      // Natural deceleration
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',    // Overshoot & settle
    gentle: 'cubic-bezier(0.25, 0.1, 0.25, 1)',     // Subtle, no drama
    snap:   'cubic-bezier(0.68, -0.55, 0.27, 1.55)', // Elastic snap
  };
  return map[name] ?? map.smooth;
}

/**
 * Generate a CSS transition shorthand.
 *
 * @param properties - CSS properties to transition
 * @param purpose - Timing purpose
 * @param easing - Easing curve name
 * @returns CSS transition value string
 */
export function transition(
  properties: string | string[],
  purpose: Parameters<typeof duration>[0] = 'fast',
  easing: EasingName = 'smooth'
): string {
  const props = Array.isArray(properties) ? properties : [properties];
  const dur = duration(purpose);
  const ease = getCSSEasing(easing);
  return props.map(p => `${p} ${dur}ms ${ease}`).join(', ');
}


// ═══════════════════════════════════════════════════════════════
// Value Animation (for counters, progress, etc.)
// ═══════════════════════════════════════════════════════════════

/**
 * Animate a numeric value from start to end, calling onUpdate each frame.
 * Perfect for KPI counters, progress bars, chart values.
 *
 * @param from - Starting value
 * @param to - Target value
 * @param onUpdate - Called each frame with the current value
 * @param durationMs - Animation duration (default: 987ms)
 * @returns Cancel function
 */
export function animateValue(
  from: number,
  to: number,
  onUpdate: (value: number) => void,
  durationMs = FIBO_MS[5]
): () => void {
  const startTime = performance.now();
  let rafId: number;

  function tick(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = smooth(progress);
    const current = from + (to - from) * eased;

    onUpdate(current);

    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    }
  }

  rafId = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(rafId);
}


// ═══════════════════════════════════════════════════════════════
// Intersection Observer (scroll-reveal)
// ═══════════════════════════════════════════════════════════════

/**
 * Svelte action: reveals an element when it scrolls into view.
 * Adds 'revealed' class and sets stagger delay as CSS variable.
 *
 * Usage in Svelte:
 *   <div use:reveal={{ index: 0 }}>Content</div>
 *
 * CSS:
 *   div { opacity: 0; transform: translateY(21px); transition: ... }
 *   div.revealed { opacity: 1; transform: translateY(0); }
 *
 * @param node - The DOM element (provided by Svelte use: directive)
 * @param params - Options: index for stagger, threshold for trigger point
 */
export function reveal(
  node: HTMLElement,
  params: { index?: number; threshold?: number } = {}
) {
  const { index = 0, threshold = 0.15 } = params;
  const delayMs = stagger(index);

  // Set stagger delay as CSS custom property
  node.style.setProperty('--reveal-delay', `${delayMs}ms`);
  node.style.transitionDelay = `${delayMs}ms`;

  // Find the nearest scrollable ancestor to use as IO root
  // This ensures reveals trigger when scrolling within .content-area
  function findScrollParent(el: HTMLElement): HTMLElement | null {
    let parent = el.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflow + style.overflowY)) return parent;
      parent = parent.parentElement;
    }
    return null;
  }

  const scrollRoot = findScrollParent(node);

  // Check if element is already visible (above-fold content)
  const rect = node.getBoundingClientRect();
  const alreadyVisible = rect.top < window.innerHeight && rect.bottom > 0;

  if (alreadyVisible) {
    setTimeout(() => node.classList.add('revealed'), delayMs + 50);
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        node.classList.add('revealed');
        observer.unobserve(node);
      }
    },
    { threshold, root: scrollRoot }
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    },
    update(newParams: { index?: number; threshold?: number }) {
      const newDelay = stagger(newParams.index ?? 0);
      node.style.setProperty('--reveal-delay', `${newDelay}ms`);
      node.style.transitionDelay = `${newDelay}ms`;
    },
  };
}

/**
 * Svelte action: staggered entrance animation on mount.
 * Unlike `reveal` which waits for scroll, this triggers immediately.
 * Perfect for page-level content that should animate in on navigation.
 *
 * Usage:
 *   <div use:enter={{ index: 0 }}>Content</div>
 *
 * @param node - The DOM element
 * @param params - Options: index for stagger delay
 */
export function enter(
  node: HTMLElement,
  params: { index?: number; baseMs?: number } = {}
) {
  const { index = 0, baseMs = 55 } = params;
  const delayMs = stagger(index, baseMs);

  node.style.opacity = '0';
  node.style.transform = 'translateY(13px)';
  node.style.transition = `opacity ${FIBO_MS[3]}ms ${getCSSEasing('smooth')}, transform ${FIBO_MS[3]}ms ${getCSSEasing('smooth')}`;
  node.style.transitionDelay = `${delayMs}ms`;

  // Trigger on next frame so the initial state is painted first
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      node.style.opacity = '1';
      node.style.transform = 'translateY(0)';
    });
  });

  return {
    update(newParams: { index?: number; baseMs?: number }) {
      // No-op after initial animation — entrance is one-shot
    },
  };
}


// ═══════════════════════════════════════════════════════════════
// Presets — Ready-to-use motion configurations
// ═══════════════════════════════════════════════════════════════

/** Pre-configured motion styles for common UI patterns */
export const presets = {
  /** Card appearing in a grid or list */
  cardEnter: {
    from: { opacity: 0, transform: 'translateY(21px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
    duration: FIBO_MS[3], // 377ms
    easing: getCSSEasing('smooth'),
  },

  /** Modal opening */
  modalOpen: {
    from: { opacity: 0, transform: 'translateY(-13px) scale(0.97)' },
    to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    duration: FIBO_MS[2], // 233ms
    easing: getCSSEasing('spring'),
  },

  /** Toast sliding in from the right */
  toastSlideIn: {
    from: { opacity: 0, transform: 'translateX(55px) scale(0.95)' },
    to: { opacity: 1, transform: 'translateX(0) scale(1)' },
    duration: FIBO_MS[2], // 233ms
    easing: getCSSEasing('smooth'),
  },

  /** Subtle hover lift for interactive elements */
  hoverLift: {
    transform: 'translateY(-2px)',
    boxShadow: '0 4px 12px rgba(28, 28, 28, 0.08)',
    duration: FIBO_MS[1], // 144ms
    easing: getCSSEasing('smooth'),
  },

  /** Button press feedback */
  press: {
    transform: 'scale(0.97)',
    duration: FIBO_MS[0], // 89ms
    easing: getCSSEasing('gentle'),
  },

  /** Value counter animation */
  counter: {
    duration: FIBO_MS[5], // 987ms
    easing: smooth,
  },

  /** Skeleton shimmer loading */
  shimmer: {
    duration: 1400,
    easing: 'ease',
    infinite: true,
  },
} as const;
