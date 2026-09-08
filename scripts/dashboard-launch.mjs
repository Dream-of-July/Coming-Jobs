import { Store } from '../plugins/coming-jobs/src/store.mjs';
import { startDashboard } from '../plugins/coming-jobs/src/web.mjs';
import { spawn } from 'node:child_process';
const store = new Store();
const d = await startDashboard(store);
console.log('工作台仅在本机运行。保持这个窗口打开；数据会持续保存。\n' + d.url);
if (process.platform === 'darwin')
    spawn('open', [d.url], { stdio: 'ignore' });
else if (process.platform === 'win32')
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', d.url], { stdio: 'ignore' });
else
    spawn('xdg-open', [d.url], { stdio: 'ignore' }).on('error', () => { });
process.on('SIGINT', () => { d.server.close(); store.close(); process.exit(0); });
