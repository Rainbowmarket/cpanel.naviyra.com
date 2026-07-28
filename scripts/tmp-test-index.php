<?php
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PHP OK</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0">
  <h1>PHP is running on the server</h1>
  <p>If you see this page in the browser, <code>index.php</code> is executed (not downloaded).</p>
  <p>PHP version: <?php echo htmlspecialchars(PHP_VERSION); ?></p>
  <p>Host: <?php echo htmlspecialchars($_SERVER['HTTP_HOST'] ?? ''); ?></p>
  <p>Time: <?php echo date('c'); ?></p>
  <p><a style="color:#34d399" href="/index.php?t=<?php echo time(); ?>">Force reload index.php</a></p>
</body>
</html>
