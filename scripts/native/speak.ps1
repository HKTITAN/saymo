# Reads words aloud with one of Windows' own voices, offline: the Windows
# twin of the Mac's `say`, used by src/lib/studio/sound/voice.ts.
#
#   speak.ps1 -List                                    one line per voice: name|language|gender
#   speak.ps1 -Voice <name> -Rate <0.5..6> -TextFile <in.txt> -Out <out.wav>
#
# The words come from a file, never the command line, so they can't be read
# as options. Uses Windows.Media.SpeechSynthesis, which has the newer voices
# (Heera and Ravi for Indian English, Kalpana and Hemant for Hindi).
param(
  [switch]$List,
  [string]$Voice,
  [double]$Rate = 1.0,
  [string]$TextFile,
  [string]$Out
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

# WinRT calls are asynchronous; this waits for one.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1" } |
  Select-Object -First 1
function Wait($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  $task.Result
}

if ($List) {
  foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
    "$($v.DisplayName)|$($v.Language)|$($v.Gender)"
  }
  exit 0
}

$chosen = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq $Voice } | Select-Object -First 1
if (-not $chosen) {
  [Console]::Error.WriteLine("There's no voice called $Voice on this PC.")
  exit 2
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synth.Voice = $chosen
$synth.Options.SpeakingRate = [Math]::Min(6.0, [Math]::Max(0.5, $Rate))
$words = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)
$stream = Wait ($synth.SynthesizeTextToStreamAsync($words)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])

$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$size = [uint32]$stream.Size
$null = Wait ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes($Out, $bytes)
