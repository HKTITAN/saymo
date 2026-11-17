# Opens Windows' own folder picker and prints the folder chosen (nothing on
# Cancel): the Windows twin of the Finder picker in
# src/lib/studio/connect/destinations.ts. Needs -STA.
param([string]$Prompt = "Choose a folder")

Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $Prompt
$dialog.ShowNewFolderButton = $true
# An owner that stays on top, so the picker opens in front of the browser.
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $dialog.SelectedPath
}
$owner.Dispose()
