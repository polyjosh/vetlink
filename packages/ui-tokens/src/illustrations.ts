/**
 * Flat illustrations (§24.2, §24.13): species placeholders for animals without a photo, and
 * empty-state pictures. Stored as plain shapes so web (inline SVG) and mobile
 * (react-native-svg) draw the same picture from one source. 96 × 96 viewBox, background disc
 * included. Colours are literals except the theme slots `bg` and `brand`.
 */

export type IllustrationFill = string | { slot: 'bg' | 'brand' };

export type IllustrationShape =
  | { type: 'circle'; cx: number; cy: number; r: number; fill: IllustrationFill }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: IllustrationFill }
  | {
      type: 'path';
      d: string;
      fill?: IllustrationFill;
      stroke?: IllustrationFill;
      strokeWidth?: number;
    };

/** Clients supply the accessible label from i18n (species names, `web.empty.*`). */
export interface Illustration {
  shapes: readonly IllustrationShape[];
}

export const ILLUSTRATION_VIEWBOX = '0 0 96 96';

export type IllustrationTheme = 'light' | 'dark';

const SLOTS: Record<IllustrationTheme, Record<'bg' | 'brand', string>> = {
  light: { bg: '#E4F0E8', brand: '#1F5F3F' }, // color.primarySoft, color.primary
  dark: { bg: '#1D3528', brand: '#6CC79A' },
};

/** The colour to paint a fill with in this theme. */
export function resolveFill(fill: IllustrationFill, theme: IllustrationTheme): string {
  return typeof fill === 'string' ? fill : SLOTS[theme][fill.slot];
}

const BG: IllustrationShape = { type: 'circle', cx: 48, cy: 48, r: 48, fill: { slot: 'bg' } };
const INK = '#1A1F1C';
const WHITE = '#FFFFFF';

const cattle: Illustration = {
  shapes: [
    BG,
    { type: 'path', d: 'M34 30C29 26 27 20 29 15C32 20 36 23 41 25Z', fill: '#EFE2C4' },
    { type: 'path', d: 'M62 30C67 26 69 20 67 15C64 20 60 23 55 25Z', fill: '#EFE2C4' },
    { type: 'path', d: 'M33 37C25 32 16 33 11 38C16 44 25 45 34 43Z', fill: '#A0522D' },
    { type: 'path', d: 'M63 37C71 32 80 33 85 38C80 44 71 45 62 43Z', fill: '#A0522D' },
    { type: 'path', d: 'M31 39C25 36 19 37 16 39C20 42 26 42 31 41Z', fill: '#E8A9A1' },
    { type: 'path', d: 'M65 39C71 36 77 37 80 39C76 42 70 42 65 41Z', fill: '#E8A9A1' },
    {
      type: 'path',
      d: 'M31 30C38 22 58 22 65 30C68 40 66 52 62 60L34 60C30 52 28 40 31 30Z',
      fill: '#B5651D',
    },
    {
      type: 'path',
      d: 'M43 26C46 24 50 24 53 26C54 34 54 44 56 56L40 56C42 44 42 34 43 26Z',
      fill: '#FBF8F1',
    },
    { type: 'ellipse', cx: 48, cy: 64, rx: 17, ry: 12, fill: '#F2B8B5' },
    { type: 'ellipse', cx: 41, cy: 64, rx: 3, ry: 2.5, fill: '#7A3B33' },
    { type: 'ellipse', cx: 55, cy: 64, rx: 3, ry: 2.5, fill: '#7A3B33' },
    { type: 'circle', cx: 37, cy: 42, r: 3.2, fill: INK },
    { type: 'circle', cx: 59, cy: 42, r: 3.2, fill: INK },
    { type: 'circle', cx: 38, cy: 41, r: 1, fill: WHITE },
    { type: 'circle', cx: 60, cy: 41, r: 1, fill: WHITE },
  ],
};

