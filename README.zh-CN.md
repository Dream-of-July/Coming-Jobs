# Coming Jobs

[English](README.md) · [安装](docs/INSTALL.zh-CN.md) · [验证范围](docs/TESTING.zh-CN.md)

本地求职助手：复用已确认资料，按完整 JD 选岗，组装可核验的简历，把登录与人工操作集中处理，再按逐项审批单推进投递。

**1.0.0-beta.16 支持 Codex 和 Claude 宿主档案。** 此分支仍是测试版本，尚未发布 beta.16 下载包；[已发布版本](https://github.com/Dream-of-July/Coming-Jobs/releases)与源码版本可能不同。这是独立项目，并非 OpenAI 或 Anthropic 官方产品。

## 每批如何推进

1. 读取已批准目标清单、资料、当前门户与会话；无关的记账更新不再让所有岗位评估失效。
2. 集中处理必要的登录、权限、扫码、人机验证及人工上传。Claude 下验证码由本人输入；Codex 沿用已明确获准的邮箱优先只读流程。
3. 审批单逐项列出岗位、来源、精确字段与转换、组装文案、实际简历 SHA、协议摘要和哈希、人工声明、阻塞和警告。回复 **“批准 S-ABCDEF 全部”**，或列明所选编号。
4. 插件逐项重新检查。只有有效会话授权覆盖且五分钟内回读通过的项目可放行一次提交；先记为结果待核验，再点击一次、读取结果并记录实际简历 SHA。变化项暂停，其他项目继续。

已确认目标、未变化的材料与预填不逐项重复询问。正常批次的人工触点预算为两次：集中检查点与批次审批；新出现的协议、声明、验证码或内容变化可能增加必要的检查点。目标清单和模板基线的首次批准属于初始化。

`batch_submit` 默认 `on`；`prefill_only` 仅预填，`off` 恢复本人提交。扫码、图形或滑块验证、密码、注册、承诺书、法律声明和测评始终由本人处理。Claude 的 `javascript_tool` 仅回读；当前上传方案是按批次与公司整理后由本人拖入。

## 安装与恢复

需要 Node.js **22.13+**。默认安装 Codex；也可分别选择 Claude 或两者：

```sh
node scripts/build-release.mjs
node scripts/install.mjs --host both --skip-cli
```

安装器保持用户设置文件原样；按返回的具体目录在宿主启用插件和 hooks。未设置 `JOBOS_HOST` 时默认 `codex`。两种宿主共用已有 `~/.jobos-next` 数据契约，不自动迁移真实资料。使用 Claude CLI 可通过 `--plugin-dir` 加载生成的专用目录。

```sh
node --no-warnings scripts/migration-plan.mjs --workspace "$WORKSPACE_DB"
```

该命令只读生成清单；迁移需要另行审阅带码清单。不要把私人清单或备份提交到 Git。安装、重启、调度绑定与真实门户成功分别核验。

## 材料与隐私

同一 PDF 按字节 SHA 批准一次即可跨岗位复用；字节或引用证据变化后失效。模板身份字段固定，改写条目先合并批准，再由插件组装；模板、函数和图片固定哈希。Node 只提取与传输函数文本，模板函数只在离线 Chrome 页面沙箱执行。渲染检查文本顺序、溢出、图片和 2 MB 大小上限，并保存截图与回执。

本地优先不等于所有宿主操作都离线。授权宿主仍可能处理你选择使用的资料；源码、测试和门户样例只使用合成资料。[隐私边界](SECURITY.md) · [内部结构](docs/ARCHITECTURE.md)。

## 验证与限制

完整自动化测试覆盖双宿主批次流程、严格工具参数、导入授权作废、写入租约、恢复与 SHA 记录。另有真实 Chrome 离线渲染测试、双宿主安装冒烟，以及可选 Playwright 的三个合成门户流程。合成成功不证明任意真实招聘门户受支持；Claude Desktop 上传、本地视图与定时任务仍需用户在真实宿主核验。

[安装与权限](docs/INSTALL.zh-CN.md) · [测试方法](docs/TESTING.zh-CN.md) · [变更记录](CHANGELOG.md) · [MIT](LICENSE)
