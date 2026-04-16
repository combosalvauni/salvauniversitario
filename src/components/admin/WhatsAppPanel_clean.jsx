import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, MessageCircle, Send, CheckCircle, XCircle, RefreshCw,
  Phone, FileText, Save, RotateCcw, Wifi, WifiOff, Volume2, Edit3, Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cn } from '../../lib/utils';
import {
  getWhatsAppStatus, getWhatsAppConfig, saveWhatsAppConfig,
  reconnectWhatsApp, sendWhatsAppTest,
} from '../../lib/babylonApi';

const STATE_LABELS = { open: 'Conectado', connecting: 'Conectando...', close: 'Desconectado' };
const STATE_COLORS = { open: 'text-green-400', connecting: 'text-yellow-400', close: 'text-red-400' };
const STATE_DOT = { open: 'bg-green-400', connecting: 'bg-yellow-400', close: 'bg-red-400' };

const PLAN_ICONS = {
  combo_mensal: '📅',
  combo_trimestral: '📦',
  combo_semestral: '🏆',
};

const EVENT_LABELS = {
  payment_approved: 'Pagamento Aprovado',
  pix_ready: 'PIX Pronto',
};

const TEMPLATE_VARS = {
  payment_approved: ['customerName', 'offerName', 'amount', 'email'],
  pix_ready: ['customerName', 'offerName', 'amount', 'pixCode'],
};

function WhatsAppBubble({ text }) {
  return (
    <div className="rounded-2xl bg-[#0b141a] border border-white/10 p-4 max-w-lg">
      <div className="rounded-xl bg-[#005c4b] px-3 py-2 text-sm text-white whitespace-pre-wrap leading-relaxed">
        {text}
      </div>
      <div className="text-right mt-1">
        <span className="text-[10px] text-gray-500">12:00 ✓✓</span>
      </div>
    </div>
  );
}

