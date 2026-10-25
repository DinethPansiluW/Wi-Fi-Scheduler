/**
 * Wi-Fi OFF Scheduler - Wi-Fi & Network Engine
 * Wraps Windows netsh wlan and ipconfig commands using child_process.execFile with argument arrays.
 * Never uses raw shell string concatenation to prevent command injection with SSIDs having spaces or quotes.
 */

const { execFile } = require('child_process');

const TIMEOUT_MS = 15000;

/**
 * Executes a system binary with argument array safely.
 * @param {string} file Binary name or path.
 * @param {string[]} args Array of arguments.
 * @param {number} [timeout=15000] Timeout in milliseconds.
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runCommand(file, args = [], timeout = TIMEOUT_MS) {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        {
          windowsHide: true,
          timeout,
          maxBuffer: 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              stdout: stdout ? stdout.toString() : '',
              stderr: stderr ? stderr.toString() : error.message,
              code: typeof error.code === 'number' ? error.code : 1,
              error
            });
          } else {
            resolve({
              stdout: stdout ? stdout.toString() : '',
              stderr: stderr ? stderr.toString() : '',
              code: 0,
              error: null
            });
          }
        }
      );
    } catch (err) {
      resolve({
        stdout: '',
        stderr: err.message,
        code: 1,
        error: err
      });
    }
  });
}

/**
 * Gets the current Wi-Fi adapter state and connected SSID.
 * Parses `netsh wlan show interfaces`.
 * Specifically ensures BSSID is NEVER mistaken for SSID.
 *
 * @returns {Promise<{
 *   available: boolean,
 *   connected: boolean,
 *   state: 'connected' | 'disconnected' | 'no_adapter' | 'service_stopped',
 *   ssid: string | null,
 *   interfaceName: string | null,
 *   description: string | null,
 *   signal: string | null,
 *   rawOutput: string,
 *   error?: string
 * }>}
 */
async function getCurrentWifiState() {
  const result = await runCommand('netsh', ['wlan', 'show', 'interfaces']);
  const output = result.stdout || '';

  // Check if WLAN AutoConfig service is stopped
  if (
    output.includes('WLAN AutoConfig service is not running') ||
    output.includes('The Wireless AutoConfig Service (wlansvc) is not running')
  ) {
    return {
      available: false,
      connected: false,
      state: 'service_stopped',
      ssid: null,
      interfaceName: null,
      description: null,
      signal: null,
      rawOutput: output,
      error: 'WLAN AutoConfig service (wlansvc) is not running.'
    };
  }

  // Check if there are no wireless interfaces installed or hosted
  if (
    output.includes('There is no wireless interface on the system') ||
    output.includes('No wireless interface found') ||
    output.trim() === ''
  ) {
    return {
      available: false,
      connected: false,
      state: 'no_adapter',
      ssid: null,
      interfaceName: null,
      description: null,
      signal: null,
      rawOutput: output,
      error: 'No Wi-Fi adapter detected on this system.'
    };
  }

  const lines = output.split(/\r?\n/);
  let interfaceName = null;
  let description = null;
  let state = 'disconnected';
  let ssid = null;
  let signal = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Interface name: "Name                   : Wi-Fi"
    if (/^Name\s*:/i.test(trimmed)) {
      const match = trimmed.match(/^Name\s*:\s*(.+)$/i);
      if (match) interfaceName = match[1].trim();
    }

    // Description: "Description            : Intel(R) Wi-Fi 6 AX200..."
    if (/^Description\s*:/i.test(trimmed)) {
      const match = trimmed.match(/^Description\s*:\s*(.+)$/i);
      if (match) description = match[1].trim();
    }

    // State: "State                  : connected" or "disconnected"
    if (/^State\s*:/i.test(trimmed)) {
      const match = trimmed.match(/^State\s*:\s*(.+)$/i);
      if (match) {
        const val = match[1].trim().toLowerCase();
        state = val.includes('connected') && !val.includes('disconnected') ? 'connected' : 'disconnected';
      }
    }

    // SSID line: MUST NOT match BSSID!
    // Example: "SSID                   : Hemis WiFi"
    // (BSSID line is "BSSID                  : 12:34:56:78:9a:bc")
    if (/^SSID\s*:/i.test(trimmed) && !/^BSSID/i.test(trimmed)) {
      const match = trimmed.match(/^SSID\s*:\s*(.+)$/i);
      if (match) {
        ssid = match[1].trim();
      }
    }

    // Signal: "Signal                 : 95%"
    if (/^Signal\s*:/i.test(trimmed)) {
      const match = trimmed.match(/^Signal\s*:\s*(\d+%\s*.*)$/i);
      if (match) {
        signal = match[1].trim();
      }
    }
  }

  const isConnected = state === 'connected';

  return {
    available: true,
    connected: isConnected,
    state: isConnected ? 'connected' : 'disconnected',
    ssid: isConnected ? ssid : null,
    interfaceName,
    description,
    signal,
    rawOutput: output
  };
}

