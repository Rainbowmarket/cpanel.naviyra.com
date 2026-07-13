<?php

declare(strict_types=1);

namespace Naviyra\Security\Services;

use Naviyra\Security\Config;

final class GeoService
{
    public function lookup(string $ip): array
    {
        if ($this->isPrivate($ip)) {
            return ['country_code' => '—', 'country_name' => 'Local/Private'];
        }

        $dbPath = Config::get('GEOIP_DB_PATH', '');
        if ($dbPath && is_file($dbPath) && class_exists('GeoIp2\\Database\\Reader')) {
            try {
                $reader = new \GeoIp2\Database\Reader($dbPath);
                $record = $reader->country($ip);
                return [
                    'country_code' => $record->country->isoCode ?? null,
                    'country_name' => $record->country->name ?? null,
                ];
            } catch (\Throwable) {
                // fall through
            }
        }

        // Lightweight HTTP fallback (rate-limited in production; cache recommended)
        $ctx = stream_context_create(['http' => ['timeout' => 2]]);
        $json = @file_get_contents("http://ip-api.com/json/{$ip}?fields=status,country,countryCode", false, $ctx);
        if ($json) {
            $data = json_decode($json, true);
            if (($data['status'] ?? '') === 'success') {
                return [
                    'country_code' => $data['countryCode'] ?? null,
                    'country_name' => $data['country'] ?? null,
                ];
            }
        }

        return ['country_code' => null, 'country_name' => null];
    }

    public function parseUserAgent(?string $ua): array
    {
        if ($ua === null || $ua === '') {
            return ['browser' => 'Unknown', 'os' => 'Unknown'];
        }

        $browser = 'Unknown';
        if (preg_match('/Edg\/([\d.]+)/', $ua)) {
            $browser = 'Edge';
        } elseif (preg_match('/Chrome\/([\d.]+)/', $ua)) {
            $browser = 'Chrome';
        } elseif (preg_match('/Firefox\/([\d.]+)/', $ua)) {
            $browser = 'Firefox';
        } elseif (preg_match('/Safari\/([\d.]+)/', $ua) && !str_contains($ua, 'Chrome')) {
            $browser = 'Safari';
        }

        $os = 'Unknown';
        if (preg_match('/Windows NT/', $ua)) {
            $os = 'Windows';
        } elseif (preg_match('/Mac OS X/', $ua)) {
            $os = 'macOS';
        } elseif (preg_match('/Android/', $ua)) {
            $os = 'Android';
        } elseif (preg_match('/iPhone|iPad/', $ua)) {
            $os = 'iOS';
        } elseif (preg_match('/Linux/', $ua)) {
            $os = 'Linux';
        }

        return ['browser' => $browser, 'os' => $os];
    }

    private function isPrivate(string $ip): bool
    {
        return !filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        );
    }
}
