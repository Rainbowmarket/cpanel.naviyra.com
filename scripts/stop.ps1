# Stop Node processes started by Naviyra Panel (panel on 3000, agent on 4000)

Write-Host "Stopping Naviyra Panel (port 3000) and Agent (port 4000)..." -ForegroundColor Cyan

foreach ($port in @(3000, 4000)) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        $pids = $conn.OwningProcess | Sort-Object -Unique
        foreach ($pid in $pids) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped process $pid on port $port" -ForegroundColor Green
        }
    } else {
        Write-Host "Nothing running on port $port" -ForegroundColor Gray
    }
}