/**
 * Gets list of saved Wi-Fi profile names on the machine.
 * Parses `netsh wlan show profiles`.
 *
 * @returns {Promise<string[]>}
 */
async function getSavedProfiles() {
  const result = await runCommand('netsh', ['wlan', 'show', 'profiles']);
  const output = result.stdout || '';
  const profiles = [];

  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // Matches: "All User Profile     : <ProfileName>"
    // Also tolerant of "User Profile          : <ProfileName>"
    const match = trimmed.match(/^(?:All User Profile|User Profile)\s*:\s*(.+)$/i);
    if (match) {
      const name = match[1].trim();
      if (name && !profiles.includes(name)) {
        profiles.push(name);
      }
    }
  }

  return profiles;
}

/**
 * Disconnects the active Wi-Fi connection.
 * Runs `netsh wlan disconnect`.
 * Works without admin privileges.
 *
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function disconnectWifi() {
  const result = await runCommand('netsh', ['wlan', 'disconnect']);
  const output = (result.stdout + ' ' + result.stderr).trim();

  // If successfully dispatched or already disconnected
  if (
    result.code === 0 ||
    output.toLowerCase().includes('completed successfully') ||
    output.toLowerCase().includes('disconnected')
  ) {
    return {
      success: true,
      message: 'Wi-Fi disconnect command sent successfully.'
    };
  }

  return {
    success: false,
    message: output || 'Failed to disconnect Wi-Fi.'
  };
}

/**
 * Connects to a saved Wi-Fi profile.
 * Runs `netsh wlan connect name=<profileName>`.
 * Does not require admin privileges.
 *
 * @param {string} profileName
 * @param {string} [interfaceName] Optional interface name.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function connectWifi(profileName, interfaceName) {
  if (!profileName) {
    return { success: false, message: 'Profile name is required to connect.' };
  }

  const args = ['wlan', 'connect', `name=${profileName}`];
  if (interfaceName) {
    args.push(`interface=${interfaceName}`);
  }

  const result = await runCommand('netsh', args);
  const output = (result.stdout + ' ' + result.stderr).trim();

  if (
    result.code === 0 ||
    output.toLowerCase().includes('completed successfully') ||
    output.toLowerCase().includes('connection request was given successfully')
  ) {
    return {
      success: true,
      message: `Connection request sent for profile "${profileName}".`
    };
  }

  return {
    success: false,
    message: output || `Failed to connect to "${profileName}".`
  };
}

/**
 * Renews the IP configuration.
 * Runs `ipconfig /renew`.
 *
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function renewIp() {
  const result = await runCommand('ipconfig', ['/renew'], 20000);
  const output = (result.stdout + ' ' + result.stderr).trim();

  if (result.code === 0 && !output.toLowerCase().includes('an error occurred')) {
    return {
      success: true,
      message: 'IP address renewed successfully.'
    };
  }

  return {
    success: result.code === 0,
    message: output.slice(0, 300) || 'IP renew executed.'
  };
}

/**
 * Checks if a rule's SSID target condition matches the current network.
 *
 * @param {Object} rule
 * @param {string|null} currentSsid
 * @returns {{ matches: boolean, reason: string }}
 */
