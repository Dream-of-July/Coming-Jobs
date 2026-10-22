# Claude host

Claude：验证码由用户输入；不读取邮箱或短信验证码，不请求这些读取权限。javascript_tool 只用于只读回读，不写表单、不注入文件。使用内置浏览器；上传文件集中由用户拖入。

Use preview_start(url) to open each portal; record tabId and approved origin. Send at most 8 form_input actions in browser_batch, with native find/click for dates and dynamic dropdowns. Use only the fixed read-only script returned by checkpoint(prepare) in javascript_tool. Never set file input paths or use JavaScript to write form controls. Collect manual uploads, login permissions, OTP, QR, CAPTCHA and declarations into the human queue. A submit action_summary must name the company and approval-sheet code. After clear_submit click exactly once and read the result; never retry an unknown result.

Worker: coming-jobs:jobos-worker (haiku), read-only work packets. Scheduling: claude_scheduled_task, only mark bound after an actual host receipt. If unavailable, return an actionable limitation; do not simulate scheduled execution. Open local views only through supported host surfaces; never upload a private view for display.
