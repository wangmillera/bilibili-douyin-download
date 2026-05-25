export type DesktopSettings = {
  downloadDirectory: string;
  preferredBrowser: "chrome" | "edge" | "safari";
  developerMode: boolean;
  recentTasksLimit: number;
};

export type DesktopRuntimeStatus = {
  isDesktop: boolean;
  backendOrigin: string;
  backendHealthy: boolean;
  platform: string;
};

export type TaskFileKind = "video" | "subtitle-srt" | "subtitle-txt" | "task-dir";

declare global {
  interface Window {
    desktopBridge?: {
      getSettings: () => Promise<DesktopSettings>;
      updateSettings: (changes: Partial<DesktopSettings>) => Promise<DesktopSettings>;
      chooseDownloadDirectory: () => Promise<DesktopSettings>;
      openDownloadDirectory: () => Promise<string>;
      openTaskFile: (payload: { taskId: string; kind: TaskFileKind }) => Promise<string>;
      getRuntimeStatus: () => Promise<DesktopRuntimeStatus>;
      listRecentTasks: (limit?: number) => Promise<unknown[]>;
    };
  }
}

export {};
