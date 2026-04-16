// server/whatsappAutoReply.mjs
// ═══════════════════════════════════════════════════════════════
// Auto-resposta por palavra-chave no WhatsApp.
// Regras persistidas em whatsapp-autoreplies.json.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'whatsapp-autoreplies.json');
const COOLDOWN_MS = 60_000; // 1 min entre respostas iguais para o mesmo contato

let rules = [];
const cooldownMap = new Map(); // `${jid}:${ruleId}` -> timestamp

// ── Carregar regras do disco ──
function loadRules() {
  if (!existsSync(CONFIG_PATH)) return;
  try {
    const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (Array.isArray(data.rules)) rules = data.rules;
  } catch (err) {
    console.warn('[wa-autoreply] Falha ao carregar regras:', err?.message);
  }
}

function saveRules() {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ rules }, null, 2), 'utf8');
    console.log('[wa-autoreply] Regras salvas em', CONFIG_PATH);
    return true;
  } catch (err) {
    console.error('[wa-autoreply] Falha ao salvar regras:', err?.message);
    return false;
  }
}

// ── Inicializar ──
loadRules();

// ── Encontrar regra que casa com a mensagem ──
export function findMatchingRule(text) {
  if (!text || !rules.length) return null;
  const normalized = text.trim().toLowerCase();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const keyword of (rule.keywords || [])) {
      const kw = keyword.toLowerCase();
      if (rule.matchMode === 'exact') {
        if (normalized === kw) return rule;
      } else {
        // default: 'contains'
        if (normalized.includes(kw)) return rule;
      }
    }
  }
  return null;
}

// ── Verificar cooldown (evita spam) ──
export function checkCooldown(jid, ruleId) {
  const key = `${jid}:${ruleId}`;
  const lastSent = cooldownMap.get(key);
  if (lastSent && Date.now() - lastSent < COOLDOWN_MS) return false; // em cooldown
  cooldownMap.set(key, Date.now());
  return true; // pode enviar
}

// ── Admin: listar regras ──
export function getRules() {
  return rules.map(r => ({ ...r }));
}

// ── Admin: criar regra ──
export function createRule({ keywords, response, matchMode = 'contains', enabled = true }) {
  if (!Array.isArray(keywords) || !keywords.length || !response) return null;
  const rule = {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    keywords: keywords.map(k => String(k).trim()).filter(Boolean),
    response: String(response),
    matchMode: matchMode === 'exact' ? 'exact' : 'contains',
    enabled: Boolean(enabled),
    createdAt: new Date().toISOString(),
  };
  rules.push(rule);
  saveRules();
  return rule;
}

// ── Admin: atualizar regra ──
export function updateRule(id, updates) {
  const rule = rules.find(r => r.id === id);
  if (!rule) return null;
  if (Array.isArray(updates.keywords)) {
    rule.keywords = updates.keywords.map(k => String(k).trim()).filter(Boolean);
  }
  if (typeof updates.response === 'string') rule.response = updates.response;
  if (updates.matchMode === 'exact' || updates.matchMode === 'contains') rule.matchMode = updates.matchMode;
  if (typeof updates.enabled === 'boolean') rule.enabled = updates.enabled;
  saveRules();
  return { ...rule };
}

// ── Admin: deletar regra ──
export function deleteRule(id) {
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  saveRules();
  return true;
}

// ── Limpar cooldowns expirados (chamar periodicamente) ──
export function cleanupCooldowns() {
  const now = Date.now();
  for (const [key, ts] of cooldownMap) {
    if (now - ts > COOLDOWN_MS * 2) cooldownMap.delete(key);
  }
}
