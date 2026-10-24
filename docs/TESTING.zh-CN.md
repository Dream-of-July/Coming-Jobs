# 验证范围

完整命令、覆盖项、合成门户与真实门户人工验收步骤见[测试说明](TESTING.md)。

双宿主无浏览器端到端测试纳入 npm test；另有真实 Chrome 离线渲染与可选 Playwright 三门户验证。Claude 上传和人工步骤在浏览器测试中由合成夹具模拟，不等于真实 Claude Desktop 已有自动上传能力。CI 配置覆盖 Node 22/24、macOS/Ubuntu；本地测试不能冒充远程 CI 结果。
