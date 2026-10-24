# 每日运行契约

公司账本、完整范围检查、预算和推荐快照由插件实现；公开来源的读取、JD 语义评估、定时唤起和实际展示由宿主执行。程序不能自行激活一个未加载的插件。

## 用户目标与结果口径

先复用用户确认的每日实际提交目标、统计时区和“新企业”定义，更新偏好时重新匹配；不要每天重复确认。详见 [完整采集与每日目标](../skills/jobos/references/discovery-and-daily-goals.md)。

用户目标与当前工具设置分别记录：target_companies最多为5，表示推荐待办数量，不是每日实际提交企业目标。用户目标超过工具上限时明确缺口；不能在文档中把五家改写成已支持更高目标，也不能重复start绕过预算。

日报分列目标、按实际提交时间核实的新企业数、用户报告待核数、可行动企业数、待人工步骤与未达原因。同企业多岗位/别名去重；抓取、推荐、准备、登录、暂存及上传不算提交。旧邮件重读、本地建档和旧preparing队列不算今天新提交。实际最终提交按用户逐批批准与当前宿主规则执行；定时后台始终只读。

## 初始化与绑定

读取 context(scope=daily) 及已有画像。用户已要求每日推荐后 configure(confirmed=true,user_ref=实际授权引用)，默认北京时间09:00、补足最多五家、目录优先、每天最多扩展一家、选定后才准备材料。已有配置不反复覆盖。复用相同目标线程的现有 heartbeat，保留原跟进范围、通知偏好与授权；不恢复旧版 cron，不创建重复任务。

使用宿主工具成功更新任务后 bind，记录真实任务和目标线程 ID。任务暂停、失败或旧构建不兼容时 health，不声称已运行成功。新进程工具返回与当前会话实际加载是独立验收。配置暂停只暂停每日推荐；仍保留已授权的申请跟进。新会话无需激活口令，所需首次插件启用、hooks 信任仍以宿主状态为准。

首次 status 检查 company 目录。已有 jobs/申请仅迁移明确公司名和批次，不猜届别；目录未登记时读取已授权的公开公司来源（preferences.referral_source 仅在用户已授权时用于发现），程序提取公司名和官方入口，登记 company。原目录行只用来发现公司，不代表官方岗位或名额证据。后续优先轮询已登记目录，最多额外发现一家。scope 必须明确 track、campaign 和官方来源；学校、性格或历史资料不能替代求职意图。

opportunity 记录官方或用户已明确提供的批次名额，source_ref 保存公开规则 URL 或实际用户陈述引用；不能因“求职就一次机会”推断所有公司都只能投一次。应用历史批次未知时，用官方记录或用户已确认信息 link_application，不改写 submitted_material/job_snapshot。名额耗尽只跳过本批次发现，仍跟进全部申请；被拒或撤回不自动返还名额。

更新规则时，省略 limit/deadline 保留旧值；显式传 null 清除旧值。limit=null 表示名额未知，仍需核实，不等于无限名额。规则移除截止日后用 deadline=null；exhausted 是独立的核验结论，需要新证据明确解除时另传 exhausted=false。较旧观察不能覆盖或清除较新规则。

## 每日执行

1. 先 followup(queue,background=true) 独立只读检查全部已提交/用户确认申请。notification、capability、outcome 也传 background=true。缺连接器/登录只标缺口，不阻塞后面的公开岗位推荐。
2. daily(start) 得到 run_id，再重复 daily(next)。不要绕过分配任务调用旧 jobs/shortlist，也不手动扩大预算。默认最多20家公司元数据、5家公司深入审阅、100份新增或变更正文/评估、20分钟，目录外扩展最多一家。实际 Token 用量由宿主决定，工作量预算不等于精确 Token 限额。
3. metadata 任务只读核验该 scope 的官方目录变化和名额，必要时刷新官方公司介绍。observe 保存 changed、fingerprint、change_basis、公开分页 cursor 和 done/partial/blocked。changed=false也必须携带本次重新请求的live_entries和live_checked_at核对全部入口ID。只有覆盖完整 JD 正文、开放状态和截止的可靠全范围版本标识，或逐份重新验证后的完整摘要，才允许 changed=false。仅岗位数、编号列表、列表 ETag 或标题没变化不能证明 JD 未变。没有可靠标识时 changed=true。
4. collect默认用程序/爬虫批量读取scope内官网公开目录、全部分页及完整正文，不用Computer Use逐岗浏览作为常规采集。公开获取失败才用获准页面定位入口或补读缺项，不能提取Cookie/令牌或绕过拒绝。通过 daily(ingest) 分批落地，jobs source=official、mode 与 run 相同；collection 是完整范围快照，external_ids 是累计清单，不能只传本批新增编号。complete=false 可保存已列出的编号与已读正文；目录列齐但缺详情仍不能完成。按 detail_limit 限制本次新增正文；每批保存公开 cursor，不能保存Cookie、令牌、带身份链接或原始响应日志。保留正文成功/失败与待评估数量，不能把下载成功当评估完成。次日先核验目录未发生影响游标的变化，再续读；变化时重取目录并按内容哈希复用正文。
5. collect 完成后 observe(done)，插件独立检查目录/正文完整性。partial/blocked 都保留进度，不在同一天无新证据重试。assess 任务每批最多10个完整JD，必须覆盖全部要求，包括不符合的岗位；只使用已确认且允许 matching 的事实。daily(assess) 接收完整分配任务，不能遗漏硬门槛或用 title 过滤代替审阅。
6. 任务为 expand 时，只从授权来源额外发现最多一家，用 daily(company,run_id,task_id) 登记，或 observe(blocked/partial) 记录具体阻塞。不得为凑数无限找公司。任务为空或 budget_exhausted 时 daily(report)，保存足额/不足额推荐与未完成原因。

