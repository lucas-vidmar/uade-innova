/* ============================================================
   AudioPlayer — TTS class podcast player (Story 11.3.1)
   Custom controls: play/pause, seekable progress bar, elapsed/
   total time, download link and playback speed selector.
   ============================================================ */

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

const SPEED_OPTIONS = [1, 1.25, 1.5];

/**
 * Renders a self-contained TTS audio player for the class podcast.
 * @param {HTMLElement} container Mount point (will be emptied).
 * @param {Object} options
 * @param {string} options.src       Audio stream URL (GET /api/class-audio/{classId}).
 * @param {string} options.className Class title, used for the player label.
 * @param {string} options.downloadName Suggested filename for the download link.
 * @returns {{ element: HTMLElement, destroy: Function }}
 */
export function renderAudioPlayer(container, { src, className = '', downloadName = 'podcast.mp3' }) {
    const label = `Podcast de la clase — ${className}`;

    const el = document.createElement('div');
    el.className = 'audio-player';
    el.setAttribute('data-testid', 'tts-audio-player');
    el.innerHTML = `
        <div class="audio-player-label" data-testid="audio-player-label">🎧 ${escapeHtml(label)}</div>
        <audio class="audio-player-media" preload="metadata" data-testid="audio-player-media">
            <source src="${escapeHtml(src)}" type="audio/mpeg">
            Tu navegador no soporta el elemento de audio.
        </audio>
        <div class="audio-player-controls">
            <button type="button" class="audio-player-play" data-testid="audio-player-play" aria-label="Reproducir" title="Reproducir/Pausar">
                <svg class="icon-play" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                <svg class="icon-pause" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="display:none"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
            </button>
            <span class="audio-player-time" data-testid="audio-player-elapsed">0:00</span>
            <input type="range" class="audio-player-progress" data-testid="audio-player-progress" min="0" max="1000" step="1" value="0" aria-label="Progreso de reproducción">
            <span class="audio-player-time" data-testid="audio-player-duration">0:00</span>
            <a class="audio-player-download" data-testid="audio-player-download" href="${escapeHtml(src)}" download="${escapeHtml(downloadName)}" title="Descargar audio" aria-label="Descargar audio">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </a>
        </div>
        <div class="audio-player-speed" role="group" aria-label="Velocidad de reproducción">
            <span class="audio-player-speed-label">Velocidad:</span>
            ${SPEED_OPTIONS.map(speed => `
                <button type="button" class="audio-player-speed-btn${speed === 1 ? ' active' : ''}" data-rate="${speed}" aria-pressed="${speed === 1 ? 'true' : 'false'}">${speed}x</button>
            `).join('')}
        </div>
    `;

    container.appendChild(el);

    const media = el.querySelector('.audio-player-media');
    const playBtn = el.querySelector('.audio-player-play');
    const iconPlay = el.querySelector('.icon-play');
    const iconPause = el.querySelector('.icon-pause');
    const progress = el.querySelector('.audio-player-progress');
    const elapsedEl = el.querySelector('[data-testid="audio-player-elapsed"]');
    const durationEl = el.querySelector('[data-testid="audio-player-duration"]');
    const speedBtns = el.querySelectorAll('.audio-player-speed-btn');

    let seeking = false;
    let currentRate = 1;

    const setPlaying = (playing) => {
        playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
        playBtn.setAttribute('title', playing ? 'Pausar' : 'Reproducir');
        iconPlay.style.display = playing ? 'none' : '';
        iconPause.style.display = playing ? '' : 'none';
        el.classList.toggle('is-playing', playing);
    };

    const setDuration = () => {
        if (Number.isFinite(media.duration)) {
            durationEl.textContent = formatTime(media.duration);
        }
    };

    const syncProgress = () => {
        if (seeking || !Number.isFinite(media.duration) || media.duration <= 0) return;
        const pct = (media.currentTime / media.duration) * 1000;
        progress.value = String(Math.round(pct));
        elapsedEl.textContent = formatTime(media.currentTime);
    };

    playBtn.addEventListener('click', () => {
        if (media.paused) {
            media.play().catch(() => {
                setPlaying(false);
            });
        } else {
            media.pause();
        }
    });

    progress.addEventListener('input', () => {
        seeking = true;
        const pct = Number(progress.value) / 1000;
        if (Number.isFinite(media.duration) && media.duration > 0) {
            const target = pct * media.duration;
            elapsedEl.textContent = formatTime(target);
        }
    });

    progress.addEventListener('change', () => {
        if (Number.isFinite(media.duration) && media.duration > 0) {
            const pct = Number(progress.value) / 1000;
            media.currentTime = pct * media.duration;
        }
        seeking = false;
        syncProgress();
    });

    media.addEventListener('play', () => setPlaying(true));
    media.addEventListener('pause', () => setPlaying(false));
    media.addEventListener('ended', () => {
        setPlaying(false);
        media.currentTime = 0;
        progress.value = '0';
        elapsedEl.textContent = '0:00';
    });
    media.addEventListener('loadedmetadata', setDuration);
    media.addEventListener('durationchange', setDuration);
    media.addEventListener('timeupdate', syncProgress);

    speedBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            currentRate = Number(btn.dataset.rate);
            media.playbackRate = currentRate;
            speedBtns.forEach((b) => {
                const active = Number(b.dataset.rate) === currentRate;
                b.classList.toggle('active', active);
                b.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        });
    });

    media.addEventListener('loadedmetadata', () => {
        media.playbackRate = currentRate;
        speedBtns.forEach((b) => {
            const active = Number(b.dataset.rate) === currentRate;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    });

    const destroy = () => {
        media.pause();
        media.removeAttribute('src');
        media.load();
        el.remove();
    };

    return { element: el, destroy };
}