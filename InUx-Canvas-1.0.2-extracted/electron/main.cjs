const { appendFileSync, mkdirSync } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} = require('electron');

const {
  checkLatestRelease,
  isAllowedReleaseUrl,
} = require('./update-service.cjs');

const BACKEND_HOST = '127.0.0.1';
// Keep the origin stable so localStorage and IndexedDB survive app restarts.
const BACKEND_PORT = 17851;
const BACKEND_START_TIMEOUT_MS = 45_000;
const BACKEND_POLL_INTERVAL_MS = 250;

let backendProcess = null;
let backendPort = 0;
let mainWindow = null;

function appendBackendLog(stream, chunk) {
  const logDir = path.join(app.getPath('userData'), 'logs');
  mkdirSync(logDir, { recursive: true });
  appendFileSync(
    path.join(logDir, 'backend.log'),
    `[${new Date().toISOString()}] [${stream}] ${String(chunk)}`,
    'utf8',
  );
}

function assertBackendPortAvailable() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => {
      reject(new Error(`本地端口 ${BACKEND_PORT} 已被占用，请关闭占用它的程序后重试`));
    });
    server.listen(BACKEND_PORT, BACKEND_HOST, () => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  });
}

function getBackendExecutable() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'inux-canvas-backend');
  }
  return path.resolve(__dirname, '..', 'dist', 'inux-canvas-backend', 'inux-canvas-backend');
}

function requestHealth(port) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: BACKEND_HOST,
      port,
      path: '/api/health',
      timeout: 1_000,
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.once('error', () => resolve(false));
  });
}

async function waitForBackend(port) {
  const deadline = Date.now() + BACKEND_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (backendProcess?.exitCode != null) {
      throw new Error(`本地后端提前退出，代码 ${backendProcess.exitCode}`);
    }
    if (await requestHealth(port)) return;
    await new Promise(resolve => setTimeout(resolve, BACKEND_POLL_INTERVAL_MS));
  }
  throw new Error('本地后端启动超时');
}

async function startBackend() {
  await assertBackendPortAvailable();
  backendPort = BACKEND_PORT;
  const executable = getBackendExecutable();
  const dataDir = app.getPath('userData');
  backendProcess = spawn(executable, [], {
    env: {
      ...process.env,
      INUX_BACKEND_PORT: String(backendPort),
      INUX_DATA_DIR: dataDir,
      INUX_BACKEND_LOG_LEVEL: 'info',
      PYTHONUNBUFFERED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess.stdout.on('data', chunk => appendBackendLog('stdout', chunk));
  backendProcess.stderr.on('data', chunk => appendBackendLog('stderr', chunk));
  backendProcess.once('error', error => appendBackendLog('process', `${error.stack || error}\n`));
  await waitForBackend(backendPort);
}

function stopBackend() {
  if (!backendProcess || backendProcess.exitCode != null) return;
  backendProcess.kill('SIGTERM');
  const processToStop = backendProcess;
  setTimeout(() => {
    if (processToStop.exitCode == null) processToStop.kill('SIGKILL');
  }, 3_000).unref();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#101010',
    title: 'InUx Canvas',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const appUrl = `http://${BACKEND_HOST}:${backendPort}`;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== appUrl && !url.startsWith(`${appUrl}/`)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle('InUx Canvas');
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadURL(appUrl);
}

ipcMain.handle('desktop:get-app-info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
}));

ipcMain.handle('desktop:check-for-updates', () => (
  checkLatestRelease({ currentVersion: app.getVersion() })
));

ipcMain.handle('desktop:open-release-page', async (_event, releaseUrl) => {
  if (!isAllowedReleaseUrl(releaseUrl)) {
    return { ok: false, error: '更新地址不可信' };
  }
  await shell.openExternal(releaseUrl);
  return { ok: true };
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      await startBackend();
      createMainWindow();
    } catch (error) {
      appendBackendLog('startup', `${error.stack || error}\n`);
      dialog.showErrorBox('InUx Canvas 启动失败', error?.message || String(error));
      app.quit();
    }
  });

  app.on('before-quit', stopBackend);
  app.on('window-all-closed', () => app.quit());
}
