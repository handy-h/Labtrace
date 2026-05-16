# LabTrace PowerShell Script
# ============================
# 兼容 Makefile 功能的 PowerShell 版本
# 用法: .\labtrace.ps1 <command> [-Force]

param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [switch]$Force
)

# --- 配置 ---

$AppName = "labtrace"
$PidFile = ".labtrace.pid"
$LogFile = "dev.log"

# 端口缓存（避免重复解析 .env）
$script:CachedPort = $null

# --- 颜色输出函数 ---
function Write-Color {
    param([string]$Color, [string]$Prefix, [string]$Message)
    $colorMap = @{
        "GREEN"  = "Green"
        "YELLOW" = "Yellow"
        "RED"    = "Red"
        "CYAN"   = "Cyan"
    }
    $c = $colorMap[$Color]
    if ($c) {
        Write-Host "[$Prefix] " -ForegroundColor $c -NoNewline
    } else {
        Write-Host "[$Prefix] " -NoNewline
    }
    Write-Host $Message
}

# --- 从 .env 读取端口（带缓存） ---
function Get-Port {
    if ($script:CachedPort) { return $script:CachedPort }
    $envPath = Join-Path (Get-Location) ".env"
    if (Test-Path $envPath) {
        $match = Select-String -Path $envPath -Pattern "^PORT=(\d+)" -ErrorAction SilentlyContinue
        if ($match) {
            $script:CachedPort = $match.Matches.Groups[1].Value
            return $script:CachedPort
        }
    }
    $script:CachedPort = "8080"
    return $script:CachedPort
}

# --- 获取版本信息 ---
function Get-Version {
    $ver = git describe --tags --always --dirty 2>$null
    if (-not $ver) { $ver = "dev" }
    return $ver
}