export function WhatsAppPanel() {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [reconnecting, setReconnecting] = useState(false);

  const [selectedPlan, setSelectedPlan] = useState('combo_mensal');
  const [selectedEvent, setSelectedEvent] = useState('payment_approved');
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState('');

  const [sendForm, setSendForm] = useState({ phone: '', customerName: 'Teste' });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statusData, configData] = await Promise.all([
        getWhatsAppStatus(),
        getWhatsAppConfig(),
      ]);
      setStatus(statusData);
      setConfig(configData);
    } catch (err) {
      setError(err?.message || 'Erro ao carregar dados do WhatsApp.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    setEditMode(false);
    setSendResult(null);
  }, [selectedPlan, selectedEvent]);

  const plan = config?.plans?.[selectedPlan];
  const templateText = plan?.templates?.[selectedEvent] || '';
  const previewText = plan?.previews?.[selectedEvent] || '';

  const handleToggleWhatsApp = useCallback(async (planKey, enabled) => {
    if (!config) return;
    setSaving(true);
    try {
      const result = await saveWhatsAppConfig({ plans: { [planKey]: { whatsappEnabled: enabled } } });
      if (result?.config) setConfig(result.config);
      setSaveMsg('Salvo!');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      setError(err?.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleToggleAudio = useCallback(async (planKey, enabled) => {
    if (!config) return;
    setSaving(true);
    try {
      const result = await saveWhatsAppConfig({ plans: { [planKey]: { audioEnabled: enabled } } });
      if (result?.config) setConfig(result.config);
      setSaveMsg('Salvo!');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      setError(err?.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleSaveAudioUrl = useCallback(async (planKey, audioUrl) => {
    setSaving(true);
    try {
      const result = await saveWhatsAppConfig({ plans: { [planKey]: { audioUrl } } });
      if (result?.config) setConfig(result.config);
      setSaveMsg('URL do áudio salva!');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      setError(err?.message || 'Erro ao salvar URL do áudio.');
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSaveAudioDelay = useCallback(async (planKey, audioDelaySeconds) => {
    setSaving(true);
    try {
      const result = await saveWhatsAppConfig({ plans: { [planKey]: { audioDelaySeconds } } });
      if (result?.config) setConfig(result.config);
      setSaveMsg(`Delay salvo: ${audioDelaySeconds}s`);
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      setError(err?.message || 'Erro ao salvar delay.');
    } finally {
      setSaving(false);
    }
  }, []);

  const handleStartEdit = useCallback(() => {
    setEditText(templateText);
    setEditMode(true);
  }, [templateText]);

  const handleSaveTemplate = useCallback(async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const updated = {
        plans: {
          [selectedPlan]: {
            templates: { [selectedEvent]: editText },
          },
        },
      };
      const result = await saveWhatsAppConfig(updated);
      if (result?.config) setConfig(result.config);
      setEditMode(false);
      setSaveMsg('Template salvo!');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setError(err?.message || 'Erro ao salvar template.');
    } finally {
      setSaving(false);
    }
  }, [selectedPlan, selectedEvent, editText]);

  const handleResetTemplate = useCallback(async () => {
    if (!config?.defaults?.[selectedEvent]) return;
    setSaving(true);
    try {
      const updated = {
        plans: {
          [selectedPlan]: {
            templates: { [selectedEvent]: config.defaults[selectedEvent] },
          },
        },
      };
      const result = await saveWhatsAppConfig(updated);
      if (result?.config) setConfig(result.config);
      setEditMode(false);
      setSaveMsg('Restaurado para o padrão!');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setError(err?.message || 'Erro ao restaurar.');
    } finally {
      setSaving(false);
    }
  }, [config, selectedPlan, selectedEvent]);

  const handleReconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      const result = await reconnectWhatsApp();
      setStatus((prev) => ({ ...prev, state: result?.state || 'connecting', connected: result?.state === 'open' }));
    } catch (err) {
      setError(err?.message || 'Erro ao reconectar.');
    } finally {
      setReconnecting(false);
      setTimeout(fetchAll, 3000);
    }
  }, [fetchAll]);

  const handleSendTest = useCallback(async () => {
    setSending(true);
    setSendResult(null);
    try {
      const result = await sendWhatsAppTest({
        phone: sendForm.phone,
        customerName: sendForm.customerName,
        offerName: plan?.label || 'Combo Trimestral',
        amount: plan?.amountDisplay || 'R$ 94,90',
        email: 'teste@email.com',
        planKey: selectedPlan,
        templateId: selectedEvent,
      });
      setSendResult({ ok: true, ...result });
    } catch (err) {
      setSendResult({ ok: false, error: err?.message || 'Erro ao enviar.' });
    } finally {
      setSending(false);
    }
  }, [sendForm, plan, selectedPlan, selectedEvent]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const planKeys = config?.plans ? Object.keys(config.plans) : [];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError('')}>fechar</button>
        </div>
      )}

      {saveMsg && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-400 flex items-center gap-2">
          <CheckCircle className="h-4 w-4" /> {saveMsg}
        </div>
      )}

      {/* ════════════════ CONEXÃO ════════════════ */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-green-400" /> Conexão WhatsApp
          </CardTitle>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} /> Atualizar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReconnect}
              disabled={reconnecting}
              className="text-yellow-400 hover:text-yellow-300"
            >
              {reconnecting
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Reconectando...</>
                : <><Wifi className="h-4 w-4 mr-1" /> Reconectar</>
              }
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Conexão</p>
              <div className="mt-2 flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', STATE_DOT[status?.state] || 'bg-gray-500')} />
                <span className={cn('text-lg font-semibold', STATE_COLORS[status?.state] || 'text-gray-400')}>
                  {STATE_LABELS[status?.state] || 'Desconhecido'}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Habilitado (.env)</p>
              <div className="mt-2 flex items-center gap-2">
                {status?.enabled
                  ? <><CheckCircle className="h-5 w-5 text-green-400" /><span className="text-lg font-semibold text-green-400">Sim</span></>
                  : <><XCircle className="h-5 w-5 text-red-400" /><span className="text-lg font-semibold text-red-400">Não</span></>
                }
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Número Pareado</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {status?.pairingPhoneNumber
                  ? status.pairingPhoneNumber.replace(/^(\d{2})(\d{2})(\d{5})(\d{4})$/, '+$1 ($2) $3-$4')
                  : '—'}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Áudio Global</p>
              <div className="mt-2 flex items-center gap-2">
                {status?.audioUrl
                  ? <><Volume2 className="h-5 w-5 text-green-400" /><span className="text-sm text-green-400 truncate">{status.audioUrl.split('/').pop()}</span></>
                  : <span className="text-sm text-gray-500">Nenhum</span>
                }
              </div>
            </div>
          </div>

          {status?.pairingCode && (
            <div className="mt-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
              <p className="text-sm text-yellow-300 flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Código de pareamento: <span className="font-mono font-bold text-lg">{status.pairingCode}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ════════════════ PLANOS ════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Mensagens por Plano
          </CardTitle>
          <p className="text-xs text-gray-400 mt-1">
            Configure o template de cada mensagem para cada plano. Variáveis disponíveis: {'{customerName}'}, {'{offerName}'}, {'{amount}'}, {'{email}'}, {'{pixCode}'}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Tabs dos planos */}
          <div className="flex gap-2 flex-wrap">
            {planKeys.map((key) => {
              const p = config.plans[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedPlan(key)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all border',
                    selectedPlan === key
                      ? 'border-primary/40 bg-primary/10 text-white shadow-md'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white',
                  )}
                >
                  <span className="text-lg">{PLAN_ICONS[key] || '📦'}</span>
                  <div className="text-left">
                    <div>{p.label}</div>
                    <div className="text-xs opacity-60">{p.amountDisplay}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detalhes do plano selecionado */}
          {plan && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
              {/* Toggles */}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={plan.whatsappEnabled !== false}
                      onChange={(e) => handleToggleWhatsApp(selectedPlan, e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
                  </div>
                  <span className="text-sm text-gray-300">WhatsApp ativo neste plano</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={plan.audioEnabled !== false}
                      onChange={(e) => handleToggleAudio(selectedPlan, e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
                  </div>
                  <span className="text-sm text-gray-300">Enviar áudio automático</span>
                </label>
              </div>

              {/* Configuração de Áudio */}
              {plan.audioEnabled !== false && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
                  <p className="text-sm font-semibold text-white flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-green-400" /> Configuração de Áudio — {plan.label}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400">URL do Áudio (MP3, OGG, etc.)</label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="https://exemplo.com/audio-boas-vindas.mp3"
                          value={plan.audioUrl || ''}
                          onChange={(e) => {
                            setConfig((prev) => ({
                              ...prev,
                              plans: {
                                ...prev.plans,
                                [selectedPlan]: { ...prev.plans[selectedPlan], audioUrl: e.target.value },
                              },
                            }));
                          }}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSaveAudioUrl(selectedPlan, plan.audioUrl || '')}
                          disabled={saving}
                          className="bg-green-600 hover:bg-green-700 text-white shrink-0"
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </div>
                      {plan.audioUrl && (
                        <p className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" /> Áudio configurado
                        </p>
                      )}
                      {!plan.audioUrl && (
                        <p className="text-xs text-gray-500">
                          Sem URL neste plano — usa o áudio global do .env (se existir).
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400">
                        Delay antes do áudio: <span className="text-white font-semibold">{plan.audioDelaySeconds ?? 3}s</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={plan.audioDelaySeconds ?? 3}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setConfig((prev) => ({
                            ...prev,
                            plans: {
                              ...prev.plans,
                              [selectedPlan]: { ...prev.plans[selectedPlan], audioDelaySeconds: val },
                            },
                          }));
                        }}
                        onMouseUp={(e) => handleSaveAudioDelay(selectedPlan, Number(e.target.value))}
                        onTouchEnd={(e) => handleSaveAudioDelay(selectedPlan, Number(e.target.value))}
                        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-500">
                        <span>0s (imediato)</span>
                        <span>15s</span>
                        <span>30s</span>
                        <span>60s</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs de evento */}
              <div className="flex gap-2 border-b border-white/10 pb-2">
                {Object.entries(EVENT_LABELS).map(([evKey, evLabel]) => (
                  <button
                    key={evKey}
                    type="button"
                    onClick={() => setSelectedEvent(evKey)}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded-t-lg transition-all',
                      selectedEvent === evKey
                        ? 'bg-white/10 text-white font-semibold border-b-2 border-primary'
                        : 'text-gray-400 hover:text-white',
                    )}
                  >
                    {evKey === 'payment_approved' ? '✅' : '⏳'} {evLabel}
                  </button>
                ))}
              </div>

              {/* Variáveis disponíveis */}
              <div className="flex flex-wrap gap-1">
                {(TEMPLATE_VARS[selectedEvent] || []).map((v) => (
                  <span
                    key={v}
                    className="text-[10px] bg-white/10 text-gray-300 rounded px-1.5 py-0.5 font-mono cursor-pointer hover:bg-white/20"
                    onClick={() => {
                      if (editMode) {
                        setEditText((t) => t + `{${v}}`);
                      }
                    }}
                    title={editMode ? `Clique para inserir {${v}}` : v}
                  >
                    {`{${v}}`}
                  </span>
                ))}
              </div>

              {/* Preview ou Editor */}
              {editMode ? (
                <div className="space-y-3">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={16}
                    className="w-full rounded-xl border border-white/20 bg-black/40 px-4 py-3 text-sm text-white font-mono resize-y focus:border-primary/50 focus:outline-none"
                    placeholder="Digite o template aqui..."
                  />
                  <div className="flex gap-2">
                    <Button type="button" onClick={handleSaveTemplate} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                      Salvar Template
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setEditMode(false)}>
                      Cancelar
                    </Button>
                    <Button type="button" variant="ghost" onClick={handleResetTemplate} disabled={saving} className="text-yellow-400 hover:text-yellow-300 ml-auto">
                      <RotateCcw className="h-4 w-4 mr-1" /> Restaurar Padrão
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      Preview — {plan.label} — {EVENT_LABELS[selectedEvent]}
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={handleStartEdit}>
                      <Edit3 className="h-4 w-4 mr-1" /> Editar Template
                    </Button>
                  </div>
                  <WhatsAppBubble text={previewText} />
                </div>
              )}

              {/* Enviar Teste */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <p className="text-sm font-semibold text-white flex items-center gap-2">
                  <Send className="h-4 w-4 text-primary" /> Enviar Teste — {plan.label} — {EVENT_LABELS[selectedEvent]}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="text-xs text-gray-400">Telefone (com DDD)</label>
                    <Input
                      placeholder="16998859608"
                      value={sendForm.phone}
                      onChange={(e) => setSendForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">Nome do cliente</label>
                    <Input
                      placeholder="Teste"
                      value={sendForm.customerName}
                      onChange={(e) => setSendForm((f) => ({ ...f, customerName: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      onClick={handleSendTest}
                      disabled={sending || !sendForm.phone}
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                    >
                      {sending
                        ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Enviando...</>
                        : <><Send className="h-4 w-4 mr-1" /> Enviar</>
                      }
                    </Button>
                  </div>
                </div>

                {sendResult && (
                  <div className={cn(
                    'rounded-lg p-3 text-sm flex items-center gap-2',
                    sendResult.ok ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400',
                  )}>
                    {sendResult.ok ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {sendResult.ok ? 'Mensagem enviada com sucesso!' : sendResult.error}
                  </div>
                )}
              </div>

            </div>
          )}

        </CardContent>
      </Card>

      {/* ════════════════ RESUMO ════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" /> Resumo Geral
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wide">
                  <th className="py-2 text-left">Plano</th>
                  <th className="py-2 text-center">WhatsApp</th>
                  <th className="py-2 text-center">Áudio</th>
                  <th className="py-2 text-center">Delay</th>
                  <th className="py-2 text-left">URL Áudio</th>
                </tr>
              </thead>
              <tbody>
                {planKeys.map((key) => {
                  const p = config.plans[key];
                  return (
                    <tr key={key} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2">
                        <span className="mr-2">{PLAN_ICONS[key] || '📦'}</span>
                        {p.label}
                      </td>
                      <td className="py-2 text-center">
                        {p.whatsappEnabled !== false
                          ? <CheckCircle className="h-4 w-4 text-green-400 inline" />
                          : <XCircle className="h-4 w-4 text-red-400 inline" />
                        }
                      </td>
                      <td className="py-2 text-center">
                        {p.audioEnabled !== false
                          ? p.audioUrl
                            ? <Volume2 className="h-4 w-4 text-green-400 inline" />
                            : <Volume2 className="h-4 w-4 text-yellow-400 inline" title="Áudio ativo, sem URL própria (usa global)" />
                          : <span className="text-gray-500">—</span>
                        }
                      </td>
                      <td className="py-2 text-center text-xs text-gray-300">
                        {p.audioEnabled !== false ? `${p.audioDelaySeconds ?? 3}s` : '—'}
                      </td>
                      <td className="py-2 text-xs text-gray-400 max-w-[200px] truncate">
                        {p.audioUrl || <span className="text-gray-600">global / nenhum</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
