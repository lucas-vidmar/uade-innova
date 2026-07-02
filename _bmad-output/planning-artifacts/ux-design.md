---
documentType: "UX Design Specification"
version: "1.0"
date: "2026-05-10"
source: "DESIGN.md + PRD User Journeys"
---

# UX Design Specification — UADE Innova Dashboard

## 1. Overview

This document consolidates the **Design System** (`DESIGN.md`) and maps it to the **User Journeys** defined in the PRD to ensure visual consistency across all planned screens and interactions.

### 1.1 Design Philosophy
Premium, modern, high-performance educational dashboard. Emphasis on clarity, intelligent data visualization, and a "Smart" aesthetic using deep blues, subtle gradients, and glassmorphism-inspired elements.

### 1.2 Scope
- **In Scope:** All MVP screens (Student Chat, Teacher Upload, Admin Dashboard, Class Browser)
- **Out of Scope (post-MVP):** Advanced data visualization (growth phase), mobile-native app

---

## 2. Design Tokens

### 2.1 Color Palette

#### Brand & Core
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | `#00405C` | Core branding, deep backgrounds |
| `--color-primary-light` | `#00608A` | Interactive states, primary links |
| `--color-primary-dark` | `#002D41` | Deepest tint, contrast, shadows |
| `--color-accent` | `#0077AB` | CTAs, highlights, active indicators |
| `--color-accent-glow` | `rgba(0, 64, 92, 0.15)` | Soft glow for hover states |

#### Semantic / Status
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#10b981` | Affirmative actions, positive KPIs, "Ready" states |
| `--color-warning` | `#f59e0b` | Pending actions, warnings, near-deadlines |
| `--color-error` | `#ef4444` | Destructive actions, errors, late submissions |
| `--color-info` | `#38bdf8` | Neutral notifications, informative chips |

#### Dark Mode (Default)
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-base` | `#061B2C` | Application shell background |
| `--surface-1` | `#0C253B` | Primary card and element background |
| `--surface-2` | `#12304A` | Secondary background for inputs, tabs, nested elements |
| `--surface-3` | `#1A3C5C` | Tertiary background for borders/hovers |
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` | Subtle separating lines |
| `--text-primary` | `#f1f5f9` | Main content and titles |
| `--text-secondary` | `#94a3b8` | Meta-text, labels, secondary information |
| `--text-muted` | `#475569` | Disabled text, placeholders |

#### Light Mode
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-base-light` | `#f1f5f9` | Slate 100 base |
| `--surface-1-light` | `#ffffff` | White card background |
| `--surface-2-light` | `#e2e8f0` | Light grey for secondary inputs |
| `--text-primary-light` | `#061B2C` | Black Pearl for maximum readability |

### 2.2 Typography

| Element | Font | Weight | Letter-spacing | Line-height |
|---------|------|--------|----------------|-------------|
| Page Titles (3xl) | Montserrat | 700/800 | -0.02em | 1.2 |
| Section Headers (2xl) | Montserrat | 700 | -0.02em | 1.3 |
| Card Titles (xl) | Montserrat | 600 | normal | 1.4 |
| Body Text (md) | Montserrat | 400/500 | normal | 1.6 |
| Secondary/Meta (sm) | Montserrat | 400 | normal | 1.5 |
| Labels/Badges (xs) | Montserrat | 500 | 0.05em | 1.4 |

### 2.3 Spacing & Radius

**Base Unit:** 4px

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Micro gaps |
| `--space-2` | 8px | Tight spacing |
| `--space-3` | 12px | Default internal padding |
| `--space-4` | 16px | Card padding |
| `--space-5` | 20px | Section gaps |
| `--space-6` | 24px | Component separation |
| `--space-8` | 32px | Layout gaps |
| `--space-10` | 40px | Major section padding |
| `--space-12` | 48px | Page margins |
| `--space-16` | 64px | Hero/major divisions |

**Border Radius:**
| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Inner components |
| `--radius-md` | 10px | Buttons, Inputs |
| `--radius-lg` | 16px | Cards, Modals |
| `--radius-xl` | 24px | Large containers |
| `--radius-full` | 9999px | Pills, Avatars |

