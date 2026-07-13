<?php

declare(strict_types=1);

namespace Naviyra\Security\Services;

final class ThreatDetector
{
    /** @var list<array{type:string,severity:string,pattern:string}> */
    private array $rules = [
        ['type' => 'sql_injection', 'severity' => 'critical', 'pattern' => '/(\bunion\b.+\bselect\b|\bselect\b.+\bfrom\b|\bdrop\b.+\btable\b|\bor\b\s+1\s*=\s*1|--|\#|;\s*--|\bxp_\w+)/i'],
        ['type' => 'sql_injection', 'severity' => 'high', 'pattern' => '/(\binsert\b.+\binto\b|\bupdate\b.+\bset\b|\bdelete\b.+\bfrom\b)/i'],
        ['type' => 'xss', 'severity' => 'high', 'pattern' => '/(<script\b|javascript\s*:|onerror\s*=|onload\s*=|<iframe\b|document\.cookie)/i'],
        ['type' => 'path_traversal', 'severity' => 'high', 'pattern' => '/(\.\.\/|\.\.\\\\|%2e%2e%2f|%2e%2e%5c)/i'],
        ['type' => 'scanner', 'severity' => 'medium', 'pattern' => '/(\/wp-admin|\/wp-login|\/\.env|\/phpmyadmin|\/\.git|\/admin\.php|\/xmlrpc\.php|\/shell\.php)/i'],
        ['type' => 'scanner', 'severity' => 'medium', 'pattern' => '/(nikto|sqlmap|acunetix|nmap|masscan|dirbuster|gobuster)/i'],
    ];

    /** @var list<string> */
    private array $botPatterns = [
        '/bot/i', '/crawl/i', '/spider/i', '/slurp/i', '/curl/i', '/wget/i',
        '/python-requests/i', '/Go-http-client/i', '/libwww/i',
    ];

    /**
     * @return list<array{type:string,severity:string,payload:string}>
     */
    public function analyze(string $url, ?string $userAgent, ?string $body = null): array
    {
        $haystack = $url . ' ' . ($body ?? '');
        $findings = [];

        foreach ($this->rules as $rule) {
            if (preg_match($rule['pattern'], $haystack, $m)) {
                $findings[] = [
                    'type' => $rule['type'],
                    'severity' => $rule['severity'],
                    'payload' => substr($m[0], 0, 500),
                ];
            }
        }

        if ($userAgent !== null && $userAgent !== '') {
            foreach ($this->botPatterns as $pattern) {
                if (preg_match($pattern, $userAgent)) {
                    $findings[] = [
                        'type' => 'bot',
                        'severity' => 'low',
                        'payload' => substr($userAgent, 0, 200),
                    ];
                    break;
                }
            }
        }

        return $findings;
    }

    public function isBruteForce(\PDO $db, string $ip, int $windowMinutes = 15, int $threshold = 20): bool
    {
        $stmt = $db->prepare(
            'SELECT COUNT(*) FROM security_events
             WHERE ip_address = ? AND threat_type IN (\'brute_force\', \'scanner\')
             AND detected_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)'
        );
        $stmt->execute([$ip, $windowMinutes]);
        return (int) $stmt->fetchColumn() >= $threshold;
    }
}
