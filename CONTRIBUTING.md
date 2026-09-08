# Contributing / 参与贡献

Thanks for helping make job searching a little less repetitive. Small, evidence-backed changes are welcome. / 欢迎用可复现、有依据的小改动，让求职少一点重复劳动。

1. Open an issue describing the problem and expected behavior. / 先说明问题与预期。
2. Use synthetic fixtures, temporary workspaces and example domains. / 使用合成资料、临时目录与示例域名。
3. Keep API and data compatibility, authorization and user-edit protection intact. / 保留接口兼容、授权及用户修改保护。
4. Run the regression suite and rebuild release metadata when plugin files change. / 修改插件后运行回归并重建摘要。
5. Describe what was actually tested and what remains uncertain. / 明确区分已测范围与未验证部分。

```sh
node scripts/build-release.mjs
node --no-warnings --test plugins/coming-jobs/tests/*.test.mjs
node scripts/check-public.mjs
```

No account credentials or external applications are required for the unit suite. Do not submit personal materials, full chat transcripts, private workspace files or host-specific configuration paths.

无需账号或真实投递即可运行单元测试。不要提交个人材料、完整对话、私有工作区或本机专属配置路径。

Please be respectful, specific and constructive. Disagreement about code is welcome; harassment and disclosure of someone else's personal information are not.
