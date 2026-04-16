// server/whatsappTemplateConfig.mjs
// ═══════════════════════════════════════════════════════════════
// Configuração persistente de templates WhatsApp por plano.
// Salva em whatsapp-templates.json ao lado deste arquivo.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'whatsapp-templates.json');

// ── Textos padrão dos templates (com placeholders {var}) ──

const DEFAULT_PAYMENT_APPROVED = [
  '✅ *Pagamento confirmado!*',
  '',
  'Olá, {customerName}! Seu pagamento do *{offerName}* no valor de *{amount}* foi aprovado com sucesso.',
  '',
  '━━━━━━━━━━━━━━━━━━━━',
  '📦 *Pedido:* {offerName}',
  '💰 *Valor:* {amount}',
  '📧 *E-mail do acesso:* {email}',
  '━━━━━━━━━━━━━━━━━━━━',
  '',
  '🚀 *Próximos passos:*',
  '1️⃣ Baixe o app ou acesse pelo navegador',
  '2️⃣ Entre com o *mesmo e-mail da compra*',
  '3️⃣ Seu acesso já está liberado automaticamente',
  '',
  '🔒 Sua compra tem *garantia de 30 dias*. Se não gostar, devolvemos seu dinheiro.',
  '',
  'Qualquer dúvida, é só responder esta mensagem! 💬',
].join('\n');

const DEFAULT_PIX_READY = [
  '⏳ *PIX pronto para pagamento!*',
  '',
  'Olá, {customerName}! Seu pedido do *{offerName}* no valor de *{amount}* está quase finalizado.',
  '',
  '━━━━━━━━━━━━━━━━━━━━',
  '📦 *Pedido:* {offerName}',
  '💰 *Valor:* {amount}',
  '━━━━━━━━━━━━━━━━━━━━',
  '',
  '📋 *Como pagar:*',
  '1️⃣ Copie o código PIX abaixo',
  '2️⃣ Abra o app do seu banco',
  '3️⃣ Escolha *Pagar com PIX → Copia e Cola*',
  '4️⃣ Cole o código e confirme',
  '',
  '🔑 *Código PIX:*',
  '```{pixCode}```',
  '',
  '⚡ Assim que o pagamento for confirmado, você receberá outra mensagem com as instruções de acesso.',
  '',
  'Qualquer dúvida, é só responder aqui! 💬',
].join('\n');

// ── Config padrão com os 3 planos ──

function buildDefaultConfig() {
  return {
    plans: {
      combo_mensal: {
        label: 'Combo Mensal',
        amountDisplay: 'R$ 39,90',
        amountCents: 3990,
        whatsappEnabled: true,
        audioEnabled: true,
        audioUrl: '',
        audioDelaySeconds: 3,
        templates: {
          payment_approved: DEFAULT_PAYMENT_APPROVED,
          pix_ready: DEFAULT_PIX_READY,
        },
        steps: {
          payment_approved: [
            { type: 'text', content: DEFAULT_PAYMENT_APPROVED, delayBefore: 0 },
          ],
          pix_ready: [
            { type: 'text', content: DEFAULT_PIX_READY, delayBefore: 0 },
          ],
        },
      },
      combo_trimestral: {
        label: 'Combo Trimestral',
        amountDisplay: 'R$ 94,90',
        amountCents: 9490,
        whatsappEnabled: true,
        audioEnabled: true,
        audioUrl: '',
        audioDelaySeconds: 3,
        templates: {
          payment_approved: DEFAULT_PAYMENT_APPROVED,
          pix_ready: DEFAULT_PIX_READY,
        },
        steps: {
          payment_approved: [
            { type: 'text', content: DEFAULT_PAYMENT_APPROVED, delayBefore: 0 },
          ],
          pix_ready: [
            { type: 'text', content: DEFAULT_PIX_READY, delayBefore: 0 },
          ],
        },
      },
      combo_semestral: {
        label: 'Combo Semestral',
        amountDisplay: 'R$ 159,90',
        amountCents: 15990,
        whatsappEnabled: true,
        audioEnabled: true,
        audioUrl: '',
        audioDelaySeconds: 3,
        templates: {
          payment_approved: DEFAULT_PAYMENT_APPROVED,
          pix_ready: DEFAULT_PIX_READY,
        },
        steps: {
          payment_approved: [
            { type: 'text', content: DEFAULT_PAYMENT_APPROVED, delayBefore: 0 },
          ],
          pix_ready: [
            { type: 'text', content: DEFAULT_PIX_READY, delayBefore: 0 },
          ],
        },
      },
    },
  };
}

// ── Leitura / Escrita ──

/**
 * Migra plano antigo (templates + audioUrl) para novo formato de steps.
 * Chamado automaticamente ao carregar configs legadas.
 */
function ensureSteps(plan) {
  if (plan.steps && typeof plan.steps === 'object'
      && Array.isArray(plan.steps.payment_approved)) return;
  plan.steps = {};
  for (const event of ['payment_approved', 'pix_ready']) {
    const arr = [];
    if (plan.templates?.[event]) {
      arr.push({ type: 'text', content: plan.templates[event], delayBefore: 0 });
    }
    if (event === 'payment_approved' && plan.audioEnabled !== false && (plan.audioUrl || '').trim()) {
      arr.push({ type: 'audio', audioUrl: plan.audioUrl.trim(), delayBefore: plan.audioDelaySeconds ?? 3 });
    }
    if (arr.length === 0) {
      const defaults = buildDefaultConfig();
      const defPlan = Object.values(defaults.plans)[0];
      arr.push({ type: 'text', content: defPlan.templates[event], delayBefore: 0 });
    }
    plan.steps[event] = arr;
  }
}

