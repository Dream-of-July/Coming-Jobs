# Integrated application workflow reliability / 已集成的投递流程改进

This page describes the reliability changes integrated with the current dual-host source. A published download and an already-running host session may load different builds. Install the reviewed source with the normal installer, fully restart the selected host, and compare the first `jobos1_context` version/build with `plugins/coming-jobs/release.json` before expecting the new behavior. See [installation](INSTALL.md) / [安装](INSTALL.zh-CN.md).

本文描述与当前双宿主源码整合后的可靠性改进。已发布安装包及当前宿主会话可能加载不同构建。使用正常安装器更新后，完全重启所选宿主，并在新会话核对 `jobos1_context` 的 version/build。

## What changes / 具体变化

| Area / 问题 | Behavior / 新行为 |
| --- | --- |
| Known information omitted / 遗漏已有资料 | `jobos1_form_profile` resolves all observed fields in one call. Known optional GitHub, LinkedIn, portfolio and website fields participate in coverage. Company-scoped answers override applicable global aliases; conflicts remain explicit. / 一次匹配全表资料；相关选填链接也检查，公司答案按范围复用。 |
| Slow and fragile filling / 填表慢且容易失误 | Semantic locators agree with readback. Batches read current values before writing and check the final form after all writes. A later reactive control clearing an earlier value prevents completion. / 已相符的值不重填，结束时统一检查，发现联动清空就补缺口。 |
| Codes processed late / 验证码处理滞后 | On Codex, the authorized host prepares the receiver and input first, reads immediately, and uses bounded polling only when no valid code is available. Auth secrets stay transient. / Codex 已有授权适用时及时读取和输入；Claude 验证码由用户输入。 |
| One choice wastes capacity / 只准备一个志愿 | Company strategies expose verified limits, submitted use, draft reservations and eligible distinct choices. `daily(choose,role_numbers)` and existing shortlist choices prepare the selected set atomically. / 核实名额后批量准备已选岗位，保留准备顺序，继续剩余合适机会。 |
| Awkward resume rewriting / 简历改写生硬 | `material(context)` provides scoped facts, the approved baseline and reusable files. `material(reuse)` keeps approved exact bytes in a separate target-job record. Necessary rewrites carry original/new mappings and explicit editorial review. / 已有版本合适就复用；需要改写时核对实际贡献、遗漏与夸大。 |

## Host integration / 宿主接入

The plugin is a local MCP service with host-provided browser and communication capabilities. It does not embed a mailbox or SMS reader. `executeVerificationCode` in `src/host-batch.mjs` is a Codex adapter helper; Claude leaves codes to the user and does not call it. In Codex, the host must supply an authorized code source and actual status observations. Account, origin, channel, request and time matching must come from real provider or browser evidence. A fabricated request association cannot establish a match.

Codex 验证码帮助函数需要宿主提供真实、已授权的邮件或短信来源，以及当前页面状态。函数立即读取，匹配本次账号、接收方、渠道、请求和有效期；过期或不匹配的消息不输入。`entered` 只表示已输入，`verified` 需要页面实际接受的证据；结果未知只读核验。每次调用最多写入一次，已尝试的请求不能通过重新调用来盲目重试。宿主适配器还必须提供自己的读取超时。

Whole-form coverage depends on a truthful `observed_fields` inventory and current options supplied by the host. Old plans without inventories remain readable with an explicit legacy coverage status. A saved checkpoint does not prove that the portal saved the data, and preparation order does not prove the portal's actual preference rank.

全表核验依赖宿主真实枚举页面字段和下拉选项。已观察字段不会因空清单而消失；条件变化使字段实际不适用时，用 `applicable:false` 和真实 `observation_ref` 明确记录，并移除对应写入目标。旧计划兼容读取，但缺少全表清单时不能声称已完整核验。实际门户志愿位置、附件关联和暂存成功都需要当前页面证据。

Resume numeric and wording checks are aids to editing. They do not independently prove semantic truth, PDF extraction fidelity or the quality of every generated sentence. Rewritten baseline items require explicit review; host-provided PDF text is bound to the actual local file hash.

简历规则不能自动证明每句话都准确自然。主 Agent 仍需查看原文与改写，检查本人贡献、数字、保留内容和最终 PDF。通过机械检查不能代替编辑审核。

## Verification / 验证

See [test scope](TESTING.md) / [测试范围](TESTING.zh-CN.md) for repeatable commands and limitations. New fixtures cover reactive field clearing, company alias overrides, known optional omissions, multiple-choice capacity and ordering, faithful resume rewrites, stale evidence and ephemeral codes. They use synthetic data and do not send applications to employers.

The eight-field label fixture reduces DOM evaluations from 16 to 9: eight current-value reads and one final batch read. This measures one synthetic helper path, not elapsed time or whole-application speed. Real portal behavior and end-to-end latency still need observation in an authorized application session.

八字段标签控件的合成用例中，DOM 读取由 16 次降到 9 次；这是局部调用次数，不代表整个投递流程的提速比例。本次源码验证没有登录真实招聘账号、读取真实验证码或提交申请。
