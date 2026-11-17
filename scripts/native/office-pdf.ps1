# A PowerPoint (.pptx, .ppt) or OpenDocument (.odp) deck saved as a PDF by
# PowerPoint itself, on Windows: the twin of the Keynote export on a Mac.
# Opens the deck read-only with no window, saves it as a PDF (hidden slides
# left out), prints each slide's hidden flag and speaker notes, and closes it
# without saving. If PowerPoint wasn't open before, it's quit again.
#
# Prints: the hidden flags (true or false), split by character 30, then
# character 29, then the notes, split by character 30.
#
# usage: powershell -File office-pdf.ps1 <deck> <out.pdf>

param(
  [Parameter(Mandatory = $true)][string]$Deck,
  [Parameter(Mandatory = $true)][string]$Pdf
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$wasOpen = [bool](Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
$app = New-Object -ComObject PowerPoint.Application
$deckFile = (Resolve-Path -LiteralPath $Deck).Path
$pdfFile = [System.IO.Path]::GetFullPath($Pdf)
$doc = $null
try {
  # ReadOnly, not Untitled, no window (msoTrue is -1, msoFalse 0).
  $doc = $app.Presentations.Open($deckFile, -1, 0, 0)
  $hidden = @()
  $notes = @()
  foreach ($slide in $doc.Slides) {
    $hidden += [string]($slide.SlideShowTransition.Hidden -eq -1)
    $text = ""
    foreach ($shape in $slide.NotesPage.Shapes) {
      # The notes page's body text (ppPlaceholderBody is 2), not the slide picture.
      if ($shape.Type -eq 14 -and $shape.PlaceholderFormat.Type -eq 2 -and $shape.HasTextFrame) {
        $text = $shape.TextFrame.TextRange.Text
      }
    }
    $notes += ($text -replace "`r", "`n")
  }
  # ppSaveAsPDF is 32.
  $doc.SaveAs($pdfFile, 32)
  $doc.Close()
  $doc = $null
  [Console]::Out.Write((($hidden -join [char]30).ToLower()) + [char]29 + ($notes -join [char]30))
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($doc) { try { $doc.Close() } catch {} }
  if (-not $wasOpen) { try { $app.Quit() } catch {} }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
