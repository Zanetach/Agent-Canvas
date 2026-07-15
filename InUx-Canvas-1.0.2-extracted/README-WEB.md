# InUx Canvas 本地 Web 运行

该目录是从 `InUx-Canvas-1.0.2-arm64.dmg` 提取的 macOS ARM64 构建产物。后端程序同时提供 API 和前端静态页面，因此无需启动 Electron 窗口。

## 启动

```bash
cd /Users/zane/Documents/Agent-01/InUx-Canvas-1.0.2-extracted
./start-web.sh
```

启动成功后会自动打开：

```text
http://127.0.0.1:17851
```

终端中按 `Ctrl+C` 停止。若不希望自动打开浏览器：

```bash
./start-web.sh --no-open
```

可通过环境变量修改端口和数据目录：

```bash
INUX_BACKEND_PORT=18000 INUX_DATA_DIR="$HOME/.inux-canvas" ./start-web.sh
```

## 验证

Web 服务运行不依赖 Playwright。只有完整浏览器烟测需要 Node.js、`npx` 和 Playwright Chromium；若尚未安装：

```bash
npx playwright install chromium
```

然后执行：

```bash
./test-web.sh
```

测试会使用临时数据目录和 `17852` 端口，依次检查健康接口、前端资源，并通过本机 Playwright Chromium Headless Shell 确认“新建画布”界面完成渲染。

## macOS 安全提示

若重新从 DMG 提取后出现“Apple 无法验证”提示，只移除该提取目录的隔离属性：

```bash
./start-web.sh --fix-quarantine
```

该选项只处理当前提取目录并继续启动，不需要关闭系统 Gatekeeper。
