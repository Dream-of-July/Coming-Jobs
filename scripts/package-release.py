#!/usr/bin/env python3
"""Build a deterministic, allowlisted source test bundle. No private workspace reads."""
from pathlib import Path
import hashlib,json,subprocess,zipfile
root=Path(__file__).resolve().parent.parent
subprocess.run(['node','scripts/check-public.mjs'],cwd=root,check=True)
subprocess.run(['node','scripts/install.mjs','--verify-only'],cwd=root,check=True,stdout=subprocess.DEVNULL)
version=json.loads((root/'plugins/coming-jobs/package.json').read_text())['version']
name='Coming-Jobs-v'+version
out=root/'dist';out.mkdir(exist_ok=True)
archive=out/(name+'.zip')
allowed_dirs={'.agents','.github','docs','plugins','scripts'}
allowed_files={'README.md','README.zh-CN.md','LICENSE','SECURITY.md','CONTRIBUTING.md','CHANGELOG.md','.gitignore','.gitattributes','Install.command','Open Dashboard.command','Run Demo.command'}
files=[]
for p in sorted(root.rglob('*')):
    rel=p.relative_to(root)
    if not (rel.parts[0] in allowed_dirs or len(rel.parts)==1 and rel.name in allowed_files):continue
    if any(part in {'__pycache__','node_modules','.git'} for part in rel.parts):continue
    if p.is_symlink():raise RuntimeError('Release cannot contain symlinks')
    if p.is_file():files.append((p,rel))
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p,rel in files:
        info=zipfile.ZipInfo(name+'/'+rel.as_posix(),(2026,9,8,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=(0o100755 if p.suffix=='.command' else 0o100644)<<16
        z.writestr(info,p.read_bytes())
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
(out/'SHA256SUMS').write_text(checksum+'  '+archive.name+'\n')
print(json.dumps({'archive':archive.name,'sha256':checksum,'files':len(files),'bytes':archive.stat().st_size}))