const goat: Illustration = {
  shapes: [
    BG,
    { type: 'path', d: 'M38 26C34 18 30 13 24 11C30 17 33 22 34 29Z', fill: '#8D8478' },
    { type: 'path', d: 'M58 26C62 18 66 13 72 11C66 17 63 22 62 29Z', fill: '#8D8478' },
    { type: 'path', d: 'M36 36C28 38 20 44 17 52C25 51 32 46 37 42Z', fill: '#A47148' },
    { type: 'path', d: 'M60 36C68 38 76 44 79 52C71 51 64 46 59 42Z', fill: '#A47148' },
    {
      type: 'path',
      d: 'M36 28C42 22 54 22 60 28C63 38 60 52 55 62C52 67 44 67 41 62C36 52 33 38 36 28Z',
      fill: '#C8915A',
    },
    { type: 'path', d: 'M43 64C44 72 46 78 48 82C50 78 52 72 53 64Z', fill: '#E9DCC8' },
    { type: 'ellipse', cx: 48, cy: 60, rx: 9, ry: 7, fill: '#E6C49A' },
    { type: 'ellipse', cx: 45, cy: 60, rx: 1.6, ry: 1.2, fill: '#6B4A2B' },
    { type: 'ellipse', cx: 51, cy: 60, rx: 1.6, ry: 1.2, fill: '#6B4A2B' },
    { type: 'circle', cx: 40, cy: 40, r: 3.6, fill: '#F1D36B' },
    { type: 'circle', cx: 56, cy: 40, r: 3.6, fill: '#F1D36B' },
    { type: 'path', d: 'M37.4 39.2h5.2v1.6h-5.2Z', fill: INK },
    { type: 'path', d: 'M53.4 39.2h5.2v1.6h-5.2Z', fill: INK },
  ],
};

const WOOL_SHADE = '#DDD3BF';
const WOOL = '#FBF7EE';
const woolPuffs: [number, number, number][] = [
  [34, 30, 10],
  [48, 25, 11],
  [62, 30, 10],
  [29, 44, 9],
  [67, 44, 9],
];

const sheep: Illustration = {
  shapes: [
    BG,
    ...woolPuffs.map(([cx, cy, r]): IllustrationShape => ({
      type: 'circle',
      cx,
      cy,
      r: r + 1.5,
      fill: WOOL_SHADE,
    })),
    ...woolPuffs.map(([cx, cy, r]): IllustrationShape => ({
      type: 'circle',
      cx,
      cy,
      r,
      fill: WOOL,
    })),
    { type: 'path', d: 'M34 44C27 43 20 46 16 50C22 53 29 52 35 49Z', fill: '#3E3A36' },
    { type: 'path', d: 'M62 44C69 43 76 46 80 50C74 53 67 52 61 49Z', fill: '#3E3A36' },
    {
      type: 'path',
      d: 'M38 34C44 30 52 30 58 34C61 44 58 58 53 66C51 69 45 69 43 66C38 58 35 44 38 34Z',
      fill: '#4A4440',
    },
    { type: 'circle', cx: 44, cy: 32, r: 6, fill: WOOL },
    { type: 'circle', cx: 52, cy: 32, r: 6, fill: WOOL },
    { type: 'circle', cx: 48, cy: 29, r: 6, fill: WOOL },
    { type: 'circle', cx: 42, cy: 46, r: 2.6, fill: WHITE },
    { type: 'circle', cx: 54, cy: 46, r: 2.6, fill: WHITE },
    { type: 'circle', cx: 42.4, cy: 46.4, r: 1.4, fill: INK },
    { type: 'circle', cx: 54.4, cy: 46.4, r: 1.4, fill: INK },
    { type: 'ellipse', cx: 48, cy: 61, rx: 3, ry: 2, fill: '#C98C86' },
  ],
};

