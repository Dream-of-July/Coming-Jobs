'use strict';
let token = location.hash.slice(1);
try {
    token ||= sessionStorage.getItem('jobos_local_session');
    if (token) {
        sessionStorage.setItem('jobos_local_session', token);
        history.replaceState(null, '', location.pathname);
    }
}
catch { }
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const factLabel = k => ({ 'intent.tracks': '招聘类型', 'intent.direction': '目标方向', 'intent.locations': '地点范围', 'education.summary': '教育与毕业安排', 'experience.summary': '工作与实习经历', 'project.anchor': '代表项目', 'availability': '到岗安排', 'languages': '工作语言', 'name': '姓名', 'school': '学校', 'project.description': '项目内容' }[k] ?? k);
const stageLabel = k => ({ preparing: '准备中', unknown: '结果待核验', submitted: '已投递', screening: '简历筛选', assessment: '笔试/测评', interview: '面试', offer: 'Offer', rejected: '未通过', withdrawn: '已撤回' }[k] ?? k);
let data, tab = 'overview';
const titles = { overview: '今日工作台', profile: '我的资料', jobs: '岗位推荐', applications: '投递进度', interviews: '面试与复盘', settings: '偏好与跟进' };
function notice(message) { $('#notice').hidden = false; $('#notice').textContent = message; }
async function api(name, args) { const r = await fetch('/api/call', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) }); const result = await r.json(); if (!result.ok)
    throw Error(result.error?.message || result.error || '操作未完成'); return result; }
