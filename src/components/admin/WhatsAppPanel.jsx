import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, MessageCircle, Send, CheckCircle, XCircle, RefreshCw,
  Phone, FileText, Save, RotateCcw, Wifi, Volume2, Eye,
  Upload, ChevronUp, ChevronDown, Trash2, Plus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cn } from '../../lib/utils';
import {
  getWhatsAppStatus, getWhatsAppConfig, saveWhatsAppConfig,
  reconnectWhatsApp, sendWhatsAppTest, uploadWhatsAppAudio,
} from '../../lib/babylonApi';

const STATE_LABELS = { open: 'Conectado', connecting: 'Conectando...', close: 'Desconectado' };
const STATE_COLORS = { open: 'text-green-400', connecting: 'text-yellow-400', close: 'text-red-400' };
const STATE_DOT = { open: 'bg-green-400', connecting: 'bg-yellow-400', close: 'bg-red-400' };

const PLAN_ICONS = { combo_mensal: '📅', combo_trimestral: '📦', combo_semestral: '🏆' };
const EVENT_LABELS = { payment_approved: 'Pagamento Aprovado', pix_ready: 'PIX Pronto' };
const TEMPLATE_VARS = {
  payment_approved: ['customerName', 'offerName', 'amount', 'email'],
  pix_ready: ['customerName', 'offerName', 'amount', 'pixCode'],
};

function renderPreviewText(content, plan) {
  return (content || '')
    .replace(/{customerName}/g, 'João')
    .replace(/{offerName}/g, plan?.label || 'Combo')
    .replace(/{amount}/g, plan?.amountDisplay || 'R$ 39,90')
    .replace(/{email}/g, 'joao@email.com')
    .replace(/{pixCode}/g, '00020126580014br.gov.bcb.pix...');
}

function WhatsAppBubble({ text }) {
  return (
    <div className="max-w-md">
      <div className="rounded-xl bg-[#005c4b] px-3 py-2 text-sm text-white whitespace-pre-wrap leading-relaxed">
        {text}
      </div>
      <div className="text-right mt-0.5">
        <span className="text-[10px] text-gray-600">12:00 ✓✓</span>
      </div>
    </div>
  );
}

