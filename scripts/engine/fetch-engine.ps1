<#
.SYNOPSIS
  Downloads, verifies and extracts the pinned LibreOffice engine described in
  scripts/engine/engine.lock.json.

.DESCRIPTION
  Idempotent. The steps are:
    1. If the engine image (vendor/libreoffice) already holds the pinned version, stop.
       No network access happens in this case.
    2. Reuse a verified MSI from the download folder (vendor/downloads), or download it
       with retries from the pinned archive URL, then from the fallback URL.
    3. Verify the size and the SHA-256 digest against the lock file.
    4. Verify the detached OpenPGP signature (.asc) with gpg when gpg is available
       (Git for Windows ships one). The public key is fetched over HTTPS from
       keyserver.ubuntu.com and the full fingerprint is compared with the lock file.
    5. Extract the MSI with an administrative install (msiexec /a) into the engine folder.
  Only the download folder, the engine folder and vendor/engine-image.json are written.
  Nothing is installed, registered or written to system folders.

.PARAMETER Force
  Re-extract even if the engine folder already holds the pinned version.

.PARAMETER VerifyOnly
  Reuse or download the MSI and verify it (size, SHA-256, signature) without extracting it.

.PARAMETER RequireSignature
  Fail when the signature cannot be checked (no gpg, key not available).
  A signature that is checked and does not match always fails.

.PARAMETER SkipSignature
  Do not check the OpenPGP signature. The SHA-256 digest from the lock file is still enforced.

.PARAMETER RemoveMsiAfterExtract
  Delete the downloaded MSI after a successful extraction (saves about 360 MB).

.PARAMETER DownloadDir
  Folder for the MSI, its signature and the gpg home. Default: vendor/downloads.

.PARAMETER EngineDir
  Target folder of the extracted engine image. Default: vendor/libreoffice.

.PARAMETER LockFile
  Lock file to use. Default: scripts/engine/engine.lock.json.

.EXAMPLE
  npm run engine:fetch
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/engine/fetch-engine.ps1 -VerifyOnly
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$VerifyOnly,
  [switch]$RequireSignature,
  [switch]$SkipSignature,
  [switch]$RemoveMsiAfterExtract,
  [string]$DownloadDir,
  [string]$EngineDir,
  [string]$LockFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $LockFile) { $LockFile = Join-Path $PSScriptRoot 'engine.lock.json' }
if (-not $DownloadDir) { $DownloadDir = Join-Path $RepoRoot 'vendor\downloads' }
if (-not $EngineDir) { $EngineDir = Join-Path $RepoRoot 'vendor\libreoffice' }
$ImageRecord = Join-Path (Split-Path -Parent ([System.IO.Path]::GetFullPath($EngineDir))) 'engine-image.json'

function Write-Step([string]$Message) {
  Write-Host "[engine] $Message"
}

function Get-FullPath([string]$Path) {
  if (-not [System.IO.Path]::IsPathRooted($Path)) { $Path = Join-Path (Get-Location).Path $Path }
  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}

