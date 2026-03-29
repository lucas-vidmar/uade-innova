# Glassmorphism Design System (2026)

This document outlines the design tokens and UI patterns for the "Glassmorphism" aesthetic applied to the UADE Educational Dashboard, taking inspiration from Apple UI and modern minimalist editors (like Pencode).

## Core Principles

1. **Frosted Glass (Glassmorphism):** Use semi-transparent backgrounds with a heavy blur (`backdrop-filter`) to give depth and context, allowing the background to subtly bleed through.
2. **Illuminated Interactions:** Active states and hover effects should feel like light sources or glowing rounded rectangles, rather than flat solid colors or simple borders.
3. **Asymmetric Content (Chat):** Information density should dictate layout. User inputs are bounded (bubbles), while system/AI outputs are expansive (full-width) to maximize readability of generated content.
4. **Uncluttered Navigation:** Navigation elements should minimize their footprint. The sidebar is icon-only by default and expands smoothly only when interacted with.

## CSS Custom Properties (Tokens)

These tokens have been added to `globals.css` and are specifically tuned for Light and Dark modes.

### Glass Tokens

*   `--glass-bg`: The primary semi-transparent background for panels (Sidebar, Header, Cards).
    *   *Light:* `rgba(255, 255, 255, 0.6)`
    *   *Dark:* `rgba(30, 41, 59, 0.6)`
*   `--glass-bg-solid`: A slightly more opaque variant for modals or dropdowns where high contrast is needed to prevent background text interference.
*   `--glass-border`: Subtle, low-opacity white borders to define edges without harsh lines.
*   `--glass-hover`: Background color for hover states.
*   `--glass-active`: Background color for selected/active states, typically incorporating the primary brand color with very low opacity.

### Shadow & Glow Tokens

*   `--shadow-sm` / `--shadow-md` / `--shadow-lg` / `--shadow-xl`: Layered box-shadows to provide depth to floating elements. Dark mode uses more aggressive shadows.
*   `--shadow-glow`: Used for focus states and active navigation items.
    *   `box-shadow: 0 4px 12px var(--color-accent-glow), inset 0 0 0 1px var(--color-border-focus);`

## Structural Patterns

### 1. The Expandable Sidebar (`Sidebar.js`)
*   **Location:** Fixed to the left edge.
*   **Behavior:** `80px` wide by default (showing only icons and the first letter/icon of the logo). Expands to `240px` on `:hover` via CSS transitions.
*   **Aesthetics:** Uses `--glass-bg` with `backdrop-filter: blur(12px)`.

### 2. The Floating Header (`Header.js`)
*   **Location:** Fixed near the top center (`top: 16px`, `left: 50%`, `transform: translateX(-50%)`).
*   **Contents:** Contains the Course/Subject selector in the middle, and the Theme toggle and Profile dropdown grouped to the right.
*   **Aesthetics:** Pill-shaped (`border-radius: var(--radius-full)`), using `--glass-bg`.

### 3. The RAG Chat UI (`ChatWidget.js`)
*   **User Messages:** Retain a bounded "bubble" style aligned to the right. They use `--glass-active` to denote they are the user's input.
*   **Assistant Messages:**
    *   **No Avatar:** The bot icon has been removed.
    *   **Full Width:** The text is not constrained within a background bubble. It spans the width of the container (with padding) for optimal reading of long markdown responses, code blocks, or tables.
    *   **Alignment:** Aligned to the left.

### 4. Mobile Layout
*   **Sidebar:** Hidden completely via media query.
*   **Bottom Navigation:** A frosted glass bar fixed to the bottom of the screen (`BottomNav.js`).

## Implementation Notes
*   Always ensure `-webkit-backdrop-filter` is used alongside `backdrop-filter` for Safari compatibility.
*   When using glass backgrounds over scrollable content, ensure the `z-index` stacking context is correctly managed (Sidebar > Header > Content).