<?php

declare(strict_types=1);

namespace Naviyra\Security;

/** Resolve the connecting client IP (never trust body-supplied values for auth decisions). */
final class ClientIp
{
    public static function fromRequest(): string
    {
        $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if (self::isValid($remote)) {
            // Only honor X-Forwarded-For when the immediate peer is a trusted proxy/loopback
            if (self::isTrustedProxy($remote)) {
                $xff = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
                if ($xff !== '') {
                    $first = trim(explode(',', $xff)[0] ?? '');
                    if (self::isValid($first)) {
                        return $first;
                    }
                }
                $real = (string) ($_SERVER['HTTP_X_REAL_IP'] ?? '');
                if (self::isValid($real)) {
                    return $real;
                }
            }
            return $remote;
        }
        return '0.0.0.0';
    }

    public static function isValid(string $ip): bool
    {
        return filter_var($ip, FILTER_VALIDATE_IP) !== false;
    }

    private static function isTrustedProxy(string $ip): bool
    {
        if ($ip === '127.0.0.1' || $ip === '::1') {
            return true;
        }
        // Optional comma-separated trusted proxies in .env
        $raw = Config::get('TRUSTED_PROXIES', '') ?? '';
        if ($raw === '') {
            return false;
        }
        foreach (explode(',', $raw) as $proxy) {
            if (trim($proxy) === $ip) {
                return true;
            }
        }
        return false;
    }
}
