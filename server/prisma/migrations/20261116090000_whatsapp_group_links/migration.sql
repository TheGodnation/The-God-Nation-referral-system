-- One-time: the ministry's English and French WhatsApp groups for the About page.
-- Fills a link only when none is set yet, and never runs again, so the admin can change or remove them in Settings.
INSERT INTO "Settings" ("id", "whatsappGroupEnUrl", "whatsappGroupFrUrl", "updatedAt")
VALUES ('singleton', 'https://chat.whatsapp.com/CqA24dT3H30B59pB4hfcdU', 'https://chat.whatsapp.com/DUarwLdVVMQCbUDnhtQtRA', now())
ON CONFLICT ("id") DO UPDATE SET
  "whatsappGroupEnUrl" = COALESCE("Settings"."whatsappGroupEnUrl", EXCLUDED."whatsappGroupEnUrl"),
  "whatsappGroupFrUrl" = COALESCE("Settings"."whatsappGroupFrUrl", EXCLUDED."whatsappGroupFrUrl");
