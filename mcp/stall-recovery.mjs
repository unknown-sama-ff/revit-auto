import { execFile } from 'node:child_process';

export const STALL_RECOVERY_SCHEMA_VERSION = 1;

const INTERACTIVE_PROMPT_PATTERNS = [
  { reason: 'interactive_prompt_hang', name: 'unclosed_lisp_prompt', regex: /(?:^|\r?\n)\s*\(+_>\s*$/ },
  { reason: 'interactive_prompt_hang', name: 'press_enter_prompt', regex: /press\s+enter\s+to\s+continue/i },
  { reason: 'interactive_prompt_hang', name: 'enter_drawing_name_prompt', regex: /enter\s+name\s+of\s+drawing/i },
  { reason: 'interactive_prompt_hang', name: 'font_or_shape_prompt', regex: /(?:specify\s+(?:font|shape)|select\s+shape\s+file)/i },
  { reason: 'interactive_prompt_hang', name: 'press_esc_prompt', regex: /press\s+esc\s+to\s+cancel/i },
  { reason: 'drawing_recovery_prompt', name: 'drawing_corrupt_or_recover', regex: /(?:drawing\s+file\s+is\s+not\s+valid|press\s+enter\s+to\s+recover|drawing\s+.*needs\s+recovery)/i },
  { reason: 'cad_fatal_or_license_error', name: 'license_or_fatal_error', regex: /(?:fatal\s+error|licen[cs][a-z]*\s+.*(?:fail|error))/i }
];

export function classifyCadConsoleLog(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { stalled: false, reason: null, matchedPattern: null };
  }
  // Inspect the tail where an active interactive prompt or fatal message sits.
  const tail = text.length > 4096 ? text.slice(-4096) : text;
  for (const rule of INTERACTIVE_PROMPT_PATTERNS) {
    if (rule.regex.test(tail)) {
      return { stalled: true, reason: rule.reason, matchedPattern: rule.name };
    }
  }
  return { stalled: false, reason: null, matchedPattern: null };
}

export function buildStallReceipt({
  stallDetected = false,
  stallReason = null,
  autoRecoveryAttempted = false,
  recoveryActions = [],
  recoveryOutcome = 'not_needed',
  automaticRetryAllowed = false,
  nextSafeAction = '',
  circuitState = null,
  hostState = null,
  postTimeoutVerification = null
} = {}) {
  return {
    schemaVersion: STALL_RECOVERY_SCHEMA_VERSION,
    stallDetected: Boolean(stallDetected),
    stallReason: stallReason ?? null,
    autoRecoveryAttempted: Boolean(autoRecoveryAttempted),
    recoveryActions: Array.isArray(recoveryActions) ? [...recoveryActions] : [],
    recoveryOutcome,
    automaticRetryAllowed: Boolean(automaticRetryAllowed),
    nextSafeAction: String(nextSafeAction || ''),
    ...(circuitState ? { circuitState } : {}),
    ...(hostState ? { hostState } : {}),
    ...(postTimeoutVerification ? { postTimeoutVerification } : {})
  };
}

export class CircuitBreaker {
  constructor({ threshold = 2, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.threshold = Math.max(1, Number(threshold) || 2);
    this.windowMs = Math.max(1000, Number(windowMs) || 600000);
    this.now = now;
    this.entries = new Map();
  }

  _prune(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.lastFailureAt > this.windowMs) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  check(key) {
    const entry = this._prune(key);
    if (!entry) {
      return { open: false, consecutiveFailures: 0, threshold: this.threshold, lastReason: null };
    }
    return {
      open: entry.consecutiveFailures >= this.threshold,
      consecutiveFailures: entry.consecutiveFailures,
      threshold: this.threshold,
      lastReason: entry.lastReason
    };
  }

  recordFailure(key, reason = 'unknown') {
    const prev = this._prune(key);
    const sameReason = prev && prev.lastReason === reason;
    const consecutiveFailures = sameReason ? prev.consecutiveFailures + 1 : 1;
    const entry = {
      consecutiveFailures,
      lastReason: reason,
      lastFailureAt: this.now()
    };
    this.entries.set(key, entry);
    return {
      open: consecutiveFailures >= this.threshold,
      consecutiveFailures,
      threshold: this.threshold,
      lastReason: reason
    };
  }

  recordSuccess(key) {
    this.entries.delete(key);
    return { open: false, consecutiveFailures: 0, threshold: this.threshold, lastReason: null };
  }

  reset(key) {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
}

// Read-only Windows inspection of a Revit process (process liveness, UI thread responsiveness,
// and owned modal dialog windows such as warning/save/family prompts blocking ExternalEvent).
// Strictly non-mutating: never clicks, closes windows, focuses UI, or terminates Revit.
export async function inspectRevitHostState({ pid = null, timeoutMs = 2000 } = {}) {
  if (process.platform !== 'win32' || process.env.REVIT_AI_DISABLE_HOST_PROCESS_PROBE === '1') {
    return { available: false, reason: 'probe_skipped' };
  }
  const targetPid = Number.isInteger(pid) && pid > 0 ? pid : 0;
  const script = [
    "$ErrorActionPreference='Stop'",
    `$targetPid=${targetPid}`,
    '$procs=@()',
    'if($targetPid -gt 0){ $p=Get-Process -Id $targetPid -ErrorAction SilentlyContinue; if($p){ $procs=@($p) } }',
    'else { $procs=@(Get-Process -Name Revit -ErrorAction SilentlyContinue) }',
    'if($procs.Count -eq 0){ [ordered]@{available=$true;processAlive=$false;revitProcessCount=0;pid=$null;mainWindowResponding=$null;modalDialogDetected=$false;modalDialogCount=0;modalDialogClasses=@()} | ConvertTo-Json -Compress; exit 0 }',
    '$proc=$procs[0]',
    '$sig=@"',
    'using System;',
    'using System.Collections.Generic;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public static class RevitModalProbe {',
    '  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);',
    '  public static string[] FindOwnedDialogs(int pid, IntPtr mainHwnd) {',
    '    var list = new List<string>();',
    '    EnumWindows((h, _) => {',
    '      uint wp; GetWindowThreadProcessId(h, out wp);',
    '      if ((int)wp != pid || h == mainHwnd) return true;',
    '      if (!IsWindowVisible(h) || !IsWindowEnabled(h)) return true;',
    '      var owner = GetWindow(h, 4);',
    '      var sb = new StringBuilder(64);',
    '      GetClassName(h, sb, sb.Capacity);',
    '      var cls = sb.ToString();',
    '      bool isDialogClass = cls == "#32770" || cls.IndexOf("Dialog", StringComparison.OrdinalIgnoreCase) >= 0 || cls.IndexOf("TaskDialog", StringComparison.OrdinalIgnoreCase) >= 0;',
    '      if (isDialogClass || (owner != IntPtr.Zero && owner == mainHwnd && !IsWindowEnabled(mainHwnd))) {',
    '        if (list.Count < 8) list.Add(cls);',
    '      }',
    '      return true;',
    '    }, IntPtr.Zero);',
    '    return list.ToArray();',
    '  }',
    '}',
    '"@',
    'if(-not ("RevitModalProbe" -as [type])){ Add-Type -TypeDefinition $sig -Language CSharp | Out-Null }',
    '$dialogs=@([RevitModalProbe]::FindOwnedDialogs($proc.Id, $proc.MainWindowHandle))',
    '[ordered]@{available=$true;processAlive=$true;revitProcessCount=$procs.Count;pid=$proc.Id;mainWindowResponding=[bool]$proc.Responding;modalDialogDetected=($dialogs.Count -gt 0);modalDialogCount=$dialogs.Count;modalDialogClasses=$dialogs} | ConvertTo-Json -Compress'
  ].join('\n');

  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: Math.max(500, Math.min(5000, timeoutMs)), maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve({ available: false, reason: error?.killed ? 'probe_timeout' : 'probe_error' });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
          resolve(parsed);
        } catch {
          resolve({ available: false, reason: 'probe_parse_error' });
        }
      }
    );
  });
}

