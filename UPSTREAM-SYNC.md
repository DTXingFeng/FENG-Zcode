# 上游跟进策略（独立于官方 ZCode）

本仓库独立演进，不与官方 [zai-org/ZCode](https://github.com/zai-org/ZCode) 共享历史节奏；
官方仓库仅作为上游来源，漏洞修复与功能更新按需 cherry-pick 吸收。

## Remote 布局

| remote     | 指向                                   | 用途                                                |
| ---------- | -------------------------------------- | --------------------------------------------------- |
| `upstream` | `https://github.com/zai-org/ZCode.git` | 只读拉取（push URL 已置为 `DISABLE`，误推直接失败） |
| `origin`   | 自有仓库（创建后自行添加）             | 日常推送                                            |

创建自有远端后：

```bash
git remote add origin <你的仓库地址>
git push -u origin main
```

添加 `origin` 后，`pnpm` 新会话的基线新鲜度检查（`scripts/check-workspace-freshness.mjs`）
会自动改以 `origin/main` 为基准；没有 `origin` 时回退 `upstream/main`。

## 同步点

轻量标签 `upstream-sync/<shortsha>` 表示「已审视到该提交」：

- cherry-pick 不会让上游 sha 成为本地祖先，因此同步点只按标签创建时间取最新，
  不校验可达性；跳过某个上游提交是有意决策。
- 基线标签：`upstream-sync/872ad96`（官方 open source 快照，main 与 upstream/main 重合点）。

## 日常流程

```bash
pnpm upstream:check          # fetch 上游，列出同步点以来的新提交（按安全/修复/功能分组）
git cherry-pick <sha>        # 按需挑选；冲突正常解决后 git cherry-pick --continue
pnpm typecheck && pnpm lint  # 每轮吸收后验证
pnpm upstream:mark-synced    # 审视完成（含跳过项）后移动同步点标签
```

## 约束

- 不 `git merge upstream/main`，除非明确决定收敛历史；选择性吸收是默认模式。
- 不向 `upstream` 推送（push URL 已禁用，恢复需 `git remote set-url --push upstream <url>`）。
- 上游大版本重构（目录搬迁、协议改版）优先评估重做而非 cherry-pick，冲突成本过高时放弃该提交并在本地记录替代方案。
