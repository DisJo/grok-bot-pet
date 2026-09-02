export type AppLocale = "zh" | "en";

type ColorKey = "black" | "gray" | "brown" | "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "violet" | "magenta";
type StatusRoleKey = "completed" | "error" | "stopped" | "waiting";
type TaskStatusKey = "idle" | "receiving" | "processing" | "waiting-input" | "completed" | "error" | "stopped" | "offline";
type ShapeKey = "blob" | "pebble" | "bean" | "egg" | "squircle" | "tablet" | "capsule" | "cylinder" | "hex" | "gem" | "crystal" | "wedge" | "shield" | "dome" | "arch" | "cloud" | "teardrop" | "leaf";

export interface LocalizedDataCopy {
  codexTask: string;
  unnamedTask: string;
  codexMissing: string;
  requestTimedOut(method: string): string;
  requestFailed: string;
  disconnected: string;
}

interface LocalizedCopy {
  data: LocalizedDataCopy;
  tray: {
    working(count: number, inferred: boolean): string;
    localIdle: string;
    connectedIdle: string;
    disconnected: string;
    current(title: string): string;
    error(message: string): string;
    closeSettings: string;
    openSettings: string;
    hidePet: string;
    showPet: string;
    refresh: string;
    openCodex: string;
    alwaysOnTop: string;
    shadows: string;
    pointerFollowing: string;
    launchAtLogin: string;
    version(version: string): string;
    quit: string;
  };
  settings: {
    working(count: number, inferred: boolean): string;
    localIdle: string;
    connectedIdle: string;
    disconnected: string;
    closeSettings: string;
    hidePet: string;
    showPet: string;
    refresh: string;
    openCodex: string;
    inProgress: string;
    recentTasks: string;
    taskCount(count: number): string;
    noTasks: string;
    activeOnly: string;
    missingCwd: string;
    noActiveTasks: string;
    noRecentTasks: string;
    appearance: string;
    characterSize: string;
    opacity: string;
    bodyColor: string;
    eyeColor: string;
    statusColors: string;
    autoShape: string;
    behavior: string;
    alwaysOnTop: string;
    pointerFollowing: string;
    clickInteractions: string;
    showBadge: string;
    shadows: string;
    application: string;
    launchAtLogin: string;
    restoreDefaults: string;
    version(version: string): string;
    quit: string;
    colors: Record<ColorKey, string>;
    eyeColors: Record<string, string>;
    statusRoles: Record<StatusRoleKey, string>;
    statusColorLabel(role: string, color: string): string;
    shapes: Record<ShapeKey, string>;
    taskStatuses: Record<TaskStatusKey, string>;
  };
}

