# install.ps1 —— 把 dsh-memory-kit（或它的 scoped 版本）装进当前 DSH profile（默认 desktop）。
#
# 做三件事：
#   1. 把插件包复制到 <DSH_HOME>/plugins/<包名最后一段>
#   2. 在 profile 的 node_modules 里建 junction
#   3. profile package.json：加 link 依赖 + 把 bundle 注册进 dsh.profile.bundles
#
# 用法：powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Profile desktop] [-Restart]
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::Default } catch {}

$ProfileName = 'desktop'
$DoRestart = $false
for ($i = 0; $i -lt $args.Count; $i++) {
  switch ($args[$i]) {
    '-Profile' { $ProfileName = $args[$i + 1] }
    '-Restart' { $DoRestart = $true }
  }
}

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ProfileDir = Join-Path $DshHome "profiles\$ProfileName"
$PkgJson = Get-Content (Join-Path $Here 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$PkgName = $PkgJson.name          # 可能是 @scope/name
$PluginDirName = ($PkgName -split '/')[-1]
$PluginDir = Join-Path $DshHome ("plugins\" + $PluginDirName)
$Link = Join-Path $ProfileDir ("node_modules\" + $PkgName)

Write-Host "DSH_HOME : $DshHome"
Write-Host "profile  : $ProfileName"
if (-not (Test-Path $ProfileDir)) { Write-Host "找不到 profile 目录：$ProfileDir"; exit 1 }

# 1) 复制插件包
New-Item -ItemType Directory -Force -Path (Split-Path $PluginDir) | Out-Null
$sameDir = $false
try { $sameDir = (Resolve-Path $Here).Path -eq (Resolve-Path $PluginDir).Path } catch { $sameDir = $false }
if ($sameDir) {
  Write-Host "1/3 已经在插件目录里，跳过复制"
} elseif (Test-Path $PluginDir) {
  # 已装过：**不要删目录再拷**（DSH 可能正在用，删了会瞬时断掉），逐个覆盖文件即可
  Get-ChildItem $Here -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($Here.Length).TrimStart('\')
    $dst = Join-Path $PluginDir $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item $_.FullName $dst -Force
  }
  Write-Host "1/3 已存在旧版本，已原地更新文件（$PluginDir）"
} else {
  Copy-Item $Here $PluginDir -Recurse -Force
  Write-Host "1/3 插件已复制到 $PluginDir"
}

# 2) junction
New-Item -ItemType Directory -Force -Path (Split-Path $Link) | Out-Null
if (-not (Test-Path $Link)) {
  New-Item -ItemType Junction -Path $Link -Target $PluginDir | Out-Null
  Write-Host "2/3 junction 已建：$Link"
} else {
  Write-Host "2/3 junction 已存在"
}

# 3) package.json：link 依赖 + bundle
$PkgFile = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path $PkgFile)) { Write-Host "找不到 $PkgFile"; exit 1 }
$pkg = Get-Content $PkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $pkg.PSObject.Properties['dependencies']) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$linkSpec = 'link:' + ($PluginDir -replace '\\', '/')
$pkg.dependencies | Add-Member -NotePropertyName $PkgName -NotePropertyValue $linkSpec -Force
if (-not $pkg.PSObject.Properties['dsh']) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
if (-not $pkg.dsh.PSObject.Properties['profile']) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
if (-not $pkg.dsh.profile.PSObject.Properties['bundles']) { $pkg.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains $PkgName) { $bundles += $PkgName }
$pkg.dsh.profile.bundles = $bundles
# PS 5.1 的 -Encoding UTF8 会写 BOM，DSH 读 package.json 会报 Unexpected token
# （本机 dsh-gui-url 就是被这个坑掉的），所以用无 BOM 写。
$json = $pkg | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText($PkgFile, $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "3/3 package.json 已更新（bundles: $($bundles -join ', ')）"

Write-Host ""
Write-Host "装好了。重启 DSH 后应该出现："
Write-Host "  $DshHome\memory-kit\memory\"
Write-Host "  $DshHome\memory-kit\memory-kit.log"
Write-Host ""
Write-Host "重启后第一件事：编辑 persona.md，写清她是谁、你叫什么。"

if ($DoRestart) {
  Write-Host "3 秒后重启 DSH…"
  Start-Sleep -Seconds 3
  Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  $exe = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
  if (Test-Path $exe) { Start-Process $exe }
}