每家公司只在全部已登记有效范围完成审阅、名额无冲突、官方介绍30天内有效后推荐；每岗使用与公司比较相同的职责、证据等级与门槛校验；仅 eligibility=pass 且 tier=priority/conditional/adjacent 可行动。资格unknown/conflict单列待澄清，不以旧分数补足推荐。规则缺失或超过7天显示“未复核”；不展示匹配分数和录用概率。通常展示主推一岗与两岗备选；已核实名额允许更多合适独立岗位时扩展展示，最多100项。卡片 `application_strategy` 分列已提交使用、准备中预留、剩余机会和有序建议；展示多个岗位不等于获准同时投，不足五家公司就如实说明。

## 展示、续跑和控制

使用 report 的稳定 A–E 编号、report_id、官方链接、个人匹配理由/缺口和截止。主次岗位顺序不可自己重排。重复触发从 next 同一任务恢复，不能重置当天预算。report.notify=false 且跟进也没有新进展/可行动事项时静默。report 已原子预留本次通知，重复运行不会再次通知；成功展示后 acknowledge(result_ref=真实展示结果引用)；失败或结果未知不能自动重发。生成 HTML 不等于用户已看到，后台只生成，用户查看任务时再用 open_in_codex 打开。

跨日补存 report 仍归属原 run.date，仅作历史恢复，不预留新通知或回退较新的调度游标；后续投递必须取得当天核验结果。不存在的 run_id 返回 daily_run_not_found。

报告包含 presentation 时是私有本地 HTML，不公开托管。日报是有日期的核验快照。用户明确选择后 daily(choose) 复核当前 JD、评估和名额，再复用/创建 preparing 申请；“暂缓 A”用 feedback(defer)，无日期表示持续暂缓，用户恢复用 save；reject 表示不再推荐该公司，可用 save 恢复。

`daily(choose)` 接受旧版 `role_number` 或新版 `role_numbers`，二者只传一个。多选在写入前整体复核名额与同一母申请，保留用户给出的准备顺序；已有申请复用，不重复占位。准备顺序不是门户实际志愿号，填写前仍核验页面。只投完一个而仍有合适机会时，公司待办不自动完成；被拒、撤回或结果未知的真实申请不自动返还额度。

追加选择会续在同公司、同范围的已有准备顺序之后。例如先选 `[2,1]`，再加 `[3]`，仍按 `[2,1,3]` 准备，重开报告也保持一致。用户明确 `shortlist(feedback,reject)` 或 `daily(feedback,reject)` 时，只对没有门户执行、草稿回执、待核验结果或提交历史的本地准备释放预留，并记为 `cancelled_preparation`。返回的 `preparation_cancellation` 列出已取消、未改动和需要核验的记录。已取消记录保留历史、撤销执行授权，不进行门户撤回，也不计入跟进队列；明确 `save` 恢复偏好后再 `choose` 才重新准备。

可靠完整清单的 `changed=false` 核验同时更新该清单内岗位的实际复核时间，保持报告、策略和选择的时效一致。只有编号未变或缺少正文级核验证据时不能刷新为有效岗位。

宿主必须在电脑开机、应用运行且本地目录可用时唤起。离线后首次运行只开始当天任务，不补发历史每日通知；用户未在场时不登录、不请求验证码、不准备五份简历、不操作真实表单。后台不触发交互式 finish 循环；已保存报告后可以结束。

## 共同评估与公司比较

评估字段、证据等级、到岗窗口、冲突与七列表格使用 [岗位适配评估](../skills/jobos/references/fit-assessment.md)。report先保存当日独立排序快照，之后才比较上一批；单列误判、待澄清问题与四类差异。正式校招和实习分开。

`jobos1_comparison` 是独立的最多20家公司分批比较入口，使用comparison_key、累计预算与cursor恢复，不读写daily_budget，也不生成日报choose编号。完整调用与合成运行示例见 [公司比较](COMPARISON.md)。用户仍需选定具体岗位并审核材料后进入申请流程。


## Dual-host scheduling (beta.16)

provider is codex_heartbeat (requires target_thread_id) or claude_scheduled_task (does not require a Codex thread). Both require a successful real host receipt and provider_task_id; unavailable host scheduling must remain unbound. Daily/background execution is read-only and cannot clear_submit. Unchanged or non-actionable results stay quiet.
