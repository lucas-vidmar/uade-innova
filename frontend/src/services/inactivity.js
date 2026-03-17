/* ============================================================
   Inactivity Monitor Service
   Terminates session after 60 minutes of no user interaction.
   ============================================================ */
import { auth } from './auth.js';

// 60 minutes in milliseconds
const INACTIVITY_TIMEOUT = 60 * 60 * 1000; 

let idleTimer;

export const inactivityMonitor = {
    init() {
        // Events that indicate user activity
        const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
        
        // Reset timer on any of these events
        activityEvents.forEach(event => {
            window.addEventListener(event, () => this.resetTimer(), { passive: true });
        });

        this.resetTimer();
        console.log('[Inactivity] Monitor initialized (Timeout: 60m)');
    },

    resetTimer() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => this.handleInactivity(), INACTIVITY_TIMEOUT);
    },

    handleInactivity() {
        console.warn(`[Inactivity] User idle for ${INACTIVITY_TIMEOUT / 1000}s. Triggering logout.`);
        auth.logout();
    }
};
