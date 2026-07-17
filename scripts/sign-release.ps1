# Sign a release with minisign: download its artifacts, hash them into a
# SHA256SUMS manifest, sign the manifest, upload both files back.
# The secret key never leaves this machine — CI only ever builds.
#
# Usage:  pwsh scripts/sign-release.ps1 v2.1.0
#         (works on the draft release before you click Publish)

param([Parameter(Mandatory)][string]$Tag)
$ErrorActionPreference = "Stop"

if (-not (Get-Command minisign -ErrorAction SilentlyContinue)) {
    throw "minisign not found - install it first (https://jedisct1.github.io/minisign/)"
}

$dir = Join-Path ([System.IO.Path]::GetTempPath()) "satconverter-sign-$Tag"
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
New-Item -ItemType Directory $dir | Out-Null

Write-Output "downloading $Tag artifacts..."
gh release download $Tag --dir $dir

# sha256sum -c compatible manifest: "<hash>  <name>", sorted, lowercase.
$files = Get-ChildItem $dir -File | Where-Object { $_.Name -notlike "SHA256SUMS*" } | Sort-Object Name
$manifest = ($files | ForEach-Object {
    "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}) -join "`n"
$sums = Join-Path $dir "SHA256SUMS"
[System.IO.File]::WriteAllText($sums, $manifest + "`n")

Write-Output "signing (minisign will ask for your key password)..."
minisign -Sm $sums -t "SatConverter $Tag"
if ($LASTEXITCODE -ne 0) { throw "minisign failed" }

gh release upload $Tag $sums "$sums.minisig" --clobber
Write-Output "done: SHA256SUMS + SHA256SUMS.minisig attached to $Tag."
Write-Output "review the draft on GitHub, then click Publish."
