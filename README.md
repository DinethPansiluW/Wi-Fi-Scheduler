# Wi-Fi OFF Scheduler

A modern, compact desktop application built with Electron and Windows native tooling that replaces legacy batch scripts with an intuitive, flexible, and robust automated Wi-Fi scheduling engine.

---

## Highlights & Features

- **Background Scheduling via Windows Task Scheduler (`schtasks`)**: Every enabled rule is synchronized directly with Windows Task Scheduler under `\WiFiOffScheduler\`. Your schedules trigger and run reliably even when the desktop application is **completely closed** or quit from the system tray!
- **Headless Runner Mode**: When an OS scheduled task triggers, the app starts in a hidden, lightweight headless mode (`--run-rule "<ruleId>"` or `--reconnect "<ssid>"`), safely validates missed occurrences within the catch-up window, executes the command with zero GUI popups, logs history atomically, and exits cleanly.
- **Compact NetMod-Style Flat UI**: Clean, calm interface featuring a 52px slim navigation rail (Home, Log, Settings, and About), flat cards, custom typeable 12h/24h time picker, live countdown ticker, and a 15px corner radius.
- **Standard User Execution (`asInvoker`)**: Never requires Administrator privileges. Windows `netsh wlan disconnect`, `connect`, and `schtasks` run seamlessly in standard user context with `RunLevel=LeastPrivilege`.
- **Sanitized Execution**: All system commands (`netsh`, `ipconfig`, `schtasks`) are dispatched using `child_process.execFile` with discrete argument vectors—never raw shell string concatenation. SSIDs with spaces, quotes, or special characters run securely.
- **Advanced Rules Engine**:
  - **Actions**: Disconnect Wi-Fi, Connect to saved profile, Toggle, and Renew IP (`ipconfig /renew`).
  - **Filters**: Target ANY network, ONLY specified SSIDs, or ALL EXCEPT specified SSIDs.
  - **Cadences**: Once (specific date & time), Daily, Weekly (multi-select days), and Monthly (with 28/29/30/31-day clamping).
  - **Auto-Reconnect**: Automatically reconnects after *N* minutes for Disconnect rules via a one-time OS task.
  - **Catch-Up**: Automatically detects if the PC was asleep or off at the scheduled time (`StartWhenAvailable=true`) and executes within the configured catch-up window.
- **Atomic Data Persistence**: Atomic writes (`temp file` + `fs.renameSync`) with timestamp-based mtime cache invalidation prevent race conditions between the GUI window and headless background runs.

---

## How Background Schedules Work

1. **Task Registration**:
   When you create or enable a rule, the app registers a scheduled task in Windows Task Scheduler inside the `\WiFiOffScheduler\` folder named `Rule_<ruleId>`.
2. **Execution Without App Open**:
   At the trigger time, Windows Task Scheduler launches the application executable with `--run-rule "<ruleId>"`. The app runs in background headless mode:
   - Verifies the rule is enabled and not paused.
   - Evaluates the occurrence and catch-up window to guarantee no duplicate firing.
   - Executes the network command via `netsh` or `ipconfig`.
   - Records the result in `history.json` and displays a native notification banner if enabled.
   - Exits immediately.
3. **No Double-Firing**:
   When the GUI application is already open, the in-app scheduler detects which rules are registered with the OS and defers execution to the Windows Task Scheduler task while continuing to update live countdowns and UI tickers.

### Verification Steps

You can verify that background tasks are registered using either method:
- **Windows Task Scheduler GUI**: Press `Win + R`, type `taskschd.msc`, expand **Task Scheduler Library**, and click on the **WiFiOffScheduler** folder.
- **Command Line**: Run the following command in PowerShell or Command Prompt:
  ```cmd
  schtasks /Query /FO LIST /TN "\WiFiOffScheduler\"
  ```

### Quick Test Recipe

To test that rules execute with the app completely closed:
1. Open Wi-Fi OFF Scheduler.
2. Click the floating **+** button to create a new rule.
3. Choose **Disconnect** and set the trigger time **2 minutes ahead** of your current clock time. Click **Save Rule**.
4. In Settings, confirm **Windows Task Scheduler** is enabled and shows `Active Windows tasks: 1`.
5. Right-click the app's tray icon in your Windows taskbar and choose **Quit** (the app is now fully closed).
6. Wait for the 2 minutes to elapse.
7. Observe your Wi-Fi disconnect and a desktop notification appear.
8. Reopen Wi-Fi OFF Scheduler: the Activity Log will show the background execution with timestamp and success result!

---

## File Structure

```text
wifi-off-scheduler/
├── .gitignore
├── .npmrc
├── build/
│   ├── icon.ico
│   ├── icon.png
│   ├── installer.nsh          # NSIS uninstaller script to remove background tasks
│   └── README.txt
├── dev-server.js              # Standalone web preview server for testing
├── main.js                    # Main process with headless runner & IPC handlers
├── package.json
├── preload.js                 # ContextBridge secure IPC bridge
├── README.md
├── renderer/
│   ├── app.js                 # UI logic, sheet editor, tickers, About page
│   ├── icon.png               # App visual logo
│   ├── index.html             # NetMod layout, Settings, About view
│   └── styles.css             # Flat theme styling, 15px radius, social cards
├── scheduler.js               # Next-run calculation engine & OS task deferral
├── store.js                   # Atomic storage with mtime cache invalidation
├── taskscheduler.js           # Windows Task Scheduler XML & schtasks bridge
├── test-schedule.js           # 21 next-run math unit tests
├── test-tasks.js              # 7 Task Scheduler XML unit tests
└── wifi.js                    # Windows netsh & ipconfig command interface
```

---

## How to Run & Build

### 1. Prerequisites
- Node.js 18 or higher
- Windows 10 or Windows 11

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Unit Tests
```bash
# Verify next-run schedule calculations (21 tests)
npm run test:schedule

# Verify Windows Task Scheduler XML generation & triggers (7 tests)
npm run test:tasks
```

### 4. Run Development Desktop App
```bash
npm start
```

### 5. Build Standalone Windows Executables
```bash
npm run dist
```
Produces:
- **NSIS Installer**: `dist/Wi-Fi OFF Scheduler-Setup-1.0.0.exe` (includes automatic Task Scheduler cleanup upon uninstall).
- **Portable Executable**: `dist/Wi-Fi OFF Scheduler-Portable-1.0.0.exe` (zero-install single `.exe`).

---

## About & Developer Credits

- **Author**: DinethPansiluW
- **Role**: Lead author of the original Wi-Fi OFF Scheduler batch tool, converted into this Electron desktop app.
- **License**: MIT License.