### 2.4 Motion

- **Default transition:** `all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`
- **Hover scale:** `transform: scale(1.02)` on interactive cards
- **Loading skeleton:** Shimmer animation with `linear-gradient` mask
- **Toast entrance:** Slide-in from bottom-right with fade
- **Modal entrance:** Scale from 0.95 + opacity fade

---

## 3. Component Library

### 3.1 Buttons

| Variant | Background | Text | Border | Shadow | Hover State |
|---------|------------|------|--------|--------|-------------|
| **Primary** | Brand gradient | White | None | Soft brand glow | Brighten gradient, increase shadow |
| **Secondary** | `--surface-2` | `--text-primary` | `--border-subtle` | None | `--surface-3` background |
| **Ghost** | Transparent | `--text-secondary` | 1px `--border-subtle` | None | `--surface-2` background |
| **Danger** | Error-bg | Error-text | None | None | Darken error-bg |

**Shared Styles:** `border-radius: var(--radius-md)`, `font-weight: 600`, `padding: 10px 20px`

### 3.2 Cards & Surfaces

| Variant | Background | Radius | Border | Special |
|---------|------------|--------|--------|---------|
| **Default Card** | `--surface-1` | `var(--radius-lg)` | `--border-subtle` | None |
| **KPI Card** | `--surface-1` | `var(--radius-lg)` | `--border-subtle` | Decorative top-border with brand gradient |
| **Gradient Card** | Soft brand gradient | `var(--radius-lg)` | None | High-emphasis content |
| **Upload Zone** | `--surface-2` dashed | `var(--radius-lg)` | Dashed `--border-subtle` | Hover: solid border + `--color-accent-glow` |

### 3.3 Forms

| Element | Background | Radius | Text | Focus State |
|---------|------------|--------|------|-------------|
| **Input/Select** | `--surface-2` | `var(--radius-md)` | `--text-primary` | `--color-accent-glow` border |
| **Textarea (Chat)** | `--surface-2` | `var(--radius-lg)` | `--text-primary` | `--color-accent-glow` border |
| **Badge** | Semantic color (10% opacity) | `var(--radius-full)` | Semantic color | None |

### 3.4 Chat Components

| Component | Description |
|-----------|-------------|
| **Chat Bubble (User)** | `--surface-3` background, right-aligned, `--radius-lg` with tail |
| **Chat Bubble (AI)** | `--surface-1` background, left-aligned, `--radius-lg` with tail |
| **Source Citation Chip** | `--surface-2` background, `--radius-full`, icon + filename + chunk index |
| **Typing Indicator** | 3 animated dots, `--color-accent`, pulsing |
| **Suggested Question Pill** | Ghost button style, `--radius-full`, truncates with ellipsis |

---

## 4. Screen Specifications

### 4.1 Student Chat Screen (Primary View)

**Layout:** Full-height, 2-column on desktop (sidebar + chat), single-column on mobile

**Left Sidebar (collapsible on mobile):**
- **Class Selector:** Dropdown with current class, `--surface-2` background
- **Material Filters:** Checkboxes for transcript/presentation/notes/bibliography
- **Suggested Questions:** 3-4 ghost pills stacked vertically
- **Chat History:** Scrollable list of past queries, `--text-secondary` timestamps

**Main Chat Area:**
- **Header:** Class title (xl), material status badges (sm), settings icon
- **Message History:** Scrollable, auto-scroll to bottom on new message
- **Input Area:** Fixed bottom, textarea with send button, character counter
- **Empty State:** Centered illustration + "Ask anything about your class materials"

**States:**
- **Loading:** Skeleton cards for AI response, pulsing dots for "thinking"
- **Error:** Inline retry button with `--color-error` border
- **Success:** Source chips appear below AI response with slide-in animation

### 4.2 Teacher Upload Screen

**Layout:** Centered max-width container (800px), single-column

