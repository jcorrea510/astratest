/** Version info baked in by vite.config: the version comes from package.json; the commit hash is for Settings > About and the FPS counter only. */
declare const __APP_VERSION__: string | undefined;
declare const __COMMIT__: string | undefined;
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const COMMIT: string = typeof __COMMIT__ === 'string' ? __COMMIT__ : 'dev';
export function formatVersion(version: string): string { return `v${version}`; }
/** "v0.9.0", shown on menus. */
export const VERSION_LABEL: string = formatVersion(VERSION);
/** "v0.9.0 · abc1234", shown in Settings > About and beside the FPS counter. */
export const BUILD: string = `${VERSION_LABEL} · ${COMMIT}`;
