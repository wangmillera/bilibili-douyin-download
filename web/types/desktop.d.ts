export type DesktopSettings = {
  downloadDirectory: string;
  preferredBrowser: "chrome" | "edge" | "safari";
  preferredBrowserProfile: string;
  developerMode: boolean;
  recentTasksLimit: number;
};

export type DesktopRuntimeStatus = {
  isDesktop: boolean;
  backendOrigin: string;
  backendHealthy: boolean;
  backendLaunchError: string | null;
  backendProcessExited: boolean;
  backendPort: number;
  logDir: string;
  missingResources: string[];
  platform: string;
};

export type TaskFileKind = "video" | "subtitle-srt" | "subtitle-txt" | "task-dir";

export type DesktopDiagnostics = {
  chrome_detected: boolean;
  candidate_profiles: string[];
  selected_profile: string;
  douyin_cookie_count: number;
  cookie_read_method: string | null;
  cookie_read_error: string | null;
  douyin_helper_repo_exists: boolean;
  douyin_helper_python_exists: boolean;
  ffmpeg_exists: boolean;
  ffprobe_exists: boolean;
};

declare global {
  interface Window {
    desktopBridge?: {
      getSettings: () => Promise<DesktopSettings>;
      updateSettings: (changes: Partial<DesktopSettings>) => Promise<DesktopSettings>;
      chooseDownloadDirectory: () => Promise<DesktopSettings>;
      openDownloadDirectory: () => Promise<string>;
      openLogsDirectory: () => Promise<string>;
      openTaskFile: (payload: { taskId: string; kind: TaskFileKind }) => Promise<string>;
      getRuntimeStatus: () => Promise<DesktopRuntimeStatus>;
      listRecentTasks: (limit?: number) => Promise<unknown[]>;
      getDiagnostics: () => Promise<DesktopDiagnostics | null>;
      restartBackend: () => Promise<boolean>;
      exportLogs: () => Promise<{ content: string; filename: string }>;
    };
  }
}

export {};
