// One vocabulary for how things move.
//
// Everything here moves on the same two or three curves, so the interface reads as one object
// rather than a pile of components that each invented a fade. The rules: a panel unfolds from the
// edge it is anchored to instead of floating in from nowhere; its contents follow a beat behind it,
// in the order you read them; anything that replaces something else crosses over in the direction
// you travelled; and nothing lingers on the way out, because a slow exit is what makes an interface
// feel like a slideshow.
//
// Only transform and opacity are animated. Blur and shadow animation on a panel this size costs
// real frames on an integrated GPU, and the map has to keep its 60.

import type { Transition, Variants } from 'framer-motion';

/** Panels and sheets: firm, with just enough overshoot to feel physical. */
export const PANEL_SPRING: Transition = { type: 'spring', stiffness: 380, damping: 31, mass: 0.85 };

/** Small controls — pills, buttons, badges: quicker and tighter, no visible overshoot. */
export const POP_SPRING: Transition = { type: 'spring', stiffness: 520, damping: 36 };

/** Contents arriving inside something that is itself arriving. */
export const CONTENT_SPRING: Transition = { type: 'spring', stiffness: 460, damping: 38 };

/** Leaving. Short and slightly accelerating: out of the way before it is noticed. */
export const EXIT: Transition = { duration: 0.16, ease: [0.4, 0, 1, 1] };

/** The house easing for anything tweened rather than sprung. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** How long each section waits behind the one above it. */
const STAGGER = 0.035;

/**
 * A side panel unfolding from the edge it lives on. Pair with `origin-left` / `origin-right` so the
 * scale grows out of that edge rather than from the middle of the screen.
 */
export function panelVariants(side: 'left' | 'right'): Variants {
  const off = side === 'left' ? -22 : 22;
  return {
    hidden: { opacity: 0, x: off, scale: 0.97 },
    shown: {
      opacity: 1,
      x: 0,
      scale: 1,
      transition: { ...PANEL_SPRING, staggerChildren: STAGGER, delayChildren: 0.05 },
    },
    gone: { opacity: 0, x: off * 0.7, scale: 0.975, transition: EXIT },
  };
}

/**
 * Sections inside a panel. They carry no `initial`/`animate` of their own: inside a panel that is
 * animating they inherit its state and arrive in order, and anywhere else they simply sit still.
 */
export const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: CONTENT_SPRING },
  gone: { opacity: 0, y: -6, transition: { duration: 0.12 } },
};

/**
 * Switching between tabs of the same panel: the new one comes from the side you moved towards, so
 * the panel has a left and a right rather than one pile of content dissolving into another.
 * `dir` is +1 moving right through the tabs, −1 moving back.
 */
export function tabVariants(dir: number): Variants {
  return {
    hidden: { opacity: 0, x: 18 * dir },
    shown: { opacity: 1, x: 0, transition: { duration: 0.24, ease: EASE, staggerChildren: STAGGER, delayChildren: 0.02 } },
    gone: { opacity: 0, x: -14 * dir, transition: { duration: 0.13, ease: [0.4, 0, 1, 1] } },
  };
}

/** A pill or button that takes over from a panel: it grows out of the same edge a moment later. */
export function handoverVariants(side: 'left' | 'right'): Variants {
  const off = side === 'left' ? -14 : 14;
  return {
    hidden: { opacity: 0, x: off, scale: 0.9 },
    shown: { opacity: 1, x: 0, scale: 1, transition: { ...POP_SPRING, delay: 0.1 } },
    gone: { opacity: 0, x: off, scale: 0.9, transition: { duration: 0.12 } },
  };
}
