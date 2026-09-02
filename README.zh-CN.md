<div align="center">
  <h1>Grok Bot Pet</h1>
  <p><strong>运行在 macOS 桌面的 Codex 动画宠物。</strong></p>
  <p>无需反复打开任务窗口，也能看见 Agent 正在思考、搜索、编辑、等待、完成或出错。</p>
  <p><a href="README.md">English</a> · <strong>简体中文</strong></p>
  <p>
    <code>macOS</code> <code>Electron</code> <code>Codex</code> <code>Codex CLI</code>
    <code>桌面宠物</code> <code>状态栏应用</code> <code>Grok Bot</code>
    <code>SVG 动画</code> <code>TypeScript</code>
  </p>
</div>

> [!NOTE]
> Grok Bot Pet 是非官方社区项目。角色概念、视觉语言和核心动画机制来源于并参考了 **Grok Bot**，与 OpenAI、xAI 不存在隶属、背书或赞助关系。

## 它能做什么

Grok Bot Pet 会把本机 Codex 活动转换成一个常驻 macOS 桌面的动态角色。桌面只显示宠物，任务、控制和自定义选项集中在系统状态栏中。

它可以观察 Codex 桌面端和 CLI 的活动，并对推理、搜索、命令、文件修改、审批、回复、完成、失败和中断作出动画反应。

## 主要特点

- 透明无边框、可拖动、始终置顶，并可跨桌面和全屏空间显示。
- 通过表情、形状、颜色、粒子、丝带和动作反馈任务状态。
- 在系统状态栏查看任务、刷新连接和自定义角色。
- 可调整尺寸、透明度、身体及眼睛颜色、形状、阴影、角标、动画和鼠标跟随。
- 只读观察，不会创建、中断、删除、审批任务，也不会代替用户回复。
- 数据保留在 Mac 本地，不会把任务内容上传到第三方服务。

## 系统要求

- macOS 13 或更高版本
- Apple Silicon 或 Intel Mac
- Codex macOS 桌面端、Codex CLI 或兼容的 Codex 安装

## 安装

1. 从 [GitHub Releases](../../releases) 页面下载最新 Universal `.dmg` 或 `.zip`。
2. 将 **Grok Bot Pet.app** 移入 `/Applications`。
3. 启动 App，并通过 macOS 系统状态栏图标使用。

正式发布的安装包已使用 Apple Developer ID 签名并通过 Apple 公证。首次启动时，macOS 仍可能显示标准的“从互联网下载”确认提示。

对外分享时请发送生成的 `.dmg` 或 `.zip`，不要直接发送裸 `.app`；部分聊天软件和网盘可能破坏未打包的 App Bundle。

## 使用方式

点击状态栏图标可以查看任务、刷新识别、打开 Codex 或自定义角色。点击宠物会随机互动，拖动可调整位置，待机时眼睛可以跟随鼠标指针。

App 会优先连接本机 Codex 服务，也会使用本地会话信息补充 CLI 任务识别。不同 Codex 版本能提供的状态细节可能有所不同。

## 从源码运行

从源码构建需要当前 Node.js LTS 版本和 Xcode Command Line Tools（未安装时运行 `xcode-select --install`）。命令行工具用于编译原生 macOS 窗口桥接模块。

```bash
npm ci
npm run dev
```

常用检查与构建命令：

```bash
npm run typecheck
npm test
npm run build
npm run build:mac
```

## 隐私与限制

- Grok Bot Pet 不会上传任务内容。
- 不需要屏幕录制或辅助功能权限。
- App 只观察任务，不会控制审批或代替用户输入。
- 目前仅支持 macOS。
- 暂未实现自动更新，需要手动安装新版本。

## 来源与知识产权

本项目的角色核心动画机制来源于 Grok Bot，并在研究其动画表现后，以 TypeScript 进行移植和重新实现。本仓库不主张拥有 Grok Bot 的角色设计、视觉识别、名称或相关商标权利。

**Grok**、**Grok Bot**、xAI 及其相关设计和标识的权利归各自权利人所有；**Codex**、OpenAI 及其相关标识同样归各自权利人所有。

[MIT License](LICENSE) 只适用于本项目的原创实现代码，**不授予**任何第三方商标、角色设计、视觉识别或受保护资产的权利。重新分发或修改本项目时请保留这份来源声明，并自行确认相关使用在所在司法辖区是否获得允许。

完整说明请参阅 [Third-Party Notices](THIRD_PARTY_NOTICES.md)。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请运行 `npm run typecheck`、`npm test` 和 `npm run build`。
