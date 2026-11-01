import { execFile, spawn, exec } from 'child_process';
import path from 'path';

/**
 * Runs a raw CMD command string.
 * @param {string} command - The CMD command string to execute.
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
export function runCmdCommand(command) {
  return new Promise((resolve) => {
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : ''),
        code: error ? error.code || 1 : 0
      });
    });
  });
}

export async function runStartCmdCommand(workspaceDir, joinedCmds) {
  const args = `/k "${joinedCmds}"`;
  const script = `$proc = Start-Process cmd.exe -WindowStyle Normal -WorkingDirectory '${workspaceDir.replace(/'/g, "''")}' -ArgumentList '${args.replace(/'/g, "''")}' -PassThru; if ($proc) { Write-Output $proc.Id }`;
  const res = await runCommand(script);
  return { code: res.code, pid: parseInt(res.stdout.trim()) || null };
}

/**
 * Launches a new PowerShell window executing the specified commands.
 * @param {string} workspaceDir - Working directory to cd into.
 * @param {string} joinedCmds - The commands joined by '; '.
 * @returns {Promise<{code: number, pid: number}>}
 */
export async function runStartPowerShellCommand(workspaceDir, joinedCmds) {
  const script = `$proc = Start-Process powershell.exe -WindowStyle Normal -WorkingDirectory '${workspaceDir.replace(/'/g, "''")}' -ArgumentList "-NoExit", "-Command", "${joinedCmds.replace(/"/g, '`"')}" -PassThru; if ($proc) { Write-Output $proc.Id }`;
  const res = await runCommand(script);
  return { code: res.code, pid: parseInt(res.stdout.trim()) || null };
}


/**
 * Runs a raw PowerShell command string.
 * @param {string} command - The PowerShell command string to execute.
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
export function runCommand(command) {
  return new Promise((resolve, reject) => {
    // PowerShell command execution. We wrap command in try/catch to ensure we capture script errors properly.
    const psArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `$ErrorActionPreference = 'Stop'; try { ${command} } catch { Write-Error $_.Exception.Message; exit 1 }`
    ];

    execFile('powershell.exe', psArgs, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : ''),
        code: error ? error.code || 1 : 0
      });
    });
  });
}

/**
 * Runs a PowerShell script file.
 * @param {string} scriptPath - Absolute path to the .ps1 script.
 * @param {string[]} args - Arguments to pass to the script.
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
export function runScriptFile(scriptPath, args = []) {
  return new Promise((resolve) => {
    const psArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      ...args
    ];

    execFile('powershell.exe', psArgs, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : ''),
        code: error ? error.code || 1 : 0
      });
    });
  });
}

/**
 * Spawns a live PowerShell session for streaming output.
 * @param {string} command - PowerShell command.
 * @param {object} callbacks - Event callbacks.
 * @param {function} callbacks.onStdout - Callback for stdout.
 * @param {function} callbacks.onStderr - Callback for stderr.
 * @param {function} callbacks.onClose - Callback for process exit.
 * @returns {ChildProcess}
 */
export function spawnCommand(command, { onStdout, onStderr, onClose }) {
  const psArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    command
  ];

  const psProcess = spawn('powershell.exe', psArgs, { windowsHide: true });

  if (onStdout) {
    psProcess.stdout.on('data', (data) => onStdout(data.toString()));
  }
  if (onStderr) {
    psProcess.stderr.on('data', (data) => onStderr(data.toString()));
  }
  if (onClose) {
    psProcess.on('close', (code) => onClose(code));
  }

  return psProcess;
}
