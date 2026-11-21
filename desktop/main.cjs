// Meridian Afterglow desktop shell: serves the built game from inside the app over a private app:// origin (so fetch,
// modules and WebAssembly all work) and opens it fullscreen. Same game as the website, no tabs or browser UI.
const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
// keep the game smooth: no background throttling, use the discrete GPU path when there is one
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');

const root = path.join(__dirname, 'game');
function create() {
  const win = new BrowserWindow({
    width: 1600, height: 900, backgroundColor: '#0d2629', title: 'Meridian Afterglow', fullscreen: true,
    autoHideMenuBar: true, webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('app://game/index.html?noshell');
}
app.whenReady().then(() => {
  protocol.handle('app', req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname); if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // minimal menu (keeps Cmd+Q / Cmd+F fullscreen / copy-paste working on macOS)
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'reload' }] }]));
  create();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) create(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
