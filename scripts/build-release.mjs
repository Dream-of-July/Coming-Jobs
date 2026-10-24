#!/usr/bin/env node
/** Rebuild metadata from the same tool registry used by the running MCP. No network. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { VERSION } from '../plugins/coming-jobs/src/core.mjs';
import { TOOLS } from '../plugins/coming-jobs/src/catalog.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const plugin = path.join(root, 'plugins/coming-jobs');
const versions = ['package.json','.codex-plugin/plugin.json','.claude-plugin/plugin.json'].map(f => JSON.parse(readFileSync(path.join(plugin,f),'utf8')).version);
if (!versions.every(v => v === VERSION)) throw Error('Package, Codex, Claude and runtime versions must agree before building the fifth release version.');
writeFileSync(path.join(plugin, 'docs/tool-schemas.json'), JSON.stringify(TOOLS, null, 2) + '\n');
const excludes = new Set(['release.json', '.mcp.json', 'hooks/hooks.json']);
const files = {};
function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            walk(full);
        else if (entry.isFile()) {
            const rel = path.relative(plugin, full).split(path.sep).join('/');
            if (!excludes.has(rel))
                files[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
        }
    }
}
walk(plugin);
const build = createHash('sha256').update(JSON.stringify(files)).digest('hex');
const version = JSON.parse(readFileSync(path.join(plugin, '.codex-plugin/plugin.json'), 'utf8')).version;
writeFileSync(path.join(plugin, 'release.json'), JSON.stringify({ version, contract: 'jobos/1', build, files,
    mutable_host_configuration: ['.mcp.json', 'hooks/hooks.json'], note: 'Integrity metadata, not a cryptographic signature. Installer rewrites only declared host configuration.' }, null, 2) + '\n');
console.log(JSON.stringify({ version, build, files: Object.keys(files).length, tools: TOOLS.length }));