# --- 获取构建时间 ---
function Get-BuildTime {
    return [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss\Z")
}

# --- 读取 PID 文件 ---
function Get-Pid {
    if (Test-Path $PidFile) {
        try {
            return [int](Get-Content $PidFile -Raw -ErrorAction Stop).Trim()
        } catch {
            return $null
        }
    }
    return $null
}

# --- 检查进程是否运行 ---
function Test-ProcessRunning {
    param([int]$ProcessId)
    try {
        $null = Get-Process -Id $ProcessId -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# --- 检查端口占用（返回 PID 数组） ---
function Get-ProcessOnPort {
    param([string]$Port)
    # 优先使用 Get-NetTCPConnection (PowerShell 5.0+, 无语言环境依赖)
    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($connections) {
            return @($connections | ForEach-Object { $_.OwningProcess } | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
        }
    } catch {
        # 回退到 netstat
    }
    # netstat 回退方案
    try {
        $connections = netstat -ano | Select-String ":$Port(\s|$)"
        $pids = @()
        foreach ($line in $connections) {
            $parts = $line.ToString() -split '\s+'
            if ($parts.Count -ge 5) {
                $procId = $parts[-1]
                if ($procId -match '^\d+$' -and $procId -notin $pids) {
                    $pids += [int]$procId
                }
            }
        }
        return $pids
    } catch {
        return @()
    }
}

# =============================================
# 命令实现
# =============================================

function Invoke-Help {
    Write-Host "LabTrace PowerShell Script" -ForegroundColor Cyan
    Write-Host "========================="
    Write-Host ""
    Write-Host "用法: .\labtrace.ps1 <command> [-Force]" -ForegroundColor Green
    Write-Host ""
    Write-Host "命令列表:" -ForegroundColor Green
    Write-Host "  build      编译生成可执行二进制文件"
    Write-Host "  dev        开发者模式运行（丰富日志）"
    Write-Host "  run        生产模式运行（仅必要日志）"
    Write-Host "  stop       优雅关闭应用"
    Write-Host "  test       运行单元测试"
    Write-Host "  lint       代码静态检查"
    Write-Host "  clean      清理临时文件、缓存及二进制文件（保留 ./data 目录）"
    Write-Host "  rebuild    先清理再编译"
    Write-Host "  restart    先停止再启动"
    Write-Host "  help       显示帮助信息"
    Write-Host ""
    Write-Host "选项:"
    Write-Host "  -Force     跳过交互确认（用于 stop 命令）"
}

function Invoke-Build {
    Write-Color "CYAN" "build" "编译 $AppName..."
    $version = Get-Version
    $buildTime = Get-BuildTime
    $ldflags = "-s -w -X main.version=$version -X main.buildTime=$buildTime"

    # 检查 C 编译器（go-sqlite3 需要 cgo）
    $hasGcc = Get-Command gcc -ErrorAction SilentlyContinue
    if (-not $hasGcc) {
        Write-Color "RED" "build" "未找到 gcc，go-sqlite3 需要 CGO 支持"
        Write-Host "  请安装 MinGW-w64 (https://www.mingw-w64.org/)" -ForegroundColor Yellow
        exit 1
    }

    # 编译前进行静态检查
    go vet ./...
    $env:CGO_ENABLED = "1"
    go build -ldflags "$ldflags" -o "$AppName.exe" .
    if ($LASTEXITCODE -eq 0) {
        Write-Color "GREEN" "build" "编译完成: .\$AppName.exe (version: $version)"
    } else {
        Write-Color "RED" "build" "编译失败 (exit code: $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
}

function Invoke-Dev {
    # 检查旧进程
    $savedPid = Get-Pid
    if ($savedPid -and (Test-ProcessRunning $savedPid)) {
        Write-Color "YELLOW" "dev" "检测到 PID 文件，尝试先停止旧进程..."
        Invoke-Stop -force:$true
    }

    Write-Color "CYAN" "dev" "以开发者模式启动..."
    $port = Get-Port

    # 仅在二进制不存在时编译
    if (-not (Test-Path "$AppName.exe")) {
        Write-Color "YELLOW" "dev" "二进制文件不存在，先编译..."
        Invoke-Build
    }

    # 后台启动进程，重定向输出以便失败时诊断
    $errFile = [System.IO.Path]::GetTempFileName()
    $savedEnv = $env:GIN_MODE
    $env:GIN_MODE = "debug"
    $proc = Start-Process -FilePath ".\$AppName.exe" -WindowStyle Hidden -PassThru -RedirectStandardError $errFile
    $env:GIN_MODE = $savedEnv
    $procId = $proc.Id

    # 写入 PID 文件
    $procId | Out-File -FilePath $PidFile -Encoding ASCII

    Start-Sleep -Seconds 2

    if (Test-ProcessRunning $procId) {
        Write-Color "GREEN" "dev" "已启动 (PID: $procId, 端口: $port, 日志: $LogFile)"
        Write-Host "查看输出: Get-Content -Path '$LogFile' -Wait" -ForegroundColor Gray
    } else {
        Write-Color "RED" "dev" "启动失败"
        # 读取并输出重定向的错误信息
        if (Test-Path $errFile) {
            $errMsg = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
            if ($errMsg) { Write-Host $errMsg -ForegroundColor Red }
            Remove-Item $errFile -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $PidFile) { Remove-Item $PidFile }
    }
}

function Invoke-Run {
    # 检查旧进程
    $savedPid = Get-Pid
    if ($savedPid -and (Test-ProcessRunning $savedPid)) {
        Write-Color "YELLOW" "run" "检测到 PID 文件，尝试先停止旧进程..."
        Invoke-Stop -force:$true
    }

    # 检查二进制
    if (-not (Test-Path "$AppName.exe")) {
        Write-Color "YELLOW" "run" "二进制文件不存在，先编译..."
        Invoke-Build
    }

    Write-Color "CYAN" "run" "以生产模式启动..."
    $port = Get-Port

    # 后台启动进程，重定向输出以便失败时诊断
    $errFile = [System.IO.Path]::GetTempFileName()
    $savedEnv = $env:GIN_MODE
    $env:GIN_MODE = "release"
    $proc = Start-Process -FilePath ".\$AppName.exe" -WindowStyle Hidden -PassThru -RedirectStandardError $errFile
    $env:GIN_MODE = $savedEnv
    $procId = $proc.Id

    $procId | Out-File -FilePath $PidFile -Encoding ASCII

    Start-Sleep -Seconds 2

    if (Test-ProcessRunning $procId) {
        Write-Color "GREEN" "run" "已启动 (PID: $procId, 端口: $port)"
    } else {
        Write-Color "RED" "run" "启动失败"
        # 读取并输出重定向的错误信息
        if (Test-Path $errFile) {
            $errMsg = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
            if ($errMsg) { Write-Host $errMsg -ForegroundColor Red }
            Remove-Item $errFile -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $PidFile) { Remove-Item $PidFile }
    }
}

# --- 通过 PID 文件优雅停止进程 ---
function Stop-ByPidFile {
    $savedPid = Get-Pid
    if (-not $savedPid) { return $false }

    if (-not (Test-ProcessRunning $savedPid)) {
        Write-Color "YELLOW" "stop" "PID $savedPid 已不存在，清理 PID 文件"
        if (Test-Path $PidFile) { Remove-Item $PidFile -ErrorAction SilentlyContinue }
        return $false
    }

    Write-Color "CYAN" "stop" "正在停止进程 (PID: $savedPid)..."

    # 优先使用 taskkill 发送关闭信号（Windows 上触发 Go 信号处理器的优雅关闭）
    taskkill /PID $savedPid 2>$null
    Start-Sleep -Seconds 1

    if (-not (Test-ProcessRunning $savedPid)) {
        Write-Color "GREEN" "stop" "进程已退出"
        if (Test-Path $PidFile) { Remove-Item $PidFile -ErrorAction SilentlyContinue }
        return $true
    }

    # 等待最多 5 秒
    $waited = 0
    while ($waited -lt 5 -and (Test-ProcessRunning $savedPid)) {
        Start-Sleep -Seconds 1
        $waited++
    }

    if (Test-ProcessRunning $savedPid) {
        Write-Color "YELLOW" "stop" "进程未在 5 秒内退出，强制终止"
        Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
    } else {
        Write-Color "GREEN" "stop" "进程已退出"
    }
    if (Test-Path $PidFile) { Remove-Item $PidFile -ErrorAction SilentlyContinue }
    return $true
}

# --- 端口清理 ---
function Invoke-PortCleanup {
    param([switch]$Force)
    $port = Get-Port
    $portPids = Get-ProcessOnPort $port
    if ($portPids.Count -eq 0) { return }

    Write-Host ""
    Write-Color "RED" "stop" "端口 $port 仍被以下进程占用: $($portPids -join ', ')"

    $shouldKill = $Force
    if (-not $shouldKill -and [Environment]::UserInteractive) {
        $shouldKill = (Read-Host "是否强制结束占用端口的进程？[y/N]") -eq "y"
    } elseif (-not $shouldKill) {
        Write-Color "YELLOW" "stop" "非交互模式，跳过端口清理"
        return
    }

    foreach ($p in $portPids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Write-Color "GREEN" "stop" "已强制终止进程 $p"
    }
}

function Invoke-Stop {
    Write-Color "CYAN" "stop" "正在停止..."
    Stop-ByPidFile
    Invoke-PortCleanup -Force:$Force
}

function Invoke-Test {
    Write-Color "CYAN" "test" "运行测试..."
    go test -v ./...
    Write-Color "GREEN" "test" "测试完成"
}

function Invoke-Lint {
    Write-Color "CYAN" "lint" "运行 go vet..."
    go vet ./...
    Write-Color "GREEN" "lint" "检查完成"
}

function Invoke-Clean {
    Write-Color "CYAN" "clean" "清理编译产物..."
    if (Test-Path "$AppName.exe") {
        Remove-Item "$AppName.exe" -Force
        Write-Color "GREEN" "clean" "已删除二进制文件: $AppName.exe"
    }

    Write-Color "CYAN" "clean" "清理 Go 缓存..."
    go clean -cache -testcache 2>$null
    Write-Color "GREEN" "clean" "Go 缓存已清理"

    Write-Color "CYAN" "clean" "清理临时文件..."
    Get-ChildItem -Path . -Filter "*.log" | Where-Object { -not $_.PSIsContainer } | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path . -Filter "*.out" | Where-Object { -not $_.PSIsContainer } | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path . -Filter "*.test" | Where-Object { -not $_.PSIsContainer } | Remove-Item -Force -ErrorAction SilentlyContinue
    if (Test-Path $PidFile) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path "tmp") { Remove-Item "tmp" -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Color "GREEN" "clean" "临时文件已清理"

    Write-Color "CYAN" "clean" "保留 ./data 目录及其下所有文件"
}

function Invoke-Rebuild {
    Invoke-Clean
    Invoke-Build
}

function Invoke-Restart {
    Invoke-Stop
    Invoke-Run
}

# =============================================
# 入口
# =============================================

# .env 预检查（仅对需要 .env 的命令执行）
$needsDotEnv = @("build", "dev", "run", "stop", "rebuild", "restart")
if ($Command.ToLower() -in $needsDotEnv) {
    $envPath = Join-Path (Get-Location) ".env"
    if (-not (Test-Path $envPath)) {
        Write-Color "RED" "error" "未找到 .env 文件，请复制 .env.example 并配置"
        exit 1
    }
    $envContent = Get-Content $envPath -Raw -ErrorAction SilentlyContinue
    if ($envContent -notmatch 'DB_KEY=[0-9a-fA-F]{64}') {
        Write-Color "RED" "error" ".env 中缺少有效的 DB_KEY（需 64 位十六进制字符串）"
        Write-Host "  执行以下命令生成: openssl rand -hex 32" -ForegroundColor Gray
        exit 1
    }
}

switch ($Command.ToLower()) {
    "build"   { Invoke-Build }
    "dev"     { Invoke-Dev }
    "run"     { Invoke-Run }
    "stop"    { Invoke-Stop }
    "test"    { Invoke-Test }
    "lint"    { Invoke-Lint }
    "clean"   { Invoke-Clean }
    "rebuild" { Invoke-Rebuild }
    "restart" { Invoke-Restart }
    "help"    { Invoke-Help }
    default   {
        Write-Color "RED" "error" "未知命令: $Command"
        Write-Host "使用 '.\labtrace.ps1 help' 查看可用命令"
        exit 1
    }
}
