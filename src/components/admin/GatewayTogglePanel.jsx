import { useCallback, useEffect, useState } from 'react';
import { Loader2, CreditCard, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { getPaymentGateway, setPaymentGateway } from '../../lib/babylonApi';

const GATEWAYS = [
  { key: 'babylon', label: 'Banco Babylon' },
  { key: 'amplopay', label: 'AmploPay' },
  { key: 'enkibank', label: 'Enki Bank' },
  { key: 'syncpay', label: 'Sync Payments' },
];

const GATEWAY_LABELS = Object.fromEntries(GATEWAYS.map((g) => [g.key, g.label]));

export function GatewayTogglePanel() {
  const [activeGateway, setActiveGateway] = useState('');
  const [configured, setConfigured] = useState({});
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');

  const fetchGateway = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getPaymentGateway();
      setActiveGateway(data.activeGateway || '');
      setConfigured({
        babylon: Boolean(data.babylonConfigured),
        amplopay: Boolean(data.amploPayConfigured),
        enkibank: Boolean(data.enkiBankConfigured),
        syncpay: Boolean(data.syncPayConfigured),
      });
    } catch (err) {
      setError(err?.message || 'Erro ao carregar configuração do gateway.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGateway();
  }, [fetchGateway]);

  const handleSwitch = useCallback(async (newGateway) => {
    if (newGateway === activeGateway) return;

    if (!configured[newGateway]) {
      setError(`O gateway ${GATEWAY_LABELS[newGateway]} não está configurado no servidor. Configure as variáveis de ambiente antes de alternar.`);
      return;
    }

    setSwitching(true);
    setError('');
    try {
      const data = await setPaymentGateway(newGateway);
      setActiveGateway(data.activeGateway || newGateway);
      setConfigured({
        babylon: Boolean(data.babylonConfigured),
        amplopay: Boolean(data.amploPayConfigured),
        enkibank: Boolean(data.enkiBankConfigured),
        syncpay: Boolean(data.syncPayConfigured),
      });
    } catch (err) {
      setError(err?.message || 'Erro ao alternar gateway.');
    } finally {
      setSwitching(false);
    }
  }, [activeGateway, configured]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" /> Gateway de Pagamento
        </CardTitle>
        <p className="text-xs text-gray-400 mt-1">
          Alterne o gateway ativo para processar novos checkouts. A troca é imediata e afeta apenas novas transações.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-400 mb-1">Gateway ativo</div>
                <div className="text-lg font-semibold text-white">
                  {GATEWAY_LABELS[activeGateway] || activeGateway}
                </div>
              </div>
              {switching && <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {GATEWAYS.map((gw) => {
                const isActive = activeGateway === gw.key;
                const isConfigured = configured[gw.key];
                return (
                  <button
                    key={gw.key}
                    type="button"
                    disabled={switching || isActive}
                    onClick={() => handleSwitch(gw.key)}
                    className={`rounded-lg p-4 border text-left transition-all ${
                      isActive
                        ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/30'
                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                    } ${switching ? 'opacity-50 cursor-not-allowed' : isActive ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-white">{gw.label}</span>
                      {isActive && (
                        <span className="text-[10px] uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-full font-semibold">
                          Ativo
                        </span>
                      )}
                    </div>
                    <span className={`text-xs ${isConfigured ? 'text-green-400' : 'text-red-400'}`}>
                      {isConfigured ? '● Configurado' : '○ Não configurado'}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-gray-500">
              Nota: a alternância é em tempo real na memória do servidor. Se o servidor reiniciar, o gateway voltará para o valor definido na variável de ambiente <code className="text-gray-400">PAYMENT_GATEWAY</code>.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
