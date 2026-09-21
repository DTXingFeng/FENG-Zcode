#!/usr/bin/env node
// 上游跟进检查 —— 本仓库独立于官方 ZCode（zai-org/ZCode）演进，官方仓库只作为
// 上游来源：漏洞修复、功能更新按需 cherry-pick 吸收，不 merge、不整分支同步。
//
// 脚本 fetch 上游后，列出「上次同步点 → 上游最新」之间的新提交，按 conventional
// commit 类型 + 安全关键词分组，并给出可直接复制的 cherry-pick 命令。
//
// 同步点语义：轻量标签 upstream-sync/<shortsha> 表示「已审视到该提交」。cherry-pick
// 不会让上游 sha 成为本地祖先，所以同步点只按标签创建时间取最新，不做 reachable 校验；
// 跳过某个上游提交是有意决策，审视完成后用 --mark-synced 把指针推到上游最新即可。
//
// 用法：
//   node scripts/check-upstream-updates.mjs               # fetch 上游并列出新增量
//   node scripts/check-upstream-updates.mjs --no-fetch    # 复用本地已有 refs（离线）
//   node scripts/check-upstream-updates.mjs --json        # 机器可读输出
//   node scripts/check-upstream-updates.mjs --mark-synced # 审视完成后移动同步点
// 选项：--remote upstream --branch main

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);

function optionValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const remoteName = optionValue("--remote", "upstream");
const remoteBranch = optionValue("--branch", "main");
const doFetch = !args.includes("--no-fetch");
const asJson = args.includes("--json");
const markSynced = args.includes("--mark-synced");

const SYNC_TAG_PREFIX = "upstream-sync/";
const TAG = "[upstream-sync]";

// 安全相关关键词：主题命中即归入 security 组，无论 conventional 类型是什么。
const SECURITY_SUBJECT_PATTERN =
  /(security|cve-\d+|vuln|vulnerab|xss|csrf|ssrf|rce|inject|sanitiz|escap|traversal|privileg|越权|提权|漏洞)/i;
const CONVENTIONAL_PATTERN = /^(\w+)(\([^)]*\))?!?:\s*(.*)$/;

async function git(...gitArgs) {
  const { stdout } = await execFile("git", gitArgs, { encoding: "utf8" });
  return stdout.trim();
}

function classifyCommit(subject) {
  if (SECURITY_SUBJECT_PATTERN.test(subject)) return "security";
  const match = subject.match(CONVENTIONAL_PATTERN);
  const type = match?.[1]?.toLowerCase() ?? "";
  if (["fix", "bugfix", "hotfix"].includes(type)) return "fix";
  if (["feat", "feature"].includes(type)) return "feat";
  if (["perf"].includes(type)) return "perf";
  if (["refactor"].includes(type)) return "refactor";
  if (["test", "docs", "chore", "ci", "build", "style"].includes(type)) return "chore";
  return "other";
}

const GROUP_ORDER = ["security", "fix", "feat", "perf", "refactor", "other", "chore"];
const GROUP_TITLES = {
  security: "安全 / 漏洞（建议优先跟进）",
  fix: "缺陷修复",
  feat: "功能更新",
  perf: "性能优化",
  refactor: "重构",
  other: "其他",
  chore: "杂项（docs/ci/test，通常可跳过）",
};

async function latestSyncTag() {
  const output = await git(
    "for-each-ref",
    "--sort=-creatordate",
    "--count=1",
    "--format=%(refname:short)%09%(objectname:short)",
    `refs/tags/${SYNC_TAG_PREFIX}*`,
  );
  if (!output) return null;
  const [name, sha] = output.split("\t");
  return { name, sha };
}

