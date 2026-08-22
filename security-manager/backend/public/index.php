<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/Config.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Response.php';
require_once __DIR__ . '/../src/ClientIp.php';
require_once __DIR__ . '/../src/Jwt.php';
require_once __DIR__ . '/../src/Router.php';
require_once __DIR__ . '/../src/Middleware/AuthMiddleware.php';
require_once __DIR__ . '/../src/Services/ThreatDetector.php';
require_once __DIR__ . '/../src/Services/GeoService.php';
require_once __DIR__ . '/../src/Services/FirewallService.php';
require_once __DIR__ . '/../src/Services/VisitorService.php';
require_once __DIR__ . '/../src/Services/StatsService.php';
require_once __DIR__ . '/../src/Controllers/AuthController.php';
require_once __DIR__ . '/../src/Controllers/DomainsController.php';
require_once __DIR__ . '/../src/Controllers/VisitorsController.php';
require_once __DIR__ . '/../src/Controllers/StatsController.php';
require_once __DIR__ . '/../src/Controllers/SecurityController.php';
require_once __DIR__ . '/../src/Controllers/BlocklistController.php';
require_once __DIR__ . '/../src/Controllers/WhitelistController.php';
require_once __DIR__ . '/../src/Controllers/IngestController.php';

use Naviyra\Security\Config;
use Naviyra\Security\Middleware\AuthMiddleware;
use Naviyra\Security\Controllers\AuthController;
use Naviyra\Security\Controllers\DomainsController;
use Naviyra\Security\Controllers\VisitorsController;
use Naviyra\Security\Controllers\StatsController;
use Naviyra\Security\Controllers\SecurityController;
use Naviyra\Security\Controllers\BlocklistController;
use Naviyra\Security\Controllers\WhitelistController;
use Naviyra\Security\Controllers\IngestController;
use Naviyra\Security\Router;

$envPath = dirname(__DIR__) . '/.env';
if (!is_file($envPath)) {
    $envPath = dirname(__DIR__) . '/.env.example';
}
Config::load($envPath);

header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Ingest-Key');

// CORS: never default to *. Set CORS_ORIGIN explicitly (e.g. https://panel.example.com).
$corsOrigin = trim((string) (Config::get('CORS_ORIGIN', '') ?? ''));
if ($corsOrigin !== '' && $corsOrigin !== '*') {
    header('Access-Control-Allow-Origin: ' . $corsOrigin);
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: true');
} elseif ($corsOrigin === '*') {
    // Explicit * is allowed only for fully public read-only demos — no credentials.
    header('Access-Control-Allow-Origin: *');
}
// Empty CORS_ORIGIN → same-origin only (no ACAO header)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$router = new Router();
$auth = new AuthController();
$domains = new DomainsController();
$visitors = new VisitorsController();
$stats = new StatsController();
$security = new SecurityController();
$blocklist = new BlocklistController();
$whitelist = new WhitelistController();
$ingest = new IngestController();

// Public
$router->get('/', fn () => Naviyra\Security\Response::json([
    'name' => 'Naviyra Visitor & Security Manager API',
    'version' => '1.0.0',
]));
$router->post('/api/auth/login', fn () => $auth->login());

// Ingest (API key)
$router->post('/api/ingest', function () use ($ingest) {
    AuthMiddleware::requireIngestKey();
    $ingest->log();
});
$router->post('/api/ingest/batch', function () use ($ingest) {
    AuthMiddleware::requireIngestKey();
    $ingest->batch();
});
$router->post('/api/ingest/blocklist', function () use ($ingest) {
    AuthMiddleware::requireIngestKey();
    $ingest->blocklist();
});

// Protected
$router->get('/api/auth/me', function () use ($auth) {
    $payload = AuthMiddleware::requireAdmin();
    $auth->me($payload);
});
$router->get('/api/domains', function () use ($domains) {
    AuthMiddleware::requireAdmin();
    $domains->index();
});
$router->post('/api/domains', function () use ($domains) {
    AuthMiddleware::requireAdmin();
    $domains->store();
});
$router->delete('/api/domains/{id}', function ($p) use ($domains) {
    AuthMiddleware::requireAdmin();
    $domains->destroy((int) $p['id']);
});
$router->get('/api/visitors', function () use ($visitors) {
    AuthMiddleware::requireAdmin();
    $visitors->index();
});
$router->get('/api/visitors/live', function () use ($visitors) {
    AuthMiddleware::requireAdmin();
    $visitors->live();
});
$router->get('/api/stats/overview', function () use ($stats) {
    AuthMiddleware::requireAdmin();
    $stats->overview();
});
$router->get('/api/stats/chart', function () use ($stats) {
    AuthMiddleware::requireAdmin();
    $stats->chart();
});
$router->get('/api/security/events', function () use ($security) {
    AuthMiddleware::requireAdmin();
    $security->index();
});
$router->post('/api/security/events/{id}/block', function ($p) use ($security) {
    AuthMiddleware::requireAdmin();
    $security->blockFromEvent((int) $p['id']);
});
$router->get('/api/blocklist', function () use ($blocklist) {
    AuthMiddleware::requireAdmin();
    $blocklist->index();
});
$router->post('/api/blocklist', function () use ($blocklist) {
    AuthMiddleware::requireAdmin();
    $blocklist->store();
});
$router->delete('/api/blocklist/{ip}', function ($p) use ($blocklist) {
    AuthMiddleware::requireAdmin();
    $blocklist->destroy($p['ip']);
});
$router->get('/api/whitelist', function () use ($whitelist) {
    AuthMiddleware::requireAdmin();
    $whitelist->index();
});
$router->post('/api/whitelist', function () use ($whitelist) {
    AuthMiddleware::requireAdmin();
    $whitelist->store();
});
$router->delete('/api/whitelist/{id}', function ($p) use ($whitelist) {
    AuthMiddleware::requireAdmin();
    $whitelist->destroy((int) $p['id']);
});

$router->dispatch($_SERVER['REQUEST_METHOD'], $_SERVER['REQUEST_URI']);