**Sections:**
1. **Class Selector:** Dropdown to choose which class to upload to
2. **Material Type Tabs:** 4 tabs (Transcript, Presentation, Notes, Bibliography)
3. **Upload Zone:** Large dashed-border area with drag-and-drop support
   - **Idle State:** Upload icon + "Drag files here or click to browse"
   - **Drag Over:** Solid border + `--color-accent-glow`
   - **Uploading:** Progress bar with percentage, material name
   - **Success:** Green checkmark + "Processing..." → "Ready"
   - **Error:** Red border + error message + retry button
4. **Material List:** Table of uploaded materials with status badges
   - Columns: Filename | Type | Size | Status | Actions
   - Status badges: "Pending" (warning), "Processing" (info), "Ready" (success), "Error" (error)

### 4.3 Class Browser (Student)

**Layout:** Grid of cards (3 columns desktop, 1 column mobile)

**Class Card:**
- **Top:** Class number + title (lg), date badge (sm)
- **Middle:** Topic tags (pills), material count icons
- **Bottom:** "Chat about this class" primary button
- **Hover:** Elevated shadow + scale(1.02)

**Filters:**
- Subject dropdown
- Date range picker
- Material availability toggle

### 4.4 Admin Dashboard

**Layout:** Full-width, 2-column (KPIs + charts)

**KPI Row (4 cards):**
- Active Students (number + trend arrow)
- Messages Today (number + sparkline)
- Avg. Response Time (number + trend)
- Top Subject (name + percentage)

**Charts:**
- **Usage Over Time:** Line chart, brand gradient fill
- **Top Queries:** Horizontal bar chart, `--color-accent` bars
- **Material Coverage:** Donut chart per subject

---

## 5. Responsive Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| **Mobile** | < 640px | Single column, collapsible sidebar, stacked cards |
| **Tablet** | 640px - 1024px | 2-column grids, sidebar as overlay |
| **Desktop** | > 1024px | Full 2-3 column layouts, persistent sidebar |

---

## 6. Accessibility Requirements

- **Color Contrast:** All text meets WCAG AA (4.5:1 for normal, 3:1 for large)
- **Focus Rings:** Visible `outline: 2px solid var(--color-accent)` on all interactive elements
- **Keyboard Navigation:** Tab order logical, Escape closes modals
- **Screen Readers:** ARIA labels on icon-only buttons, live regions for chat updates
- **Reduced Motion:** Respect `prefers-reduced-motion` media query

---

## 7. Design-to-Code Mapping

### 7.1 CSS Variables (Global)

All tokens defined in Section 2 are exposed as CSS custom properties on `:root`.

### 7.2 Component Implementation

| Component | Location | File |
|-----------|----------|------|
| Button | `frontend/src/components/` | `Button.js` + `Button.css` |
| Card | `frontend/src/components/` | `Card.js` + `Card.css` |
| ChatBubble | `frontend/src/components/` | `ChatBubble.js` + `ChatBubble.css` |
| UploadZone | `frontend/src/components/` | `UploadZone.js` + `UploadZone.css` |
| Badge | `frontend/src/components/` | `Badge.js` + `Badge.css` |
| Input | `frontend/src/components/` | `Input.js` + `Input.css` |

### 7.3 Page Implementation

| Page | Location | File |
|------|----------|------|
| Student Chat | `frontend/src/pages/student/` | `ChatPage.js` + `ChatPage.css` |
| Teacher Upload | `frontend/src/pages/teacher/` | `UploadPage.js` + `UploadPage.css` |
| Class Browser | `frontend/src/pages/student/` | `ClassBrowserPage.js` + `ClassBrowserPage.css` |
| Admin Dashboard | `frontend/src/pages/director/` | `DashboardPage.js` + `DashboardPage.css` |

---

## 8. Validation Checklist

- [x] All PRD user journeys have corresponding screen specifications
- [x] Design tokens are sufficient for all MVP components
- [x] Color contrast meets WCAG AA standards
- [x] Responsive breakpoints cover mobile/tablet/desktop
- [x] Accessibility requirements are documented
- [x] Design-to-code mapping is clear for developers
