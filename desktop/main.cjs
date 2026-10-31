const { app, BrowserWindow, dialog, Menu, protocol, session } = require('electron');
const path = require('node:path');
const { APP_URL, isAppUrl, isLocalResource, createAssetHandler } = require('./protocol.cjs');

app.setName('APDF Local');
if (process.env.APDF_DESKTOP_DATA_DIR) app.setPath('userData', path.resolve(process.env.APDF_DESKTOP_DATA_DIR));
else app.setPath('userData', path.join(app.getPath('appData'), 'APDF Local'));

protocol.registerSchemesAsPrivileged([{
  scheme: 'apdf',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

let mainWindow;
let localSession;
function openWindow(url = APP_URL, auxiliary = false) {
  const window = new BrowserWindow({
    title: 'APDF Local', width: auxiliary ? 900 : 1440, height: auxiliary ? 700 : 1100,
    minWidth: 640, minHeight: 540, show: false, backgroundColor: '#f5f6f8',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      session: localSession, nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false, navigateOnDragDrop: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event, target) => {
    if (!isAppUrl(target)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === `${APP_URL}THIRD_PARTY_NOTICES.txt`) openWindow(url, true);
    return { action: 'deny' };
  });
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question', title: 'Leave the editor?',
      message: 'Leave this PDF editing session?',
      detail: 'Download your edited PDF before leaving. Edits and Undo history are not restored after closing or reloading.',
      buttons: ['Stay', 'Leave'], defaultId: 0, cancelId: 0, noLink: true,
    });
    // Electron allows the pending navigation/close when this event is prevented.
    if (choice === 1) event.preventDefault();
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') dialog.showErrorBox('APDF Local stopped', 'Reopen the app to continue. Downloaded PDFs are safe; the current unsaved edit session could not be restored.');
  });
  void window.loadURL(url).catch(error => dialog.showErrorBox('Unable to open APDF Local', error.message));
  return window;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = openWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.apdf.local');
    localSession = session.fromPartition('persist:apdf-local');
    localSession.protocol.handle('apdf', createAssetHandler(path.join(__dirname, 'web')));
    localSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isLocalResource(details.url) }));
    localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    localSession.setPermissionCheckHandler(() => false);
    localSession.on('will-download', (event, item) => {
      if (!item.getURL().startsWith('blob:apdf://app/')) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ title: 'Save PDF', filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [
        { label: 'Edit PDF', accelerator: 'CmdOrCtrl+1', click: () => { if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(APP_URL); } },
        { label: 'Assemble PDFs', accelerator: 'CmdOrCtrl+2', click: () => { if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(`${APP_URL}?view=assemble`); } },
        { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]));
    mainWindow = openWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = openWindow();
    });
  }).catch(error => { dialog.showErrorBox('Unable to start APDF Local', error.message); app.quit(); });
  app.on('before-quit', () => localSession?.flushStorageData());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
