# Lightweight tasks / 轻量任务

## English

The beta.10 source adds host-managed, read-only worker tasks. Codex Desktop runs `gpt-5.6-luna` with medium reasoning, with at most three workers and the host's actual available capacity. Small tasks and unavailable model selection fall back to the primary agent. No extra model API or key is required.

Resume lookup starts with registered material hashes, the confirmed baseline and job-version lineage. Default index responses omit body text; only explicitly selected material/source IDs can return extracted text. Authorized directory inventory is shallow, capped at 200 files / 20 MiB, and reports skipped subdirectories, truncation and unreadable entries. It is not a full-computer search. Native text is cached; PDF extraction requires a hash-bound host result and an evidence reference. A source's accompanying text is not proof that a PDF contains it.

Independent JD assessments, material comparisons, source extraction, company introductions and status summaries can be delegated. Workers return proposals; the primary agent reviews and writes through existing business tools. All recommendations and ambiguous/hard-conflict decisions are reviewed. Other exclusions are sampled at a minimum of one and 10% per batch; an error expands review to the entire batch. Full official JD coverage remains required. Shared browser sessions, uploads, approval and final submission are not parallel worker tasks.

### Interfaces

- `jobos1_tasks`: `plan`, `claim`, `complete`, `review`, `takeover`, `cancel`, `status`, `metrics`. Packets contain referenced inputs and selected confirmed facts, not the conversation history. Each job result includes a complete assessment ready for the existing assessment interface after review.
- `jobos1_material_index`: compact `lookup`/`index`, explicit `inventory`, and `cache_host_text`. Use `include_text` with selected IDs only.
- `jobos1_daily(next)`: optional `limit` from 1 to 3 returns `tasks`; omission keeps the existing singleton response. Download quotas and assessments are reserved atomically, so parallel workers cannot each consume the global remainder.

Attempts expire after ten minutes and require explicit takeover after checking host status. A new attempt invalidates late replies. Reviewed results are cached against input, profile, scope, rule and model identity; changed inputs require a new plan. Restored tasks need fresh execution/review. Neither task completion nor a cache hit approves a resume or submits an application.

### Evidence and limits

On 2026-09-08, two actual Luna medium subagents in Codex Desktop received independent dispatcher packets with six synthetic JDs. Both returned all required rows; the primary agent completed and reviewed them. Missing profile facts stayed unknown. A separate declared-unavailable capability scenario selected the primary-agent fallback. This checks the host path and fallback logic, not an actual model outage or real job-fit quality.

`node --no-warnings scripts/task-benchmark.mjs` compares the same 30 synthetic JDs in three identical batches. Serial and cold parallel scenarios dispatch three workers each; claim round trips are 4 versus 2, including the final empty claim. Warm reviewed cache dispatches zero workers. Worker responses in this benchmark are explicit stubs; timings measure dispatcher overhead only. The live host exercise above is separate.

Per-attempt input/output bytes survive takeover. Host-provided token counts are optional; primary-agent orchestration usage is unavailable here and remains null. Do not equate byte counts, smaller models or parallelism with a measured reduction in total tokens, cost or real application time.

## 简体中文

beta.10 增加宿主管理的只读轻量任务：默认 Luna medium，最多三个工作子 Agent，并受当前宿主容量限制。小任务或宿主不能指定模型时，由主 Agent 接管；不增加模型 API 或密钥。

查找简历先复用已登记文件哈希、确认基线和岗位版本关联。默认索引不返回正文，只给明确选中的资料返回提取文本。目录查找需要适用授权，仅读取当前层，最多 200 个文件、20 MiB，并报告未进入子目录、截断与不可读项；不能称为全盘搜索。原生文本缓存复用，PDF 提取必须绑定哈希和宿主证据，不把附带文字当成 PDF 解析证明。

完整 JD 评估、材料差异、资料提取、公司介绍和独立状态摘要可交给子 Agent。所有结果先作为提案，由主 Agent 复核后经原业务工具落库。推荐项、疑难、硬条件冲突全部检查；其他排除项每批至少抽查一个且不少于 10%，发现错误即复核整批。官网分页和完整 JD 要求保留；共享页面、上传、确认和最终提交不能并发委派。

新增 `jobos1_tasks` 与 `jobos1_material_index`，每日 `next` 可选 `limit=1..3`，旧调用不变。下载额度和评估预算原子预留。执行十分钟后过期，核对状态后显式接管；新 attempt 拒绝迟到结果。缓存绑定输入、画像、作用域、规则和模型；恢复导入后的任务须重新执行与复核。

2026-09-08 已在当前 Codex Desktop 启动两个真实 Luna medium 子 Agent，分别处理调度器的合成输入，6 个岗位结果全部回收并由主 Agent 复核；缺少画像事实保持未知。另用声明不可用的能力场景验证主 Agent 降级，未声称真的发生模型故障或验证真实岗位匹配质量。

合成基准采用相同 30 份 JD、三个相同批次：串行与冷并发各调度三次工作任务，领取往返分别为 4 和 2；热缓存不再调度。基准中的工作结果为明确标注的桩，耗时仅是调度开销；真实宿主验证单独记录。

逐次尝试的字节指标在接管后仍保留。宿主未提供 Token 数据和主 Agent 编排用量时保留未知，不据此报告总 Token、费用或真实投递速度的节省比例。