const pig: Illustration = {
  shapes: [
    BG,
    { type: 'path', d: 'M30 34L26 16C34 18 40 24 42 30Z', fill: '#E58FA0' },
    { type: 'path', d: 'M66 34L70 16C62 18 56 24 54 30Z', fill: '#E58FA0' },
    { type: 'circle', cx: 48, cy: 50, r: 24, fill: '#F4AFBF' },
    { type: 'ellipse', cx: 48, cy: 58, rx: 12, ry: 9, fill: '#E58FA0' },
    { type: 'ellipse', cx: 44, cy: 58, rx: 2.2, ry: 3.2, fill: '#A84F63' },
    { type: 'ellipse', cx: 52, cy: 58, rx: 2.2, ry: 3.2, fill: '#A84F63' },
    { type: 'circle', cx: 40, cy: 44, r: 2.8, fill: INK },
    { type: 'circle', cx: 56, cy: 44, r: 2.8, fill: INK },
    { type: 'circle', cx: 40.8, cy: 43.2, r: 0.9, fill: WHITE },
    { type: 'circle', cx: 56.8, cy: 43.2, r: 0.9, fill: WHITE },
  ],
};

const poultry: Illustration = {
  shapes: [
    BG,
    { type: 'path', d: 'M30 62C36 72 62 76 70 60L72 72C64 84 38 86 28 74Z', fill: '#B85F28' },
    {
      type: 'path',
      d: 'M38 32C38 24 44 22 46 28C47 20 54 19 55 27C57 21 64 22 62 31Z',
      fill: '#D32F2F',
    },
    { type: 'circle', cx: 50, cy: 46, r: 18, fill: '#D9823B' },
    { type: 'path', d: 'M33 44L21 49L33 54Z', fill: '#F2B33D' },
    { type: 'path', d: 'M36 54C34 60 38 65 42 61C42 58 40 55 38 54Z', fill: '#D32F2F' },
    { type: 'circle', cx: 44, cy: 43, r: 3.6, fill: WHITE },
    { type: 'circle', cx: 43.4, cy: 43.2, r: 2, fill: INK },
  ],
};

const dog: Illustration = {
  shapes: [
    BG,
    { type: 'path', d: 'M30 30C20 30 14 42 16 56C22 58 30 50 34 40Z', fill: '#6D4C33' },
    { type: 'path', d: 'M66 30C76 30 82 42 80 56C74 58 66 50 62 40Z', fill: '#6D4C33' },
    {
      type: 'path',
      d: 'M32 32C38 24 58 24 64 32C68 42 66 56 60 64C54 70 42 70 36 64C30 56 28 42 32 32Z',
      fill: '#C49A6C',
    },
    { type: 'ellipse', cx: 48, cy: 58, rx: 12, ry: 10, fill: '#F1E3CF' },
    { type: 'path', d: 'M43 52C43 49 53 49 53 52C53 55 50 57 48 57C46 57 43 55 43 52Z', fill: INK },
    { type: 'path', d: 'M48 57L48 61M44 62Q48 65 52 62', stroke: INK, strokeWidth: 1.6 },
    { type: 'circle', cx: 41, cy: 42, r: 3, fill: INK },
    { type: 'circle', cx: 55, cy: 42, r: 3, fill: INK },
    { type: 'circle', cx: 41.9, cy: 41.1, r: 1, fill: WHITE },
    { type: 'circle', cx: 55.9, cy: 41.1, r: 1, fill: WHITE },
  ],
};

/** "Other": a paw print in the brand colour. */
const other: Illustration = {
  shapes: [
    BG,
    { type: 'ellipse', cx: 48, cy: 60, rx: 15, ry: 12, fill: { slot: 'brand' } },
    { type: 'ellipse', cx: 31, cy: 44, rx: 6, ry: 8, fill: { slot: 'brand' } },
    { type: 'ellipse', cx: 42, cy: 34, rx: 6, ry: 8, fill: { slot: 'brand' } },
    { type: 'ellipse', cx: 54, cy: 34, rx: 6, ry: 8, fill: { slot: 'brand' } },
    { type: 'ellipse', cx: 65, cy: 44, rx: 6, ry: 8, fill: { slot: 'brand' } },
  ],
};

/** One picture per species (keys match `SPECIES` in @vetlink/shared). */
export const speciesIllustrations = { cattle, goat, sheep, pig, poultry, dog, other } as const;

