# 增量契约

沿用 `jobos/1`、`jobos1_` 工具前缀及兼容的旧必填参数。CLI、MCP和本地看板使用同一 registry 校验，完整工具列表以 `tool-schemas.json` 为准。旧数据库无需重建；导出增加 collection，恢复不恢复外部授权与执行占用。

## beta.14 表单、材料与志愿

- `form_profile(application_id,fields)` 只读匹配真实观察字段与适用事实，包含已知选填链接、公司别名、冲突、长度及真实下拉选项；`plan.observed_fields` 和 `review.field_coverage` 共同检查遗漏。已观察清单保留；动态字段实际不适用时，使用带真实 `observation_ref` 的 `applicable:false` 明确记录，不再列入写入目标。认证及必要声明不作为普通已保存值。
- `material(context,job_id)` 返回适用材料和证据上下文；`material(reuse)` 为新岗位建立独立的同字节材料记录，不改写源文件归属，不扩大外部授权。`draft` / `lineage` 支持 `baseline_mappings`，`approve.reviewed_content_keys` 记录改写条目已编辑审核。
- `application_strategy` 显示按公司和招聘范围核实的已用额度、草稿预留和合适独立岗位；`daily.choose.role_numbers` 支持多选，原 `role_number` 仍可用。多选先整体预检，再按明确顺序准备，最终提交仍由用户完成。
- 登录码使用宿主短时适配器及已有适用授权；不写入普通事实、计划、checkpoint 或日志。未知结果只读核验，不重复输入或重发。

## 上下文与采集

- `context.since` 接受上次 `data.context_revision`；相同响应为 `unchanged=true`，仍返回最新 flow。无 since 保留原有完整字段；当前申请增加 pending_groups、authorization_status、resume_sync。
- `jobs(ingest).compact=true` 只缩短回包，原始完整JD仍存储。旧调用仍返回完整岗位。
- `jobs(ingest).collection` 是一个公司/类型/届别的完整编号快照：company、track、可选campaign、source_url、observed_at、total、external_ids、pages_read、has_more、complete。不是新增编号补丁。shortlist(daily) 可传 campaign，避免其他届别影响当前候选池。每次补正文或翻页更新同一范围；不跨真实/演练模式混合。
- 列表未结束、编号不齐、正文缺失、范围过期均不能证明全量；有明确未完成 collection 的批次不能 choose。没有新元数据的旧记录继续可用，但 coverage_verified 不为真。工具验证结构与已登记证据，不代替宿主逐岗阅读。

## 授权与恢复

- `authorize.reuse=true` 不创建新内容授权，只为已覆盖内容续上两小时单会话执行占用；必须引用原授权，另一未过期会话不能抢写。旧版 grant 仅在原计划与原有效期内适用。
- 新 grant 的 scope_hash 绑定申请、JD与接收方，field_grants 绑定字段语义、值、事实版本与附件字节。定位器、顺序和同字节显示改名不扩大内容；新增值、事实纠正或接收方变化不能复用。
- plan 返回 covered_fields / missing_fields；未变化且独立的字段组可以先继续。计划变化保留原值与可恢复观察，最终就绪需重新回读。
- checkpoint 支持 `read_state=unreadable`、空 option_id、空 file_name；这表示尚未读到或没有附件，不伪造空字符串目标。可选 portal_saved 区分真实暂存证据；缺省表示未知。
- browser.fillGroup 仅使用调用方提供的 Tab，不启动浏览器。可接入当前宿主的 readField/writeField/readUpload、settle、savePortal、refreshField；后两者不能绑定最终提交或改变授权内容。每个成功字段持久化累计观察，失败时保存不确定字段并抛出原错误，不自动重复外部写。savePortal 成功后重新回读；缺失的值不会通过 review。

## 材料与交接

- plan.checklist：key、label、required、state(pending/verified/not_applicable)、可选group_key与observation_ref。完成或不适用必须有观察引用，绑定区域必须回读通过。宿主必须枚举用户点名区域及全部教育、材料和门户必填。
- review 增加 checklist、completeness、portal_persistence。旧计划可检查原已登记区域，但标 legacy_inventory_unverified，不能说全表已核验；所有必要缺口都会返回 blockers。已登记作品集若无上传区域或仅链接入口核验证据，也会阻塞。
- `material(register)` 同字节同种材料改名保留审核，内容变化清除审核；提交材料历史快照不变。
- `workspace(presentation)` 记录宿主实际 opened/failed 结果，使用可选 view_hash 防过期确认；只生成HTML时为 generated。
- `followup(schedule_status)` 可记录 paused/failed/needs_rebind；相同 configure 保留已绑定任务。跟进通知只在新通知、截止、动作或能力状态变化时返回 notify=true。

## 边界与限制

宿主回读是观察证据，不是远端哈希或官方 provider。浏览器权限和人工提交要求不由本插件扩大。旧调用仍受旧状态语义限制；新增完整清单与 collection 必须由宿主提供真实证据，不能填造。

错误码包括 collection_incomplete、collection_count_invalid、fact_changed、lease_expired、field_unreadable、host_method_unavailable、user_edit_conflict、upload_not_verified、portal_save_not_verified、presentation_changed；仅对适用的定位失败允许一次更新定位器，不把所有失败都重试。
