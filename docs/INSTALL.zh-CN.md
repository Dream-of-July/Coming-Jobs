# 安装 Coming Jobs

[English](INSTALL.md) · [返回首页](../README.zh-CN.md)

**目前仅为 Codex Desktop 优化。** 参考环境为 macOS。安装包包含开发脚本，不是已签名的原生 App 或 App Store 应用。

## 准备

- 安装 Codex Desktop 与 **Node.js 22.13+**。安装器使用执行它的 Node 路径。
- 保留现有候选人工作区，默认位于 `~/.jobos-next`；产品更名不迁移或重置这个目录。

## 下载

**通过 Agent 下载**

在 Codex Desktop 新建任务，复制下面这句话即可，无需先安装 Coming Jobs：

```text
请从 https://github.com/Dream-of-July/Coming-Jobs/releases/tag/v1.0.0-beta.10 下载 Coming Jobs 测试版的 ZIP 和 SHA256SUMS，校验 SHA-256 后解压到本地，并告诉我解压位置和 Codex Desktop 的安装步骤。
```

**手动下载**

从同一个[测试版本](https://github.com/Dream-of-July/Coming-Jobs/releases/tag/v1.0.0-beta.10)下载 ZIP 和 `SHA256SUMS`。运行 `shasum -a 256 Coming-Jobs-v1.0.0-beta.10.zip`，将结果与 `SHA256SUMS` 比较。

## 安装

解压后打开 `Install.command`，或在解压目录运行：

```sh
node scripts/install.mjs
```

安装器校验包内文件摘要，复制到带版本号的本地目录，生成当前宿主的 Node、MCP 与 hook 路径，并优先使用 Codex 官方插件 CLI。它不会安装 Node、下载依赖或重置求职资料。需要修改的配置会先备份，已知旧 JobOS 插件入口会停用。

结果为 `cli_install_completed` 时，重启 Codex Desktop 并新建任务。若为 `personal_marketplace_ready`，先在应用的本地/个人插件列表中启用 Coming Jobs，再重启。按实际需要审核宿主能力。

对新任务说：

> 开始 Coming Jobs。读取当前资料，从最后确认的步骤继续。

首次 `jobos1_context` 应返回 **1.0.0-beta.10**。已运行的任务可能仍持有旧进程；复制新文件不等于热更新。

## 从 JobOS 升级

新插件 ID 为 `coming-jobs`，来源名为 `coming-jobs`。数据继续保存在 `~/.jobos-next`，`jobos1_` 接口与 `jobos_next` 服务器标识保留兼容。安装器停用已知旧插件入口，不删除旧源码或资料。

切换版本前保存或交接进行中的投递。重开页面后先读取，不直接覆盖；本地 checkpoint 不代表招聘门户已保存。

## 无法启动时

| 现象 | 处理 |
| --- | --- |
| Node 缺失或版本过低 | 安装受支持版本，再运行安装器。 |
| 插件来源冲突 | 核对具体来源，不覆盖其他同名来源。 |
| 同版本出现不同构建 | 使用匹配的原始安装包，或新的版本号。 |
| 对话仍显示旧版工具 | 重启 Codex Desktop，并新建任务。 |
| 浏览器或调度不可用 | 核对宿主能力和绑定，不把未运行写成成功。 |

仅检查文件完整性：`node scripts/install.mjs --verify-only`。隔离安装演练：`node scripts/install.mjs --home /tmp/coming-jobs-install-test --skip-cli`；后者不代表已启用当前插件。

## 停用与恢复

通过 Codex 插件界面停用或移除 Coming Jobs。求职资料与安装代码分开存放，卸载代码不需要删除 `~/.jobos-next`。安装配置备份位于 `~/.local/share/coming-jobs/install-backups`。

下载或解压不会自动更新已有 Desktop 安装。运行安装器后，完全退出并重新打开 Codex Desktop。
