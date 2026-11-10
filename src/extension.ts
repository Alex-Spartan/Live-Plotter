import * as net from 'node:net';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface IncomingSample {
  values: Record<string, number>;
}

interface PlotSample {
  type: 'sample';
  values: Record<string, number>;
  timestamp: number;
}

const DEFAULT_PORT = 43173;
const MAX_MESSAGE_LENGTH = 64 * 1024;
const MAX_VARIABLES = 100;
const MAX_NAME_LENGTH = 100;

export function activate(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  let webviewReady = false;
  const knownVariables = new Set<string>();
  const recentSamples: PlotSample[] = [];
  const clients = new Set<net.Socket>();
  const output = vscode.window.createOutputChannel('Live Variable Plotter');
  const port = vscode.workspace.getConfiguration('liveVariablePlotter').get<number>('port', DEFAULT_PORT);
  const maxDataPoints = vscode.workspace.getConfiguration('liveVariablePlotter').get<number>('maxDataPoints', 120);

  const postStatus = (message: string): void => {
    void panel?.webview.postMessage({ type: 'status', message });
  };

  const openGraph = (): void => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    panel = vscode.window.createWebviewPanel(
      'liveVariablePlotter',
      'Live Variable Plotter',
      vscode.ViewColumn.Active,
      { enableScripts: true },
    );
    panel.webview.html = getWebviewHtml(panel.webview);
    panel.webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        webviewReady = true;
        void panel?.webview.postMessage({
          type: 'variables',
          variables: [...knownVariables],
        });
        for (const sample of recentSamples) {
          void panel?.webview.postMessage(sample);
        }
        postStatus(knownVariables.size > 0
          ? `Receiving live values on 127.0.0.1:${port}.`
          : `Waiting for samples on 127.0.0.1:${port}.`);
      }
    });
    panel.onDidDispose(() => {
      panel = undefined;
      webviewReady = false;
    });
  };

  const handleSample = (sample: IncomingSample): void => {
    let hasNewVariable = false;
    for (const [name, value] of Object.entries(sample.values)) {
      if (name.length > MAX_NAME_LENGTH) {
        continue;
      }
      if (!knownVariables.has(name)) {
        knownVariables.add(name);
        hasNewVariable = true;
      }
    }

    if (!panel) {
      openGraph();
    }
    const message: PlotSample = {
      type: 'sample',
      values: sample.values,
      timestamp: Date.now(),
    };
    recentSamples.push(message);
    if (recentSamples.length > maxDataPoints) {
      recentSamples.shift();
    }
    if (webviewReady) {
      if (hasNewVariable) {
        void panel?.webview.postMessage({
          type: 'variables',
          variables: [...knownVariables],
        });
      }
      void panel?.webview.postMessage(message);
    }
    postStatus(`Receiving live values on 127.0.0.1:${port}.`);
  };

  const server = net.createServer(socket => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > MAX_MESSAGE_LENGTH) {
        output.appendLine('Rejected an oversized sample from the local client.');
        socket.destroy();
        return;
      }

      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) {
          continue;
        }
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isIncomingSample(parsed)) {
            output.appendLine('Rejected an invalid sample from the local client.');
            continue;
          }
          handleSample(parsed);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          output.appendLine(`Could not read a local sample: ${detail}`);
        }
      }
    });
    socket.on('error', error => {
      output.appendLine(`Local sample connection error: ${error.message}`);
    });
  });

  server.on('error', error => {
    const message = `Could not listen on 127.0.0.1:${port}: ${error.message}`;
    output.appendLine(message);
    void vscode.window.showErrorMessage(`${message}. Check the Live Variable Plotter port setting.`);
    postStatus(message);
  });
  server.listen(port, '127.0.0.1', () => {
    output.appendLine(`Listening for C++ samples on 127.0.0.1:${port}.`);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('liveVariablePlotter.open', openGraph),
    vscode.commands.registerCommand('liveVariablePlotter.runDemo', () => {
      openGraph();
      const terminal = vscode.window.createTerminal({
        name: 'Live Variable Plotter Demo',
        cwd: path.join(context.extensionPath, 'examples'),
      });
      terminal.show();
      terminal.sendText(
        'cmd.exe /d /c "g++.exe -std=c++11 -O0 -g live_variables.cpp -lws2_32 -o live_variables.exe && live_variables.exe"',
      );
    }),
    output,
    new vscode.Disposable(() => {
      for (const client of clients) {
        client.destroy();
      }
      clients.clear();
      if (server.listening) {
        server.close();
      }
    }),
  );
}

export function deactivate(): void {}

