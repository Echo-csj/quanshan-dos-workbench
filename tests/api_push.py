#!/usr/bin/env python3
"""api_push.py — 通过 GitHub Git Data API 精确复刻本地提交并推送（绕过 github.com 直连限制）
用法：python3 api_push.py <本地提交SHA> <远端分支>
原理：blob/tree/commit 对象内容由内容完全决定。按本地提交的原始 author/committer/
message 在服务端重建对象，若逐级 SHA 一致，则最终 commit SHA 与本地完全相同，
本地仓库无需任何后续同步。"""
import base64
import json
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = 'Echo-csj/quanshan-dos-workbench'
API = 'https://api.github.com'

def git(*args):
    return subprocess.run(['git'] + list(args), capture_output=True, text=True, check=True).stdout

def api_call(method, path, token, payload=None):
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('Content-Type', 'application/json')
    req.add_header('User-Agent', 'api-push-script')
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode('utf-8'))

def get_token():
    out = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
                         capture_output=True, text=True, check=True).stdout
    for line in out.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1]
    raise RuntimeError('未取到凭证')

def main():
    local_sha = sys.argv[1] if len(sys.argv) > 1 else None
    branch = sys.argv[2] if len(sys.argv) > 2 else 'main'
    if not local_sha:
        print('用法: api_push.py <commit_sha> [branch]'); sys.exit(2)
    local_sha = git('rev-parse', local_sha).strip()
    token = get_token()

    # 0. 远端分支当前指向
    ref = api_call('GET', f'/repos/{REPO}/git/ref/heads/{branch}', token)
    remote_head = ref['object']['sha']
    parent = git('rev-parse', local_sha + '^').strip()
    print(f'远端 {branch} = {remote_head[:10]}，本地提交父 = {parent[:10]}')
    if remote_head != parent:
        print('!! 远端不是本地提交的父，拒绝继续（非快进）'); sys.exit(1)

    # 1. 提交涉及的文件（相对父提交的变更）
    files = []
    for line in git('diff-tree', '--no-commit-id', '--name-status', '-r', local_sha).splitlines():
        parts = line.split('\t')
        status, path = parts[0], parts[-1]
        if status.startswith('D'):
            files.append({'path': path, 'delete': True})
        else:
            files.append({'path': path, 'delete': False})
    print(f'变更文件 {len(files)} 个: ' + ', '.join(f["path"] for f in files))

    # 2. 逐文件创建 blob（校验 SHA 与本地一致）
    tree_entries = []
    for f in files:
        if f['delete']:
            tree_entries.append({'path': f['path'], 'mode': '100644', 'type': 'blob', 'sha': None})  # 稀疏树不直接支持删除，走 tree 遍历剔除
            print(f'  跳过删除路径（本仓库当前无删除场景）: {f["path"]}')
            continue
        raw = open(f['path'], 'rb').read()
        b = api_call('POST', f'/repos/{REPO}/git/blobs', token,
                     {'content': base64.b64encode(raw).decode('ascii'), 'encoding': 'base64'})
        local_blob = git('hash-object', f['path']).strip()
        ok = '✓' if b['sha'] == local_blob else '✗'
        print(f'  {ok} blob {f["path"]} -> {b["sha"][:10]} (本地 {local_blob[:10]})')
        if b['sha'] != local_blob:
            print('!! blob SHA 不一致，中止'); sys.exit(1)
        tree_entries.append({'path': f['path'], 'mode': '100644', 'type': 'blob', 'sha': b['sha']})

    # 3. 创建 tree（base = 远端 HEAD 的 tree）
    base_tree = git('rev-parse', remote_head + '^{tree}').strip()
    t = api_call('POST', f'/repos/{REPO}/git/trees', token,
                 {'base_tree': base_tree, 'tree': [e for e in tree_entries if e.get('sha')]})
    local_tree = git('rev-parse', local_sha + '^{tree}').strip()
    ok = '✓' if t['sha'] == local_tree else '✗'
    print(f'{ok} tree -> {t["sha"][:10]} (本地 {local_tree[:10]})')
    if t['sha'] != local_tree:
        print('!! tree SHA 不一致，中止'); sys.exit(1)

    # 4. 从本地提交原始对象解析 author/committer/message
    raw_commit = git('cat-file', 'commit', local_sha)
    m = re.search(r'^author (.+) <(.+)> (\d+) ([+-]\d{4})$', raw_commit, re.M)
    author = {'name': m.group(1), 'email': m.group(2)}
    ts = int(m.group(3)); tz = m.group(4)
    iso = datetime.fromtimestamp(ts, timezone(timedelta(hours=int(tz[:3]), minutes=int(tz[0] + tz[3:])))).isoformat()
    author['date'] = iso
    m2 = re.search(r'^committer (.+) <(.+)> (\d+) ([+-]\d{4})$', raw_commit, re.M)
    committer = {'name': m2.group(1), 'email': m2.group(2), 'date': iso}
    message = raw_commit.split('\n\n', 1)[1]  # 含结尾换行（git 规范化后的原文）

    c = api_call('POST', f'/repos/{REPO}/git/commits', token,
                 {'message': message, 'tree': t['sha'], 'parents': [remote_head],
                  'author': author, 'committer': committer})
    ok = '✓' if c['sha'] == local_sha else '✗'
    print(f'{ok} commit -> {c["sha"]} (本地 {local_sha})')
    if c['sha'] != local_sha:
        print('!! commit SHA 不一致（服务端可能规范化了 message），中止——远端未变动')
        sys.exit(1)

    # 5. 更新 ref（快进）
    r = api_call('PATCH', f'/repos/{REPO}/git/refs/heads/{branch}', token, {'sha': c['sha']})
    print(f'✓ ref {branch} -> {r["object"]["sha"][:10]}（快进）')

    # 6. 复核
    ref2 = api_call('GET', f'/repos/{REPO}/git/ref/heads/{branch}', token)
    print(f'复核: 远端 {branch} = {ref2["object"]["sha"]}，本地 = {local_sha}，'
          + ('完全一致 ✓' if ref2['object']['sha'] == local_sha else '不一致 ✗'))

if __name__ == '__main__':
    main()
