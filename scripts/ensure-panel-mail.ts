/**
 * After deploy: sync panel DB mail host + MAIL_FROM mailbox from .env.
 * Uses PANEL_HOSTNAME / PANEL_PUBLIC_URL / MAIL_HOSTNAME / MAIL_FROM — not hardcoded brands.
 *
 * Run: cd /opt/naviyra-panel && set -a && source .env && set +a && \
 *   npx tsx --tsconfig tsconfig.json scripts/ensure-panel-mail.ts
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getPanelBaseDomain } from "../src/lib/base-domain";
import { getSystemMailFromAddress } from "../src/lib/mail/system-mail";
import { ensurePanelBaseDomain } from "../src/lib/services/domains";
import {
  createMailAccount,
  ensureMailHostSetup,
} from "../src/lib/services/mail";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const panelDomain = getPanelBaseDomain();
  if (!panelDomain) {
    console.log("ensure_panel_mail=skipped (no PANEL_HOSTNAME / PANEL_PUBLIC_URL)");
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) {
    console.log("ensure_panel_mail=skipped (no admin user yet)");
    return;
  }

  const domain = await ensurePanelBaseDomain(admin.id);
  if (!domain) {
    console.log("ensure_panel_mail=skipped (panel domain row missing)");
    return;
  }

  console.log("ensure_panel_mail domain=", domain.name);

  try {
    const host = await ensureMailHostSetup(domain.id, admin.id);
    console.log("ensure_panel_mail host=", host);
  } catch (error) {
    console.error("ensure_panel_mail host_setup_failed", error);
  }

  const from = getSystemMailFromAddress();
  const at = from.lastIndexOf("@");
  if (at <= 0) {
    console.log("ensure_panel_mail=skip_mailbox bad MAIL_FROM", from);
    return;
  }
  const localPart = from.slice(0, at);
  const mailDomainName = from.slice(at + 1).toLowerCase();

  let mailDomainRow = await prisma.domain.findFirst({
    where: { name: mailDomainName },
  });

  // MAIL_FROM may use a customer/hosted domain (SPF); ensure that domain exists for admin
  if (!mailDomainRow && mailDomainName === panelDomain) {
    mailDomainRow = domain;
  }
  if (!mailDomainRow) {
    console.log(
      "ensure_panel_mail=skip_mailbox domain not in panel DB:",
      mailDomainName,
      "(create the domain or set MAIL_FROM to an existing mailbox domain)"
    );
    return;
  }

  const email = `${localPart}@${mailDomainName}`;
  const existing = await prisma.mailAccount.findUnique({ where: { email } });
  if (existing) {
    console.log("ensure_panel_mail mailbox_exists", email);
    // Still ensure that domain's mail.* host
    if (mailDomainRow.id !== domain.id) {
      try {
        await ensureMailHostSetup(mailDomainRow.id, mailDomainRow.userId);
      } catch (error) {
        console.error("ensure_panel_mail secondary_host_failed", error);
      }
    }
    return;
  }

  const pass = `Nv${randomBytes(6).toString("hex")}!`;
  try {
    await createMailAccount({
      domainId: mailDomainRow.id,
      userId: mailDomainRow.userId,
      localPart,
      password: pass,
      quotaMb: 256,
    });
    console.log("ensure_panel_mail mailbox_created", email);
  } catch (error) {
    // Agent may have created MTA mailbox already; upsert DB only
    console.error("ensure_panel_mail create_failed", error);
    const md =
      (await prisma.mailDomain.findUnique({
        where: { domainId: mailDomainRow.id },
      })) ??
      (await prisma.mailDomain.create({ data: { domainId: mailDomainRow.id } }));
    const passwordHash = await hashPassword(pass);
    await prisma.mailAccount.upsert({
      where: { email },
      create: {
        email,
        passwordHash,
        quotaMb: 256,
        mailDomainId: md.id,
      },
      update: {},
    });
    console.log("ensure_panel_mail mailbox_upserted", email);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