function isIncomingSample(value: unknown): value is IncomingSample {
  if (!value || typeof value !== 'object' || !('values' in value)) {
    return false;
  }
  const values = value.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return false;
  }

  const entries = Object.entries(values);
  return entries.length > 0
    && entries.length <= MAX_VARIABLES
    && entries.every(([name, sample]) =>
      name.length > 0
      && name.length <= MAX_NAME_LENGTH
      && typeof sample === 'number'
      && Number.isFinite(sample));
}

function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const maxDataPoints = vscode.workspace.getConfiguration('liveVariablePlotter').get<number>('maxDataPoints', 120);
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Variable Plotter</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 16px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    #status { color: var(--vscode-descriptionForeground); min-height: 1.4em; }
    #variables { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .variable { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--vscode-panel-border); padding: 5px 8px; }
    .variable input { accent-color: var(--vscode-focusBorder); }
    canvas { width: 100%; height: min(65vh, 480px); display: block; }
    #empty { color: var(--vscode-descriptionForeground); padding: 32px 0; text-align: center; }
  </style>
</head>
<body>
  <header><h2>Live Variable Plotter</h2></header>
  <div id="status" role="status">Connecting to the local C++ sample listener...</div>
  <div id="variables" aria-label="Select variables to plot"></div>
  <div id="empty">Send a sample from C++, Python, or JavaScript to display it here.</div>
  <canvas id="chart" aria-label="Live variable graph"></canvas>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const limit = ${maxDataPoints};
    const colors = ['#3794ff', '#e3a23b', '#4ec9b0', '#d16d9e', '#b180d7', '#89c541', '#e06c75'];
    const series = new Map();
    const selected = new Set();
    const canvas = document.getElementById('chart');
    const context = canvas.getContext('2d');
    const variableList = document.getElementById('variables');
    const empty = document.getElementById('empty');

    function updateVisibility() {
      empty.hidden = selected.size > 0;
      canvas.hidden = selected.size === 0;
      empty.textContent = series.size === 0
        ? 'Send a sample from C++, Python, or JavaScript to display it here.'
        : 'Select one or more variables above to display them.';
    }

    function renderVariables() {
      variableList.replaceChildren();
      for (const [name, item] of series) {
        const label = document.createElement('label');
        label.className = 'variable';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(name);
        checkbox.onchange = () => {
          if (checkbox.checked) selected.add(name); else selected.delete(name);
          updateVisibility();
          resizeCanvas();
          draw();
        };
        const color = document.createElement('span');
        color.style.color = item.color;
        color.textContent = name;
        label.append(checkbox, color);
        variableList.append(label);
      }
      updateVisibility();
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      let min = Infinity;
      let max = -Infinity;
      for (const name of selected) {
        const item = series.get(name);
        if (!item) continue;
        for (const value of item.points) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
      if (min === Infinity) return;
      if (min === max) { min -= 1; max += 1; }
      const left = 58, right = 12, top = 12, bottom = 26;
      const plotWidth = Math.max(1, width - left - right);
      const plotHeight = Math.max(1, height - top - bottom);
      context.font = '12px ' + getComputedStyle(document.body).fontFamily;
      context.strokeStyle = getComputedStyle(document.body).getPropertyValue('--vscode-panel-border');
      context.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground');
      context.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = top + plotHeight * i / 4;
        const label = (max - (max - min) * i / 4).toPrecision(4);
        context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
        context.fillText(label, 0, y + 4);
      }
      for (const name of selected) {
        const item = series.get(name);
        if (!item || !item.points.length) continue;
        context.strokeStyle = item.color;
        context.lineWidth = 2;
        context.beginPath();
        item.points.forEach((value, index) => {
          const x = left + plotWidth * index / Math.max(1, limit - 1);
          const y = top + plotHeight * (max - value) / (max - min);
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.stroke();
      }
    }

    window.addEventListener('resize', () => { resizeCanvas(); draw(); });
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'status') {
        document.getElementById('status').textContent = message.message;
      } else if (message.type === 'variables') {
        for (const name of message.variables) {
          if (!series.has(name)) {
            const colorIndex = series.size % colors.length;
            series.set(name, { color: colors[colorIndex], points: [] });
          }
        }
        renderVariables();
        resizeCanvas();
        draw();
      } else if (message.type === 'sample') {
        for (const [name, value] of Object.entries(message.values)) {
          const item = series.get(name);
          if (!item || !Number.isFinite(value)) continue;
          item.points.push(value);
          if (item.points.length > limit) item.points.shift();
        }
        draw();
      }
    });
    resizeCanvas();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}
