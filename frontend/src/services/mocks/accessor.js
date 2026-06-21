const mockCache = {};

export async function getMock(name, defaultEmpty) {
    if (import.meta.env.DEV) {
        if (!(name in mockCache)) {
            try {
                const module = await import('./data.js');
                mockCache[name] = module[name] !== undefined ? module[name] : defaultEmpty;
            } catch {
                return defaultEmpty;
            }
        }
        return mockCache[name];
    }
    return defaultEmpty;
}