# Refuses targets in system locations; this script must never write there.
function Assert-SafeTarget([string]$Path) {
  $full = Get-FullPath $Path
  $root = [System.IO.Path]::GetPathRoot($full).TrimEnd('\')
  if ($full -eq $root) { throw "Refusing to use a drive root as target: $full" }
  $forbidden = @($env:SystemRoot, $env:windir, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432, $env:ProgramData) |
    Where-Object { $_ } | ForEach-Object { (Get-FullPath $_) }
  foreach ($f in $forbidden) {
    if ($full.Equals($f, [StringComparison]::OrdinalIgnoreCase) -or
        $full.StartsWith($f + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to write into a system folder: $full"
    }
  }
  return $full
}

function Read-Lock([string]$Path) {
  $lock = Get-Content -Raw -Encoding UTF8 -Path $Path | ConvertFrom-Json
  foreach ($name in 'version', 'msiUrl', 'fallbackUrl', 'sha256', 'sizeBytes', 'gpgFingerprint', 'sourceUrl') {
    if (-not ($lock.PSObject.Properties.Name -contains $name)) { throw "engine.lock.json: missing field '$name'" }
  }
  if ($lock.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'engine.lock.json: sha256 must be 64 hex digits' }
  if ($lock.gpgFingerprint -notmatch '^[0-9A-F]{40}$') { throw 'engine.lock.json: gpgFingerprint must be 40 upper-case hex digits' }
  foreach ($u in $lock.msiUrl, $lock.fallbackUrl, $lock.sourceUrl) {
    if ($u -notmatch '^https://') { throw "engine.lock.json: URL must use https: $u" }
  }
  return $lock
}

# Quotes one argument for the Windows (MSVCRT) command-line parser.
function ConvertTo-Argument([string]$Value) {
  if ($Value -eq '') { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  $backslashes = 0
  foreach ($ch in $Value.ToCharArray()) {
    if ($ch -eq '\') { $backslashes++; continue }
    if ($ch -eq '"') {
      [void]$sb.Append('\' * ($backslashes * 2 + 1)); [void]$sb.Append('"'); $backslashes = 0; continue
    }
    if ($backslashes -gt 0) { [void]$sb.Append('\' * $backslashes); $backslashes = 0 }
    [void]$sb.Append($ch)
  }
  if ($backslashes -gt 0) { [void]$sb.Append('\' * ($backslashes * 2)) }
  [void]$sb.Append('"')
  return $sb.ToString()
}

# Runs a console tool with stdout/stderr redirected to files. Waits for the process itself only
# (Start-Process -Wait would also wait for daemons such as gpg-agent).
function Invoke-Tool([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds = 600) {
  $out = [System.IO.Path]::GetTempFileName()
  $err = [System.IO.Path]::GetTempFileName()
  try {
    $argLine = ($Arguments | ForEach-Object { ConvertTo-Argument $_ }) -join ' '
    $p = Start-Process -FilePath $FilePath -ArgumentList $argLine -NoNewWindow -PassThru `
      -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $p.Handle # keeps ExitCode available after exit (Windows PowerShell 5.1)
    if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
      & taskkill.exe /PID $p.Id /T /F | Out-Null
      throw "$([System.IO.Path]::GetFileName($FilePath)) did not finish within $TimeoutSeconds s"
    }
    return [pscustomobject]@{
      ExitCode = $p.ExitCode
      StdOut   = [System.IO.File]::ReadAllText($out)
      StdErr   = [System.IO.File]::ReadAllText($err)
    }
  } finally {
    Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  }
}

function Get-EngineVersion([string]$Dir) {
  $exe = Join-Path $Dir 'program\soffice.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $null }
  return (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
}

function Test-MsiFile([string]$Path, $Lock) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -ne [int64]$Lock.sizeBytes) {
    Write-Step "Size mismatch for $($item.Name): $($item.Length) bytes, expected $($Lock.sizeBytes)."
    return $false
  }
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if (-not $hash.Equals($Lock.sha256, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Step "SHA-256 mismatch for $($item.Name): $hash"
    return $false
  }
  return $true
}

function Invoke-Download([string]$Url, [string]$Destination, [int]$Attempts = 3) {
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  for ($i = 1; $i -le $Attempts; $i++) {
    Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    try {
      if (Test-Path -LiteralPath $curl) {
        $r = Invoke-Tool $curl @('--fail', '--location', '--silent', '--show-error', '--connect-timeout', '30',
          '--retry', '2', '--retry-delay', '5', '--output', $Destination, $Url) 1800
        if ($r.ExitCode -ne 0) { throw "curl exit code $($r.ExitCode): $($r.StdErr.Trim())" }
      } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 1800
      }
      return $true
    } catch {
      Write-Step "Download attempt $i/$Attempts failed: $($_.Exception.Message)"
      if ($i -lt $Attempts) { Start-Sleep -Seconds (5 * $i * $i) }
    }
  }
  Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
  return $false
}

function Get-FileNameFromUrl([string]$Url) {
  return [System.IO.Path]::GetFileName(([System.Uri]$Url).AbsolutePath)
}

# Returns the path of a verified MSI: an existing file is reused, otherwise it is downloaded.
function Get-VerifiedMsi($Lock, [string]$Dir) {
  $candidates = @(
    [pscustomobject]@{ Url = $Lock.msiUrl; Path = Join-Path $Dir (Get-FileNameFromUrl $Lock.msiUrl) },
    [pscustomobject]@{ Url = $Lock.fallbackUrl; Path = Join-Path $Dir (Get-FileNameFromUrl $Lock.fallbackUrl) }
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c.Path -PathType Leaf) {
      Write-Step "Checking existing $([System.IO.Path]::GetFileName($c.Path)) ..."
      if (Test-MsiFile $c.Path $Lock) {
        Write-Step 'Reusing the verified MSI (size and SHA-256 match the lock file).'
        return $c
      }
      Write-Step 'Existing file does not match the lock file; it will be replaced.'
      Remove-Item -LiteralPath $c.Path -Force
    }
  }
  foreach ($c in $candidates) {
    Write-Step "Downloading $($c.Url)"
    $part = "$($c.Path).part"
    if (Invoke-Download $c.Url $part) {
      if (Test-MsiFile $part $Lock) {
        Move-Item -LiteralPath $part -Destination $c.Path -Force
        Write-Step 'Download verified (size and SHA-256 match the lock file).'
        return $c
      }
      Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
    }
  }
  throw 'Could not obtain an MSI that matches engine.lock.json.'
}

function Find-Gpg {
  $candidates = New-Object System.Collections.Generic.List[string]
  $cmd = Get-Command gpg.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates.Add($cmd.Source) }
  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($git) { $candidates.Add((Join-Path (Split-Path -Parent (Split-Path -Parent $git.Source)) 'usr\bin\gpg.exe')) }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432) | Where-Object { $_ }) {
    $candidates.Add((Join-Path $base 'Git\usr\bin\gpg.exe'))
    $candidates.Add((Join-Path $base 'GnuPG\bin\gpg.exe'))
  }
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c -PathType Leaf) { return $c } }
  return $null
}

# Git for Windows ships an MSYS2 gpg that only understands POSIX-style absolute paths.
function ConvertTo-GpgPath([string]$Gpg, [string]$Path) {
  $cygpath = Join-Path (Split-Path -Parent $Gpg) 'cygpath.exe'
  if (Test-Path -LiteralPath $cygpath -PathType Leaf) {
    $r = Invoke-Tool $cygpath @('-u', $Path) 30
    if ($r.ExitCode -eq 0 -and $r.StdOut.Trim()) { return $r.StdOut.Trim() }
  }
  return $Path
}

function Get-StatusLines([string]$Text) {
  return @($Text -split "`r?`n" | Where-Object { $_.StartsWith('[GNUPG:] ') })
}

# Returns 'verified' or 'unavailable'; throws when a signature is checked and does not match.
function Test-Signature($Lock, [string]$MsiPath, [string]$AscPath, [string]$Dir) {
  $gpg = Find-Gpg
  if (-not $gpg) { return 'unavailable: gpg not found' }
  Write-Step "Using $gpg"
  $fpr = $Lock.gpgFingerprint
  $gpgHome = Join-Path $Dir 'gnupg'
  New-Item -ItemType Directory -Force -Path $gpgHome | Out-Null
  $homeArg = ConvertTo-GpgPath $gpg $gpgHome
  $common = @('--homedir', $homeArg, '--batch', '--no-autostart', '--status-fd', '1')
  $gpgconf = Join-Path (Split-Path -Parent $gpg) 'gpgconf.exe'
  try {
    $keyFile = Join-Path $Dir 'tdf-signing-key.asc'
    $fresh = "$keyFile.download"
    $keyUrl = "https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x$fpr"
    Write-Step "Fetching the signing key $fpr from keyserver.ubuntu.com ..."
    if (Invoke-Download $keyUrl $fresh 2) {
      Move-Item -LiteralPath $fresh -Destination $keyFile -Force
    } elseif (Test-Path -LiteralPath $keyFile) {
      Write-Step 'Keyserver not reachable; using the previously downloaded key file (fingerprint is still checked).'
    } else {
      return 'unavailable: signing key could not be downloaded'
    }
    $imp = Invoke-Tool $gpg ($common + @('--import', (ConvertTo-GpgPath $gpg $keyFile))) 120
    $importOk = Get-StatusLines $imp.StdOut | Where-Object { $_ -match "^\[GNUPG:\] IMPORT_OK \d+ $fpr$" }
    if (-not $importOk) {
      throw "The downloaded key does not contain the pinned fingerprint $fpr.`n$($imp.StdErr.Trim())"
    }
    Write-Step 'Verifying the OpenPGP signature ...'
    $v = Invoke-Tool $gpg ($common + @('--verify', (ConvertTo-GpgPath $gpg $AscPath), (ConvertTo-GpgPath $gpg $MsiPath))) 600
    $status = Get-StatusLines $v.StdOut
    if ($status | Where-Object { $_ -match '^\[GNUPG:\] (BADSIG|ERRSIG|REVKEYSIG|NO_PUBKEY) ' }) {
      throw "Signature verification FAILED:`n$($status -join "`n")`n$($v.StdErr.Trim())"
    }
    $valid = $status | Where-Object { $_ -match '^\[GNUPG:\] VALIDSIG ' } | Select-Object -First 1
    if (-not $valid) { throw "No valid signature found:`n$($status -join "`n")" }
    $fields = $valid.Substring(9).Trim() -split ' '
    $signer = $fields[1]
    $primary = $fields[$fields.Length - 1]
    if ($signer -ne $fpr -and $primary -ne $fpr) {
      throw "Signature made by $signer (primary $primary), expected $fpr."
    }
    if ($status | Where-Object { $_ -match '^\[GNUPG:\] EXPKEYSIG ' }) {
      Write-Step 'Note: the signing key has expired since the signature was made.'
    }
    Write-Step "Good signature from $fpr."
    return 'verified'
  } finally {
    if (Test-Path -LiteralPath $gpgconf -PathType Leaf) {
      Invoke-Tool $gpgconf @('--homedir', $homeArg, '--kill', 'all') 60 | Out-Null
    }
  }
}

function Get-VerifiedSignatureFile($Candidate, [string]$Dir) {
  $asc = "$($Candidate.Path).asc"
  if (Test-Path -LiteralPath $asc -PathType Leaf) { return $asc }
  # The signature is the same for the archive and the mirror file names.
  foreach ($other in Get-ChildItem -LiteralPath $Dir -Filter 'LibreOffice_*_Win_x86-64.msi.asc' -ErrorAction SilentlyContinue) {
    Copy-Item -LiteralPath $other.FullName -Destination $asc
    return $asc
  }
  if (Invoke-Download "$($Candidate.Url).asc" $asc 3) { return $asc }
  return $null
}

# File operations right after msiexec can hit short-lived locks (Windows Installer service, antivirus scans).
function Invoke-WithRetry([scriptblock]$Action, [string]$What, [int]$Attempts = 20, [int]$DelaySeconds = 3) {
  for ($i = 1; $i -le $Attempts; $i++) {
    try { & $Action; return } catch {
      if ($i -eq $Attempts) { throw }
      Write-Step "$What failed ($($_.Exception.Message.Trim())); retrying in $DelaySeconds s ($i/$Attempts) ..."
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}

function Expand-Msi([string]$MsiPath, [string]$TargetDir, [string]$Version, [string]$LogDir) {
  $parent = Split-Path -Parent $TargetDir
  $partial = "$TargetDir.partial"
  $old = "$TargetDir.old"
  $drive = New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($TargetDir))
  if ($drive.AvailableFreeSpace -lt 2.5GB) {
    throw ("Not enough free space on {0} ({1:N1} GB free, about 2.5 GB needed). Use -EngineDir to extract to another drive." -f $drive.Name, ($drive.AvailableFreeSpace / 1GB))
  }
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Recurse -Force }
  $log = Join-Path $LogDir "admin-extract-$Version.log"
  Write-Step "Extracting (administrative install, no system changes) into $partial ..."
  $msiexec = Join-Path $env:SystemRoot 'System32\msiexec.exe'
  $argLine = '/a "{0}" /qn TARGETDIR="{1}" /L*v "{2}"' -f $MsiPath, $partial, $log
  $p = Start-Process -FilePath $msiexec -ArgumentList $argLine -PassThru -WindowStyle Hidden
  $null = $p.Handle
  $p.WaitForExit()
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    throw "msiexec /a failed with exit code $($p.ExitCode). See $log"
  }
  $got = Get-EngineVersion $partial
  if ($got -ne $Version) { throw "Extracted engine reports version '$got', expected '$Version'. See $log" }
  if (Test-Path -LiteralPath $old) {
    Invoke-WithRetry { Remove-Item -LiteralPath $old -Recurse -Force }.GetNewClosure() "Removing $old"
  }
  if (Test-Path -LiteralPath $TargetDir) {
    Invoke-WithRetry { Rename-Item -LiteralPath $TargetDir -NewName (Split-Path -Leaf $old) }.GetNewClosure() "Moving the previous image aside"
  }
  Invoke-WithRetry { Rename-Item -LiteralPath $partial -NewName (Split-Path -Leaf $TargetDir) }.GetNewClosure() "Activating the new image"
  if (Test-Path -LiteralPath $old) {
    Invoke-WithRetry { Remove-Item -LiteralPath $old -Recurse -Force }.GetNewClosure() "Removing the previous image"
  }
  Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------------------------------------ main
$lock = Read-Lock $LockFile
$DownloadDir = Assert-SafeTarget $DownloadDir
$EngineDir = Assert-SafeTarget $EngineDir
if ($SkipSignature -and $RequireSignature) { throw '-SkipSignature and -RequireSignature cannot be combined.' }

Write-Step "Pinned engine: LibreOffice $($lock.version) (SHA-256 $($lock.sha256))"
$present = Get-EngineVersion $EngineDir
if (-not $Force -and -not $VerifyOnly -and $present -eq $lock.version) {
  Write-Step "Engine image already present: $EngineDir (version $present). Nothing to do."
  if (-not (Test-Path -LiteralPath $ImageRecord)) {
    Write-Step 'No provenance record found (image not extracted by this script). Use -Force to re-extract from the verified MSI.'
  }
  exit 0
}
if ($present -and $present -ne $lock.version) {
  Write-Step "Engine image has version $present; the lock file pins $($lock.version). It will be replaced."
}

New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
$candidate = Get-VerifiedMsi $lock $DownloadDir

$signature = 'skipped (-SkipSignature)'
if (-not $SkipSignature) {
  $asc = Get-VerifiedSignatureFile $candidate $DownloadDir
  if ($asc) {
    $signature = Test-Signature $lock $candidate.Path $asc $DownloadDir
  } else {
    $signature = 'unavailable: signature file could not be downloaded'
  }
  if ($signature -ne 'verified') {
    if ($RequireSignature) { throw "Signature could not be checked ($signature) and -RequireSignature is set." }
    Write-Warning "Signature not checked ($signature). Integrity relies on the pinned SHA-256 digest."
  }
}

if ($VerifyOnly) {
  Write-Step "Verified: $($candidate.Path) (signature: $signature). Extraction skipped (-VerifyOnly)."
  exit 0
}

Expand-Msi $candidate.Path $EngineDir $lock.version $DownloadDir
$record = [ordered]@{
  version     = $lock.version
  sha256      = $lock.sha256.ToLowerInvariant()
  signature   = $signature
  msi         = [System.IO.Path]::GetFileName($candidate.Path)
  sourceUrl   = $candidate.Url
  extractedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
[System.IO.File]::WriteAllText($ImageRecord, ($record | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
if ($RemoveMsiAfterExtract) { Remove-Item -LiteralPath $candidate.Path -Force }
Write-Step "Engine ready: $EngineDir (LibreOffice $($lock.version), signature: $signature)."
Write-Step 'Next: npm run engine:prepare builds vendor/engine-dist for packaging.'
