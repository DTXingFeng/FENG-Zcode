# Spec: 桌面端移除自动更新链路

## 背景与动机

本仓库（FENG-Zcode）独立于官方 ZCode 演进（见 `UPSTREAM-SYNC.md`）。官方的
electron-updater feed 只分发官方构建：若保留桌面端自动更新，应用会把本地
fork 替换为官方版本，直接破坏独立性；远端强制升级 gate（force-update）同样
只在"升级到官方包"语义下成立。因此整体移除桌面端更新检测/下载/安装链路，
升级改为手动：跟随 `pnpm upstream:check` 流程，重新构建分发。

## 移除范围（行为边界）

- **删除**：`autoUpdater.ts`、`manifestUpdateProvider.ts`、`forceUpdateGuard.ts`、
  `forceUpdatePrompt.ts`；启动期轮询检查、菜单/托盘"检查更新"入口、手动检查
  IPC、更新下载/取消/跳过/安装 IPC、独立更新状态窗口（windowKind
  `update-status`）、更新日志（release notes）推送与确认、设置页
  `receivePreviewUpdates` / `autoDownloadAndInstallUpdates` 开关、
  `skippedElectronUpdateVersions` / `pendingPostUpdateReleaseNotes` 设置字段、
  shared 中的 update channels 与 `update.ts` / `forceUpdate.ts` 类型、
  UI 更新弹窗/按钮/菜单状态、i18n `update.*` / 菜单更新文案、
  `electron-updater` 依赖。
- **保留**：插件商店的"检查更新"（插件域，与桌面应用更新无关）、CLI 自更新
  命令（`zcode update`，CLI 分发域）、`windowsInstallResourceLocks.ts` 中
  启动完整性诊断仍使用的资源快照能力。

## 状态所有权

更新状态唯一所有者是 main 进程 updater（被删除）；删除后不存在任何更新
状态。设置页不再展示更新偏好；`AppSettings` 中相关字段全部移除（schema
同步收窄），旧 setting.json 中残留字段由 zod schema strip，无需迁移。

## 失败语义

不存在的更新通道 = 不存在的功能：不发起更新请求、无 toast、无菜单项。
`DesktopCommandIds.CheckForUpdates` 枚举成员删除（编译期防漏）。

## 验收场景

1. 桌面 dev 启动：无 `[auto-update]` 日志、无更新菜单项、设置页无更新开关。
2. 全仓 `grep -r "autoUpdater|electron-updater|UpdateStatus"` 仅剩无关命中
   （插件域、CLI 域）。
3. `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 通过。
4. 打包产物不再包含 electron-updater。
