<?php

declare(strict_types=1);

namespace Naviyra\Security;

final class Jwt
{
    public static function encode(array $payload): string
    {
        $header = self::b64(['typ' => 'JWT', 'alg' => 'HS256']);
        $payload['iat'] = time();
        $payload['exp'] = time() + Config::int('JWT_TTL', 86400);
        $body = self::b64($payload);
        $sig = self::sign("{$header}.{$body}");
        return "{$header}.{$body}.{$sig}";
    }

    public static function decode(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        [$header, $body, $sig] = $parts;
        if (!hash_equals(self::sign("{$header}.{$body}"), $sig)) {
            return null;
        }
        $payload = json_decode(self::b64Decode($body), true);
        if (!is_array($payload)) {
            return null;
        }
        if (($payload['exp'] ?? 0) < time()) {
            return null;
        }
        return $payload;
    }

    private static function sign(string $data): string
    {
        $secret = Config::get('JWT_SECRET', '');
        if ($secret === null || strlen($secret) < 16) {
            throw new \RuntimeException('JWT_SECRET must be at least 16 characters');
        }
        return self::b64Raw(hash_hmac('sha256', $data, $secret, true));
    }

    private static function b64(array $data): string
    {
        return self::b64Raw(json_encode($data, JSON_UNESCAPED_UNICODE));
    }

    private static function b64Raw(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64Decode(string $data): string
    {
        $pad = 4 - (strlen($data) % 4);
        if ($pad < 4) {
            $data .= str_repeat('=', $pad);
        }
        return (string) base64_decode(strtr($data, '-_', '+/'), true);
    }
}
