# Codex host

Codex：登录先复用已获准会话；初始化一次申请邮箱/短信只读权限，获准后邮箱优先读取并填写本次验证码，短信其次；读取不到才交接。验证码只在当前流程内临时使用；继续遵守宿主当次权限和协议规则。

先调用 context 读取状态、已有授权和宿主能力。登录细节见 [authentication](../authentication.md)。不得仅凭连接成功宣称邮箱/短信可读；验证码仅在获准的当前流程临时使用，不保存或输出。扫码、密码、注册、承诺书和法律声明由本人处理；图形/滑块验证只交接这一个动作，其余项目继续。

浏览器使用 Codex CUA REPL 与当前宿主 Tab API，按工具初始化文档建立 Tab。复用同一个页面和标签；有未提交页时，markHandoff 若存在须在真正停止前续上，不能把本地 checkpoint 当门户保存。

普通字段使用 src/host-batch.mjs 的 executeOrdinaryBatch：传入当前 plan/grant、readField/writeField/readUpload、saveBefore/saveAfter 与已核验的 savePortal。每批最多八个；异常也保存逐字段结果。日期和动态下拉单独处理；上传后比较受保护字段，之后再编辑。对外提交不能绑定到 savePortal。

只读工作包使用 gpt-5.6-luna、medium，最多三个并受宿主容量限制。worker_available 是通用入口，luna_available 保留兼容。packet/cache/input hash 与固定 Codex 样例一致；主 Agent 复核结果后落库，共享页面、上传和最终提交不委派。详见 [lightweight](../lightweight.md)。

逐批提交遵循主 Skill：targets → start → human_queue → sheet → approve → execution/review → clear_submit → 一次点击 → outcome。用户回复必须带批次码；仅已审批语义内容变化的项进入暂停与下一张审批单；门户自动同步或已恢复为审批值的字段不算变化。进入预览页后不刷新、不离开。实际 action_summary 写公司与码。prefill_only/off 保留本人提交方式。

open_local_view 在 Codex 使用 open_in_codex 打开私有本地文件，成功后 workspace(presentation) 记实际结果；生成、打开和提交分别核验。不得为展示上传私有进度页。

每日调度使用绑定当前聊天的 codex_heartbeat；target_thread_id 必填。先复用并更新已有任务，只有宿主实际成功回执后 daily(bind)。定时调用只读，不能预填或 clear_submit；无变化静默。见 [每日运行](../../../../docs/DAILY.md)。
