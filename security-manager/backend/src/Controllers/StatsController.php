<?php

declare(strict_types=1);

namespace Naviyra\Security\Controllers;

use Naviyra\Security\Database;
use Naviyra\Security\Response;
use Naviyra\Security\Services\StatsService;
use PDO;

final class StatsController
{
    private StatsService $stats;

    public function __construct()
    {
        $this->stats = new StatsService(Database::connect());
    }

    public function overview(): void
    {
        $domainId = isset($_GET['domain_id']) ? (int) $_GET['domain_id'] : null;
        Response::json(['stats' => $this->stats->overview($domainId)]);
    }

    public function chart(): void
    {
        $days = min(90, max(1, (int) ($_GET['days'] ?? 7)));
        $domainId = isset($_GET['domain_id']) ? (int) $_GET['domain_id'] : null;
        Response::json([
            'chart' => $this->stats->trafficChart($days, $domainId),
            'countries' => $this->stats->topCountries($domainId),
        ]);
    }
}