function evaluateSsidTarget(rule, currentSsid) {
  const targetType = rule.targetType || 'any'; // 'any' | 'only' | 'except'
  const targetSsids = Array.isArray(rule.targetSsids)
    ? rule.targetSsids.map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];

  const activeSsidNormalized = (currentSsid || '').trim().toLowerCase();

  if (targetType === 'any') {
    return { matches: true, reason: 'Target set to ANY Wi-Fi.' };
  }

  if (targetType === 'only') {
    if (targetSsids.length === 0) {
      return { matches: true, reason: 'No filter specified; acting on current network.' };
    }
    if (activeSsidNormalized && targetSsids.includes(activeSsidNormalized)) {
      return {
        matches: true,
        reason: `Current SSID "${currentSsid}" matches allowed list.`
      };
    }
    return {
      matches: false,
      reason: `Current SSID "${currentSsid || 'None'}" is not in target list [${(rule.targetSsids || []).join(', ')}].`
    };
  }

  if (targetType === 'except') {
    if (activeSsidNormalized && targetSsids.includes(activeSsidNormalized)) {
      return {
        matches: false,
        reason: `Current SSID "${currentSsid}" is in excluded list [${(rule.targetSsids || []).join(', ')}].`
      };
    }
    return {
      matches: true,
      reason: `Current SSID "${currentSsid || 'None'}" is not excluded.`
    };
  }

  return { matches: true, reason: 'Condition satisfied.' };
}

/**
 * High-level executor for a rule against the live network state.
 *
 * @param {Object} rule
 * @returns {Promise<{ success: boolean, action: string, message: string, detail?: string }>}
 */
async function executeRule(rule) {
  if (!rule) {
    return { success: false, action: 'unknown', message: 'Rule is invalid or undefined.' };
  }

  const action = rule.action || 'disconnect'; // 'disconnect' | 'connect' | 'toggle' | 'renew_ip'
  const state = await getCurrentWifiState();

  // 1. DISCONNECT ACTION
  if (action === 'disconnect') {
    if (!state.connected) {
      return {
        success: true,
        action: 'disconnect',
        message: 'Wi-Fi was already disconnected. No action needed.'
      };
    }

    const evaluation = evaluateSsidTarget(rule, state.ssid);
    if (!evaluation.matches) {
      return {
        success: false,
        action: 'disconnect',
        message: `Skipped: ${evaluation.reason}`
      };
    }

    const result = await disconnectWifi();
    return {
      success: result.success,
      action: 'disconnect',
      message: result.success
        ? `Disconnected from "${state.ssid || 'Wi-Fi'}".`
        : `Disconnect failed: ${result.message}`
    };
  }

  // 2. CONNECT ACTION
  if (action === 'connect') {
    const profile = rule.targetProfile;
    if (!profile) {
      return {
        success: false,
        action: 'connect',
        message: 'No Wi-Fi profile selected for connection.'
      };
    }

    if (rule.onlyIfNotConnected && state.connected) {
      return {
        success: true,
        action: 'connect',
        message: `Already connected to "${state.ssid || 'a network'}". Skipping connect.`
      };
    }

    const result = await connectWifi(profile, state.interfaceName);
    return {
      success: result.success,
      action: 'connect',
      message: result.message
    };
  }

  // 3. TOGGLE ACTION
  if (action === 'toggle') {
    if (state.connected) {
      // Check target filter
      const evaluation = evaluateSsidTarget(rule, state.ssid);
      if (!evaluation.matches) {
        return {
          success: false,
          action: 'toggle',
          message: `Skipped disconnect: ${evaluation.reason}`
        };
      }
      const disc = await disconnectWifi();
      return {
        success: disc.success,
        action: 'toggle',
        message: disc.success
          ? `Toggled: Disconnected from "${state.ssid}".`
          : `Toggle disconnect failed: ${disc.message}`
      };
    } else {
      // Disconnected: connect to target profile
      const profile = rule.targetProfile;
      if (!profile) {
        return {
          success: false,
          action: 'toggle',
          message: 'Wi-Fi is disconnected, but no connect profile specified.'
        };
      }
      const conn = await connectWifi(profile, state.interfaceName);
      return {
        success: conn.success,
        action: 'toggle',
        message: conn.success
          ? `Toggled: Connected to "${profile}".`
          : `Toggle connect failed: ${conn.message}`
      };
    }
  }

  // 4. RENEW IP ACTION
  if (action === 'renew_ip') {
    const renew = await renewIp();
    return {
      success: renew.success,
      action: 'renew_ip',
      message: renew.message
    };
  }

  return {
    success: false,
    action: action,
    message: `Unknown action: "${action}".`
  };
}

module.exports = {
  getCurrentWifiState,
  getSavedProfiles,
  disconnectWifi,
  connectWifi,
  renewIp,
  evaluateSsidTarget,
  executeRule
};
