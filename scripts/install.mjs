#!/usr/bin/env node
import { realpathSync, cpSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const plugin = path.join(packageRoot, 'plugins', 'coming-jobs');
const manifest = JSON.parse(readFileSync(path.join(plugin, '.codex-plugin/plugin.json'), 'utf8'));
export function verify(root = plugin) {
    const release = JSON.parse(readFileSync(path.join(root, 'release.json'), 'utf8'));
    for (const [relative, wanted] of Object.entries(release.files)) {
        const actual = createHash('sha256').update(readFileSync(path.join(root, relative))).digest('hex');
        if (actual !== wanted)
            throw Error(`安装文件校验失败：${relative}。请重新解压原始安装包。`);
    }
    return release;
}
function atomic(file, text) {
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.jobos-tmp';
    writeFileSync(temp, text, { mode: 0o600 });
    renameSync(temp, file);
}
export function disableLegacy(text) {
    // Narrowly scoped edits. Never delete caches, databases, tokens or other plugins.
    let changed = 0;
    const chunks = text.split(/(?=^\[(?!\[))/m);
    const result = chunks.map(chunk => {
        const header = chunk.split(/\r?\n/)[0];
        const oldPlugin = /^\[plugins\.(?:"(?:jobos-recruiting|jobos-next)(?:@[^"\]]+)?"|jobos-recruiting|jobos-next)\]\s*(?:#.*)?$/.test(header);
        const oldServer = /^\[mcp_servers\.(?:"jobos"|jobos)\]\s*(?:#.*)?$/.test(header) && /jobos/i.test(chunk);
        if (!oldPlugin && !oldServer)
            return chunk;
        if (/^enabled\s*=\s*false\b/m.test(chunk))
            return chunk;
        changed++;
        if (/^enabled\s*=/m.test(chunk))
            return chunk.replace(/^enabled\s*=.*$/m, 'enabled = false # disabled by Coming Jobs installer; original config backed up');
        return chunk.replace(/^(\[[^\r\n]+\][^\r\n]*)(?:\r?\n|$)/, '$1\nenabled = false # superseded by Coming Jobs\n');
    }).join('');
    return { text: result, changed };
}
function cliCandidates(home) {
    return [process.env.JOBOS_CODEX_BIN, 'codex', path.join(home, '.npm-global/bin/codex'), path.join(home, '.local/bin/codex'), '/Applications/Codex.app/Contents/Resources/codex', '/Applications/ChatGPT.app/Contents/Resources/codex'].filter(Boolean);
}
/** Replace only this plugin's known local release source; restore it if adding fails. */
export function registerMarketplace(cli, dest, home, backups, run = spawnSync) {
    const options = { encoding:'utf8', timeout:20000, env:{...process.env,CODEX_HOME:path.join(dest,'.host-registry/codex')} };
    const execute = args => run(cli, ['plugin','marketplace',...args], options);
    const listing = execute(['list','--json']);
    if (listing.status !== 0) return { ok:false, state:'marketplace_unavailable' };
    let existing;
    try { existing = JSON.parse(listing.stdout).marketplaces.find(m=>m.name==='coming-jobs'); }
    catch { return { ok:false, state:'marketplace_unavailable' }; }
    if (existing?.root === dest) return {ok:true,state:'marketplace_registered'};
    if (existing) {
        const releases = path.join(home,'.local/share/coming-jobs/releases') + path.sep;
        if (existing.marketplaceSource?.sourceType !== 'local' || !existing.root.startsWith(releases))
            return {ok:false,state:'marketplace_source_conflict'};
        atomic(path.join(backups,'jobos-marketplace-source.json'),JSON.stringify(existing,null,2));
        if (execute(['remove','coming-jobs','--json']).status !== 0) return {ok:false,state:'marketplace_update_failed'};
    }
    if (execute(['add',dest,'--json']).status === 0) return {ok:true,state:'marketplace_registered'};
    const restored = existing ? execute(['add',existing.root,'--json']).status === 0 : true;
    return {ok:false,state:restored?'marketplace_update_failed':'marketplace_restore_required'};
}
function installCodex({ home = os.homedir(), skipCli = false } = {}) {
    const major = Number(process.versions.node.split('.')[0]), minor = Number(process.versions.node.split('.')[1]);
    if (major < 22 || major === 22 && minor < 13)
        throw Error('需要 Node.js 22.13 或更新版本；没有自动下载、sudo 或修改系统安全设置。');
    const release = verify();
    const dest = path.join(home, '.local/share/coming-jobs/releases', manifest.version);
    const installedPlugin = path.join(dest, 'plugins/coming-jobs');
    const backups = path.join(home, '.local/share/coming-jobs/install-backups', String(Date.now()));
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    if (existsSync(path.join(installedPlugin, 'release.json'))) {
        const prior = JSON.parse(readFileSync(path.join(installedPlugin, 'release.json'), 'utf8'));
        if (prior.build !== release.build)
            throw Error('相同版本目录里出现不同构建。未覆盖；请使用新版本号发布。');
        verify(installedPlugin);
    }
    else {
        mkdirSync(dest, { recursive: true });
        cpSync(packageRoot, dest, { recursive: true, filter: source => !['.git','node_modules','dist','output','private-backups'].includes(path.basename(source)) });
    }
    const dataHome = path.join(home, '.jobos-next');
    const serverConfig = { jobos_next: { command: process.execPath, args: ['--no-warnings', path.join(installedPlugin, 'src/mcp.mjs')], cwd: installedPlugin,
            env: { JOBOS_NEXT_HOME: dataHome, JOBOS_HOST: 'codex' }, tool_timeout_sec: 90 } };
    atomic(path.join(installedPlugin, '.mcp.json'), JSON.stringify(serverConfig, null, 2));
    const hooks = JSON.parse(readFileSync(path.join(plugin, 'hooks/hooks.json'), 'utf8'));
    for (const entries of Object.values(hooks.hooks))
        for (const entry of entries)
            for (const handler of entry.hooks)
                handler.command = `"${process.execPath}" --no-warnings "${path.join(installedPlugin, 'hooks/lifecycle.mjs')}" --home "${dataHome}"`;
    atomic(path.join(installedPlugin, 'hooks/hooks.json'), JSON.stringify(hooks, null, 2));
    const settings = path.join(home, '.codex/config.toml');
    const disabled = 0;
    // Read only: neither this installer nor its CLI commands may change user host settings.
    const hookTrust = existsSync(settings) ? (/hooks[\s\S]{0,500}enabled\s*=\s*false/.test(readFileSync(settings,'utf8')) ? 'disabled' : 'verify_in_host') : 'not_configured';
    let state = 'files_deployed', cli = null;
    if (!skipCli)
        cli = cliCandidates(home).find(cmd => {
            const r = spawnSync(cmd, ['plugin', '--help'], { encoding: 'utf8', timeout: 10000 });
            return r.status === 0 && /marketplace/.test(r.stdout ?? '');
        });
    if (cli) {
        mkdirSync(path.join(dest,'.host-registry/codex'),{recursive:true,mode:0o700});
        const registration = registerMarketplace(cli,dest,home,backups);
        state = registration.state;
        if (registration.ok) {
            const r = spawnSync(cli, ['plugin','add','coming-jobs@coming-jobs','--json'], {encoding:'utf8',timeout:30000,env:{...process.env,CODEX_HOME:path.join(dest,'.host-registry/codex')}});
            if (r.status === 0) state = 'cli_registry_ready';
        }
    }
    if (state === 'files_deployed') {
        const marketFile = path.join(home, '.agents/plugins/marketplace.json');
        let market = { name: 'personal', interface: { displayName: '个人插件' }, plugins: [] };
        if (existsSync(marketFile)) {
            market = JSON.parse(readFileSync(marketFile, 'utf8'));
            cpSync(marketFile, path.join(backups, 'marketplace.json'));
        }
        if (!Array.isArray(market.plugins))
            throw Error('个人插件来源格式不支持，未覆盖原文件。');
        const relative = './' + path.relative(home, installedPlugin).split(path.sep).join('/');
        market.plugins = market.plugins.filter(x => x.name !== 'coming-jobs');
        market.plugins.push({ name: 'coming-jobs', source: { source: 'local', path: relative }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' });
        atomic(marketFile, JSON.stringify(market, null, 2));
        state = 'personal_marketplace_ready';
    }
    const result = { version: manifest.version, build: release.build, state, disabled_legacy_sections: disabled, installed_path: installedPlugin,
        hook_trust:hookTrust, registration_scope:'isolated_registry', data_home: dataHome, old_data_deleted: false, backup_directory: backups,
        next: `文件已就绪；用户 config.toml 未修改。按宿主插件管理器添加来源 ${dest} 并启用 Coming Jobs、审核 hooks 后重启；隔离 CLI 登记不等于当前宿主已启用。以新会话 context 的版本与 build 为准。` };
    atomic(path.join(dest, 'install-result.json'), JSON.stringify(result, null, 2));
    return result;
}

/** Registration uses local scope in the installed release; never user settings. */
export function registerClaudeMarketplace(cli, dest, home, backups, run = spawnSync) {
 const options={encoding:'utf8',timeout:20000,cwd:dest,env:{...process.env,CLAUDE_CONFIG_DIR:path.join(home,'.local/share/coming-jobs/claude-host-registry')}};
 const exec=args=>run(cli,['plugin','marketplace',...args],options);
 const listed=exec(['list','--json']);if(listed.status!==0)return {ok:false,state:'marketplace_unavailable'};
 let existing;try { const data=JSON.parse(listed.stdout);existing=(Array.isArray(data)?data:data.marketplaces).find(m=>m.name==='coming-jobs'); } catch{return {ok:false,state:'marketplace_unavailable'};}
 const prior=existing?.source?.path ?? existing?.source?.url ?? existing?.installLocation;
 if (prior===dest) return {ok:true,state:'marketplace_registered'};
 if(existing){
  const allowed=path.join(home,'.local/share/coming-jobs/claude-releases')+path.sep;
  if(existing.source?.source!=='directory'||!prior?.startsWith(allowed))return {ok:false,state:'marketplace_source_conflict'};
  atomic(path.join(backups,'claude-marketplace-source.json'),JSON.stringify(existing,null,2));
  if(exec(['remove','coming-jobs']).status!==0)return {ok:false,state:'marketplace_update_failed'};
 }
 if(exec(['add',dest,'--scope','local']).status===0)return {ok:true,state:'marketplace_registered'};
 const restored=existing?exec(['add',prior,'--scope','local']).status===0:true;
 return {ok:false,state:restored?'marketplace_update_failed':'marketplace_restore_required'};
}
export function installClaude({home=os.homedir(),skipCli=false}={}) {
 const release=verify(),dest=path.join(home,'.local/share/coming-jobs/claude-releases',manifest.version),installedPlugin=path.join(dest,'plugins/coming-jobs');
 const backups=path.join(home,'.local/share/coming-jobs/install-backups','claude-'+Date.now());mkdirSync(backups,{recursive:true,mode:0o700});
 if(existsSync(path.join(installedPlugin,'release.json'))){const prior=JSON.parse(readFileSync(path.join(installedPlugin,'release.json'),'utf8'));if(prior.build!==release.build)throw Error('相同版本出现不同 Claude 构建，未覆盖。');verify(installedPlugin);}
 else {mkdirSync(dest,{recursive:true});cpSync(packageRoot,dest,{recursive:true,filter:s=>!['.git','node_modules','dist','output','private-backups'].includes(path.basename(s))});}
 const dataHome=path.join(home,'.jobos-next');
 atomic(path.join(installedPlugin,'.mcp.json'),JSON.stringify({mcpServers:{jobos_next:{command:process.execPath,args:['--no-warnings',path.join(installedPlugin,'src/mcp.mjs')],env:{JOBOS_NEXT_HOME:dataHome,JOBOS_HOST:'claude'}}}},null,2));
 const hooks=JSON.parse(readFileSync(path.join(plugin,'hooks/hooks.json'),'utf8'));delete hooks.description;
 for(const entries of Object.values(hooks.hooks)) for(const entry of entries) for(const handler of entry.hooks) handler.command=`"${process.execPath}" --no-warnings "${path.join(installedPlugin,'hooks/lifecycle.mjs')}" --home "${dataHome}" --host claude`;
 atomic(path.join(installedPlugin,'hooks/hooks.json'),JSON.stringify(hooks,null,2));
 atomic(path.join(dest,'.claude-plugin/marketplace.json'),JSON.stringify({name:'coming-jobs',owner:{name:'Dream-of-July'},plugins:[{name:'coming-jobs',source:'./plugins/coming-jobs'}]},null,2));
 let state='files_deployed';
 const cli=skipCli?null:[process.env.JOBOS_CLAUDE_BIN,'claude',path.join(home,'.local/bin/claude')].filter(Boolean).find(cmd=>spawnSync(cmd,['plugin','--help'],{encoding:'utf8',timeout:10000}).status===0);
 if(cli){const result=registerClaudeMarketplace(cli,dest,home,backups);state=result.state;if(result.ok){const out=spawnSync(cli,['plugin','install','coming-jobs@coming-jobs','--scope','local'],{cwd:dest,encoding:'utf8',timeout:30000,env:{...process.env,CLAUDE_CONFIG_DIR:path.join(home,'.local/share/coming-jobs/claude-host-registry')}});if(out.status===0)state='cli_registry_ready';}}
 return {version:manifest.version,build:release.build,state,installed_path:installedPlugin,data_home:dataHome,backup_directory:backups,registration_scope:'isolated_registry',old_data_deleted:false,
 next:`Claude 文件已就绪。未改用户 settings.json。可先用 claude --plugin-dir "${installedPlugin}" 启动；或在 /plugin 中手动添加本地 marketplace "${dest}" 并启用 coming-jobs。登录、验证码和文件拖入按集中检查点处理。`};
}
export function install({home=os.homedir(),skipCli=false,host='codex'}={}) {
 if(!['codex','claude','both','auto'].includes(host))throw Error('--host 必须为 codex、claude、both 或 auto。');
 if(host==='auto'){const available=['codex','claude'].filter(c=>spawnSync(c,['--version'],{encoding:'utf8',timeout:10000}).status===0);host=available.length===2?'both':available[0]??'codex';}
 const hosts={};if(host==='codex'||host==='both')hosts.codex=installCodex({home,skipCli});if(host==='claude'||host==='both')hosts.claude=installClaude({home,skipCli});
 return {...(hosts.codex??hosts.claude),hosts};
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2), i = args.indexOf('--home');
    try {
        const result = args.includes('--verify-only') ? verify() : install({ home: i >= 0 ? args[i + 1] : os.homedir(), skipCli: args.includes('--skip-cli'), host: args.includes('--host') ? args[args.indexOf('--host')+1] : 'codex' });
        console.log(JSON.stringify(result, null, 2));
    }
    catch (e) {
        console.error('安装未完成：' + e.message);
        process.exitCode = 1;
    }
}
