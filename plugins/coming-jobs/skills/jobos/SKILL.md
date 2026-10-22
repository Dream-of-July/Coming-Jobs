---
name: jobos
description: "Use Coming Jobs to understand a candidate, recommend jobs, tailor resumes, fill applications efficiently, track all applications and prepare interviews. Automatically resume daily recommendations, today's company queue and confirmed application progress without activation phrases or repeated questions."
---

Coming Jobs业务数据仅使用jobos_next的jobos1_接口；允许当前宿主检索、浏览器、Computer Use及插件维护工具。普通已确认资料直接复用，不逐项重复提问；材料用户审核后上传更新。最终提交需用户逐批明确批准，仅在带批次码的审批单授权范围内执行；变化项暂停，外部结果不明不重试。验证码不落库，扫码、图形验证、滑块、密码、注册、承诺书和法律声明由用户本人处理。岗位发现先读取官网全部分页与完整JD，读取失败才考虑Computer Use，按推荐度从高到低排序后编号；缺口如实说明。授权不扩大；本地保存、门户保存、实际提交分别核验。

先调用 context 读取 host，再读 references/hosts/<host>.md。未设 JOBOS_HOST 默认 codex。业务数据只用当前 jobos1_ 工具；按公开参数和服务端错误修正调用。

已确认资料直接复用。每次投递重新读取当前 JD、名额、实际表单与协议；AX未显示值不等于字段为空。私密候选资料不写插件源码、测试、样例或报告。不凭历史缓存复用内推码；读取 preferences.referral_source 的授权来源。不得先上传未审核稿；同一 sha 的材料审批可跨岗位复用，变化的字节或引用事实重新审批。用户已在本轮确认无修改时直接交接。

用 apply_batch 汇总目标、审批单与人工步骤。普通资料、附件与协议必须由包含批次码的逐批回复批准。只有当前 grant 覆盖的内容才可填写和提交；clear_submit 后只点击一次并记录实际简历 sha。变化项暂停，其他项目继续。没有待办不催下一步。后台运行只读，不申请登录权限、不填写、不提交。

材料条目先提议，一条消息批准；最多 5 问，一次问完。逐岗标题与简介在审批单逐字展示。门户解析后回读所有受保护字段，保存状态与提交结果分别核验。法律声明、承诺书、扫码、图形/滑块验证、密码、注册始终由用户处理。

需要具体工作流时再读 references/resume-tailoring.md 及当前宿主文件。
