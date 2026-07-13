<?php
/**
 * Lightweight visitor beacon — include on hosted sites or call via Nginx subrequest.
 *
 * GET /beacon.php?host=example.com&url=/page&ip=1.2.3.4
 * Header: X-Ingest-Key: your-key
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/src/Config.php';
require_once dirname(__DIR__) . '/backend/src/Database.php';
require_once dirname(__DIR__) . '/backend/src/Services/ThreatDetector.php';
require_once dirname(__DIR__) . '/backend/src/Services/GeoService.php';
require_once dirname(__DIR__) . '/backend/src/Services/FirewallService.php';
require_once dirname(__DIR__) . '/backend/src/Services/VisitorService.php';

use Naviyra\Security\Config;
use Naviyra\Security\Database;
use Naviyra\Security\Services\VisitorService;

header('Content-Type: application/json');

$envPath = dirname(__DIR__) . '/backend/.env';
if (!is_file($envPath)) {
    http_response_code(503);
    echo json_encode(['error' => 'Not configured']);
    exit;
}
Config::load($envPath);

$key = $_SERVER['HTTP_X_INGEST_KEY'] ?? '';
$expected = Config::get('INGEST_API_KEY', '');
if ($expected === '' || !hash_equals($expected, $key)) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

$host = $_GET['host'] ?? ($_SERVER['HTTP_HOST'] ?? '');
$url = $_GET['url'] ?? '/';
if ($host === '') {
    http_response_code(422);
    echo json_encode(['error' => 'host required']);
    exit;
}

$service = new VisitorService(Database::connect());
$result = $service->logVisit([
    'host' => $host,
    'url' => $url,
    'ip' => $_GET['ip'] ?? null,
    'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
    'referrer' => $_SERVER['HTTP_REFERER'] ?? null,
]);

echo json_encode(['ok' => true, 'result' => $result]);
