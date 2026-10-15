# 把仓库里的插件源码同步到 DSH 真正加载的位置，并校验一致性。
#
# 背景：profile 以 `file:` 依赖引用插件，pnpm 会把它【复制】进
# profiles/web/node_modules/dsh-evolve（不是软链），运行时加载的是那份副本。
# 改了仓库源码但没同步副本 = 运行时仍是旧代码（这个坑踩过两次）。
#
# 用法：pwsh -File scripts/sync-plugin.ps1
# 回滚：git checkout plugins/dsh-evolve && 重跑本脚本

[CmdletBinding()]
param(
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' })
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo 'plugins/dsh-evolve'
$dst = Join-Path $DshHome 'profiles/web/node_modules/dsh-evolve'

if (-not (Test-Path $src)) { throw "找不到插件源码：$src" }
if (-not (Test-Path $dst)) {
  Write-Warning "目标不存在：$dst"
  Write-Warning "说明该 profile 没有以 file: 依赖引用本插件；跳过同步（仓库源码本身就是真源）。"
  exit 0
}

Write-Host "源  : $src"
Write-Host "副本: $dst"

$files = @('package.json', 'cordis.patch.yml', 'README.md', 'lib/index.js')
foreach ($f in $files) {
  $s = Join-Path $src $f
  if (-not (Test-Path $s)) { continue }
  Copy-Item $s (Join-Path $dst $f) -Force
}

$bad = 0
foreach ($f in $files) {
  $s = Join-Path $src $f
  $d = Join-Path $dst $f
  if (-not (Test-Path $s) -or -not (Test-Path $d)) { continue }
  $hs = (Get-FileHash $s -Algorithm SHA256).Hash
  $hd = (Get-FileHash $d -Algorithm SHA256).Hash
  if ($hs -eq $hd) {
    Write-Host ("  [OK]   {0,-20} {1}" -f $f, $hs.Substring(0, 12))
  } else {
    Write-Host ("  [DIFF] {0,-20} {1} != {2}" -f $f, $hs.Substring(0, 12), $hd.Substring(0, 12)) -ForegroundColor Red
    $bad++
  }
}

if ($bad -gt 0) { throw "$bad 个文件同步后仍不一致" }

Write-Host ""
Write-Host "同步完成且哈希一致。注意：DSH 在启动时加载插件，" -ForegroundColor Yellow
Write-Host "要让新代码生效必须【重启 dsh】，然后在新会话里验证：" -ForegroundColor Yellow
Write-Host '  evolve_add(text = 一段超过 60 字符的规则)  →  期望 {"ok":false,"action":"rejected-too-long"}'
