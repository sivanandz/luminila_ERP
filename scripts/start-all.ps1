#!/usr/bin/env pwsh
# ==============================================
# Luminila Unified Startup Script
# Starts: PocketBase, WhatsApp Sidecar, Next.js
# ==============================================

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Luminila Dev Environment"

# Set console encoding to UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         Luminila Development Environment         ║" -ForegroundColor Cyan  
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Get project root (parent of scripts folder)
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $projectRoot -or $projectRoot -eq "") { 
    $projectRoot = Split-Path -Parent (Get-Location) 
}

# Track background jobs
$jobs = @()

try {
    # ─────────────────────────────────────────────────────
    # 1. Start PocketBase
    # ─────────────────────────────────────────────────────
    Write-Host "▶ Starting PocketBase..." -ForegroundColor Yellow
    $pbPath = Join-Path $projectRoot "pocketbase\pocketbase.exe"
    $pbDataPath = Join-Path $projectRoot "pocketbase\pb_data"
    
    if (Test-Path $pbPath) {
        $pbJob = Start-Job -ScriptBlock {
            param($exe, $data)
            & $exe serve --http="127.0.0.1:8090" --dir=$data
        } -ArgumentList $pbPath, $pbDataPath
        $jobs += $pbJob
        Write-Host "  ✓ PocketBase starting on http://127.0.0.1:8090" -ForegroundColor Green
        Write-Host "    Admin UI: http://127.0.0.1:8090/_/" -ForegroundColor DarkGray
    }
    else {
        Write-Host "  ✗ PocketBase not found at $pbPath" -ForegroundColor Red
    }

    # ─────────────────────────────────────────────────────
    # 2. Start WhatsApp Sidecar
    # ─────────────────────────────────────────────────────
    Write-Host "▶ Starting WhatsApp Sidecar..." -ForegroundColor Yellow
    $wppPath = Join-Path $projectRoot "wppconnect-sidecar"
    $wppServer = Join-Path $wppPath "server.js"
    
    if (Test-Path $wppServer) {
        $wppJob = Start-Job -ScriptBlock {
            param($dir, $server)
            Set-Location $dir
            
            # Auto-update wppconnect to prevent "r is not a function" errors
            Write-Host "  ↻ Checking for sidecar updates..." -ForegroundColor Gray
            npm update @wppconnect-team/wppconnect 2>&1 | Out-Null
            
            node $server
        } -ArgumentList $wppPath, $wppServer
        $jobs += $wppJob
        Write-Host "  ✓ WhatsApp Sidecar starting on http://127.0.0.1:21465" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ WhatsApp sidecar not found at $wppServer" -ForegroundColor Red
    }

    # Wait a moment for services to start
    Start-Sleep -Seconds 2

    # ─────────────────────────────────────────────────────
    # 3. Start Next.js (foreground)
    # ─────────────────────────────────────────────────────
    Write-Host "▶ Starting Next.js Dev Server..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor DarkGray
    Write-Host " Press Ctrl+C to stop all services" -ForegroundColor DarkGray
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor DarkGray
    Write-Host ""

    Set-Location $projectRoot
    npm run dev

}
finally {
    # Cleanup on exit
    Write-Host ""
    Write-Host "Stopping background services..." -ForegroundColor Yellow
    foreach ($job in $jobs) {
        Stop-Job -Job $job -ErrorAction SilentlyContinue
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    Write-Host "✓ All services stopped" -ForegroundColor Green
}
