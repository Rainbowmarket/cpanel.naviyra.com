#!/usr/bin/env php
<?php
/**
 * CLI: expire auto-blocked IPs older than AUTO_BLOCK_TTL_HOURS (default 48).
 * Usage: php scripts/expire-auto-blocks.php
 */
declare(strict_types=1);

$root = dirname(__DIR__);
require_once $root . '/backend/src/Config.php';
require_once $root . '/backend/src/Database.php';
require_once $root . '/backend/src/Services/FirewallService.php';

use Naviyra\Security\Config;
use Naviyra\Security\Database;
use Naviyra\Security\Services\FirewallService;

$env = $root . '/backend/.env';
if (!is_file($env)) {
    $env = $root . '/.env';
}
if (!is_file($env)) {
    fwrite(STDERR, "Missing .env\n");
    exit(1);
}
Config::load($env);
$db = Database::connect();
$fw = new FirewallService();
$ips = $fw->expireAutoBlocks($db);
echo 'Expired ' . count($ips) . " auto-block(s)\n";
if ($ips) {
    echo implode("\n", $ips) . "\n";
}
