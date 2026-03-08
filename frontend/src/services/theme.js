/* ============================================================
   Theme Manager — Handle light/dark mode and persistence
   ============================================================ */

export const themeManager = {
    key: 'uade_innova_theme',

    init() {
        const saved = localStorage.getItem(this.key);
        if (saved) {
            this.setTheme(saved);
        } else {
            // Auto-detect system preference
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.setTheme(prefersDark ? 'dark' : 'light');
        }

        // Listen to system changes if no preference is set
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (!localStorage.getItem(this.key)) {
                this.setTheme(e.matches ? 'dark' : 'light');
            }
        });
    },

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(this.key, theme);
        // Dispatch event for components to react if needed
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    },

    getTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    },

    toggle() {
        const next = this.getTheme() === 'dark' ? 'light' : 'dark';
        this.setTheme(next);
    }
};
