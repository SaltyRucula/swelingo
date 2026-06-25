/**
 * theme.ts — Design tokens for swelingo "Obsidian Dev Tool" aesthetic.
 *
 * Single source of truth for all colours, typography, spacing, radii, and
 * shadows.  Import in screens via:
 *   import { colors, fonts, spacing, radius, shadows } from '../theme';
 */
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
export const colors = {
  // ── Backgrounds ──────────────────────────────────────────────────────────
  bg:              '#0B0B12', // screen background   — near-black with blue undertone
  surface:         '#13131F', // card / panel        — one step lighter
  surfaceElevated: '#1A1A2C', // elevated / nested   — nested cards, code blocks

  // ── Electric cyan — primary action, active states, links ─────────────────
  accent:    '#7EE8FA',
  accentDim: 'rgba(126, 232, 250, 0.12)',

  // ── Electric lime — correct answers, streak, success ─────────────────────
  accentGreen:    '#80FF72',
  accentGreenDim: 'rgba(128, 255, 114, 0.12)',

  // ── Amber — timer running, streak fire, caution ───────────────────────────
  warning:    '#FFD166',
  warningDim: 'rgba(255, 209, 102, 0.14)',

  // ── Coral red — wrong answers, errors ────────────────────────────────────
  danger:    '#FF6B6B',
  dangerDim: 'rgba(255, 107, 107, 0.12)',

  // ── Soft violet — Level 2 challenges ────────────────────────────────────
  purple:    '#B47FFF',
  purpleDim: 'rgba(180, 127, 255, 0.14)',

  // ── Text ─────────────────────────────────────────────────────────────────
  text:      '#E8E8F0', // primary   — slightly cool white
  textMuted: '#6B6B8E', // secondary — muted blue-grey
  textFaint: '#2E2E48', // faint     — disabled states, very subtle elements

  // ── Borders ───────────────────────────────────────────────────────────────
  border:       'rgba(126, 232, 250, 0.12)', // default card edge (cyan-tinted)
  borderStrong: 'rgba(126, 232, 250, 0.30)', // focus / active edge
  borderSubtle: 'rgba(255, 255, 255, 0.06)', // internal divider
};

// ---------------------------------------------------------------------------
// Typography
// Web: Google Fonts (Syne + DM Sans + JetBrains Mono) loaded via injectWebFonts().
// Native: graceful system-font fallback.
// ---------------------------------------------------------------------------
export const fonts = {
  // Bold geometric grotesque — titles, app name, result headlines
  display: Platform.OS === 'web' ? '"Syne", system-ui, sans-serif'              : undefined,
  // Clean modern sans — body copy, labels, subtitles
  body:    Platform.OS === 'web' ? '"DM Sans", system-ui, sans-serif'           : undefined,
  // Monospaced — timer, badges, countdown, stat numbers, code
  mono:    Platform.OS === 'web' ? '"JetBrains Mono", "Courier New", monospace' : 'Courier New',
};

// ---------------------------------------------------------------------------
// Spacing (8 pt grid)
// ---------------------------------------------------------------------------
export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
};

// ---------------------------------------------------------------------------
// Border radii
// ---------------------------------------------------------------------------
export const radius = {
  sm:   6,
  md:   10,
  lg:   14,
  xl:   20,
  pill: 999,
};

// ---------------------------------------------------------------------------
// Shadows — intentionally subtle on a dark background
// ---------------------------------------------------------------------------
export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.40,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  glow: {
    shadowColor: '#7EE8FA',
    shadowOpacity: 0.30,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  ctaGlow: {
    shadowColor: '#7EE8FA',
    shadowOpacity: 0.50,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
};

// ---------------------------------------------------------------------------
// Google Fonts injection (call once at app startup, web only)
// ---------------------------------------------------------------------------
export function injectWebFonts(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  // Preconnect for faster font load
  const preconnect1 = document.createElement('link');
  preconnect1.rel  = 'preconnect';
  preconnect1.href = 'https://fonts.googleapis.com';
  document.head.appendChild(preconnect1);

  const preconnect2 = document.createElement('link');
  preconnect2.rel = 'preconnect';
  preconnect2.href = 'https://fonts.gstatic.com';
  preconnect2.setAttribute('crossorigin', '');
  document.head.appendChild(preconnect2);

  // Syne 700/800 · DM Sans 400/500/600 · JetBrains Mono 400/500/700
  const fontsLink = document.createElement('link');
  fontsLink.rel  = 'stylesheet';
  fontsLink.href =
    'https://fonts.googleapis.com/css2?' +
    'family=Syne:wght@700;800&' +
    'family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&' +
    'family=JetBrains+Mono:wght@400;500;700&' +
    'display=swap';
  document.head.appendChild(fontsLink);
}
