---
name: jobos
description: "Use Coming Jobs to understand a candidate, recommend jobs, tailor resumes, fill applications efficiently, track all applications and prepare interviews. Automatically resume daily recommendations, today's company queue and confirmed application progress without activation phrases or repeated questions."
---

Coming Jobs业务数据仅使用jobos_next的jobos1_接口；允许当前宿主检索、浏览器、Computer Use及插件维护工具。普通已确认资料直接复用，不逐项重复提问；材料用户审核后上传更新。最终提交需用户逐批明确批准，仅在带批次码的审批单授权范围内执行；仅当已审批的语义内容变化时暂停该项；门户自动同步的字段（如同月内毕业日期的具体日）和已恢复为审批值的字段不算变化。外部结果不明不重试。验证码不落库；扫码、密码、注册、承诺书和法律声明由用户本人处理；图形/滑块验证只把这一个动作交给用户，其余项目继续。进入预览页后不刷新、不离开。岗位发现先读取官网全部分页与完整JD，读取失败才考虑Computer Use，按推荐度从高到低排序后编号；缺口如实说明。授权不扩大；本地保存、门户保存、实际提交分别核验。

先调用 context 读取 host，再读 references/hosts/<host>.md。未设 JOBOS_HOST 默认 codex。业务数据只用当前 jobos1_ 工具；按公开参数和服务端错误修正调用。

一次准备多个岗位时，先读 references/application-queue.md。一批支持 1–10 个申请：start 后由 next/resume 领取一个工作项，按返回的 next 与 required_inputs 推进。使用 context(scope=batch) 看全批，context(scope=execution,application_id) 看下一组；完整 application 上下文留给首次观察和最终核对，避免反复读历史与所有资料。每个岗位保存检查点；可处理项全部推进后再集中交接，不因第一份草稿完成就结束整批。

新工作区默认 prefill_only；已有明确偏好继续有效。用户只要求填写、准备或保存草稿时，不切换成 on。取得工作项后保留 claim_id；异常保存实际回执，再 defer 原领取项并继续其他岗位。重复 next 不会重发仍在执行的工作。到 retry_at 前不轮询；达到重试上限只报告具体阻塞。宿主调用仍在进行时不得启动第二个浏览器写入者。

已确认资料直接复用。每次投递重新读取当前 JD、名额、实际表单与协议；AX未显示值不等于字段为空。私密候选资料不写插件源码、测试、样例或报告。不凭历史缓存复用内推码；读取 preferences.referral_source 的授权来源。不得先上传未审核稿；同一 sha 的材料审批可跨岗位复用，变化的字节或引用事实重新审批。用户已在本轮确认无修改时直接交接。

用 apply_batch 汇总目标、审批单与人工步骤。普通资料、附件与协议必须由包含批次码的逐批回复批准。只有当前 grant 覆盖的内容才可填写和提交；clear_submit 后只点击一次并记录实际简历 sha。只有已审批的语义内容变化才暂停该项，门户自动同步或已恢复为审批值的字段不算变化，其他项目继续。进入预览页后不刷新、不离开，直接读取并核对。没有待办不催下一步。后台运行只读，不申请登录权限、不填写、不提交。

材料条目先提议，一条消息批准；最多 5 问，一次问完。逐岗标题与简介在审批单逐字展示。门户解析后回读所有受保护字段，保存状态与提交结果分别核验。法律声明、承诺书、扫码、密码、注册由用户处理；图形/滑块验证只交接这一个动作，完成后立即续跑。

先 material(context,job_id) 复用适用的已审核版本；适合时 material(reuse)，只有确需改写时再读 references/resume-tailoring.md。实际整页观察后一次 form_profile 匹配已知必填与选填资料，并把 observed_fields 带入 plan；只问真实缺口。执行与恢复详见 references/execution.md。

同公司已选多个独立岗位时保留完整选择与准备顺序；daily(choose,role_numbers) 支持多选。准备中申请预留名额，准备顺序不代表门户志愿号；未提交的本地准备取消不等于门户撤回。
