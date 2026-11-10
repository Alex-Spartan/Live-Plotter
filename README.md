# Live Variable Plotter

Live Variable Plotter displays numeric values sent directly from C++ code. It activates automatically in VS Code and opens its graph as an editor tab when the first sample arrives; no debugger is required.

## Send values from C++

Include `examples/live_plot.h`, then call `LIVE_PLOT` each time you want to send a sample. The helper keeps a TCP connection open for subsequent samples and reconnects on a later call if the receiver disconnects. The variable names are inferred from the arguments:

```cpp
#include "live_plot.h"

int temperature = 24;
double pressure = 101.3;

LIVE_PLOT(LIVE_PLOT_VALUE(temperature), LIVE_PLOT_VALUE(pressure));
```

In the graph tab, check the variables you want to display. The extension plots only checked variables and retains the most recent samples. The C++ helper connects to `127.0.0.1:43173`; values are sent over the local machine only. If you change `liveVariablePlotter.port`, compile C++ with the matching `-DLIVE_PLOT_PORT=<port>` definition.

## Try the demo

The C++ demo sends three random integers between 10 and 50 every 100 milliseconds. Build from the integrated terminal:

```powershell
g++.exe -std=c++11 -O0 examples\live_variables.cpp -o examples\live_variables.exe -lws2_32
```

The `-lws2_32` linker option is required by the Windows socket calls in `live_plot.h`. In VS Code, **Terminal: Run Build Task** (Ctrl+Shift+B) builds the active C++ file using the configured task, which includes this library.

Run **Live Variable Plotter: Run C++ Demo** from VS Code's Command Palette. The command opens the graph and runs the demo in the integrated terminal. The graph tab opens on the first sample; select `valueA`, `valueB`, and `valueC` using their checkboxes.

## Install in the current VS Code window

For regular use, install the extension into your existing VS Code profile rather than pressing F5 (which is only for extension development and opens an Extension Development Host):

1. Package the extension as a VSIX with `npx @vscode/vsce package` from this project directory.
2. In VS Code, open **Extensions** → **...** → **Install from VSIX...**, and select the generated `.vsix` file.
3. Reload VS Code. The extension starts automatically, and the graph appears as a tab when your program sends its first sample.

## Settings

- `liveVariablePlotter.port`: local receiver port (default `43173`; match it with the `LIVE_PLOT_PORT` C++ compile definition).
- `liveVariablePlotter.maxDataPoints`: maximum samples shown per variable (default `120`, range `10`–`2000`).

## Development

- `npm run compile` compiles the extension to `dist/`.
- The **Run Extension** launch configuration is for extension development only; it opens the separate Extension Development Host.
