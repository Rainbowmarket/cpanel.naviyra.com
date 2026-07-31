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
        $this->expireAutoBlocks($db);
        $stmt = $db->prepare(
            'SELECT 1 FROM blocked_ips WHERE ip_address = ? AND is_active = 1 LIMIT 1'
        );
        $stmt->execute([$ip]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Auto-source blocks expire after AUTO_BLOCK_TTL_HOURS (default 48).
     * Manual blocks are never auto-removed.
     *
     * @return list<string> Unblocked IPs
     */
    public function expireAutoBlocks(\PDO $db): array
    {
        $hours = max(1, Config::int('AUTO_BLOCK_TTL_HOURS', 48));
        $stmt = $db->prepare(
            "SELECT ip_address FROM blocked_ips
             WHERE is_active = 1 AND source = 'auto'
             AND blocked_at < DATE_SUB(NOW(), INTERVAL ? HOUR)"
        );
        $stmt->execute([$hours]);
        $ips = $stmt->fetchAll(\PDO::FETCH_COLUMN);
        $unblocked = [];
        foreach ($ips as $ip) {
            try {
                $this->unblock($db, (string) $ip);
                $unblocked[] = (string) $ip;
            } catch (\Throwable) {
                // continue other IPs
            }
        }
        return $unblocked;
    }

    public function block(
        \PDO $db,
        string $ip,
        string $reason,
        string $source = 'manual',
        ?int $eventId = null,
        string $via = 'ufw'
    ): array {
        $ip = $this->assertSafeIp($ip);
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
        $ip = $this->assertSafeIp($ip);
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

    private function assertSafeIp(string $ip): string
    {
        $ip = trim($ip);
        if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
            throw new \InvalidArgumentException('Invalid IP address');
        }
        return $ip;
    }

    private function runUfw(string $ip, bool $block, bool $dryRun): array
    {
        $ip = $this->assertSafeIp($ip);
        $argv = $block
            ? ['ufw', 'deny', 'from', $ip, 'to', 'any']
            : ['ufw', 'delete', 'deny', 'from', $ip, 'to', 'any'];
        return $this->execArgv($argv, $dryRun);
    }

    private function runIptables(string $ip, bool $block, bool $dryRun): array
    {
        $ip = $this->assertSafeIp($ip);
        $argv = $block
            ? ['iptables', '-I', 'INPUT', '-s', $ip, '-j', 'DROP']
            : ['iptables', '-D', 'INPUT', '-s', $ip, '-j', 'DROP'];
        return $this->execArgv($argv, $dryRun);
    }

    public function syncNginxDeny(\PDO $db, bool $dryRun): array
    {
        $file = Config::get('NGINX_DENY_FILE', '/etc/nginx/naviyra-blocked-ips.conf');
        $rows = $db->query(
            'SELECT ip_address FROM blocked_ips WHERE is_active = 1 ORDER BY ip_address'
        )->fetchAll();

        $lines = ["# Naviyra Security Manager — auto-generated\n"];
        foreach ($rows as $row) {
            $ip = (string) $row['ip_address'];
            if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
                continue;
            }
            $lines[] = 'deny ' . $ip . ';';
        }
        $content = implode("\n", $lines) . "\n";

        if ($dryRun) {
            return ['ok' => true, 'dry_run' => true, 'file' => $file, 'count' => count($rows)];
        }

        if (@file_put_contents($file, $content) === false) {
            return ['ok' => false, 'error' => "Cannot write {$file}"];
        }

        $test = $this->execArgv(['nginx', '-t'], false);
        if (!$test['ok']) {
            return ['ok' => false, 'file' => $file, 'reload' => $test];
        }
        $reload = $this->execArgv(['systemctl', 'reload', 'nginx'], false);
        return ['ok' => $reload['ok'], 'file' => $file, 'count' => count($rows), 'reload' => $reload];
    }

    /** @param string[] $argv */
    private function execArgv(array $argv, bool $dryRun): array
    {
        if (count($argv) === 0) {
            return ['ok' => false, 'error' => 'empty command'];
        }
        // Re-validate any token that looks like an IP (defense in depth)
        foreach ($argv as $token) {
            if (preg_match('/^\d{1,3}(\.\d{1,3}){3}$/', $token) || strpos($token, ':') !== false) {
                if (filter_var($token, FILTER_VALIDATE_IP) === false) {
                    return ['ok' => false, 'error' => 'refusing unsafe IP token'];
                }
            }
        }

        $display = implode(' ', array_map('escapeshellarg', $argv));
        if ($dryRun) {
            return [
                'ok' => true,
                'dry_run' => true,
                'command' => $display,
            ];
        }

        $cmd = $argv[0];
        $args = array_slice($argv, 1);
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $proc = proc_open(
            array_merge([$cmd], $args),
            $descriptors,
            $pipes,
            null,
            null,
            ['bypass_shell' => true]
        );
        if (!is_resource($proc)) {
            // Fallback for older PHP without array proc_open: still avoid shell metacharacters
            $escaped = escapeshellcmd($cmd);
            foreach ($args as $a) {
                $escaped .= ' ' . escapeshellarg($a);
            }
            $output = [];
            $code = 0;
            exec($escaped . ' 2>&1', $output, $code);
            return [
                'ok' => $code === 0,
                'command' => $display,
                'output' => implode("\n", $output),
                'code' => $code,
            ];
        }

        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]) ?: '';
        $stderr = stream_get_contents($pipes[2]) ?: '';
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($proc);

        return [
            'ok' => $code === 0,
            'command' => $display,
            'output' => trim($stdout . "\n" . $stderr),
            'code' => $code,
        ];
    }
}
