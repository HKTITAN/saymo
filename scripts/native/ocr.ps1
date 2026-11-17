# The words in a picture, read by Windows' own text recognition
# (Windows.Media.Ocr), so nothing leaves the computer. The Windows twin of
# `slides ocr` in slides.swift: prints the lines top to bottom, then left to
# right, as a slide is read.
#
# usage: powershell -File ocr.ps1 <image>

param([Parameter(Mandatory = $true)][string]$Image)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]

# WinRT's async calls, waited for from PowerShell.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1" } |
  Select-Object -First 1
function Wait-Async($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { [Console]::Error.WriteLine("No text recognition language is installed."); exit 1 }

$file = Wait-Async ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $Image).Path)) ([Windows.Storage.StorageFile])
$stream = Wait-Async ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
  $decoder = Wait-Async ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  # The recognizer takes pictures up to its own size limit; bigger slides are scaled to fit.
  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $scale = [Math]::Min(1.0, $max / [Math]::Max($decoder.PixelWidth, $decoder.PixelHeight))
  $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
  $transform.ScaledWidth = [uint32][Math]::Floor($decoder.PixelWidth * $scale)
  $transform.ScaledHeight = [uint32][Math]::Floor($decoder.PixelHeight * $scale)
  $bitmap = Wait-Async ($decoder.GetSoftwareBitmapAsync(
      [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform,
      [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Wait-Async ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
} finally {
  $stream.Dispose()
}

# Top to bottom (lines within a hundredth of the height count as one row),
# then left to right.
$height = [Math]::Max(1, $transform.ScaledHeight)
$lines = foreach ($line in $result.Lines) {
  $top = ($line.Words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
  $left = ($line.Words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
  [pscustomobject]@{ Row = [Math]::Round($top / $height * 100); Left = $left; Text = $line.Text }
}
($lines | Sort-Object Row, Left | ForEach-Object { $_.Text }) -join "`n"