export const emptyStateIllustrations = {
  noAnimals: {
    shapes: [
      BG,
      { type: 'path', d: 'M22 46L48 24L74 46L74 76L22 76Z', fill: '#C0503A' },
      { type: 'path', d: 'M18 48L48 22L78 48L74 51L48 29L22 51Z', fill: '#8E3326' },
      { type: 'path', d: 'M38 56H58V76H38Z', fill: '#FBF8F1' },
      { type: 'path', d: 'M38 56L58 76M58 56L38 76', stroke: '#C0503A', strokeWidth: 2.5 },
      { type: 'circle', cx: 48, cy: 43, r: 4, fill: '#FBF8F1' },
    ],
  },
  noBookings: {
    shapes: [
      BG,
      { type: 'path', d: 'M28 22H68V80H28Z', fill: '#8D6E63' },
      { type: 'path', d: 'M32 28H64V76H32Z', fill: WHITE },
      { type: 'path', d: 'M40 18H56V28H40Z', fill: '#5D4037' },
      { type: 'path', d: 'M38 40H58M38 50H58M38 60H50', stroke: '#B0BEC5', strokeWidth: 3 },
      { type: 'circle', cx: 62, cy: 68, r: 10, fill: { slot: 'brand' } },
      { type: 'path', d: 'M57 68L61 72L67 64', stroke: WHITE, strokeWidth: 2.5 },
    ],
  },
  noOffers: {
    shapes: [
      BG,
      {
        type: 'path',
        d: 'M48 20C38 20 32 28 32 40L32 56L24 66L72 66L64 56L64 40C64 28 58 20 48 20Z',
        fill: '#F2B33D',
      },
      { type: 'circle', cx: 48, cy: 72, r: 6, fill: '#B26A00' },
      { type: 'circle', cx: 48, cy: 18, r: 3, fill: '#B26A00' },
    ],
  },
  noRatings: {
    shapes: [
      BG,
      {
        type: 'path',
        d: 'M48 18L56.8 36.6L77 39.1L62.2 53.1L66 73.2L48 63.4L30 73.2L33.8 53.1L19 39.1L39.2 36.6Z',
        fill: '#F2B33D',
      },
      { type: 'circle', cx: 42, cy: 48, r: 2.4, fill: INK },
      { type: 'circle', cx: 54, cy: 48, r: 2.4, fill: INK },
      { type: 'path', d: 'M43 56Q48 60 53 56', stroke: INK, strokeWidth: 2 },
    ],
  },
  offline: {
    shapes: [
      BG,
      {
        type: 'path',
        d: 'M30 66C22 66 18 60 18 54C18 47 24 42 31 43C33 33 41 28 50 28C60 28 67 35 68 44C75 44 80 49 80 56C80 62 75 66 69 66Z',
        fill: '#B0BEC5',
      },
      { type: 'path', d: 'M26 24L72 76', stroke: '#C62828', strokeWidth: 5 },
    ],
  },
} as const satisfies Record<string, Illustration>;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The illustration as standalone SVG markup (previews, data URIs, PDFs). */
export function illustrationSvg(
  ill: Illustration,
  theme: IllustrationTheme,
  label: string,
): string {
  const body = ill.shapes
    .map((s) => {
      if (s.type === 'circle') {
        return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${resolveFill(s.fill, theme)}"/>`;
      }
      if (s.type === 'ellipse') {
        return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${resolveFill(s.fill, theme)}"/>`;
      }
      const fill = s.fill ? resolveFill(s.fill, theme) : 'none';
      const stroke = s.stroke
        ? ` stroke="${resolveFill(s.stroke, theme)}" stroke-width="${s.strokeWidth ?? 1}" stroke-linecap="round" stroke-linejoin="round"`
        : '';
      return `<path d="${s.d}" fill="${fill}"${stroke}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ILLUSTRATION_VIEWBOX}" role="img" aria-label="${esc(label)}">${body}</svg>`;
}
