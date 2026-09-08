import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, renameSync, statSync, realpathSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, hash, id, now, CONTRACT, equal, Fault } from './core.mjs';
export const defaultHome = () => process.env.JOBOS_NEXT_HOME || path.join(os.homedir(), '.jobos-next');
export class Store {
    constructor(home = defaultHome()) {
        this.home = path.resolve(home);
        mkdirSync(this.home, { recursive: true, mode: 0o700 });
        this.assets = path.join(this.home, 'assets');
        mkdirSync(this.assets, { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(path.join(this.home, 'workspace.sqlite'));
        const existingTables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
        if (existingTables.length) {
            const existingContract = existingTables.includes('meta') ? this.db.prepare("SELECT value FROM meta WHERE key='contract'").get()?.value : null;
            if (existingContract !== CONTRACT)
                this.db.close();
            assert(existingContract === CONTRACT, 'wrong_database', '这个数据库不属于 Coming Jobs，未修改旧库。', '恢复默认 .jobos-next 路径；旧数据只通过只读导入。');
        }
        this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
        value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, entity TEXT NOT NULL,
        digest TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
        const contract = this.db.prepare("SELECT value FROM meta WHERE key='contract'").get()?.value;
        assert(!contract || contract === CONTRACT, 'wrong_database', '这不是 Coming Jobs 数据库。', '使用默认 .jobos-next；旧库只能通过明确导入读取。');
        this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('contract', CONTRACT);
        this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('workspace', id('workspace'));
        this.workspace = this.db.prepare("SELECT value FROM meta WHERE key='workspace'").get().value;
        try {
            chmodSync(this.home, 0o700);
            chmodSync(path.join(this.home, 'workspace.sqlite'), 0o600);
        }
        catch { }
    }
    close() { this.db.close(); }
    get(kind, key, required = true) {
        const row = this.db.prepare('SELECT value,revision FROM records WHERE kind=? AND id=?').get(kind, key);
        assert(row || !required, 'not_found', `找不到 ${kind} 记录。`, '读取当前工作区，不要把申请 ID 当运行 ID。');
        return row ? { ...JSON.parse(row.value), revision: row.revision } : null;
    }
    all(kind) { return this.db.prepare('SELECT value,revision FROM records WHERE kind=? ORDER BY updated_at,id').all(kind).map(r => ({ ...JSON.parse(r.value), revision: r.revision })); }
    put(kind, key, value, expectedRevision) {
        const prior = this.get(kind, key, false);
        if (expectedRevision !== undefined)
            assert((prior?.revision ?? 0) === expectedRevision, 'revision_conflict', '这份数据已经更新。', '只重新读取发生冲突的区域，保留其他已完成区域。');
        const content = { ...value, id: key };
        delete content.revision;
        if (prior) {
            const p = { ...prior };
            delete p.revision;
            if (equal(content, p))
                return prior;
        }
        const rev = (prior?.revision ?? 0) + 1;
        this.db.prepare(`INSERT INTO records VALUES (?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET
      revision=excluded.revision,value=excluded.value,updated_at=excluded.updated_at`).run(kind, key, rev, JSON.stringify(content), now());
        // Audit logs hold no raw values, filenames, URLs, transcripts, or secrets.
        this.db.prepare('INSERT INTO audit(kind,entity,digest,created_at) VALUES (?,?,?,?)').run(kind, key, hash(content), now());
        return { ...content, revision: rev };
    }
    transaction(fn) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            assert(!result?.then, 'async_transaction', '数据库事务不能跨等待。');
            this.db.exec('COMMIT');
            return result;
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
    }
    mutate(name, args, fn) {
        return this.transaction(() => {
            const key = args.request_id ? `${name}:${args.request_id}` : null;
            const digest = hash(args);
            const prior = key ? this.db.prepare('SELECT * FROM requests WHERE key=?').get(key) : null;
            if (prior) {
                assert(prior.digest === digest, 'request_conflict', '同一重试标识对应不同参数。');
                return JSON.parse(prior.result);
            }
            const result = fn();
            if (key)
                this.db.prepare('INSERT INTO requests VALUES (?,?,?)').run(key, digest, JSON.stringify(result));
            return result;
        });
    }
    asset(file, allowedRoot) {
        const resolved = realpathSync(file);
        if (allowedRoot) {
            const root = realpathSync(allowedRoot);
            assert(resolved === root || resolved.startsWith(root + path.sep), 'scope_violation', '文件不在授权目录内。');
        }
        const st = statSync(resolved);
        assert(st.isFile() && st.size <= 100 * 1024 * 1024, 'invalid_file', '文件必须存在且小于100MB。');
        const ext = path.extname(resolved).toLowerCase();
        assert(['.pdf', '.md', '.txt', '.json', '.srt', '.vtt', '.docx', '.png', '.jpg', '.jpeg', '.mp3', '.wav', '.m4a'].includes(ext), 'invalid_file', '不支持此资料格式；不执行上传的程序。');
        const bytes = readFileSync(resolved);
        if (ext === '.pdf')
            assert(bytes.subarray(0, 5).toString() === '%PDF-', 'invalid_pdf', '文件扩展名是 PDF，但文件头不是 PDF。');
        const sha256 = hash(bytes), target = path.join(this.assets, sha256 + ext);
        if (!existsSync(target)) {
            const temp = target + '.' + id('tmp');
            writeFileSync(temp, bytes, { mode: 0o600 });
            renameSync(temp, target);
        }
        return { sha256, relative_path: path.basename(target), name: path.basename(resolved).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'), bytes: bytes.length, format: ext.slice(1) };
    }
    assetPath(asset) {
        assert(asset && /^[a-f0-9]{64}\.[a-z0-9]+$/.test(asset.relative_path), 'invalid_asset', '无效的资料引用。');
        const p = realpathSync(path.join(this.assets, asset.relative_path));
        assert(p.startsWith(realpathSync(this.assets) + path.sep), 'scope_violation', '资料路径逃逸。');
        assert(hash(readFileSync(p)) === asset.sha256, 'asset_changed', '资料字节已变化，需要重新审核。');
        return p;
    }
    /** Give the host a verified upload copy with the user-facing filename, not a hash filename. */
    uploadPath(asset, { materialize = true } = {}) {
        const source = this.assetPath(asset);
        const name = path.basename(asset.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        assert(name && !['.', '..'].includes(name), 'invalid_asset', '附件名称无效。');
        const directory = path.join(this.home, 'uploads', asset.sha256);
        const target = path.join(directory, name);
        if (!materialize && !existsSync(target))
            return null;
        if (materialize)
            mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (materialize && (!existsSync(target) || hash(readFileSync(target)) !== asset.sha256))
            writeFileSync(target, readFileSync(source), { mode: 0o600 });
        assert(hash(readFileSync(target)) === asset.sha256, 'asset_changed', '上传副本字节变化。');
        return target;
    }
    writeExport(name, value) {
        const dir = path.join(this.home, 'exports');
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const target = path.join(dir, name);
        writeFileSync(target, JSON.stringify(value, null, 2), { mode: 0o600 });
        return target;
    }
}
