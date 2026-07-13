<?php

declare(strict_types=1);

namespace Naviyra\Security;

final class Config
{
    private static ?array $env = null;

    public static function load(string $envPath): void
    {
        if (!is_file($envPath)) {
            throw new \RuntimeException("Missing config: {$envPath}");
        }
        $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        self::$env = [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            [$key, $value] = array_pad(explode('=', $line, 2), 2, '');
            self::$env[trim($key)] = trim($value, " \t\"'");
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        return self::$env[$key] ?? $default;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $v = strtolower((string) self::get($key, $default ? 'true' : 'false'));
        return in_array($v, ['1', 'true', 'yes', 'on'], true);
    }

    public static function int(string $key, int $default = 0): int
    {
        return (int) (self::get($key, (string) $default) ?? $default);
    }
}
