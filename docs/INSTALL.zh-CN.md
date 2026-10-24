# 安装与双宿主权限

[完整安装命令与权限名](INSTALL.md) · [首页](../README.zh-CN.md)

默认 `--host codex`，可选 `claude`、`both`、`auto`。使用 Node.js 22.13+。安装器按版本复制文件，固定 Node 与绝对路径；不修改用户的 Claude settings 或 Codex config，不自动关闭旧插件或启用 hooks。

```sh
node scripts/build-release.mjs
node scripts/install.mjs --host both --skip-cli
```

按结果中的目录，在对应宿主手动启用来源和插件；Claude CLI 也可 `claude --plugin-dir "<返回的 Claude 插件目录>"`。自动 CLI 注册位于隔离登记目录，不等于当前桌面宿主已启用。Codex hooks 需要本人在宿主审核四条命令的 trust 状态。重启后以实际 context 返回的 host/version/build 验收，其中版本应为 `1.0.0-beta.18`。更新仓库不会热替换已经加载的插件；已有求职资料和旧版本目录会保留。GitHub 已发布下载包可能落后于当前源码。

Claude 插件工具权限名：`mcp__plugin_coming-jobs_jobos_next__jobos1_<tool>`；直接 MCP 配置使用 `mcp__jobos_next__jobos1_<tool>`。以 `/mcp` 显示为准，只批准需要的权限，不用全局放行取代批次审批。

Claude 验证码本人输入，文件按批次/公司集中拖入；只读 JavaScript 不承担填写和文件注入。扫码、图形验证、密码、注册、承诺书和法律声明都由本人完成。先在真实门户运行一批 `prefill_only`，核对解析覆盖、保存和协议，再用一份确实要投的申请验证结果与简历 SHA。

迁移只读命令、双宿主临时安装冒烟、来源冲突恢复和回滚边界见[完整文档](INSTALL.md)。
