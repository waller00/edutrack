#!/usr/bin/env bash
set -euo pipefail

AUDIT_SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_REPO_ROOT="$(git -C "$AUDIT_SOURCE_DIR" rev-parse --show-toplevel)"
AUDIT_TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/edutrack-audit.XXXXXXXX")"
export AUDIT_SOURCE_DIR AUDIT_REPO_ROOT AUDIT_TEMP_ROOT

python3 - <<'PY'
import os, pathlib, shutil, subprocess
root = pathlib.Path(os.environ['AUDIT_REPO_ROOT'])
destination = pathlib.Path(os.environ['AUDIT_TEMP_ROOT'])
files = subprocess.check_output(['git', 'ls-files', '-z', 'backend'], cwd=root).decode().split('\0')
for name in filter(None, files):
    source = root / name
    if not source.is_file() or source.name == '.env' or source.name.startswith('.env.'):
        continue
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
shutil.copytree(pathlib.Path(os.environ['AUDIT_SOURCE_DIR']) / 'reproductions',
                destination / 'backend/src/security-audit', dirs_exist_ok=True)
print(f'Entorno temporal: {destination}')
PY

cd "$AUDIT_TEMP_ROOT/backend"
npm ci --ignore-scripts --no-audit --no-fund --cache "$AUDIT_TEMP_ROOT/npm-cache"
./node_modules/.bin/prisma generate
npm test -- src/security-audit --reporter=json --outputFile="$AUDIT_TEMP_ROOT/reproductions.json"
