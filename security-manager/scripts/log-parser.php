#!/usr/bin/env php
<?php
/**
 * Parse Nginx combined access logs and send to Naviyra Security Manager ingest API.
 *
 * Usage:
 *   php log-parser.php /var/log/nginx/access.log
 *   php log-parser.php /var/log/nginx/*.log
 *
 * Cron (every minute):
 *   * * * * * php /opt/naviyra/security-manager/scripts/log-parser.php /var/log/nginx/access.log
 */

declare(strict_types=1);

$stateDir = sys_get_temp_dir() . '/naviyra-security';
if (!is_dir($stateDir)) {
    mkdir($stateDir, 0755, true);
}

$envFile = dirname(__DIR__) . '/backend/.env';
if (!is_file($envFile)) {
    fwrite(STDERR, "Missing backend/.env\n");
    exit(1);
}

$env = [];
foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $line = trim($line);
    if ($line === '' || $line[0] === '#') continue;
    [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
    $env[trim($k)] = trim($v, " \t\"'");
}

$apiUrl = rtrim($env['APP_URL'] ?? 'http://127.0.0.1:8090', '/') . '/api/ingest/batch';
$apiKey = $env['INGEST_API_KEY'] ?? '';

if ($argc < 2) {
    fwrite(STDERR, "Usage: php log-parser.php <log-file> [log-file...]\n");
    exit(1);
}

// Nginx combined: $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
$pattern = '/^(?<ip>\S+) \S+ \S+ \[(?<time>[^\]]+)\] "(?<method>\S+) (?<url>\S+) \S+" (?<status>\d+) \S+ "(?<referrer>[^"]*)" "(?<user_agent>[^"]*)"/';

for ($i = 1; $i < $argc; $i++) {
    $logFile = $argv[$i];
    if (!is_readable($logFile)) {
        fwrite(STDERR, "Cannot read: {$logFile}\n");
        continue;
    }

    $stateFile = $stateDir . '/' . md5(realpath($logFile) ?: $logFile) . '.offset';
    $offset = is_file($stateFile) ? (int) file_get_contents($stateFile) : 0;
    $fh = fopen($logFile, 'r');
    if (!$fh) continue;
    fseek($fh, $offset);

    $batch = [];
    while (($line = fgets($fh)) !== false) {
        if (!preg_match($pattern, trim($line), $m)) {
            continue;
        }
        $host = parse_url($m['url'], PHP_URL_HOST);
        if (!$host) {
            // relative URL — extract from server_name env or skip
            continue;
        }
        $path = parse_url($m['url'], PHP_URL_PATH) ?: '/';
        $query = parse_url($m['url'], PHP_URL_QUERY);
        $fullUrl = $path . ($query ? '?' . $query : '');

        $batch[] = [
            'host' => $host,
            'url' => $fullUrl,
            'method' => $m['method'],
            'ip' => $m['ip'],
            'user_agent' => $m['user_agent'],
            'referrer' => $m['referrer'] ?: null,
            'status_code' => (int) $m['status'],
        ];

        if (count($batch) >= 100) {
            sendBatch($apiUrl, $apiKey, $batch);
            $batch = [];
        }
    }

    if ($batch) {
        sendBatch($apiUrl, $apiKey, $batch);
    }

    file_put_contents($stateFile, (string) ftell($fh));
    fclose($fh);
}

function sendBatch(string $url, string $key, array $entries): void
{
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nX-Ingest-Key: {$key}\r\n",
            'content' => json_encode(['entries' => $entries]),
            'timeout' => 30,
        ],
    ]);
    $result = @file_get_contents($url, false, $ctx);
    if ($result === false) {
        fwrite(STDERR, "Ingest failed\n");
    }
}
