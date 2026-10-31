# 发版流程

两个包同版本发布：`js-shell/`（npm）和 `py-mcp/`（PyPI）。下面的命令按顺序执行即可。

## 0. 前置检查

工作区必须干净（`git status --short` 无输出），然后跑两套测试：

```sh
cd js-shell && node --check lib/index.js && node test/verify.mjs && cd ..
cd py-mcp && PYTHONPATH=src python3 -m pytest tests -q && cd ..
```

`py-mcp` 的测试需要 `mcp>=2.0.0`（系统 Python 里可能是 1.x，用独立 venv 装）。

## 1. 改版本号

只有两个文件：

- `js-shell/package.json` → `"version"`
- `py-mcp/pyproject.toml` → `version`

```sh
sed -i 's/"version": "0\.1\.1",/"version": "0.1.2",/' js-shell/package.json
sed -i 's/^version = "0\.1\.1"/version = "0.1.2"/' py-mcp/pyproject.toml
git diff --stat   # 只应该出现这两个文件
```

不要用脚本整体重写 `package.json`，会把 `peerDependenciesMeta` 的内联对象展开成一堆无意义的 diff。

## 2. 提交

提交信息只写版本，不带任何署名行：

```sh
git add js-shell/package.json py-mcp/pyproject.toml
git commit -m "Release 0.1.2"
```

## 3. 发布 npm

**注意**：本机默认 registry 是 `npmmirror`（`npm config get registry`），它只是镜像，
必须显式指向官方源，否则会发布失败或发到错误的地方。

```sh
cd js-shell
npm publish --dry-run                      # 先看文件清单（10 个文件、版本号对不对）

umask 077
NPMRC=$(mktemp)
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$NPMRC"
npm publish --userconfig "$NPMRC" --registry https://registry.npmjs.org/
rm -f "$NPMRC"
cd ..
```

token 用 npm 官网的 Automation token（或勾了 "Bypass two-factor authentication" 的
granular token）。临时 npmrc 权限 600，用完立即删除，不要写进仓库或 `~/.npmrc`。

## 4. 发布 PyPI

用独立的 venv，不污染共享环境：

```sh
uv venv /tmp/publish-venv --python 3.10
uv pip install -q --python /tmp/publish-venv/bin/python build twine

cd py-mcp
rm -rf dist build *.egg-info
/tmp/publish-venv/bin/python -m build          # 产出 .whl + .tar.gz
TWINE_USERNAME=__token__ TWINE_PASSWORD="$PYPI_TOKEN" \
  /tmp/publish-venv/bin/twine upload dist/dsh_memory_journal-<版本>*
cd ..
```

token 走环境变量，不要出现在命令行参数里（会进 shell 历史）。

## 5. 验证

```sh
# npm：latest 是否指向新版本，tarball 里是不是新代码
curl -s https://registry.npmjs.org/dsh-memory-journal | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print(d['dist-tags']['latest'], sorted(d['versions']))"

# PyPI：release 列表和文件
curl -s https://pypi.org/pypi/dsh-memory-journal/json | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print(d['info']['version'], sorted(d['releases']))"

# 真正装一遍再跑
uv venv /tmp/verify-pub --python 3.10
uv pip install --no-cache --python /tmp/verify-pub/bin/python \
  --index-url https://pypi.org/simple dsh-memory-journal==<版本>
/tmp/verify-pub/bin/python -c "import importlib.metadata as m; print(m.version('dsh-memory-journal'))"
```

两个坑：

- `uv` 会缓存索引，刚发布时可能报 "no version"，加 `--no-cache` 即可。
- npm 新包首次发布走 staged review，公开 packument 可能要等一会儿才出现 `latest`；
  `npm view --include-staged` 可以先确认版本确实传上去了。

## 6. GitHub

```sh
git push origin main
git tag -a v<版本> -m "dsh-memory-journal <版本>"
git push origin v<版本>
```

本机没有装 `gh`，Release 用 REST API 创建（凭证直接复用 git 已配置的那份，不打印）：

```sh
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/wzz618/dsh-memory-journal/releases \
  -d "$(python3 -c "import json;print(json.dumps({'tag_name':'v<版本>','name':'v<版本>','body':open('/tmp/release-notes.md').read(),'draft':False,'prerelease':False}))")"
```

Release 说明包含三块：升级须知（数据目录/迁移相关）、变更列表、安装命令。

## 7. 收尾

- 删掉 `/tmp` 下的临时 venv、npmrc、构建产物。
- `py-mcp/dist`、`build` 已在 `.gitignore` 里，不用手动清。
- 提醒凭证持有人按需轮换 token（聊天里贴过的 token 视为已泄露）。

## 检查清单

- [ ] 工作区干净、两套测试通过
- [ ] 两个版本号都改了，只改这两个文件
- [ ] 提交信息无署名
- [ ] npm 显式 `--registry https://registry.npmjs.org/`
- [ ] PyPI 用独立 venv 构建，token 走环境变量
- [ ] 两个注册表的 latest 都指向新版本，装一遍实测
- [ ] main 已推送、tag 已推送、Release 已发布
- [ ] /tmp 清理干净
