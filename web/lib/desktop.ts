import type { DesktopRuntimeStatus, DesktopSettings, TaskFileKind } from "../types/desktop";

export const fallbackDesktopSettings: DesktopSettings = {
  downloadDirectory: "",
  preferredBrowser: "chrome",
  developerMode: false,
  recentTasksLimit: 8,
};

export const fallbackDesktopRuntime: DesktopRuntimeStatus = {
  isDesktop: false,
  backendOrigin: "",
  backendHealthy: false,
  platform: "web",
};

export function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window.desktopBridge);
}

export async function getDesktopSettings(): Promise<DesktopSettings> {
  if (!hasDesktopBridge()) {
    return fallbackDesktopSettings;
  }
  return window.desktopBridge!.getSettings();
}

export async function updateDesktopSettings(changes: Partial<DesktopSettings>): Promise<DesktopSettings> {
  if (!hasDesktopBridge()) {
    return fallbackDesktopSettings;
  }
  return window.desktopBridge!.updateSettings(changes);
}

export async function chooseDownloadDirectory(): Promise<DesktopSettings> {
  if (!hasDesktopBridge()) {
    return fallbackDesktopSettings;
  }
  return window.desktopBridge!.chooseDownloadDirectory();
}

export async function openDownloadDirectory(): Promise<void> {
  if (!hasDesktopBridge()) {
    return;
  }
  await window.desktopBridge!.openDownloadDirectory();
}

export async function openTaskFile(taskId: string, kind: TaskFileKind): Promise<void> {
  if (!hasDesktopBridge()) {
    return;
  }
  await window.desktopBridge!.openTaskFile({ taskId, kind });
}

export async function getDesktopRuntimeStatus(): Promise<DesktopRuntimeStatus> {
  if (!hasDesktopBridge()) {
    return fallbackDesktopRuntime;
  }
  return window.desktopBridge!.getRuntimeStatus();
}
