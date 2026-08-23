process.env.NODE_ENV = process.env.NODE_ENV || "development";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { buildHttpVhost, buildHttpsVhost, expandSslHosts } = await import("./nginx");

describe("nginx vhost templates", () => {
  it("uses the hostname and document root passed in, not a hardcoded site", () => {
    const host = "client-site.example";
    const root = "/var/www/client-site.example/public_html";
    const conf = buildHttpVhost([host], root, {
      phpEnabled: true,
      phpFpmPass: "unix:/run/php/php8.3-fpm.sock",
    });
    assert.match(conf, /server_name client-site\.example;/);
    assert.match(conf, /root \/var\/www\/client-site\.example\/public_html;/);
    assert.match(conf, /fastcgi_pass unix:\/run\/php\/php8\.3-fpm\.sock;/);
    assert.doesNotMatch(conf, /kongunattugounder/i);
  });

  it("writes HTTPS names and cert paths from the same hostname", () => {
    const host = "shop.example.org";
    const root = "/var/www/shop.example.org/public_html";
    const certDir = "/etc/letsencrypt/live/shop.example.org";
    const conf = buildHttpsVhost([host], root, certDir, { phpEnabled: false });
    assert.match(conf, /server_name shop\.example\.org;/);
    assert.match(conf, /ssl_certificate\s+\/etc\/letsencrypt\/live\/shop\.example\.org\/fullchain\.pem;/);
    assert.match(conf, /include \/etc\/nginx\/snippets\/naviyra-ssl-params\.conf;/);
    assert.doesNotMatch(conf, /include \/etc\/letsencrypt\/options-ssl-nginx\.conf;/);
    assert.match(conf, /root \/var\/www\/shop\.example\.org\/public_html;/);
  });

  it("expands extra labels from the caller", () => {
    const hosts = expandSslHosts("example.com", ["www", "app"]);
    assert.deepEqual(hosts.sort(), ["app.example.com", "example.com", "www.example.com"].sort());
  });
});
