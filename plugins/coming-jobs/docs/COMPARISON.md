# 独立公司比较

`jobos1_comparison` 面向明确指定的1至20家公司，使用独立的 comparison_* 私有记录。它不读写 daily_budget，不伪装日报，不创建申请。职责与门槛方法见 [岗位适配评估](../skills/jobos/references/fit-assessment.md)，平台适配器见 [公开岗位采集](COLLECTORS.md)。

## 数据准备

只读取已授权资料，复用已确认事实。`remember` 的 evidence_level 保留五类证据来源；从资料提案确认时仍保留原来的证据等级。`profile(fit_context)` 保存毕业年份、所在地、可到岗地点、最早日期、每周天数、连续月数和分级工具能力。未知留空，能力广度不能代替深度。

用现有 `daily(company)` 登记公司及各 scope 的 track、campaign、source_url，`daily(opportunity)` 保存官方规则及核验时间；这些是共用目录和机会账本操作，不是开始每日任务。需要读取已有申请和阶段，批次未知先核验。规则超过7天标未复核；剩余额度未知不成为可行动推荐。

采集全部公开分页及详情，按 scope 入库。每个 scope 的 collection 为累计清单；entries 是快照的全部入口编号，live_entries 是本次重新请求的全部入口编号，live_checked_at 是实际列表核验时间。多个入口同一岗位保留来源，不混淆正式校招与实习，也不把多方向当成多个名额。仅刷新列表不能证明旧 JD 正文未变。

## 任务与恢复

1. `start`：传稳定 comparison_key、明确的 company_ids、mode；可指定 limits.details、assessments、batch_size。默认累计正文200份、评估200份、每批10岗。大目录须事先给出足够预算，最多各10000份。比较对象最多20家，与每日最多深入5家分开。
2. `next`：返回保留额度的 collect/assess 任务、已知编号、完整JD、cursor和累计预算。最多一次分配20个互不冲突任务，宿主可按能力顺序执行。任务结果、公开分页游标及已完成ID持续保存。
3. `ingest`：只保存本任务的官方岗位与完整 collection。分批读取时external_ids仍是当前累计范围；详情没齐不能结束采集。`observe(partial/blocked)` 保存原因和游标；有新证据后以原任务 `observe(collect)` 恢复相同范围。collect完成用 `observe(done)`。
4. `assess`：本次独立评估覆盖分配的完整 JD 及每项要求，包含排除理由。允许按当前任务逐岗提交；未完成部分从同一任务恢复。旧全局assessment不作为本次独立排序。
5. 中断后再次 `start` 使用相同 key 和公司，或直接 `next(run_id)`。不会重置或扩大累计预算，改变传入limits也不能重置。预算不足时保留partial与缺口；不要用新key伪装同一次未完成工作。若达到总预算上限，需重新规划明确范围/预算，不声称完成。
6. `report` 可读取未封存的阶段结果；只有目录、当前列表、完整正文及本次逐岗评估全部完成才为complete。零结果也保留已查URL及观察时间。
7. `seal` 固化独立排序的时间、哈希、证据、资格、位置与理由。若确需保存阶段快照，传 allow_partial 和具体原因；封存后不可继续修改该run，后续新证据使用新的独立版本。通常先用report保留可续跑的草稿。
8. `previous` 仅在seal后读取指定 previous_run_id 或 previous_batch_id，生成漏掉、高估、低估、相同四类差异。封存快照不因旧排名改变。`report` 输出七列表及单独的实习、误判、待澄清、参考和差异。

report为带日期的证据快照。封存后规则、名额、在招状态或画像改变，行动检查与快照分开展示；旧快照不自动构成申请授权。宿主不能在封存之前从其他接口读取旧排名来决定本次排序，工具门禁不能监控宿主在工具之外读取了什么。

## 兼容与验证

评估schema的新字段可选以接受旧调用，缺字段保守归一为unknown/qualification_hold；不会将旧匹配分转换成资格结论。读旧记录时保守投影，明确导入备份时迁移为新结构；不需要打开或改写原候选库。新排序不计算匹配分数，也不展示录用概率。原稳定batch和日报选择机制继续存在；新公司比较没有choose操作。

在仓库根目录运行 `node --no-warnings scripts/compare-synthetic.mjs` 可生成全合成的20家公司演练及Markdown报告。只创建临时测试库，显式忽略真实 JOBOS_NEXT_HOME；测试也覆盖关闭工作区后恢复。正式验证在 `plugins/coming-jobs` 运行 `npm test`，提交前在仓库根运行 `node scripts/check-public.mjs`。这些验证不登录、不访问真实招聘站、不上传、不投递。