function AudioBubble() {
  return (
    <div className="max-w-md">
      <div className="rounded-xl bg-[#005c4b] px-3 py-2 flex items-center gap-3 text-white">
        <span className="text-lg">🎤</span>
        <div className="flex-1">
          <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-white/60 rounded-full" />
          </div>
        </div>
        <span className="text-xs text-white/50">0:15</span>
      </div>
      <div className="text-right mt-0.5">
        <span className="text-[10px] text-gray-600">12:00 ✓✓</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export function WhatsAppPanel() {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStepIdx, setUploadStepIdx] = useState(null);
  const audioInputRef = useRef(null);

  const [selectedPlan, setSelectedPlan] = useState('combo_mensal');
  const [selectedEvent, setSelectedEvent] = useState('payment_approved');
  const [showPreview, setShowPreview] = useState(false);

  const [sendForm, setSendForm] = useState({ phone: '', customerName: 'Teste' });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  // ── Fetch ──

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
    setShowPreview(false);
    setSendResult(null);
  }, [selectedPlan, selectedEvent]);

  // ── Derived ──

  const plan = config?.plans?.[selectedPlan];
  const steps = plan?.steps?.[selectedEvent] || [];
  const planKeys = config?.plans ? Object.keys(config.plans) : [];

  // ── Step helpers (local state only) ──

  const setSteps = useCallback((updater) => {
    setConfig(prev => {
      if (!prev) return prev;
      const newPlans = { ...prev.plans };
      const planData = { ...newPlans[selectedPlan] };
      const planSteps = { ...planData.steps };
      const current = [...(planSteps[selectedEvent] || [])];
      const next = typeof updater === 'function' ? updater(current) : updater;
      planSteps[selectedEvent] = next;
      planData.steps = planSteps;
      newPlans[selectedPlan] = planData;
      return { ...prev, plans: newPlans };
    });
  }, [selectedPlan, selectedEvent]);

  const updateStep = useCallback((idx, updates) => {
    setSteps(arr => arr.map((s, i) => i === idx ? { ...s, ...updates } : s));
  }, [setSteps]);

  const addStep = useCallback((type) => {
    setSteps(arr => {
      const step = type === 'text'
        ? { type: 'text', content: '', delayBefore: arr.length > 0 ? 2 : 0 }
        : { type: 'audio', audioUrl: '', delayBefore: arr.length > 0 ? 3 : 0 };
      return [...arr, step];
    });
  }, [setSteps]);

  const removeStep = useCallback((idx) => {
    setSteps(arr => {
      const next = arr.filter((_, i) => i !== idx);
      if (next.length > 0) next[0] = { ...next[0], delayBefore: 0 };
      return next;
    });
  }, [setSteps]);

  const moveStep = useCallback((idx, dir) => {
    setSteps(arr => {
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= arr.length) return arr;
      const next = [...arr];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      next[0] = { ...next[0], delayBefore: 0 };
      return next;
    });
  }, [setSteps]);

  // ── Handlers ──

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

  const handleSaveFlow = useCallback(async () => {
    setSaving(true);
    try {
      const currentSteps = config?.plans?.[selectedPlan]?.steps?.[selectedEvent] || [];
      const result = await saveWhatsAppConfig({
        plans: { [selectedPlan]: { steps: { [selectedEvent]: currentSteps } } },
      });
      if (result?.config) setConfig(result.config);
      setSaveMsg('Fluxo salvo com sucesso!');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setError(err?.message || 'Erro ao salvar fluxo.');
    } finally {
      setSaving(false);
    }
  }, [config, selectedPlan, selectedEvent]);

  const handleResetFlow = useCallback(async () => {
    if (!config?.defaults?.[selectedEvent]) return;
    setSaving(true);
    try {
      const defaultSteps = [{ type: 'text', content: config.defaults[selectedEvent], delayBefore: 0 }];
      const result = await saveWhatsAppConfig({
        plans: { [selectedPlan]: { steps: { [selectedEvent]: defaultSteps } } },
      });
      if (result?.config) setConfig(result.config);
      setSaveMsg('Restaurado para o padrão!');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setError(err?.message || 'Erro ao restaurar.');
    } finally {
      setSaving(false);
    }
  }, [config, selectedPlan, selectedEvent]);

  const handleUploadAudio = useCallback((stepIdx) => {
    setUploadStepIdx(stepIdx);
    audioInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || uploadStepIdx === null) return;
    setUploading(true);
    try {
      const result = await uploadWhatsAppAudio(file);
      if (result?.audioUrl) {
        updateStep(uploadStepIdx, { audioUrl: result.audioUrl });
        setSaveMsg('Áudio convertido! Salve o fluxo para confirmar.');
        setTimeout(() => setSaveMsg(''), 4000);
      }
    } catch (err) {
      setError(err?.message || 'Erro ao enviar áudio.');
    } finally {
      setUploading(false);
      setUploadStepIdx(null);
      if (audioInputRef.current) audioInputRef.current.value = '';
    }
  }, [uploadStepIdx, updateStep]);

  const handleReconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      const result = await reconnectWhatsApp();
      setStatus(prev => ({ ...prev, state: result?.state || 'connecting', connected: result?.state === 'open' }));
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

  // ── Loading ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* Banners */}
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

      {/* Hidden file input */}
      <input ref={audioInputRef} type="file" accept="audio/*" onChange={handleFileChange} className="hidden" />

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
              type="button" variant="ghost" size="sm"
              onClick={handleReconnect} disabled={reconnecting}
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

      {/* ════════════════ FLUXO DE MENSAGENS ════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Fluxo de Mensagens
          </CardTitle>
          <p className="text-xs text-gray-400 mt-1">
            Monte o fluxo de mensagens e áudios para cada plano e evento. Pode adicionar vários passos na ordem desejada.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* ── Plan tabs ── */}
          <div className="flex gap-2 flex-wrap">
            {planKeys.map(key => {
              const p = config.plans[key];
              return (
                <button
                  key={key} type="button"
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

          {plan && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
              {/* ── WhatsApp toggle ── */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={plan.whatsappEnabled !== false}
                    onChange={e => handleToggleWhatsApp(selectedPlan, e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
                </div>
                <span className="text-sm text-gray-300">WhatsApp ativo neste plano</span>
              </label>

              {/* ── Event tabs ── */}
              <div className="flex gap-2 border-b border-white/10 pb-2">
                {Object.entries(EVENT_LABELS).map(([evKey, evLabel]) => (
                  <button
                    key={evKey} type="button"
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

              {/* ══════ FLOW BUILDER ══════ */}
              <div className="space-y-0">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Fluxo — {plan.label} — {EVENT_LABELS[selectedEvent]}
                    <span className="text-gray-500 ml-2">({steps.length} passo{steps.length !== 1 ? 's' : ''})</span>
                  </p>
                </div>

                {steps.length === 0 && (
                  <div className="text-center py-10 rounded-xl border border-dashed border-white/10">
                    <p className="text-gray-500 text-sm">Nenhum passo configurado.</p>
                    <p className="text-gray-600 text-xs mt-1">Adicione mensagens e áudios abaixo.</p>
                  </div>
                )}

                {steps.map((step, i) => (
                  <div key={`${selectedPlan}-${selectedEvent}-${i}`}>
                    {/* ── Delay connector between steps ── */}
                    {i > 0 && (
                      <div className="flex items-center gap-3 py-1.5 ml-5">
                        <div className="w-px h-5 bg-white/10" />
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>⏱️</span>
                          <span className="font-mono">{step.delayBefore || 0}s</span>
                          <input
                            type="range" min={0} max={60} step={1}
                            value={step.delayBefore || 0}
                            onChange={e => updateStep(i, { delayBefore: Number(e.target.value) })}
                            className="w-20 h-1 bg-gray-700 rounded appearance-none cursor-pointer accent-blue-500"
                          />
                        </div>
                      </div>
                    )}

                    {/* ── Step card ── */}
                    <div className={cn(
                      'rounded-xl border p-4 space-y-3',
                      step.type === 'text'
                        ? 'border-green-500/20 bg-green-500/[0.03]'
                        : 'border-purple-500/20 bg-purple-500/[0.03]',
                    )}>
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white flex items-center gap-2">
                          {step.type === 'text' ? '💬' : '🎤'} Passo {i + 1}:
                          {step.type === 'text' ? ' Mensagem de Texto' : ' Áudio (Voz)'}
                        </span>
                        <div className="flex items-center gap-0.5">
                          {i > 0 && (
                            <button type="button" onClick={() => moveStep(i, -1)}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white" title="Subir">
                              <ChevronUp className="h-4 w-4" />
                            </button>
                          )}
                          {i < steps.length - 1 && (
                            <button type="button" onClick={() => moveStep(i, 1)}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white" title="Descer">
                              <ChevronDown className="h-4 w-4" />
                            </button>
                          )}
                          <button type="button" onClick={() => removeStep(i)}
                            className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 ml-1" title="Remover">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Body — TEXT */}
                      {step.type === 'text' && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1">
                            {(TEMPLATE_VARS[selectedEvent] || []).map(v => (
                              <span
                                key={v}
                                className="text-[10px] bg-white/10 text-gray-300 rounded px-1.5 py-0.5 font-mono cursor-pointer hover:bg-white/20 select-none"
                                onClick={() => updateStep(i, { content: (step.content || '') + `{${v}}` })}
                                title={`Inserir {${v}}`}
                              >
                                {`{${v}}`}
                              </span>
                            ))}
                          </div>
                          <textarea
                            value={step.content || ''}
                            onChange={e => updateStep(i, { content: e.target.value })}
                            rows={8}
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white font-mono resize-y focus:border-primary/40 focus:outline-none"
                            placeholder="Digite a mensagem aqui... Use {customerName}, {offerName}, etc."
                          />
                          {!step.content && (
                            <p className="text-xs text-yellow-500/80">Mensagem vazia — não será enviada.</p>
                          )}
                        </div>
                      )}

                      {/* Body — AUDIO */}
                      {step.type === 'audio' && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Button
                              type="button" size="sm"
                              onClick={() => handleUploadAudio(i)}
                              disabled={uploading && uploadStepIdx === i}
                              className="bg-purple-600 hover:bg-purple-700 text-white"
                            >
                              {uploading && uploadStepIdx === i
                                ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Convertendo...</>
                                : <><Upload className="h-4 w-4 mr-1" /> Enviar Áudio</>
                              }
                            </Button>
                            <span className="text-xs text-gray-500">MP3, M4A, WAV, OGG — converte para voz automático</span>
                          </div>
                          {step.audioUrl ? (
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
                              <span className="text-xs text-green-400 truncate" title={step.audioUrl}>
                                {step.audioUrl.split('/').pop()}
                              </span>
                            </div>
                          ) : (
                            <p className="text-xs text-yellow-500/80">Nenhum áudio. Envie um arquivo ou cole a URL.</p>
                          )}
                          <Input
                            placeholder="Ou cole a URL do áudio diretamente..."
                            value={step.audioUrl || ''}
                            onChange={e => updateStep(i, { audioUrl: e.target.value })}
                            className="text-xs"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* ── Add step buttons ── */}
                <div className="flex gap-2 pt-3">
                  <Button
                    type="button" variant="ghost" size="sm"
                    onClick={() => addStep('text')}
                    disabled={steps.length >= 10}
                    className="border border-dashed border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-300"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Mensagem
                  </Button>
                  <Button
                    type="button" variant="ghost" size="sm"
                    onClick={() => addStep('audio')}
                    disabled={steps.length >= 10}
                    className="border border-dashed border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Áudio
                  </Button>
                  {steps.length >= 10 && (
                    <span className="text-xs text-gray-500 self-center ml-2">Máximo 10 passos</span>
                  )}
                </div>
              </div>

              {/* ── Save / Reset / Preview buttons ── */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-white/10">
                <Button
                  type="button" onClick={handleSaveFlow} disabled={saving}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Salvar Fluxo
                </Button>
                <Button
                  type="button" variant="ghost" onClick={handleResetFlow} disabled={saving}
                  className="text-yellow-400 hover:text-yellow-300"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Reset Padrão
                </Button>
                <Button
                  type="button" variant="ghost" size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  className="ml-auto"
                >
                  <Eye className="h-4 w-4 mr-1" /> {showPreview ? 'Ocultar' : 'Ver'} Preview
                </Button>
              </div>

              {/* ── Preview ── */}
              {showPreview && (
                <div className="rounded-xl border border-white/10 bg-[#0b141a] p-4 space-y-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                    Preview — {plan.label} — {EVENT_LABELS[selectedEvent]}
                  </p>
                  {steps.length === 0 && (
                    <p className="text-center text-gray-600 text-sm py-4">Nenhum passo para exibir.</p>
                  )}
                  {steps.map((step, i) => (
                    <div key={i}>
                      {i > 0 && step.delayBefore > 0 && (
                        <p className="text-center text-[10px] text-gray-600 py-1">⏱️ {step.delayBefore}s de espera</p>
                      )}
                      {step.type === 'text'
                        ? <WhatsAppBubble text={renderPreviewText(step.content, plan)} />
                        : <AudioBubble />
                      }
                    </div>
                  ))}
                </div>
              )}

              {/* ── Send test ── */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <p className="text-sm font-semibold text-white flex items-center gap-2">
                  <Send className="h-4 w-4 text-primary" /> Enviar Teste — {plan.label} — {EVENT_LABELS[selectedEvent]}
                </p>
                <p className="text-xs text-gray-400">
                  Envia todos os {steps.length} passo{steps.length !== 1 ? 's' : ''} do fluxo acima para o número informado.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="text-xs text-gray-400">Telefone (com DDD)</label>
                    <Input
                      placeholder="16998859608"
                      value={sendForm.phone}
                      onChange={e => setSendForm(f => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">Nome do cliente</label>
                    <Input
                      placeholder="Teste"
                      value={sendForm.customerName}
                      onChange={e => setSendForm(f => ({ ...f, customerName: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button" onClick={handleSendTest}
                      disabled={sending || !sendForm.phone}
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                    >
                      {sending
                        ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Enviando...</>
                        : <><Send className="h-4 w-4 mr-1" /> Enviar Fluxo</>
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
                    {sendResult.ok
                      ? `Fluxo enviado! ${sendResult.stepsSent || ''} passo(s) entregue(s).`
                      : sendResult.error
                    }
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
                  <th className="py-2 text-center">✅ Pag. Aprovado</th>
                  <th className="py-2 text-center">⏳ PIX Pronto</th>
                </tr>
              </thead>
              <tbody>
                {planKeys.map(key => {
                  const p = config.plans[key];
                  const fmtSteps = (arr) => {
                    if (!arr || !arr.length) return '—';
                    const t = arr.filter(s => s.type === 'text').length;
                    const a = arr.filter(s => s.type === 'audio').length;
                    const parts = [];
                    if (t) parts.push(`${t}💬`);
                    if (a) parts.push(`${a}🎤`);
                    return parts.join(' ') || '—';
                  };
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
                      <td className="py-2 text-center text-xs">{fmtSteps(p.steps?.payment_approved)}</td>
                      <td className="py-2 text-center text-xs">{fmtSteps(p.steps?.pix_ready)}</td>
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
