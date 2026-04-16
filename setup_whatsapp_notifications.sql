-- ============================================================
-- WhatsApp notification delivery tracking
-- Tabela para registrar cada envio de WhatsApp (template + áudio)
-- e evitar duplicatas. Também serve como log de auditoria.
-- ============================================================

CREATE TABLE IF NOT EXISTS checkout_notification_deliveries (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel         TEXT NOT NULL DEFAULT 'whatsapp',       -- 'whatsapp' | 'email'
  event_type      TEXT NOT NULL,                          -- 'payment_approved' | 'pix_ready'
  stable_id       TEXT NOT NULL,                          -- chave de dedup (checkoutOrderId ou providerOrderId)
  checkout_order_id TEXT,
  provider_order_id TEXT,
  recipient_phone TEXT,
  recipient_email TEXT,
  status          TEXT NOT NULL DEFAULT 'sent',           -- 'sent' | 'delivered' | 'read' | 'failed'
  scheduled_for   TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ DEFAULT now(),
  provider_message_id TEXT,                               -- wamid do WhatsApp ou id do Resend
  audio_media_id  TEXT,
  audio_message_id TEXT,
  last_error      TEXT,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Índice para evitar dupla entrega
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dedup
  ON checkout_notification_deliveries (channel, event_type, stable_id);

-- Busca por pedido
CREATE INDEX IF NOT EXISTS idx_notification_checkout_order
  ON checkout_notification_deliveries (checkout_order_id)
  WHERE checkout_order_id IS NOT NULL;

-- Busca por telefone
CREATE INDEX IF NOT EXISTS idx_notification_phone
  ON checkout_notification_deliveries (recipient_phone)
  WHERE recipient_phone IS NOT NULL;

-- RLS: apenas service_role pode ler/escrever (backend)
ALTER TABLE checkout_notification_deliveries ENABLE ROW LEVEL SECURITY;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION touch_notification_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_updated_at ON checkout_notification_deliveries;
CREATE TRIGGER trg_notification_updated_at
  BEFORE UPDATE ON checkout_notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION touch_notification_updated_at();
