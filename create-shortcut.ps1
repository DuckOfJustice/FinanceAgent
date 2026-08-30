$WshShell = New-Object -ComObject WScript.Shell
$ShortcutPath = Join-Path $WshShell.SpecialFolders("Desktop") "FinanceDuck.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = Join-Path $PSScriptRoot "start.bat"
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.IconLocation = Join-Path $PSScriptRoot "Icon.ico"
$Shortcut.Save()
Write-Host "Verknuepfung erstellt auf dem Desktop: $ShortcutPath"
