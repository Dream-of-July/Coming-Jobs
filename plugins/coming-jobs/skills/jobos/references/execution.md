# 完整材料与当前宿主批次

首次采用新流程：根据用户已确认 PDF 明确登记 material(baseline)，提供实际文件 SHA、真实文本提取引用与逐条 inventory（每段教育、工作、项目、成果、奖项、作品链接）。不存在的类别不编造；不要用修改时间选文件。登记既有审核不要求重复问用户。内容缺失先补齐、展示差异、取得适用审核。岗位版关联 lineage；文本证据是宿主提取结果，不代表插件独立解析了 PDF，必须核对实际文件。视觉验收独立保留。

表单对应正文使用 content_key 和 material_id 引用同一基线。默认原文；公司扩写或字段压缩用 material(variation)，记录公司、原文、差异、事实、长度限制和已确认来源，计划中引用 variation_id。不要把这类变化写成全局答案。照片用 kind=photo，计划给出 max_bytes、allowed_mime_types，定位唯一。

执行先读当前宿主文档。plan.batches 给出顺序与最多八项的普通字段批次。上传、学校、日期单独执行。每批先只读实际原值；附件批次还需 protected_fields 保存所有可能受解析影响的普通字段，已有值时提供经用户明确确认的 restore_keys/restore_ref 或经当前页面核验的 attachment_mode=attachment_only。，然后 checkpoint(phase=prepare,batch_number,host_version,groups.fields=原值)，使用返回的持久化目标与授权范围。重复 prepare 会被拒绝。

普通 label 控件用 ../../../src/host-batch.mjs 中的固定 executeOrdinaryBatch 函数，在当前 CUA REPL 按当前宿主规则定义后执行；不能用 eval、动态导入本地代码或 DOM evaluate 写入。参数来自 prepare 回执，不能临时改目标。函数每字段检查唯一定位、原值、长度、接收方、授权期限并回读；外部异常返回已完成项。宿主不支持此 API 时按当前文档使用等价适配并保持同样检查，不开新浏览器绕过。

执行后 checkpoint(phase=complete,groups.fields=真实回执)。通道丢失时保留 pending；下次先逐字段只读、checkpoint(phase=recover)，目标值不重填，第三种值保留。仅恢复批准的原值差异。不要把 unknown 当作失败后可直接重试。批次恢复后最终仍做全页 review 和门户保存核验。

附件先检查是否已有正确关联。首次上传必须在精修前完成：file_selected、upload_complete、parse_complete、attachment_associated、portal_saved 分别观察。无解析入口只在门户明确不解析时将 parse_complete 作为已核验不适用记录在 checklist。百分比、文件选择器、文件名均不能单独证明关联或保存。已有用户修改先保存原值，优先检查不重新解析入口；需要解析覆盖时列出确切恢复范围并核对授权，不能擅自恢复整页。照片也要求关联与保存证据。

学校查询使用完整名称及页面已有区分信息，重名不取 first/last；日期逐个处理依赖，父级变化后重新读取子级。初次识别、结构变化、最终检查用全页；普通填写只读变化字段。不要把动态节点号、坐标持久化。

成功批次带 host_version 时自动产生候选经验；experience(lookup) 精确限定 company、origin、stage、structure 与 host_version。候选需要实际合成回放的证据摘要和修改保护测试，再 validate。每次采用前只读匹配当前结构、唯一候选、回读条件后 enable；不匹配立即失效，只做一次针对性观察。不得把相同 ATS 当作跨公司的验证。候选数据不得含简历、聊天正文、私人链接、证件或凭证。代码改进走正常可审查版本，不在投递时改代码。

checkpoint.metrics 只记录实际可测的 agent_ms、tool_ms、human_wait_ms、cua_calls、full_snapshots；不可测不填，不能把总墙钟时间冒充 Agent 时间。finish 自动汇总，缺指标显示未知。后续观察 3–5 次真实使用后再评估真实收益；成功提交不改变岗位偏好。
