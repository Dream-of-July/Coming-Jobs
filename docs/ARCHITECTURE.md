# Architecture / 内部结构

| Layer / 层 | Responsibility / 职责 |
| --- | --- |
| Codex Desktop | Conversation, approved browser operations, research and host scheduling / 对话、授权浏览器、检索与调度 |
| Skill | Resume the right workflow and carry user intent / 选择与恢复正确流程 |
| MCP service | Validate tool inputs, consent, facts and state transitions / 校验输入、授权、事实和状态 |
| Private workspace | SQLite records, versioned materials, drafts and scoped experiences / 保存资料、版本、草稿与经验 |
| Host batch adapter | Execute bounded approved fields and return real observations / 执行有限已授权字段并回读 |

The plugin never supplies its own browser login or final-submit capability. Host observations are evidence inputs, not independent server-side verification. A local write-ahead batch survives a lost tool channel; recovery compares the old, target and current value before any repeat write.

插件不提供独立网页登录或最终提交能力。宿主回读属于输入证据，不是服务器端独立验证。通道中断时保留写前记录，恢复先比较原值、目标值和现值。

The directory `plugins/coming-jobs` contains the distribution. Legacy internal names (`jobos_next`, `jobos1_`, `jobos/1`, `JOBOS_NEXT_HOME`, `~/.jobos-next`) remain intentional compatibility boundaries. They do not identify a second active plugin.

`plugins/coming-jobs` 是发布插件；保留旧内部标识用于兼容，不代表同时运行第二个插件。
