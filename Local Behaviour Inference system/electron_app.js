// electron_app.js
import { app, BrowserWindow, screen, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Override user data path to bypass Windows AppData permission/lock issues
const userDataPath = path.join(__dirname, '.electron_data');
app.setPath('userData', userDataPath);

let win = null;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  win = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set always on top level to stay above normal windows
  win.setAlwaysOnTop(true, 'screen-saver');

  win.loadURL('http://localhost:5050/overlay.html');

  win.on('closed', () => {
    win = null;
  });
}

// IPC handler to dynamically toggle click-through
ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
  const webContents = event.sender;
  const browserWindow = BrowserWindow.fromWebContents(webContents);
  if (browserWindow) {
    if (ignore) {
      browserWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      browserWindow.setIgnoreMouseEvents(false);
    }
  }
});

// IPC handler to terminate the app overlay
ipcMain.on('terminate-app', () => {
  app.quit();
});

// IPC handler to manage active workflow window state
ipcMain.on('set-workflow-active', (event, active) => {
  const webContents = event.sender;
  const browserWindow = BrowserWindow.fromWebContents(webContents);
  if (browserWindow) {
    if (active) {
      console.log('[Electron] Workflow active: ensuring overlay is on top');
      browserWindow.setAlwaysOnTop(true, 'screen-saver');
      browserWindow.setVisibleOnAllWorkspaces(true);
      browserWindow.showInactive();
      browserWindow.moveTop();
    } else {
      console.log('[Electron] Workflow inactive');
      browserWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }
});

// IPC handler to open URL in standard browser
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
