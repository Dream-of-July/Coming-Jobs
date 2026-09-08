import { HOST_POLICY } from '../src/policy.mjs';
import { realpathSync, readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../src/core.mjs';
import { defaultHome, Store } from '../src/store.mjs';
/** No transcript reads, no networking, no browser actions, no permission grants. */
export function hook(event, home = defaultHome()) {
    const dir = path.join(home, 'hooks');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = hash(String(event.session_id ?? 'unknown')).slice(0, 32), file = path.join(dir, key + '.json');
    let state = { active: false };
    try {
        state = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch { }
    const save = () => { const temp = file + '.' + process.pid; writeFileSync(temp, JSON.stringify(state), { mode: 0o600 }); renameSync(temp, file); };
    const context = text => ({ hookSpecificOutput: { hookEventName: event.hook_event_name, additionalContext: text } });
    const brief = `Coming Jobs session_id=${JSON.stringify(event.session_id)}，turn_id=${JSON.stringify(event.turn_id ?? 'session-start')}。资料与授权足够就继续；只有人工步骤、决定、暂停或不可恢复阻塞才交接。每一回合结束前保存jobos1_finish与页面保留状态；方向选择可给2至3项，具体人工步骤只交接一个动作。测评不阻塞其他投递。`;
    if (event.hook_event_name === 'SessionStart')
        return context('识别求职意图、今日推荐和已绑定每日任务后读取 jobos1_context；不要求激活口令，不介入无关或插件维护任务。' + HOST_POLICY);
    if (event.hook_event_name === 'UserPromptSubmit') {
        const prompt = String(event.prompt ?? '');
        const maintenance = /(?:优化|重构|审计|实现|实施|修复|修改|维护|升级|调试|测试|记到|加入|写入|implement|optimize|repair|maintain|upgrade).*(?:插件|jobos|coming\s+jobs)|(?:插件|jobos|coming\s+jobs).*(?:工具限制|源码|维护|修复|升级|规则|流程|优化|体验)/i.test(prompt);
        if (maintenance) { state.active = false; state.maintenance = true; state.paused = false; save(); return context(HOST_POLICY + '允许文件编辑和测试。当前为插件维护任务，不执行求职回合交接要求。'); }
        const scheduled = /(?:Coming Jobs|JobOS)\s*每日运行|Coming Jobs daily run/i.test(prompt);
        const named = /coming\s+jobs|jobos|job search|resume|application|career|interview|求职|投递|简历|面试|岗位|建档|今日推荐|今天投哪|开始\s*[A-E]|暂缓\s*[A-E]/i.test(prompt);
        state.scheduled = scheduled;
        const shortReply = prompt.length < 100 && /继续|确认|已完成|已登录|已提交|暂停|先看|第\s*\d|可以|好的|停止|不弄|先到这里|stop|continue/i.test(prompt);
        if (state.maintenance && /^(?:implement|实施|实现|继续)/i.test(prompt.trim()) && !/投递|建档|找岗位/.test(prompt)) return context('继续插件维护，不执行求职收尾。');
        state.maintenance = false;
        state.active = named || (state.active && shortReply);
        state.paused = /^(?:先)?(?:停止|暂停|不弄了|先到这里)(?:[，。！!\s]|$)|^stop\b|今天先到这里|暂停投递|暂停任务/i.test(prompt.trim());
        state.turn_id = event.turn_id;
        state.continued = false;
        save();
        if (scheduled) return context('这是已绑定 Coming Jobs 每日运行。读取 context(scope=daily)，使用 daily 的预算任务续跑；跟进传 background=true；报告保存后无变化静默，不执行材料准备或浏览器写入，不改变前台申请，不要求求职 finish。');
        return state.active ? context(brief + (state.paused ? ' 用户请求暂停，只保存进度并告诉恢复方式，不继续执行。' : '')) : {};
    }
    if (event.hook_event_name === 'PostToolUse' && /jobos1_/.test(event.tool_name ?? '')) {
        if (state.maintenance) return {};
        state.active = true;
        state.turn_id = event.turn_id;
        save();
        return {};
    }
    if (event.hook_event_name === 'Stop') {
        if (state.scheduled || !state.active || state.paused || event.stop_hook_active || state.continued && state.turn_id === event.turn_id)
            return {};
        let turn = null;
        if (existsSync(path.join(home, 'workspace.sqlite'))) {
            const store = new Store(home);
            try {
                turn = store.get('turn', String(event.session_id), false);
            }
            finally {
                store.close();
            }
        }
        const message = String(event.last_assistant_message ?? '');
        const hasGuide = /下一步\s*[:：]|你可以直接回复|Next step\s*:/i.test(message);
        const hasSaved = turn?.turn_id === event.turn_id;
        if (hasSaved && (hasGuide || turn.reason === 'done'))
            return {};
        state.continued = true;
        state.turn_id = event.turn_id;
        save();
        return { decision: 'block', reason: 'Coming Jobs 本轮缺少完整交接。只补齐以下收尾，不新增对外动作，也不要重复提问：保存当前进度到 jobos1_finish；若有未提交页面，使用当前宿主支持的方法续上本轮保留标记；简要说明已完成什么，真正需要人工时给出具体操作和回复短语，只有方向选择时给可选方向；岗位比较保留完整结果，不强迫用户先做测评。不要只说“已完成”，不要宣称任务在后台自动运行。这是一次收尾修正，不得循环自续。' };
    }
    return {};
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const raw = readFileSync(0, 'utf8');
        if (raw.length > 2 * 1024 * 1024)
            throw Error();
        process.stdout.write(JSON.stringify(hook(JSON.parse(raw || '{}'), process.argv.includes('--home') ? process.argv[process.argv.indexOf('--home') + 1] : defaultHome())) + '\n');
    }
    catch {
        process.stdout.write('{}\n');
    }
}
