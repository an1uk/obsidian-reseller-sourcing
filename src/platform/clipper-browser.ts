import { hasControlCharacters } from '../domain/guards';
declare const require: ((id: string) => unknown) | undefined;

export const CHROME_CLIPPER_SETTINGS_URL = 'chrome-extension://cnjifjpddelmedmihgijeibhnjfabmlf/settings.html?section=templates';
export interface ChromeSettingsLaunch { executable: string; args: string[]; }

/** Resolve standard Windows Chrome installations without inspecting browser profiles. */
export function getChromeSettingsLaunch(
  platform: string,
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): ChromeSettingsLaunch | undefined {
  if (platform !== 'win32') return undefined;
  // Keep desktop Node modules lazy so loading the plugin on mobile remains safe.
  const load = typeof require === 'function' ? require : undefined;
  if (!load) return undefined;
  const path = (load('node:path') as typeof import('node:path')).win32;
  for (const variable of ['LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)']) {
    const root = Object.entries(env).find(([key]) => key.toUpperCase() === variable)?.[1];
    if (!root || !/^[a-z]:[\\/]/i.test(root) || hasControlCharacters(root, false) || /[<>"|?*]/.test(root) || root.slice(2).includes(':') || root.split(/[\\/]/).some(part => part === '.' || part === '..')) continue;
    const executable = path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (exists(executable)) return { executable, args: [CHROME_CLIPPER_SETTINGS_URL] };
  }
  return undefined;
}

/** Request Chrome to open Clipper settings. Success confirms process launch only. */
export async function openChromeClipperSettings(): Promise<boolean> {
  try {
    const load = typeof require === 'function' ? require : undefined;
    if (!load) return false;
    const runtime = load('node:process') as typeof import('node:process');
    if (runtime.platform !== 'win32') return false;
    const fs = load('node:fs') as typeof import('node:fs');
    const launch = getChromeSettingsLaunch(runtime.platform, runtime.env, fs.existsSync);
    if (!launch) return false;
    const { spawn } = load('node:child_process') as typeof import('node:child_process');
    return await new Promise<boolean>(resolve => {
      const child = spawn(launch.executable, launch.args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    });
  } catch { return false; }
}
