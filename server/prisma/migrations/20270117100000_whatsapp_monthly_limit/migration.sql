-- A monthly cap on automatic WhatsApp messages (each delivered one is paid for). Starts at 300 a month; the central admin changes it.
ALTER TABLE "Settings" ADD COLUMN "whatsappMonthlyLimit" INTEGER NOT NULL DEFAULT 300;