async function main() {
  const remotes = (await git("remote"))
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  if (!remotes.includes(remoteName)) {
    console.error(`${TAG} 没有 remote 「${remoteName}」。现有：${remotes.join(", ") || "（无）"}`);
    console.error(
      `${TAG} 官方仓库应配置为：git remote add upstream https://github.com/zai-org/ZCode.git`,
    );
    process.exit(1);
  }

  const remoteRef = `${remoteName}/${remoteBranch}`;
  if (doFetch) {
    try {
      await git("fetch", remoteName, "--prune");
    } catch (error) {
      console.error(`${TAG} fetch ${remoteName} 失败：${error.message}`);
      console.error(`${TAG} 离线时可加 --no-fetch 复用本地 refs。`);
      process.exit(1);
    }
  }

  try {
    await git("rev-parse", "--verify", `${remoteRef}^{commit}`);
  } catch {
    console.error(`${TAG} 上游没有分支 ${remoteRef}（默认分支不是 main？用 --branch 指定）。`);
    process.exit(1);
  }

  const tipSha = await git("rev-parse", remoteRef);
  const tipShort = await git("rev-parse", "--short", tipSha);
  const syncTag = await latestSyncTag();

  let baseSha;
  let baseLabel;
  if (syncTag) {
    baseSha = syncTag.sha;
    baseLabel = syncTag.name;
  } else {
    baseSha = await git("merge-base", "HEAD", remoteRef);
    baseLabel = `${baseSha.slice(0, 8)}（merge-base，还没有同步点标签）`;
  }

  const logOutput = await git("log", "--format=%H%x09%s", `${baseSha}..${remoteRef}`);
  const commits = logOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\t");
      return { sha, short: sha.slice(0, 8), subject, group: classifyCommit(subject) };
    });

  if (markSynced) {
    const tagName = `${SYNC_TAG_PREFIX}${tipShort}`;
    const existing = await git("tag", "--list", tagName);
    if (existing) {
      console.error(`${TAG} 标签 ${tagName} 已存在，无需重复标记。`);
      process.exit(1);
    }
    await git("tag", tagName, tipSha);
    const skipped = commits.length;
    console.log(`${TAG} 已创建同步点 ${tagName}（本轮审视 ${skipped} 个上游提交，含跳过项）。`);
    return;
  }

  if (asJson) {
    const groups = Object.fromEntries(
      GROUP_ORDER.map((group) => [group, commits.filter((c) => c.group === group)]),
    );
    console.log(
      JSON.stringify(
        {
          base: baseSha,
          tip: tipSha,
          syncTag: syncTag?.name ?? null,
          count: commits.length,
          groups,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `${TAG} ${remoteName}（${remoteRef}）自 ${baseLabel} 以来新增 ${commits.length} 个提交，当前上游最新：${tipShort}`,
  );
  if (commits.length === 0) {
    console.log(`${TAG} 上游无新提交，无需跟进。`);
    return;
  }

  for (const group of GROUP_ORDER) {
    const items = commits.filter((c) => c.group === group);
    if (items.length === 0) continue;
    console.log("");
    console.log(`  ${GROUP_TITLES[group]}（${items.length}）：`);
    for (const item of items) {
      console.log(`    ${item.short}  ${item.subject}`);
    }
  }

  const securityPicks = commits.filter((c) => c.group === "security").map((c) => c.short);
  console.log("");
  console.log(`${TAG} 选择性跟进（保持独立历史，推荐）：`);
  if (securityPicks.length > 0) {
    console.log(`    git cherry-pick ${securityPicks.join(" ")}`);
  }
  console.log(
    `    git cherry-pick <sha>   # 按需逐个挑选，冲突时正常解决后 git cherry-pick --continue`,
  );
  console.log(`${TAG} 全量跟进（引入 merge 历史，仅明确要收敛历史时使用）：`);
  console.log(`    git merge ${remoteRef}`);
  console.log(`${TAG} 审视完成（含有意跳过）后移动同步点：`);
  console.log(`    pnpm upstream:mark-synced`);
}

main().catch((error) => {
  console.error(`${TAG} 执行失败：${error.message}`);
  process.exit(1);
});
