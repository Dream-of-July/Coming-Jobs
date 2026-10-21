<p align="center"><img src="docs/assets/hero.svg" alt="Coming Jobs — 少些繁琐，向下一程出发。仅为 Codex Desktop 优化。" width="100%"></p>

<p align="center">
  <b>简体中文</b> · <a href="README.md">English</a><br>
  <a href="https://github.com/Dream-of-July/Coming-Jobs/releases/tag/v1.0.0-beta.10">下载测试版</a> ·
  <a href="docs/INSTALL.zh-CN.md">安装指南</a> ·
  <a href="docs/TESTING.zh-CN.md">测试范围</a> ·
  <a href="https://github.com/Dream-of-July/Coming-Jobs/issues/new/choose">反馈问题</a>
</p>

<p align="center">
  <img alt="测试版本 beta.10" src="https://img.shields.io/badge/release-beta.10-daf578?style=flat-square&amp;labelColor=19251c&amp;color=daf578">
  <img alt="仅为 Codex Desktop 优化" src="https://img.shields.io/badge/optimized_for-Codex_Desktop-19251c?style=flat-square">
  <a href="LICENSE"><img alt="MIT 许可" src="https://img.shields.io/badge/license-MIT-19251c?style=flat-square"></a>
</p>

**Coming Jobs 是一个优先使用本地存储的求职助手，帮你把真实经历转化为值得考虑的岗位、内容完整的简历，以及可以放心检查的投递。**

> **测试版本 · 目前仅为 Codex Desktop 优化。** 参考测试环境为 macOS；本测试版不承诺支持其他 Agent 宿主、操作系统或无人值守提交。这是独立项目，并非 OpenAI 官方产品。


> **beta.10** 新增 [Luna 轻量分工与材料索引](docs/LIGHTWEIGHT.md)。

## 少些重复操作，把注意力留给合适的机会

公司官网、简历版本、网申表单和后续通知，把一次求职拆成了许多片段。Coming Jobs 保存这些步骤之间已经确认的上下文，让下一次投递从已有进展继续。

| 更连贯的求职流程 | 可以帮你做什么 |
| :--- | :--- |
| **了解你的经历** | 复用已确认事实，只追问真正缺失的信息；公司专属答案只对该公司生效。 |
| **选好下一步** | 根据投递记录与资格安排每日公司待办，按预算增量刷新，避免每天重新读取所有岗位。 |
| **保留完整故事** | 明确已审核简历基线，适配岗位前核对已登记的经历、成果、获奖与作品集链接。 |
| **填写不中断** | 按小批次执行已授权字段，逐项回读；异常后先恢复，不盲目覆盖用户新修改。 |
| **谨慎复用经验** | 操作策略先成为候选，经过合成验证与当前页面只读匹配后才可复用。 |
| **接上后续进展** | 跟进已登记申请；实际提交版本已知时，围绕该份材料准备面试。 |

**材料由你审核，最终投递由你提交。** 初始化时可一次授权只读招聘验证码邮件和短信；登录优先邮箱，获准后自动读取并填写本次验证码，短信其次，读取不到才交接。必要协议和图形验证按宿主当次规则处理。浏览器、邮箱、短信和调度能力来自已授权的 Codex Desktop 宿主。

## 从一句话开始

**通过 Agent 下载**

在 Codex Desktop 新建任务，复制下面这句话即可，无需先安装 Coming Jobs：

```text
请从 https://github.com/Dream-of-July/Coming-Jobs/releases/tag/v1.0.0-beta.10 下载 Coming Jobs 测试版的 ZIP 和 SHA256SUMS，校验 SHA-256 后解压到本地，并告诉我解压位置和 Codex Desktop 的安装步骤。
```

**手动下载：** [ZIP](https://github.com/Dream-of-July/Coming-Jobs/releases/download/v1.0.0-beta.10/Coming-Jobs-v1.0.0-beta.10.zip) · [SHA256SUMS](https://github.com/Dream-of-July/Coming-Jobs/releases/download/v1.0.0-beta.10/SHA256SUMS)。下载两个文件，核对校验和后解压 ZIP。

下载并解压后：

1. 安装 **Node.js 22.13 或更新版本**与 Codex Desktop。在 macOS 打开 `Install.command`，或在解压目录运行：

   ```sh
   node scripts/install.mjs
   ```

2. 重启 Codex Desktop，新建一个任务，说：

   > 开始 Coming Jobs。先复用我已经确认的资料，帮我选好下一次投递。

之后可以直接说 **“今天投哪？”** 或 **“继续上次投递”**。每日自动运行需要成功绑定宿主调度；安装插件不等于定时任务已经生效。

[安装、升级与排错 →](docs/INSTALL.zh-CN.md)

## 看得清每一步

```mermaid
flowchart LR
    A[已确认经历] --> B[官方岗位]
    B --> C[完整简历]
    C --> D[已授权字段批次]
    D --> E[用户审核与提交]
    E --> F[跟进与面试准备]
    D -. 已验证的操作候选 .-> D
```

个人事实、材料、草稿回读和经验记录保存在私有本地工作区。**本地优先不等于离线运行**：Codex 与已授权宿主工具可能处理你选择使用的数据。本仓库不包含候选人数据库、简历、聊天导出或凭证。

[隐私与操作边界 →](SECURITY.md) · [内部结构 →](docs/ARCHITECTURE.md)

## 适合认真试用的测试版

本版本包含 **212 项自动化回归测试**。此前运行时也在真实 Codex Desktop 中完成了八个普通字段的合成批处理验收，包含写前持久化和逐字段回执。学校、日期、附件解析等复杂控件仍需逐门户核验；合成测试通过不代表所有招聘网站均已支持。

[查看验证范围和已知限制 →](docs/TESTING.zh-CN.md)

- **可开始试用：** 已确认上下文、岗位清单、简历完整性、普通字段批次、中断恢复和申请记录。
- **实验性能力：** 动态学校与日期控件、门户解析、操作经验复用以及宿主定时执行。
- **由人完成：** 身份验证、必要声明、最终提交和测评。

仓库文档支持 **简体中文与 English**。可要求 Agent 使用任一语言对话；测试版内置校验和工作台仍有部分中文文案。

## 一起走向下一程

最有帮助的反馈，是不含个人资料的可复现合成示例。请提供流程、预期行为和宿主版本，不要在 Issue 中上传真实简历或完整投递聊天。

[参与贡献](CONTRIBUTING.md) · [版本记录](CHANGELOG.md) · [后续方向](docs/ROADMAP.md)

<details>
<summary>从 JobOS 升级</summary>

产品与插件现已更名为 Coming Jobs。为保护既有数据，保留 `jobos1_` 工具前缀、`jobos/1` 存储协议、`JOBOS_NEXT_HOME` 环境变量和 `~/.jobos-next` 工作区。安装器停用旧插件入口并保留配置备份，不删除已有简历或投递历史。

</details>

---

<p align="center">由 <a href="https://github.com/Dream-of-July">Dream-of-July</a> 制作 · <a href="LICENSE">MIT</a><br><sub>少些繁琐，给下一程多留一点空间。</sub></p>
