/**
 * Stroke icons drawn in-house (2026-10-27: no icon dependency). 24 × 24 viewBox, 2 px stroke,
 * round caps and joins, no fill, so web (inline SVG) and mobile (react-native-svg) draw the same
 * icon from one source. Clients supply the accessible label from i18n.
 */
export const ICON_VIEWBOX = '0 0 24 24';
export const ICON_STROKE = 2;

/** A circle as a path, so every icon is a list of `d` strings. */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
}

export const icons = {
  home: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  animals: [
    'M12 13c-3 0-5 3-5 5.5 0 1.5 1.2 2.5 2.6 2 1-.3 1.6-.5 2.4-.5s1.4.2 2.4.5c1.4.5 2.6-.5 2.6-2 0-2.5-2-5.5-5-5.5z',
    circle(5.5, 10, 1.8),
    circle(9.5, 5.5, 1.8),
    circle(14.5, 5.5, 1.8),
    circle(18.5, 10, 1.8),
  ],
  calendar: [
    'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    'M4 10h16',
    'M8 3v4',
    'M16 3v4',
  ],
  user: [circle(12, 8, 4), 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  phone: [
    'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  ],
  shieldCheck: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  check: ['M5 12l5 5 9-10'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  alert: [circle(12, 12, 9), 'M12 7v6', 'M12 16.5v.5'],
  clock: [circle(12, 12, 9), 'M12 7v5l3 2'],
  mapPin: ['M12 21s-7-6-7-12a7 7 0 0 1 14 0c0 6-7 12-7 12z', circle(12, 9, 2.5)],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', circle(12, 13, 3.5)],
  plus: ['M12 5v14', 'M5 12h14'],
  star: ['M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z'],
  jobs: ['M4 8h16v11H4z', 'M9 8V5h6v3', 'M4 13h16'],
  history: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v4h4', 'M12 8v4l3 2'],
  message: ['M4 5h16v11H9l-5 4z'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  lock: ['M6 11h12v10H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  bell: ['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z', 'M10 21h4'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  payments: ['M3 6h18v12H3z', 'M3 10h18'],
  flag: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'],
  image: ['M4 5h16v14H4z', circle(9, 10, 1.5), 'M4 17l5-5 4 4 3-3 4 4'],
  settings: [
    circle(12, 12, 3),
    'M12 2v3',
    'M12 19v3',
    'M2 12h3',
    'M19 12h3',
    'M5 5l2 2',
    'M17 17l2 2',
    'M5 19l2-2',
    'M17 7l2-2',
  ],
  directions: ['M12 3l9 9-9 9-9-9z', 'M9 13v-2h5', 'M12 8.5l2.5 2.5-2.5 2.5'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof icons;