let cachedConfig = null;

export function loadConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      // Merge com defaults para garantir que planos novos existam
      const defaults = buildDefaultConfig();
      for (const key of Object.keys(defaults.plans)) {
        if (!parsed.plans?.[key]) {
          parsed.plans = parsed.plans || {};
          parsed.plans[key] = defaults.plans[key];
        }
      }
      cachedConfig = parsed;
      // Migra planos antigos para formato de steps
      for (const key of Object.keys(cachedConfig.plans || {})) {
        ensureSteps(cachedConfig.plans[key]);
      }
      return cachedConfig;
    }
  } catch (err) {
    console.warn('[wa-template-config] Erro ao ler config, usando defaults:', err.message);
  }
  cachedConfig = buildDefaultConfig();
  return cachedConfig;
}

export function saveConfig(config) {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    cachedConfig = config;
    console.log('[wa-template-config] Config salva em', CONFIG_PATH);
    return true;
  } catch (err) {
    console.error('[wa-template-config] Erro ao salvar config:', err.message);
    return false;
  }
}

export function getConfig() {
  return loadConfig();
}

export function updatePlanConfig(planKey, updates) {
  const config = loadConfig();
  if (!config.plans[planKey]) return false;
  Object.assign(config.plans[planKey], updates);
  return saveConfig(config);
}

// ── Renderização de template com variáveis ──

export function renderTemplate(templateText, vars = {}) {
  let text = String(templateText || '');
  for (const [key, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${key}}`, String(value || ''));
  }
  return text;
}

/**
 * Resolve o template para um plano + evento específico.
 * Retorna o texto renderizado com as variáveis.
 */
export function resolveTemplateForPlan(planKey, eventType, vars = {}) {
  const config = loadConfig();
  const plan = config.plans[planKey];
  if (!plan) return null;

  const templateText = plan.templates?.[eventType];
  if (!templateText) return null;

  return renderTemplate(templateText, {
    customerName: vars.customerName || 'Cliente',
    offerName: vars.offerName || plan.label,
    amount: vars.amount || plan.amountDisplay,
    email: vars.email || '',
    pixCode: vars.pixCode || '',
  });
}

/**
 * Resolve os steps de um plano + evento.
 * Retorna array de steps prontos para envio (texto já renderizado).
 */
export function resolveStepsForPlan(planKey, eventType, vars = {}) {
  const config = loadConfig();
  const plan = config.plans[planKey];
  if (!plan) return [];
  const rawSteps = plan.steps?.[eventType] || [];
  const fullVars = {
    customerName: vars.customerName || 'Cliente',
    offerName: vars.offerName || plan.label,
    amount: vars.amount || plan.amountDisplay,
    email: vars.email || '',
    pixCode: vars.pixCode || '',
  };
  return rawSteps.map(step => {
    if (step.type === 'text') {
      return { type: 'text', text: renderTemplate(step.content, fullVars), delayBefore: step.delayBefore || 0 };
    }
    if (step.type === 'audio') {
      return { type: 'audio', audioUrl: (step.audioUrl || '').trim(), delayBefore: step.delayBefore ?? 3 };
    }
    return step;
  });
}

/**
 * Dado o nome da oferta (ex: "Combo trimestral"), retorna a chave do plano.
 */
export function findPlanKeyByOfferName(offerName) {
  const normalized = String(offerName || '').toLowerCase().trim();
  const config = loadConfig();
  for (const [key, plan] of Object.entries(config.plans)) {
    if (plan.label.toLowerCase() === normalized) return key;
    if (key.replace('_', ' ') === normalized) return key;
  }
  // Fallback: busca parcial
  for (const [key, plan] of Object.entries(config.plans)) {
    if (normalized.includes(plan.label.toLowerCase().split(' ').pop())) return key;
  }
  return null;
}

/**
 * Retorna dados completos para o painel admin.
 */
export function getAdminConfigData() {
  const config = loadConfig();
  const plans = {};
  for (const [key, plan] of Object.entries(config.plans)) {
    const payVars = { customerName: 'João', offerName: plan.label, amount: plan.amountDisplay, email: 'joao@email.com', pixCode: '' };
    const pixVars = { customerName: 'João', offerName: plan.label, amount: plan.amountDisplay, email: '', pixCode: '00020126580014br.gov.bcb.pix0136exemplo-pix-code' };
    const buildPreview = (steps, vars) => (steps || []).map(s =>
      s.type === 'text' ? { ...s, renderedContent: renderTemplate(s.content, vars) } : { ...s }
    );
    plans[key] = {
      ...plan,
      previews: {
        payment_approved: renderTemplate(plan.templates?.payment_approved || '', payVars),
        pix_ready: renderTemplate(plan.templates?.pix_ready || '', pixVars),
      },
      stepPreviews: {
        payment_approved: buildPreview(plan.steps?.payment_approved, payVars),
        pix_ready: buildPreview(plan.steps?.pix_ready, pixVars),
      },
    };
  }
  return { plans, defaults: { payment_approved: DEFAULT_PAYMENT_APPROVED, pix_ready: DEFAULT_PIX_READY } };
}
