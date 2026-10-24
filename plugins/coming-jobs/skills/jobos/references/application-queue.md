# 连续准备 5–10 个岗位

## 一次建立范围

1. 首次读取 `context` 获取宿主与当前权限。复用已确认资料、目标清单和适用的已审核 PDF；需要改写才调用材料改写流程。
2. 将本次选定的 1–10 个申请传给 `apply_batch(start,application_ids,session_id)`，或使用已批准的 target_list。已有活跃批次用 `context(scope=batch)` 查找并续跑，不重复创建申请。公司名额与准备顺序仍按 opportunity/daily 的实际规则约束。
3. 用 `apply_batch(next,batch_id,session_id)` 领取一项。返回 `item.claim_id`、`item.next` 和完整 `flow`。工具参数里的 `required_inputs` 必须来自当前页面实际观察，不能直接把未补全的参数再调用一次。

## 执行一个工作项

- 材料和表单首次观察：读取完整 JD、实际控件与协议；整页一次 `form_profile` 匹配已知必填和选填资料，把 observed_fields 带入 plan。GitHub、作品集等已知链接不因选填而遗漏。
- 普通执行：读取 `context(scope=execution,application_id)`，只包含当前计划的下一组与恢复证据。这个只读包不授予写入权限。先观察当前值、调用 checkpoint(prepare)，再把返回的持久化回执交给固定宿主执行器。
- 普通字段最多八个，在一次宿主执行中完成；无需逐字段重新询问模型。随后保存真实 complete 回执。后续控件清空前项、值未保持或通道异常都不能标为完成。
- 上传、学校、日期和协议依照 plan.batches 单独处理。新计划将协议分成独立步骤；旧计划保留原检查点编号，遇到混合协议批次时使用逐项观察的适配，不把协议传给 ordinary helper。
- 协议需要读取当前完整文本，与批准 text_hash 一致才可操作。`fillGroup` 的协议适配需提供只读 `readAgreement(field)` 返回 `{text}`；法律声明仍由本人处理。
- 全部组结束后执行全页只读核对和真实门户保存检查，再生成 review。预填完成后继续 next，直到其他可处理岗位也完成。

同一岗位的有效进度会优先继续当前页面，减少来回切标签。资料分析可用最多三个只读 worker；共享浏览器页面始终只有一个写入者。

## 失败与恢复

先保存实际可观察的结果，再调用：

```json
{
  "operation": "defer",
  "batch_id": "<当前批次>",
  "application_id": "<当前申请>",
  "session_id": "<真实宿主会话>",
  "claim_id": "<本次领取回执>",
  "reason": "portal_unavailable",
  "error_code": "read_timeout"
}
```

原因使用 portal_unavailable、host_unavailable、readback_failed、interrupted、outcome_unknown、needs_user 或 content_changed。只记录执行器给出的安全错误码；不保存异常原文、账号、验证码或私人链接。新 claimant 已接手或草稿已经完成时，旧 defer 会被拒绝；此时只读当前队列，不覆盖新进度。

随后领取其他可处理项。默认重试等待为 15 秒、60 秒、300 秒，自动尝试最多三次/相同阶段与证据。`retry` 不清空预算、不跳过等待、不重新授权。队列返回 waiting 时只报告 retry_at 或在宿主允许的调度点续跑，不能忙等。

同一宿主会话重新加载后使用 resume。它保留已完成项，先回读 pending/unknown，再决定差异写入。会话或宿主改变不会继承旧授权；不得冒用旧 session_id。文件选择器出现、函数返回或本地存盘都不能替代门户证据。

宿主普通执行器默认只读单次等待 2 秒、每批协作预算 15 秒。原生 fill/setChecked 必须等待真实返回；没有宿主取消能力时，超时包装不能证明写入已经停止。不要对写入使用 Promise.race，不要在旧执行仍进行时启动第二个写入者。旧 prepare 回执不得重新执行。

## 人工步骤与结束条件

验证码、扫码、声明、缺权限等只阻塞对应岗位，统一加入 human_queue 后继续其他项目。使用真实授权的 Codex 验证码适配；Claude 保持用户输入。

prefill_only/off 下，ready_for_user 表示草稿与回读已完成，不能调用 clear_submit。全部可处理项完成后，一次列出已准备、待本人操作、等待重试和需核对的岗位；不把“待人工”算成失败，也不把“草稿已保存”算成投递成功。

只有用户明确启用 on 并批准当前批次码后，原有 clear_submit → 一次点击 → outcome 流程才可使用。unknown 结果最多有限次只读核验，不重复提交。

## 输出控制

正常循环使用 batch/execution 小上下文；需要完整表单或材料时再按申请展开。不要在每个字段前重新读取 Skill、工具 schema、全画像或所有历史。schema 错误按 details.errors 一次修正，不逐个字段重试。只报告实测的调用次数和耗时；合成基准不代表真实网站速度。
