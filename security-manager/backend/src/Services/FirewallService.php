<?php

declare(strict_types=1);

namespace Naviyra\Security\Services;

use Naviyra\Security\Config;

final class FirewallService
{
    public function isWhitelisted(\PDO $db, string $ip): bool
    {
        $stmt = $db->prepare('SELECT 1 FROM whitelisted_ips WHERE ip_address = ? LIMIT 1');
        $stmt->execute([$ip]);
        return (bool) $stmt->fetchColumn();
    }

    public function isBlocked(\PDO $db, string $ip): bool
    {
        $stmt = $db->prepare(
            'SELECT 1 FROM blocked_ips WHERE ip_address = ? AND is_active = 1 LIMIT 1'
        );
        $stmt->execute([$ip]);
        return (bool) $stmt->fetchColumn();
    }

    public function block(
        \PDO $db,
        string $ip,
        string $reason,
        string $source = 'manual',
        ?int $eventId = null,
        string $via = 'ufw'
    ): array {
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            throw new \InvalidArgumentException('Invalid IP address');
        }
        if ($this->isWhitelisted($db, $ip)) {
            throw new \RuntimeException('IP is whitelisted and cannot be blocked');
        }

        $stmt = $db->prepare(
            'INSERT INTO blocked_ips (ip_address, reason, source, security_event_id, blocked_via)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE reason = VALUES(reason), is_active = 1, blocked_at = NOW()'
        );
        $stmt->execute([$ip, $reason, $source, $eventId, $via]);

        $results = [];
        $method = Config::get('FIREWALL_METHOD', 'ufw');
        $dryRun = Config::bool('FIREWALL_DRY_RUN', true);

        if ($method === 'ufw' || $via === 'all') {
            $results['ufw'] = $this->runUfw($ip, true, $dryRun);
        }
        if ($method === 'iptables' || $via === 'all') {
            $results['iptables'] = $this->runIptables($ip, true, $dryRun);
        }
        if ($method === 'nginx' || $via === 'all') {
            $results['nginx'] = $this->syncNginxDeny($db, $dryRun);
        }

        return ['ip' => $ip, 'results' => $results];
    }

    public function unblock(\PDO $db, string $ip): array
    {
        $stmt = $db->prepare('UPDATE blocked_ips SET is_active = 0 WHERE ip_address = ?');
        $stmt->execute([$ip]);

        $dryRun = Config::bool('FIREWALL_DRY_RUN', true);
        $results = [
            'ufw' => $this->runUfw($ip, false, $dryRun),
            'iptables' => $this->runIptables($ip, false, $dryRun),
            'nginx' => $this->syncNginxDeny($db, $dryRun),
        ];

        return ['ip' => $ip, 'results' => $results];
    }

    private function runUfw(string $ip, bool $block, bool $dryRun): array
    {
        $cmd = $block
            ? "ufw deny from {$ip} to any"
            : "ufw delete deny from {$ip} to any";
        return $this->exec($cmd, $dryRun);
    }

    private function runIptables(string $ip, bool $block, bool $dryRun): array
    {
        $cmd = $block
            ? "iptables -I INPUT -s {$ip} -j DROP"
            : "iptables -D INPUT -s {$ip} -j DROP";
        return $this->exec($cmd, $dryRun);
    }

    public function syncNginxDeny(\PDO $db, bool $dryRun): array
    {
        $file = Config::get('NGINX_DENY_FILE', '/etc/nginx/naviyra-blocked-ips.conf');
        $rows = $db->query(
            'SELECT ip_address FROM blocked_ips WHERE is_active = 1 ORDER BY ip_address'
        )->fetchAll();

        $lines = ["# Naviyra Security Manager — auto-generated\n"];
        foreach ($rows as $row) {
            $lines[] = "deny {$row['ip_address']};";
        }
        $content = implode("\n", $lines) . "\n";

        if ($dryRun) {
            return ['ok' => true, 'dry_run' => true, 'file' => $file, 'count' => count($rows)];
        }

        if (@file_put_contents($file, $content) === false) {
            return ['ok' => false, 'error' => "Cannot write {$file}"];
        }

        $reload = $this->exec('nginx -t && systemctl reload nginx', false);
        return ['ok' => $reload['ok'], 'file' => $file, 'count' => count($rows), 'reload' => $reload];
    }

    private function exec(string $cmd, bool $dryRun): array
    {
        if ($dryRun) {
            return ['ok' => true, 'dry_run' => true, 'command' => $cmd];
        }
        $output = [];
        $code = 0;
        exec($cmd . ' 2>&1', $output, $code);
        return ['ok' => $code === 0, 'command' => $cmd, 'output' => implode("\n", $output), 'code' => $code];
    }
}
