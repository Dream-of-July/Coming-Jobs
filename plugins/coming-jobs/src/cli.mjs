import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from './store.mjs';
import { call } from './service.mjs';
import { TOOLS } from './catalog.mjs';
import { startDashboard } from './web.mjs';
import { convertLegacy } from './workspace.mjs';
import { VERSION, CONTRACT, buildId } from './core.mjs';
const args = process.argv.slice(2), command = args[0] ?? 'context';
if (command === 'schemas') {
    console.log(JSON.stringify(TOOLS, null, 2));
    process.exit(0);
}
if (command === 'convert-legacy') {
    try {
        const output = convertLegacy(args[1]);
        writeFileSync(args[2] ?? 'jobos-transfer.json', JSON.stringify(output, null, 2), { mode: 0o600 });
        console.log('已只读转换。输出含私人资料；下一步在 Coming Jobs 中导入该文件。');
    }
    catch (e) {
        console.error(e.message);
        process.exitCode = 1;
    }
}
else {
    const store = new Store();
    if (command === 'dashboard') {
        const d = await startDashboard(store);
        console.log(d.url);
        const close = () => { d.server.close(); store.close(); process.exit(0); };
        process.on('SIGINT', close);
        process.on('SIGTERM', close);
    }
    else {
        try {
            let result;
            if (command === 'call') {
                const input = JSON.parse(readFileSync(args[2] ?? 0, 'utf8'));
                result = call(store, args[1], input);
            }
            else
                result = call(store, 'jobos1_context', {});
            console.log(JSON.stringify(result, null, 2));
            if (!result.ok)
                process.exitCode = 1;
        }
        finally {
            store.close();
        }
    }
}