async function load() { try {
    const r = await fetch('/api/view', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok)
        throw Error('本地工作区未解锁。请从“打开工作台”启动器重新打开，不需要重新建档。');
    data = await r.json();
    render();
}
catch (e) {
    notice(e.message);
    $('#next-title').textContent = '连接尚未建立';
    $('#next-detail').textContent = '运行安装目录里的“打开工作台”，即可重新连接已保存的数据。';
} }
function stat(label, value, note) { return `<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><span>${esc(note)}</span></div>`; }
function render() {
    $('#title').textContent = titles[tab];
    $('#stage').textContent = data.flow.stage;
    $('#next-title').textContent = data.flow.next.owner === 'agent' ? `已准备好继续，由 ${data.host?.name ?? 'Codex'} 完成下一步` : data.flow.options?.length ? '选择你想推进的方向' : '等待你的操作';
    $('#next-detail').textContent = data.flow.next.prompt;
    const panel = $('#panel');
    if (tab === 'overview') {
        const m = data.metrics, c = data.coverage;
        panel.innerHTML = `<div class="stats">${stat('已选岗位', m.selected, '不含模拟')}${stat('已观察到投递', m.portal_observed_submitted, '另有 ' + m.user_reported_submitted + ' 份用户自述')}${stat('进入面试', m.interviewed, '曾进入面试的申请')}${stat('面试转化率', m.interview_rate === null ? '—' : (m.interview_rate * 100).toFixed(0) + '%', '以门户已观察申请为分母')}</div><div class="grid"><section class="card"><div class="card-title"><h2>最近的投递</h2><span class="small">保留每份简历版本</span></div>${applicationRows(data.applications.slice(-4))}</section><section class="card"><div class="card-title"><h2>你的求职资料</h2><span class="number">${c.percent}%</span></div><progress class="progress" max="100" value="${Number(c.percent)}"></progress><p class="small">这是基础资料覆盖率，不是对你的了解程度。</p>${c.items.slice(0, 6).map(i => `<div class="row"><span>${esc(i.label)}</span><span class="small">${i.complete ? '已确认' : '待补充'}</span></div>`).join('')}<p class="small">已回答 ${c.answered} 个问题，可以随时暂停。</p></section></div>`;
    }
    else if (tab === 'profile') {
        panel.innerHTML = `<div class="card"><h2>持续积累，不重复建档</h2><p class="small">这里的更正会保存到本地。未来材料使用新资料，已投递历史不会被改写。</p><div class="actions"><button id="pause-profile" class="secondary">${data.coverage.paused ? '继续建档' : '暂停访谈'}</button><button id="recommend-now">先看推荐岗位</button></div></div><h2>已确认资料 · ${data.facts.length}</h2><div class="facts">${data.facts.map(f => `<article class="card fact"><div class="body"><h3>${esc(factLabel(f.key))}</h3><pre>${esc(Array.isArray(f.value) ? f.value.join('、') : f.value)}</pre><span class="small">${esc(f.scope)} · ${esc(f.purposes.join(' / '))}</span></div><button class="secondary edit-fact" data-id="${esc(f.id)}">更正</button></article>`).join('') || '<div class="card empty">还没有资料。回到 Codex 上传简历，或直接回答第一个问题即可。</div>'}</div><h2>待核对内容 · ${data.proposals.length}</h2>${data.proposals.map(p => `<div class="card row"><div><h3>${esc(factLabel(p.key))}</h3><p>${esc(p.value)}</p></div><button class="confirm-proposal" data-id="${esc(p.id)}">确认这一项</button></div>`).join('')}`;
        $('#pause-profile').onclick = async () => act('jobos1_profile', { operation: data.coverage.paused ? 'resume' : 'pause' });
        $('#recommend-now').onclick = async () => act('jobos1_profile', { operation: 'recommend' });
        document.querySelectorAll('.edit-fact').forEach(b => b.onclick = () => edit(data.facts.find(f => f.id === b.dataset.id)));
        document.querySelectorAll('.confirm-proposal').forEach(b => b.onclick = () => act('jobos1_profile', { operation: 'confirm', proposal_ids: [b.dataset.id], confirmed: true, user_ref: '用户在本地看板确认这一项' }));
    }
    else if (tab === 'jobs') {
        const batch = data.batches.at(-1);
        panel.innerHTML = `<p class="small">${esc(batch?.coverage ?? '先由 Codex 核验完整 JD，再生成推荐。')}。匹配分不是录用概率。</p><div class="jobs">${(batch?.items ?? []).map(j => `<article class="card"><div class="job-head"><input aria-label="选择第 ${j.number} 个岗位" class="job-check" type="checkbox" value="${j.number}"><label><span class="small">${j.number} · ${esc(j.company)}</span><h2>${esc(j.title)}</h2></label><span class="score">${j.score}</span></div><div class="job-detail"><p>${esc(j.reason)}</p><p><b>优势</b> ${esc(j.advantages.join('；'))}</p><p><b>潜在风险</b> ${esc((j.risks ?? j.gaps).join('；') || '尚待核验')}</p><span class="pill">${esc(j.source)}</span><span class="pill">资格 ${esc(j.eligibility)}</span></div><div class="actions"><button class="secondary save-job" data-id="${esc(j.job_id)}">收藏</button><button class="secondary reject-job" data-id="${esc(j.job_id)}">不感兴趣</button></div></article>`).join('') || '<div class="card empty">还没有推荐。复制上方下一步到 Codex，开始发现岗位。</div>'}</div>${batch?.items.length ? '<div class="actions"><button id="choose-jobs">准备选中的岗位 →</button></div>' : ''}`;
        if ($('#choose-jobs'))
            $('#choose-jobs').onclick = () => { const numbers = [...document.querySelectorAll('.job-check:checked')].map(x => +x.value); if (!numbers.length)
                return notice('先勾选要投的岗位。'); act('jobos1_shortlist', { operation: 'choose', batch_id: batch.id, numbers, confirmed: true, user_ref: '用户在本地看板选择岗位' }); };
        for (const [cls, decision] of [['save-job', 'save'], ['reject-job', 'reject']])
            document.querySelectorAll('.' + cls).forEach(b => b.onclick = () => act('jobos1_shortlist', { operation: 'feedback', job_id: b.dataset.id, decision, confirmed: true, user_ref: '用户在本地看板选择' + decision }));
    }
    else if (tab === 'applications') {
        panel.innerHTML = `<div class="card"><h2>全部申请，不按连接器能力过滤</h2><p class="small">未配置连接器 ≠ 没有申请。结果未知时只核验，不重复投递。</p>${applicationRows(data.applications)}</div>`;
    }
    else if (tab === 'interviews') {
        panel.innerHTML = `<div class="grid"><div class="card"><h2>面试准备</h2><p>准备依据是当时实际提交的简历、岗位和答案，而不是最新基础简历。</p>${applicationRows(data.applications.filter(a => ['interview', 'assessment'].includes(a.stage)))}</div><div class="card"><h2>把面试变成下一次的积累</h2><p class="small">在 Codex 中上传授权的录音转写。引用核对后保存复盘；新经历先待确认，不自动进入简历。</p><button id="copy-interview">复制复盘指令</button></div></div>`;
        $('#copy-interview').onclick = () => copy('使用 Coming Jobs，为选中的申请分析这份面试转写，给出有原文依据的复盘和下一次练习；新经历先待我确认。');
    }
    else if (tab === 'settings') {
        const p = data.preferences ?? {}, s = data.schedule;
        panel.innerHTML = `<div class="grid"><div class="card"><h2>简历与时区</h2><label class="setting">默认模板<select id="template"><option value="classic">经典设计 · 原 Figma</option><option value="projects">项目精选</option><option value="clean">专业简约</option></select></label><label class="setting">时区<input id="timezone" value="${esc(p.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}"></label><button id="save-settings">保存偏好</button></div><div class="card"><h2>只读跟进</h2><p>状态：${esc(({host_reported_active:'已绑定宿主调度',planned:'计划已保存，待启用',update_required:'安排已改，待更新调度',paused:'已暂停',failed:'执行失败',needs_rebind:'待重新绑定'})[s?.state] ?? '尚未设置')}</p><p class="small">范围固定为全部已投递申请；无变化保持安静。保存计划不等于宿主已经创建任务。</p><p class="small">${esc(s?.timezone ?? '')} ${esc(s?.times?.join('、') ?? '')}</p><p class="small">登录、验证码、短信权限由宿主与用户处理；不自动回复、不代做测评。</p><button id="copy-followup">设置或更新每日跟进</button></div></div>`;
        $('#template').value = p.template ?? 'projects';
        $('#save-settings').onclick = () => act('jobos1_profile', { operation: 'preferences', preferences: { template: $('#template').value, timezone: $('#timezone').value }, confirmed: true, user_ref: '用户在本地看板保存偏好' });
        $('#copy-followup').onclick = () => copy('使用 Coming Jobs，设置或更新同一份全部申请只读跟进任务，检查门户和相关邮件短信，无变化保持安静。先读取已有时间安排，不重复创建任务。');
    }
    document.querySelectorAll('.open-resume').forEach(b => b.onclick = async () => { const r = await fetch('/api/asset?sha=' + b.dataset.sha, { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok)
        return notice('文件不可用，请在 Codex 中检查实际材料。'); const u = URL.createObjectURL(await r.blob()); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000); });
}
function applicationRows(apps) { return apps.length ? apps.map(a => `<div class="row"><div><h3>${esc(a.company)} · ${esc(a.title)}</h3><p>${a.mode === 'demo' ? '演练，不是真实投递 · ' : ''}${esc(({portal_observed:'官网已核验',user_reported:'用户报告，待官网核验'})[a.submission_evidence] ?? '尚未核验提交')} · ${esc(a.last_observation_at ?? '暂无核验时间')}</p>${a.submitted_material?.resume?.asset ? `<button class="secondary open-resume" data-sha="${esc(a.submitted_material.resume.asset.sha256)}">查看实际投递简历</button>` : ''}<details><summary>查看记录</summary><div class="detail-text">${esc((a.review?.checks ?? []).map(c=>c.label+'：'+(c.passed?'已检查':'待检查')).join('；') || '暂无填写检查记录')}${a.attention === 'evidence_conflict' ? '；状态证据存在冲突，待核验' : ''}</div></details></div><span class="number">${esc(stageLabel(a.stage))}</span></div>`).join('') : '<p class="empty">这里会保留你投递的每一个岗位。先选岗位，之后从这里持续跟进。</p>'; }
async function act(name, args) { try {
    await api(name, args);
    notice('已保存。下一步提示已经更新。');
    await load();
}
catch (e) {
    notice(e.message);
} }
function edit(f) { $('#editor-title').textContent = '更正 · ' + factLabel(f.key); $('#editor-help').textContent = '只更新未来使用的资料，不改写历史投递。'; $('#editor-value').value = Array.isArray(f.value) ? JSON.stringify(f.value, null, 2) : String(f.value); $('#editor').showModal(); $('#editor-save').onclick = async () => { let value = $('#editor-value').value; try {
    if (Array.isArray(f.value))
        value = JSON.parse(value);
    await api('jobos1_remember', { mode: 'user_statement', facts: [{ key: f.key, value, scope: f.scope, purposes: f.purposes }], confirmed: true, user_ref: '用户在本地看板更正资料' });
    $('#editor').close();
    await load();
}
catch (e) {
    notice(e.message);
} }; }
async function copy(text) { try {
    await navigator.clipboard.writeText(text);
    notice('已复制。回到 Codex 粘贴这句话，即可从当前进度继续。');
}
catch {
    notice('回到 Codex 发送：' + text);
} }
$('#next-button').onclick = () => copy('使用 Coming Jobs，从上次进度继续。' + (data?.flow?.next?.reply ?? data?.flow?.next?.prompt ?? '读取我的下一步。'));
$('#refresh').onclick = load;
document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b)); if (data)
    render(); });
load();
