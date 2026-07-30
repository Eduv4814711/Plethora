<#
.SYNOPSIS
  Registers the daily Windows Scheduled Task that syncs production into local.

.DESCRIPTION
  Runs scripts/sync-prod-to-local.ps1 every day at 10:00. If the machine was
  off or asleep at 10:00, the task runs as soon as it is available again.

  Runs as the current user with an interactive logon type, so no Windows
  password is stored. Trade-off: the task only fires while you are logged in.

  Idempotent - re-run it after changing the schedule.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-sync-task.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-sync-task.ps1 -At 07:30
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-sync-task.ps1 -Unregister
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'PlethoraDbSync',
    [string]$At = '10:00',
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

$SyncScript = Join-Path $PSScriptRoot 'sync-prod-to-local.ps1'
$Root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $SyncScript)) { throw "Sync script not found: $SyncScript" }

# Removing first makes re-running this script an update rather than an error.
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop } catch {}

if ($Unregister) {
    Write-Host "Removed scheduled task '$TaskName'."
    return
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$SyncScript`"" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# StartWhenAvailable is what makes a missed 10:00 run catch up on wake.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Replaces the local Plethora database with a fresh copy of Railway production. Destroys local data on every run.' | Out-Null

Write-Host "Registered scheduled task '$TaskName' - daily at $At (catches up if the PC was off)."
Write-Host ''
Write-Host 'Useful commands:'
Write-Host "  Start-ScheduledTask -TaskName $TaskName            # run it now"
Write-Host "  Get-ScheduledTaskInfo -TaskName $TaskName          # last run time and result (0 = success)"
Write-Host "  Disable-ScheduledTask -TaskName $TaskName          # pause it"
Write-Host "  .\scripts\register-sync-task.ps1 -Unregister       # remove it"
