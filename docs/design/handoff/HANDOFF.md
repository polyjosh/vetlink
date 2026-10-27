# VetLink redesign: handoff for Claude Code

Design canvas (visual reference): https://claude.ai/artifact/QKyWvi1NRbz7EJ3HD7pYQc
The canvas is private to the owner. **The files in this folder are the source of truth**, so Claude Code does not need the link.

## What's in this folder

```
vetlink-design/
├── handoff/
│   ├── HANDOFF.md        ← this file
│   └── tokens.ts         ← drop-in content for packages/ui-tokens
└── project/              ← each screen as static HTML with inline styles (open in a browser)
    ├── Main.dc.html      ← design system: colours, type, spacing, components
    ├── Login.dc.html
    ├── FarmerHome.dc.html
    ├── RequestVet.dc.html  (interactive: animal, symptoms, urgency)
    ├── Tracking.dc.html
    ├── VetOffer.dc.html
    ├── VetStatus.dc.html
    ├── WebFarmer.dc.html
    └── AdminQueue.dc.html
```

The `.dc.html` files are **reference markup, not code to paste**. Read them for exact colours, sizes, spacing, hierarchy and copy, then rebuild with the repo's components, tokens and i18n keys.

## Setup in the repo

1. Copy this whole `vetlink-design/` folder into the repo as `docs/design/`.
2. Paste the prompt below into Claude Code from the repo root.

## Prompt to paste into Claude Code

```
Read docs/design/handoff/HANDOFF.md, then follow it to restyle the frontend to the new VetLink design.
Follow CLAUDE.md's operating protocol: orient, explore, plan and wait for my approval before implementing,
because this touches more than 8 files. Work on a branch named feat/ui-redesign.
```

## Instructions for Claude Code

### Ground rules (from CLAUDE.md, which still applies)
- This is a **visual** change only. Do not change business logic, API calls, auth guards, booking transitions or payment code.
- All user-facing text goes through `packages/i18n`. Add any new copy from the designs to **both** `en.json` and `sw.json`. Swahili strings you're unsure of: add them with a `// TODO(sw-review)` note in your report, not silently.
- Screens import tokens from `packages/ui-tokens`; no hex values or magic numbers in screens.
- **New dependencies need approval.** The font needs one on mobile (see below). Ask first.
- Run `pnpm check` and show the output. For visual checks, run the web dev server and compare against `docs/design/project/*.dc.html` at 1440px and 390px wide.

### Step 1: tokens
Replace or extend `packages/ui-tokens` with `handoff/tokens.ts`. Keep existing export names working if anything imports them, by aliasing old names to the new values, and list the aliases in your report. Map `statusTone` keys to the real `BookingStatus` enum from `packages/shared`; don't create a second enum.

### Step 2: font (Figtree)
- Web: use `next/font/google` (built into Next.js, no new dep) with `Figtree`, weights 400/500/600/700/800, `display: 'swap'`, subsets `latin`. Expose it as a CSS variable and set it as Tailwind's `sans`.
- Mobile: needs `expo-font` (likely already present) and `@expo-google-fonts/figtree`. **Ask before installing.** If I decline, fall back to the system font. Every layout must still work with it.

### Step 3: Tailwind (web)
Extend `tailwind.config` from the tokens (import them, never retype hex values):
- `colors`: every key in `color` (e.g. `bg-primary`, `text-ink-muted`, `bg-warning-soft`).
- `borderRadius`: `sm 8, md 12, lg 16, xl 20, sheet 24`.
- `fontSize`: `display, title, heading, body, small, label` with line heights.
- `boxShadow`: `raised`, `overlay`.
- `maxWidth.content: 1200px`.

### Step 4: shared components (build these before touching screens)
Build each once per platform (`apps/web/components/ui`, `apps/mobile/src/components/ui`), matching `Main.dc.html`:

| Component | Spec |
|---|---|
| `Button` | variants `primary` (green), `accent` (amber, ink text, for urgent/emergency CTAs only), `secondary` (green outline), `ghost`, `danger` (red outline). Sizes `lg` 56px and `md` 48px. Radius 12. Weight 700, 17px for lg. Optional leading/trailing icon. |
| `PhoneInput` | `+254` prefix block on a ground-colour background with a divider, 56px tall, 1.5px border. Focus shows a primary border plus a 4px `primarySoft` ring. |
| `Chip` / `ChoiceChip` | 44px pill. Unselected: white with a 1.5px border. Selected: solid primary with white text. Use `aria-pressed` on web and `accessibilityState.selected` on mobile. |
| `ChoiceTile` | 72px tile, 2px border, radius 14. Shows an English label with the Swahili name under it in muted text (e.g. "Cow / Ng'ombe"). Selected: primarySoft fill with a primary border. |
| `StatusChip` | driven by `statusTone[status]`, 13–14px, weight 700, pill. |
| `VerifiedBadge` | shield-check icon plus "Verified vet", on primarySoft. |
| `Card` | surface, 1px border, radius 16, padding 16–24. `raised` variant uses `shadow.raised`. |
| `PersonRow` | 52px initials avatar (primarySoft/primary), name, verified icon, meta line, 52px call button. |
| `Timeline` | the vertical step list from `Tracking.dc.html`: done (filled primary with a check), current (info ring), upcoming (grey outline). |
| `BottomNav` (mobile) | 4 items, 60px each, icon above label. Active item: primarySoft pill behind the icon, primary colour, weight 800. |
| `LanguageToggle` | EN/SW segmented pill. Wire it to the existing i18n locale switch. |
| `TopBar` (web) | logo, nav links (active = primarySoft bg), LanguageToggle, avatar. Wraps on narrow screens. |

Icons: use the existing icon library if the repo has one (stroke style, 2px, 22–24px). Otherwise use `lucide-react` / `lucide-react-native`, which need approval. Every icon-only button needs an `aria-label` / `accessibilityLabel`.

### Step 5: screens
Restyle in this order, one commit per screen. Keep each screen's data flow and only change the presentation.

| Design file | Repo route (find the real file; these are the expected locations) |
|---|---|
| `Login.dc.html` | `(auth)` login/OTP, mobile and web. Green header block with rounded bottom corners, then the phone input, then the "Send code" button. Keep the USSD fallback card at the bottom; take the USSD code from config, not hardcoded. |
| `FarmerHome.dc.html` | mobile `(farmer)` home. Greeting; green hero card with an amber "Request a vet" button; the active booking card (only when a booking is active); animal counts in a 3-column grid; "Coming up" reminders; bottom nav. |
| `RequestVet.dc.html` | farmer booking creation, step 1. Progress bar; animal tiles in a 3-column grid; multi-select symptom chips; Today/Emergency choice; trust note; sticky bottom bar with a live summary line and a Continue button (disabled until there is at least one symptom). Animal and symptom lists come from `packages/shared`, not from the design. |
| `Tracking.dc.html` | farmer booking detail/tracking. Map on top (use the existing map component; the design's map is a placeholder); a sheet that overlaps it by 24px with a status chip, ETA headline, vet PersonRow, Timeline, fee row ("Pay by M-Pesa after the visit") and a Cancel button. **Show the fee only from the server**; `KES [FEE]` in the design is a placeholder. |
| `VetOffer.dc.html` | vet jobs/home with an incoming offer. Dark ink header with an availability switch and three stats; an offer card overlapping the header, with an amber band showing the countdown; Accept (60px primary) and Decline; an SMS hint line. Take the countdown from the offer's expiry, not a hardcoded value. |
| `VetStatus.dc.html` | vet application status. Status banner (warning tone for "changes needed"; use info for "under review" and success for "approved"); a per-section checklist where the flagged item expands with the admin note and a fix action; a privacy line; a Resubmit button disabled until the fixes are made. |
| `WebFarmer.dc.html` | web `/farmer`. TopBar; 1200px content width; hero and active booking side by side, wrapping below 900px; a recent visits table in an `overflow-x-auto` box; a sidebar with animals and upcoming reminders. |
| `AdminQueue.dc.html` | web `/admin` verification queue. Dark sidebar showing a "2FA session active" pill; status tabs; applicant list and detail panel side by side, wrapping on narrow screens; document tiles (opening one must go through the existing audited endpoint); a note textarea; Approve / Request changes / Reject, with Reject pushed to the right. Phone numbers stay masked. |

Screens not in the designs: apply the same tokens and components and follow the closest designed screen's pattern. List them in your report so I can review them.

### Accessibility and low-end Android checks
- Touch targets ≥ 48px. Body text ≥ 16px on mobile. Text contrast is 4.5:1 or better (all token pairs above pass).
- Status is never shown by colour alone: chips always have text.
- No heavy images or shadows on long lists. Prefer `border` cards in lists and use `raised` only for sheets and sticky bars.
- Check every screen at 360px wide (common low-end Android width).

### Done when
- Tokens live in `packages/ui-tokens` and are used by both apps.
- Shared components exist on both platforms.
- The 8 designed screens match the reference files at 390px (mobile) and 1440px/390px (web).
- `pnpm check` is green and the Playwright happy path still passes.
- New strings exist in both `en.json` and `sw.json`.
- The tracker and decision log in CLAUDE.md are updated: "2026-10-27: Adopted VetLink design system v1 (Figtree, field green + amber). Reason: the previous UI lacked hierarchy and consistency."
