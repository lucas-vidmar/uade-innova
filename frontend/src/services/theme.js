/* ============================================================
   Theme Manager — Handle light/dark mode and persistence
   ============================================================ */
import { safeSetItem, safeGetItem } from './local-storage.js';

export const themeManager = {
    key: 'uade_innova_theme',

    init() {
        const saved = safeGetItem(this.key);
        if (saved) {
            this.setTheme(saved);
        } else {
            // Auto-detect system preference
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.setTheme(prefersDark ? 'dark' : 'light');
        }

        // Listen to system changes if no preference is set
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (!safeGetItem(this.key)) {
                this.setTheme(e.matches ? 'dark' : 'light');
            }
        });
    },

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        safeSetItem(this.key, theme);
        // Dispatch event for components to react if needed
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
        // Fix #361 (UJ-03): a change made by the person must be persisted to that
        // person's profile, not only to the device. The hook is wired in main.js
        // to auth.saveThemePreference.
        if (typeof this.onChange === 'function') {
            try { this.onChange(theme); } catch (err) { console.warn('[Theme] onChange hook failed:', err); }
        }
    },

    /**
     * Applies a theme coming from the server profile (already owned by the
     * active identity) without re-persisting it. Used on boot so the identity
     * that is active wins over whatever the previous person left on the device.
     */
    applyTheme(theme) {
        if (!theme) return;
        const previous = this.onChange;
        this.onChange = null;
        try {
            this.setTheme(theme);
        } finally {
            this.onChange = previous;
        }
    },

    getTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    },

    toggle() {
        const next = this.getTheme() === 'dark' ? 'light' : 'dark';
        this.setTheme(next);
    }
};
