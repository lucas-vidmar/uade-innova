# Design System

## Overview
**Dashboard Educativo Inteligente (UADE)**
A premium, modern, and high-performance educational dashboard designed for students and teachers. The interface emphasizes clarity, intelligent data visualization, and a "Smart" aesthetic using deep blues, subtle gradients, and glassmorphism-inspired elements.

## Colors
### Brand & Core
- **Primary** (#00405C): Astronaut Blue. Used for core branding and deep backgrounds.
- **Primary Light** (#00608A): Lighter tint for interactive states and primary links.
- **Primary Dark** (#002D41): Deepest tint for contrast and shadows.
- **Accent** (#0077AB): Bright blue for CTAs, highlights, and active indicators.
- **Accent Glow** (rgba(0, 64, 92, 0.15)): Soft glow for hover states.

### Semantic / Status
- **Success** (#10b981): Affirmative actions, positive KPIs, "Ready" states.
- **Warning** (#f59e0b): Pending actions, warnings, near-deadlines.
- **Error** (#ef4444): Destructive actions, errors, late submissions.
- **Info** (#38bdf8): Neutral notifications, informative chips.

### Theme Colors (Dark Mode - Default)
- **Background** (#061B2C): Black Pearl. Deep base for the application shell.
- **Surface 1** (#0C253B): Primary card and element background.
- **Surface 2** (#12304A): Secondary background for inputs, tabs, and nested elements.
- **Surface 3** (#1A3C5C): Tertiary background for borders/hovers.
- **Border** (rgba(255, 255, 255, 0.08)): Subtle separating lines.
- **Text Primary** (#f1f5f9): Main content and titles.
- **Text Secondary** (#94a3b8): Meta-text, labels, and secondary information.
- **Text Muted** (#475569): Disabled text, placeholders.

### Theme Colors (Light Mode)
- **Background** (#f1f5f9): Slate 100 base.
- **Surface 1** (#ffffff): White card background.
- **Surface 2** (#e2e8f0): Light grey for secondary inputs.
- **Text Primary** (#061B2C): Black Pearl for maximum readability.

## Typography
- **Font Family**: 'Montserrat', -apple-system, system-ui, sans-serif.
- **Headlines**: Montserrat Bold (700) or ExtraBold (800). Letter-spacing: -0.02em.
- **Body**: Montserrat Regular (400) or Medium (500). Line-height: 1.6.
- **Sizes**:
  - `3xl`: 36px (Page titles)
  - `2xl`: 28px (Section headers, KPI values)
  - `xl`: 22px (Card titles, large subtitles)
  - `lg`: 18px (Medium headings)
  - `md`: 15px (Default body text)
  - `sm`: 13px (Secondary/Meta text)
  - `xs`: 11px (Labels, badges, uppercase tags)

## Spacing & Spoke
- **Grid**: 4px base unit.
- **Tokens**: `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `40px`, `48px`, `64px`.
- **Radius**:
  - `sm`: 6px (Inner components)
  - `md`: 10px (Buttons, Inputs)
  - `lg`: 16px (Cards, Modals)
  - `xl`: 24px (Large containers)
  - `full`: 9999px (Pills, Avatars)

## Components
### Buttons
- **Primary**: Brand gradient background, white text, soft brand box-shadow.
- **Secondary**: Surface-2 background, subtle border, primary text.
- **Ghost**: Transparent, secondary text, 1px border.
- **Danger**: Error-bg background, error-text, destructive feel.
- **Styles**: Rounded (10px), semi-bold weight (600), smooth transition on hover.

### Cards & Surfaces
- **Default Card**: Surface-1, 16px radius, subtle border.
- **KPI Card**: Decorative top-border (brand gradient), prominent value, secondary label.
- **Gradient Card**: Soft background gradient for high-emphasis content.

### Forms
- **Inputs/Selects**: Surface-2 background, md radius, MD text. Accent glow on focus.
- **Badges**: Pill-shaped (full radius), semantic colors with background-alpha, left-aligned dot for status.

## Do's and Don'ts
- **DO** use the `--gradient-brand` for primary actions and key accents.
- **DO** use Montserrat for all typography to maintain the UADE visual identity.
- **DO** maintain high information density while keeping white space (using the 4px grid).
- **DON'T** use hard-coded colors; always use CSS variables (tokens).
- **DON'T** use sharp corners; use `var(--radius-md)` or `var(--radius-lg)` consistently.
- **DO** implement micro-animations (0.2s cubic-bezier) for all interactive transitions.
