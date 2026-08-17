[CmdletBinding()]
param(
    [ValidateSet('read', 'write')]
    [string]$Operation = 'read',
    [string]$TargetHost = 'haika-niannian',
    [ValidateRange(3, 60)]
    [int]$ConnectTimeoutSeconds = 12
)

$expectedHost = 'haika-niannian'
if ($TargetHost -ne $expectedHost) {
    throw "DEPLOY_TARGET_REJECTED: expected $expectedHost, received $TargetHost."
}

$ssh = Get-Command ssh -ErrorAction Stop
$probe = @'
set -eu
printf 'service='; systemctl is-active niannian-ai.service 2>/dev/null || true
printf 'canvas_env='; test -f /etc/niannian-ai/canvas.env && echo present || echo absent
printf 'app_dir='; test -d /opt/niannian-ai && echo present || echo absent
'@
$result = & $ssh.Source -o BatchMode=yes -o "ConnectTimeout=$ConnectTimeoutSeconds" $TargetHost $probe
if ($LASTEXITCODE -ne 0) {
    throw 'DEPLOY_TARGET_UNREACHABLE: production identity could not be verified.'
}

$observed = @{}
foreach ($line in $result) {
    $pair = [string]$line -split '=', 2
    if ($pair.Count -eq 2) { $observed[$pair[0]] = $pair[1] }
}
$expected = @{service = 'active'; canvas_env = 'present'; app_dir = 'present'}
foreach ($entry in $expected.GetEnumerator()) {
    if ($observed[$entry.Key] -ne $entry.Value) {
        throw "DEPLOY_TARGET_REJECTED: $($entry.Key) must be $($entry.Value)."
    }
}

[pscustomobject]@{
    targetHost = $TargetHost
    operation = $Operation
    service = $observed.service
    canvasEnv = $observed.canvas_env
    appDirectory = $observed.app_dir
    verified = $true
}
