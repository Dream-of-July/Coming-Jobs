# 完整材料与当前宿主批次

多个岗位先按 [连续队列](application-queue.md) 领取工作。普通阶段使用 context(scope=execution)，最终核对才展开完整 application；保存异常回执后延期本项并继续其他岗位。

Codex 登录先按 [邮箱优先登录](authentication.md) 复用一次性只读授权并主动完成可读取的验证码；只有缺权限、缺实际读取能力或必要人工动作才交接。Claude 验证码由本人输入，不读取邮箱或短信验证码。验证码不进入材料、表单计划或检查点。

首次采用新流程：根据用户已确认 PDF 明确登记 material(baseline)，提供实际文件 SHA、真实文本提取引用与逐条 inventory（每段教育、工作、项目、成果、奖项、作品链接）。不存在的类别不编造；不要用修改时间选文件。登记既有审核不要求重复问用户。内容缺失先补齐、展示差异、取得适用审核。岗位版关联 lineage；文本证据是宿主提取结果，不代表插件独立解析了 PDF，必须核对实际文件。视觉验收独立保留。

表单对应正文使用 content_key 和 material_id 引用同一基线。默认使用本次简历已审核的文字：存在已审核 baseline_mappings 时使用岗位版新文字，否则使用基线原文。公司扩写或字段压缩用 material(variation)，记录公司、原文、差异、事实、长度限制和已确认来源，计划中引用 variation_id。不要把这类变化写成全局答案。复用审核文件使用 material(reuse)，只复用内容审核，不复制外部传输授权。照片用 kind=photo，计划给出 max_bytes、allowed_mime_types，定位唯一。

执行先读当前宿主文档。plan.batches 给出顺序与最多八项的普通字段批次。上传、学校、日期单独执行。每批先只读实际原值；附件批次还需 protected_fields 保存所有可能受解析影响的普通字段，已有值时提供经用户明确确认的 restore_keys/restore_ref 或经当前页面核验的 attachment_mode=attachment_only，然后 checkpoint(phase=prepare,batch_number,host_version,groups.fields=原值)，使用返回的持久化目标与授权范围。重复 prepare 会被拒绝。

普通控件用 ../../../src/host-batch.mjs 中的固定 executeOrdinaryBatch 函数，在当前 CUA REPL 按当前宿主规则定义后执行；不能用 eval、动态导入本地代码或 DOM evaluate 写入。参数来自 prepare 回执，不能临时改目标。函数每字段检查唯一定位、原值、长度、接收方及授权期限，批次结束统一回读全部实际字段，发现后续写入清空前项也不能报完成；外部异常只读恢复并返回实际观察。支持标签、ARIA 名称与宿主实际可用的观察定位器。宿主不支持此 API 时按当前文档使用等价适配并保持同样检查，不开新浏览器绕过。

执行器返回安全 code、failure、written/skipped/recovered 和实际 browser_calls。只读调用有界；原生写入依赖宿主自己的等待/取消能力，必须等待实际返回，禁止用 Promise.race 伪装停止。协议由独立观察步骤处理；普通函数会在写入前拒绝混合协议批次。使用 fillGroup 处理协议时提供 readAgreement 返回当前完整 text，验证其哈希。

## 即时登录验证码

仅 Codex 可在其当前权限允许时使用 `../../../src/host-batch.mjs` 的固定 `executeVerificationCode(tab,request,options)`；Claude 不调用此帮助函数，验证码仍由用户输入。它只处理已授权登录的一次性短信/邮件验证码，不操作最终申请提交或人机挑战。复制到当前宿主运行时前，先读取宿主文档；每个接口都必须由实际可用能力提供。

- request：`kind:'one_time_code'`、`purpose:'login'`、本次 `request_id`、`origin`、`account`、`channel:'sms'|'email'`、`requested_at`、`expires_at`、已观察的 `locator`。
- options.authorization：适用用户指令 `user_ref`、相同 purpose/origin/account/channel 及有效期。已有授权直接复用；不会因一次工具往返重新问用户。
- `receiveCode(scope)`：通过已授权连接器只读获取候选码，返回 null 或带上述请求范围、真实 received_at 和短时 code 的对象。不能只取邮箱里最新的一串数字；将供应商消息关联本次请求必须有账号、发送方、时间或请求标识证据，不能给旧消息伪造 request_id。
- `readStatus(scope)`：只返回 `pending|accepted|rejected|expired|captcha`，不返回页面敏感值。已进入、验证成功与结果未知分别报告。

先立即读取，未到达才进行短时、有上限的轮询。校验范围和时效后每次调用只填一次，不把 code 返回给模型摘要或写入业务工具。已尝试的请求随后只用 readStatus 核验，不能重复调用来再次写入。失败或未知不重填、不自动重发。需要点击验证码登录按钮时，只能使用已核验的登录动作和相同授权；该函数本身不点击按钮。连接器不可用或人机挑战时及时交接具体动作，不能静默长等。认证流程不调用普通业务 checkpoint；宿主适配器必须限制自身读取超时。

## 普通表单回执与恢复

执行后 checkpoint(phase=complete,groups.fields=真实回执)。通道丢失时保留 pending；下次先逐字段只读、checkpoint(phase=recover)，目标值不重填，第三种值保留。仅恢复批准的原值差异。不要把 unknown 当作失败后可直接重试。批次恢复后最终仍做全页 review 和门户保存核验。

附件先检查是否已有正确关联。首次上传必须在精修前完成：file_selected、upload_complete、parse_complete、attachment_associated、portal_saved 分别观察。无解析入口只在门户明确不解析时将 parse_complete 作为已核验不适用记录在 checklist。百分比、文件选择器、文件名均不能单独证明关联或保存。已有用户修改先保存原值，优先检查不重新解析入口；需要解析覆盖时列出确切恢复范围并核对授权，不能擅自恢复整页。照片也要求关联与保存证据。

门户确实没有暂存步骤时，在 prepare、complete/recover 和 review 都传 single_submit=true 与实际 persistence_ref；附件仍需选择、上传、解析完成和关联证据，不能虚报 portal_saved=true，也不能把保存失败当作单次提交。最终提交以实际字段、附件及控件清单的最旧观察时间为准，均须在五分钟内。重新生成 review 不会刷新观察；较早执行的区域需要重新只读回读，不重填或重传。

可选字段也必须与审批值一致。计划外普通控件需要证明为空，或与审批单中列明的解析值相同；未知值阻止提交。局部重新审批使用 application_id 限定变化项，其余仍有效、未变化的批准保留原批次码、模式和到期时间。

学校查询使用完整名称及页面已有区分信息，重名不取 first/last；日期逐个处理依赖，父级变化后重新读取子级。初次识别、结构变化、最终检查用全页；普通填写只读变化字段。不要把动态节点号、坐标持久化。

成功批次带 host_version 时自动产生候选经验；experience(lookup) 精确限定 company、origin、stage、structure 与 host_version。候选需要实际合成回放的证据摘要和修改保护测试，再 validate。每次采用前只读匹配当前结构、唯一候选、回读条件后 enable；不匹配立即失效，只做一次针对性观察。不得把相同 ATS 当作跨公司的验证。候选数据不得含简历、聊天正文、私人链接、证件或凭证。代码改进走正常可审查版本，不在投递时改代码。

checkpoint.metrics 只记录实际可测的 agent_ms、tool_ms、human_wait_ms、cua_calls、full_snapshots；不可测不填，不能把总墙钟时间冒充 Agent 时间。finish 自动汇总，缺指标显示未知。后续观察 3–5 次真实使用后再评估真实收益；成功提交不改变岗位偏好。
