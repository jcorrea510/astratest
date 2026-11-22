/** The build label baked in by vite.config (version + commit), shown on the title screen and next to the FPS counter. */
declare const __BUILD__: string | undefined;
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