export function resolveAppLocale(systemLocale?: string | null): AppLocale {
  return systemLocale?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function localizedCopy(locale: AppLocale): LocalizedCopy {
  return locale === "zh" ? zh : en;
}

const zh: LocalizedCopy = {
  data: {
    codexTask: "Codex 任务",
    unnamedTask: "未命名任务",
    codexMissing: "未找到 Codex CLI；请安装 Codex 或 ChatGPT 桌面端",
    requestTimedOut: (method) => `${method} 请求超时`,
    requestFailed: "Codex 请求失败",
    disconnected: "Codex 已断开连接"
  },
  tray: {
    working: (count, inferred) => `Codex 正在工作 · ${count} 个活动任务${inferred ? " · 推断" : ""}`,
    localIdle: "Codex 本地推断 · 当前空闲",
    connectedIdle: "Codex 已连接 · 当前空闲",
    disconnected: "Codex 未连接",
    current: (title) => `当前：${title}`,
    error: (message) => `错误：${message}`,
    closeSettings: "关闭设置面板",
    openSettings: "打开设置面板…",
    hidePet: "隐藏桌面宠物",
    showPet: "显示桌面宠物",
    refresh: "刷新任务状态",
    openCodex: "打开 Codex",
    alwaysOnTop: "始终置顶",
    shadows: "显示投影与阴影",
    pointerFollowing: "待机眼睛跟随鼠标",
    launchAtLogin: "登录时启动",
    version: (version) => `版本 ${version}`,
    quit: "退出 Grok Bot Pet"
  },
  settings: {
    working: (count, inferred) => `正在工作 · ${count} 个任务${inferred ? " · 推断" : ""}`,
    localIdle: "Codex 本地推断 · 当前空闲",
    connectedIdle: "Codex 已连接 · 当前空闲",
    disconnected: "Codex 未连接",
    closeSettings: "关闭设置",
    hidePet: "隐藏宠物",
    showPet: "显示宠物",
    refresh: "刷新状态",
    openCodex: "打开 Codex",
    inProgress: "正在进行",
    recentTasks: "最近任务",
    taskCount: (count) => `${count} 个任务`,
    noTasks: "暂无任务",
    activeOnly: "仅活动",
    missingCwd: "未提供工作目录",
    noActiveTasks: "当前没有活动任务",
    noRecentTasks: "Codex 暂无最近任务",
    appearance: "外观",
    characterSize: "角色尺寸",
    opacity: "透明度",
    bodyColor: "身体颜色",
    eyeColor: "眼睛颜色",
    statusColors: "任务状态变色",
    autoShape: "跟随任务自动变形",
    behavior: "行为",
    alwaysOnTop: "始终置顶",
    pointerFollowing: "待机眼睛跟随鼠标",
    clickInteractions: "点击互动特技",
    showBadge: "显示活动任务角标",
    shadows: "显示投影与阴影",
    application: "应用",
    launchAtLogin: "登录时启动",
    restoreDefaults: "恢复角色默认",
    version: (version) => `版本 ${version}`,
    quit: "退出 App",
    colors: { black: "黑色", gray: "灰色", brown: "棕色", red: "红色", orange: "橙色", yellow: "黄色", green: "绿色", cyan: "青色", blue: "蓝色", violet: "紫色", magenta: "洋红" },
    eyeColors: { "#ffffff": "纯白", "#f3efe6": "暖白", "#9fc9ff": "浅蓝", "#8ff0b0": "薄荷绿", "#ffd66b": "金色", "#ff9fca": "粉色", "#ff6b78": "警示红" },
    statusRoles: { completed: "完成", error: "失败", stopped: "中断", waiting: "等待" },
    statusColorLabel: (role, color) => `${role}：${color}`,
    shapes: { blob: "球体", pebble: "卵石", bean: "豆形", egg: "蛋形", squircle: "圆方", tablet: "面板", capsule: "胶囊", cylinder: "圆柱", hex: "六边", gem: "宝石", crystal: "水晶", wedge: "楔形", shield: "盾牌", dome: "穹顶", arch: "拱门", cloud: "云朵", teardrop: "水滴", leaf: "叶片" },
    taskStatuses: { idle: "空闲", receiving: "接收", processing: "处理中", "waiting-input": "等待输入", completed: "完成", error: "出错", stopped: "停止", offline: "离线" }
  }
};

const en: LocalizedCopy = {
  data: {
    codexTask: "Codex Task",
    unnamedTask: "Untitled task",
    codexMissing: "Codex CLI not found. Install Codex or the ChatGPT desktop app.",
    requestTimedOut: (method) => `${method} timed out`,
    requestFailed: "Codex request failed",
    disconnected: "Codex disconnected"
  },
  tray: {
    working: (count, inferred) => `Codex working · ${count} active ${count === 1 ? "task" : "tasks"}${inferred ? " · Inferred" : ""}`,
    localIdle: "Codex local inference · Idle",
    connectedIdle: "Codex connected · Idle",
    disconnected: "Codex disconnected",
    current: (title) => `Current: ${title}`,
    error: (message) => `Error: ${message}`,
    closeSettings: "Close settings panel",
    openSettings: "Open settings panel…",
    hidePet: "Hide desktop pet",
    showPet: "Show desktop pet",
    refresh: "Refresh task status",
    openCodex: "Open Codex",
    alwaysOnTop: "Always on top",
    shadows: "Show ground and drop shadows",
    pointerFollowing: "Eyes follow pointer while idle",
    launchAtLogin: "Launch at login",
    version: (version) => `Version ${version}`,
    quit: "Quit Grok Bot Pet"
  },
  settings: {
    working: (count, inferred) => `Working · ${count} ${count === 1 ? "task" : "tasks"}${inferred ? " · Inferred" : ""}`,
    localIdle: "Codex local inference · Idle",
    connectedIdle: "Codex connected · Idle",
    disconnected: "Codex disconnected",
    closeSettings: "Close settings",
    hidePet: "Hide pet",
    showPet: "Show pet",
    refresh: "Refresh status",
    openCodex: "Open Codex",
    inProgress: "In progress",
    recentTasks: "Recent tasks",
    taskCount: (count) => `${count} ${count === 1 ? "task" : "tasks"}`,
    noTasks: "No tasks",
    activeOnly: "Active only",
    missingCwd: "Working directory unavailable",
    noActiveTasks: "No active tasks",
    noRecentTasks: "No recent Codex tasks",
    appearance: "Appearance",
    characterSize: "Character size",
    opacity: "Opacity",
    bodyColor: "Body color",
    eyeColor: "Eye color",
    statusColors: "Change color by task status",
    autoShape: "Automatically reshape for task",
    behavior: "Behavior",
    alwaysOnTop: "Always on top",
    pointerFollowing: "Eyes follow pointer while idle",
    clickInteractions: "Click interaction effects",
    showBadge: "Show active task badge",
    shadows: "Show ground and drop shadows",
    application: "Application",
    launchAtLogin: "Launch at login",
    restoreDefaults: "Restore character defaults",
    version: (version) => `Version ${version}`,
    quit: "Quit App",
    colors: { black: "Black", gray: "Gray", brown: "Brown", red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", cyan: "Cyan", blue: "Blue", violet: "Violet", magenta: "Magenta" },
    eyeColors: { "#ffffff": "Pure white", "#f3efe6": "Warm white", "#9fc9ff": "Light blue", "#8ff0b0": "Mint green", "#ffd66b": "Gold", "#ff9fca": "Pink", "#ff6b78": "Alert red" },
    statusRoles: { completed: "Completed", error: "Failed", stopped: "Stopped", waiting: "Waiting" },
    statusColorLabel: (role, color) => `${role}: ${color}`,
    shapes: { blob: "Blob", pebble: "Pebble", bean: "Bean", egg: "Egg", squircle: "Squircle", tablet: "Tablet", capsule: "Capsule", cylinder: "Cylinder", hex: "Hexagon", gem: "Gem", crystal: "Crystal", wedge: "Wedge", shield: "Shield", dome: "Dome", arch: "Arch", cloud: "Cloud", teardrop: "Teardrop", leaf: "Leaf" },
    taskStatuses: { idle: "Idle", receiving: "Receiving", processing: "Working", "waiting-input": "Waiting for input", completed: "Completed", error: "Error", stopped: "Stopped", offline: "Offline" }
  }
};
