<?php

declare(strict_types=1);

namespace Naviyra\Security\Middleware;

use Naviyra\Security\Jwt;
use Naviyra\Security\Response;

final class AuthMiddleware
{
    public static function requireAdmin(): array
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/Bearer\s+(\S+)/', $header, $m)) {
            Response::error('Missing or invalid Authorization header', 401);
            exit;
        }
        $payload = Jwt::decode($m[1]);
        if ($payload === null || !isset($payload['sub'])) {
            Response::error('Invalid or expired token', 401);
            exit;
        }
        return $payload;
    }

    public static function requireIngestKey(): void
    {
        $key = $_SERVER['HTTP_X_INGEST_KEY'] ?? ($_GET['key'] ?? '');
        $expected = \Naviyra\Security\Config::get('INGEST_API_KEY', '');
        if ($expected === '' || !hash_equals($expected, (string) $key)) {
            Response::error('Invalid ingest key', 403);
            exit;
        }
    }
}
