# Puts a "Blacksite" shortcut on your Desktop. Add -Autostart to also start it when you sign in to Windows.
#   powershell -ExecutionPolicy Bypass -File install-shortcut.ps1 [-Autostart] [-Remove]
param([switch]$Autostart, [switch]$Remove)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here 'start.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$places = @((Join-Path $desktop 'Blacksite.lnk'))
if ($Autostart) { $places += (Join-Path $startup 'Blacksite.lnk') }
# Shortcuts from before the app was called Blacksite
$old = @((Join-Path $desktop 'My Dashboard.lnk'), (Join-Path $startup 'My Dashboard.lnk'))

if ($Remove) {
  foreach ($p in @((Join-Path $desktop 'Blacksite.lnk'), (Join-Path $startup 'Blacksite.lnk')) + $old) {
    if (Test-Path $p) { Remove-Item $p; Write-Host "Removed $p" }
  }
  exit 0
}
foreach ($p in $old) { if (Test-Path $p) { Remove-Item $p; Write-Host "Removed old shortcut $p" } }

$shell = New-Object -ComObject WScript.Shell
foreach ($p in $places) {
  $s = $shell.CreateShortcut($p)
  $s.TargetPath = $target
  $s.WorkingDirectory = $here
  $s.WindowStyle = 7  # minimized
  $s.Description = 'Blacksite: agents, tools and programs (http://localhost:4800)'
  $bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
  if (-not $bun) { $bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
  if (Test-Path $bun) { $s.IconLocation = "$bun,0" }
  $s.Save()
  Write-Host "Created $p"
}
