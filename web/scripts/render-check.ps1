# Headless render check: dump the visible text of every tab with Chrome --dump-dom.
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, so Chinese literals
# in the file itself break parsing. Chinese detection uses \uXXXX regex escapes.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File web\scripts\render-check.ps1
param(
  [string]$Base = "http://127.0.0.1:5199/",
  [int]$Budget = 9000,
  [string]$Extra = ""
)

$exe = "C:\Users\Dove\AppData\Local\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $exe)) {
  $exe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
}
$prof = Join-Path $env:TEMP "wotr-chrome-prof"
$tabs = @("class", "race", "background", "attrs", "skills", "feats", "spells", "deity", "align", "mythic", "summary")
$bad = 0

# patterns (kept as escapes so this file stays pure ASCII)
$reBoot = '\u6b63\u5728\u8bfb\u53d6\u6e38\u620f\u6570\u636e'      # loading text
$reFail = '\u6570\u636e\u6ca1\u52a0\u8f7d\u8d77\u6765'            # data failed
$reApp  = '\u6784\u7b51\u89c4\u5212\u5668'                        # "builder" in the title

# Chrome writes --dump-dom from a child process: wait until the file stops growing,
# then read it with a couple of retries (Windows keeps the handle a moment longer).
function Read-Dump([string]$path, [int]$timeoutMs) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $last = -1
  $stable = 0
  while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
    $len = 0
    if (Test-Path $path) { $len = (Get-Item $path).Length }
    if ($len -gt 0 -and $len -eq $last) { $stable++; if ($stable -ge 3) { break } } else { $stable = 0 }
    $last = $len
    Start-Sleep -Milliseconds 250
  }
  for ($i = 0; $i -lt 10; $i++) {
    try { return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) }
    catch { Start-Sleep -Milliseconds 300 }
  }
  return ""
}

foreach ($t in $tabs) {
  $out = Join-Path $env:TEMP "wotr-dom-$t.txt"
  $err = Join-Path $env:TEMP "wotr-dom-$t.err.txt"
  Remove-Item $out, $err -ErrorAction SilentlyContinue
  $url = "$Base#tab=$t$Extra"
  Start-Process -FilePath $exe -NoNewWindow `
    -RedirectStandardOutput $out -RedirectStandardError $err -ArgumentList @(
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
      "--user-data-dir=$prof", "--virtual-time-budget=$Budget", '--dump-dom', $url
    ) | Out-Null

  $raw = Read-Dump $out 40000
  $txt = "$raw"
  $txt = ($txt -replace '(?s)<script.*?</script>', '') -replace '(?s)<style.*?</style>', ''
  $txt = ($txt -replace '<[^>]+>', ' ') -replace '&nbsp;', ' '
  $txt = ($txt -replace '\s+', ' ').Trim()

  $len = $txt.Length
  $boot = [regex]::IsMatch($txt, $reBoot)
  $fail = [regex]::IsMatch($txt, $reFail)
  $app = [regex]::IsMatch($txt, $reApp)
  $guids = ([regex]::Matches($txt, '\b[0-9a-f]{32}\b') | Measure-Object).Count

  $flag = "OK "
  if ($boot -or $fail -or -not $app -or $len -lt 200 -or $guids -gt 0) { $flag = "!! "; $bad++ }
  "{0}{1,-8} chars={2,-6} rawguids={3}" -f $flag, $t, $len, $guids
  if ($flag -eq "!! ") {
    "     " + $txt.Substring(0, [Math]::Min(400, $len))
  }
}

if ($bad -gt 0) { "### $bad tab(s) broken ###"; exit 1 } else { "### all $($tabs.Count) steps rendered ###" }