export function classifyRevitBridgeStall({ code, bridgeAlive = null, hostState = null, method = '', planId = null } = {}) {
  const isWrite = ['revit.plan.confirm', 'revit.import.commit'].includes(method);
  if (hostState?.available) {
    if (hostState.processAlive === false) {
      return {
        stallReason: 'revit_process_not_running',
        nextSafeAction: isWrite && planId
          ? `Revit process is not running. Do not retry ${method}; reopen Revit and inspect project/plan state before taking further action.`
          : 'Revit process is not running. Start Revit, open the target project, and verify the bridge add-in is loaded.'
      };
    }
    if (hostState.modalDialogDetected === true) {
      return {
        stallReason: 'revit_modal_dialog',
        nextSafeAction: isWrite && planId
          ? `Revit UI thread is blocked by a modal dialog (${(hostState.modalDialogClasses || []).join(', ') || 'dialog'}). Dismiss or resolve the dialog in Revit, then query revit.plan.get for planId "${planId}" instead of recreating/retrying the write.`
          : `Revit UI thread is blocked by a modal dialog (${(hostState.modalDialogClasses || []).join(', ') || 'dialog'}). Dismiss or resolve the dialog in Revit, then re-run the read-only query.`
      };
    }
    if (hostState.mainWindowResponding === false) {
      return {
        stallReason: 'revit_ui_unresponsive',
        nextSafeAction: isWrite && planId
          ? `Revit main window is currently unresponsive (busy regenerating or blocked). Wait for Revit to recover, then query revit.plan.get for planId "${planId}" without recreating the write.`
          : 'Revit main window is currently unresponsive (busy computing or regenerating). Wait for Revit to finish before retrying read-only queries.'
      };
    }
  }
  if (code === 'bridge_timeout' && bridgeAlive === true) {
    return {
      stallReason: 'revit_external_event_stalled',
      nextSafeAction: isWrite && planId
        ? `Revit bridge listener responded to liveness check, but ${method} timed out in the Revit UI queue. Inspect postTimeoutVerification or query revit.plan.get for planId "${planId}"; never blindly recreate the write.`
        : `Revit bridge listener responded to liveness check, but ${method || 'the request'} timed out in the Revit UI queue. Check whether Revit has an active command/edit mode open.`
    };
  }
  if (code === 'bridge_connection_unavailable') {
    return {
      stallReason: 'bridge_connection_unavailable',
      nextSafeAction: 'Revit bridge port is unreachable. Confirm Revit is open, the RevitAuto add-in is loaded, and runtime/bridge.json matches the running session.'
    };
  }
  if (code === 'bridge_connection_closed') {
    return {
      stallReason: 'bridge_connection_closed',
      nextSafeAction: isWrite && planId
        ? `Revit closed the bridge socket before returning a result. Query revit.plan.get for planId "${planId}"; never duplicate a possibly committed write.`
        : 'Revit closed the bridge socket before returning a result. Verify bridge health before retrying.'
    };
  }
  return {
    stallReason: code || 'bridge_timeout',
    nextSafeAction: isWrite && planId
      ? `Query revit.plan.get for planId "${planId}" to verify outcome; never blindly recreate or retry a write.`
      : 'Verify Revit bridge health and document state before retrying.'
  };
}
