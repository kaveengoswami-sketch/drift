/**
 * Accent handling.
 *
 * The accent is the one place Drift's identity lives — surfaces have to stay
 * chromatically neutral so they don't tint the photographs sitting on them.
 * The palette is therefore drawn from the subject rather than picked as a
 * spread of hues: every swatch is a real photographic process colour, and the
 * default is the darkroom safelight this whole design system is named for.
 */

export interface AccentSwatch {
  /** The process this colour comes from. Shown on hover. */
  name: string
  value: string
}

export const ACCENTS: AccentSwatch[] = [
  { name: 'Safelight', value: '#F09A4B' },
  { name: 'Ferric red', value: '#E0645A' },
  { name: 'Selenium', value: '#A97FD0' },
  { name: 'Cyanotype', value: '#5AA9E6' },
  { name: 'Verdigris', value: '#4FBFA0' },
  { name: 'Gold chloride', value: '#E3C15A' }
]

/**
 * Settings persist a raw hex, so a value saved from an older palette outlives
 * that palette and leaves the UI showing a colour no swatch matches. The
 * picker offers a fixed set, so anything outside it is stale by definition
 * and falls back to the default rather than sticking around unselectable.
 */
export function resolveAccent(saved: string | undefined): string {
  return ACCENTS.some((a) => a.value === saved) ? (saved as string) : ACCENTS[0].value
}

/** WCAG relative luminance of a #rrggbb string. */
function luminance(hex: string): number {
  const v = hex.replace('#', '')
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/**
 * Apply an accent to the document.
 *
 * --accent-text has to be derived here rather than left to the theme. Every
 * swatch above is a light hue, so a theme that hardcodes white text on the
 * accent produces an unreadable filled button the moment the user picks one.
 */
export function applyAccent(color: string): void {
  const root = document.documentElement
  root.style.setProperty('--accent', color)
  root.style.setProperty('--accent-soft', color + '38')
  root.style.setProperty('--accent-text', luminance(color) > 0.4 ? '#1A1206' : '#ffffff')
}

/**
 * Apply the accent for a given theme.
 *
 * The café theme fixes its own accent — fern green — in theme-cafe.css, and
 * that is the whole of its identity rather than a preference. Two reasons it
 * cannot go through the picker: applyAccent writes inline properties, which
 * outrank any stylesheet and would silently defeat the theme; and every swatch
 * in ACCENTS is a light hue chosen to carry on graphite, so all six land
 * somewhere between 1.5:1 and 2.5:1 on cream. Clearing the inline properties
 * hands the accent back to the stylesheet.
 */
export function applyThemeAccent(theme: string, savedAccent: string | undefined): void {
  if (theme === 'cafe') {
    const root = document.documentElement
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-soft')
    root.style.removeProperty('--accent-text')
    return
  }
  applyAccent(resolveAccent(savedAccent))
}
