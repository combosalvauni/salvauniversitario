import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Link2, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { createAdminInviteLink, listAdminInviteLinks, revokeAdminInviteLink } from '../../lib/babylonApi';

const DEFAULT_FORM = {
    expiresInDays: '7',
    targetEmail: '',
    maxUses: '1',
    grantCredits: '0',
    note: '',
};

function formatDateTime(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString('pt-BR');
}

export function InviteLinksPanel() {
    const [form, setForm] = useState(DEFAULT_FORM);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [revokeLoadingId, setRevokeLoadingId] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [generatedLink, setGeneratedLink] = useState('');
    const [invites, setInvites] = useState([]);

    const activeInvites = useMemo(
        () => invites.filter((invite) => invite.status === 'active').length,
        [invites]
    );

    const fetchInvites = useCallback(async () => {
        setLoading(true);
        setError('');

        try {
            const response = await listAdminInviteLinks();
            setInvites(Array.isArray(response?.invites) ? response.invites : []);
        } catch (fetchError) {
            setError(fetchError?.message || 'Não foi possível carregar os convites.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInvites();
    }, [fetchInvites]);

    async function handleCopyLink(link) {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setSuccess('Link copiado.');
        } catch {
            setError('Não foi possível copiar automaticamente.');
        }
    }

    async function handleCreateInvite(e) {
        e.preventDefault();
        setCreating(true);
        setError('');
        setSuccess('');

        const payload = {
            expiresInDays: Number(form.expiresInDays || 7),
            targetEmail: String(form.targetEmail || '').trim().toLowerCase(),
            maxUses: Number(form.maxUses || 1),
            grantCredits: Number(form.grantCredits || 0),
            note: String(form.note || '').trim(),
            grantStoreAccess: true,
        };

        try {
            const response = await createAdminInviteLink(payload);
            setGeneratedLink(String(response?.inviteUrl || ''));
            setForm(DEFAULT_FORM);
            setSuccess('Convite criado com sucesso.');
            await fetchInvites();
        } catch (createError) {
            setError(createError?.message || 'Não foi possível criar o convite.');
        } finally {
            setCreating(false);
        }
    }

    async function handleRevokeInvite(inviteId) {
        if (!inviteId) return;
        setRevokeLoadingId(inviteId);
        setError('');
        setSuccess('');

        try {
            await revokeAdminInviteLink(inviteId);
            setSuccess('Convite revogado.');
            await fetchInvites();
        } catch (revokeError) {
            setError(revokeError?.message || 'Não foi possível revogar o convite.');
        } finally {
            setRevokeLoadingId('');
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2">
                        <Link2 className="h-5 w-5 text-primary" /> Gerador de Convites
                    </CardTitle>
                    <div className="text-xs text-gray-400">
                        Convites ativos: <span className="text-white font-medium">{activeInvites}</span>
                    </div>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleCreateInvite} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Input
                                value={form.targetEmail}
                                onChange={(e) => setForm((prev) => ({ ...prev, targetEmail: e.target.value }))}
                                placeholder="E-mail alvo (opcional)"
                            />
                            <Input
                                value={form.expiresInDays}
                                onChange={(e) => setForm((prev) => ({ ...prev, expiresInDays: e.target.value }))}
                                placeholder="Expira em dias (1-90)"
                            />
                            <Input
                                value={form.maxUses}
                                onChange={(e) => setForm((prev) => ({ ...prev, maxUses: e.target.value }))}
                                placeholder="Máximo de usos"
                            />
                            <Input
                                value={form.grantCredits}
                                onChange={(e) => setForm((prev) => ({ ...prev, grantCredits: e.target.value }))}
                                placeholder="Créditos para liberar"
                            />
                        </div>
                        <Input
                            value={form.note}
                            onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                            placeholder="Observação interna (opcional)"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button type="submit" disabled={creating}>
                                {creating ? 'Gerando...' : 'Gerar link de convite'}
                            </Button>
                            <Button type="button" variant="ghost" onClick={fetchInvites} disabled={loading}>
                                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Atualizar
                            </Button>
                        </div>
                    </form>

                    {generatedLink && (
                        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
                            <p className="text-xs text-gray-300">Link gerado</p>
                            <Input value={generatedLink} readOnly />
                            <Button type="button" variant="outline" onClick={() => handleCopyLink(generatedLink)}>
                                <Copy className="h-4 w-4 mr-2" /> Copiar link
                            </Button>
                        </div>
                    )}

                    {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
                    {success && <p className="mt-4 text-sm text-green-400">{success}</p>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-primary" /> Convites Criados
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                    ) : invites.length === 0 ? (
                        <p className="text-sm text-gray-400">Nenhum convite criado ainda.</p>
                    ) : (
                        <div className="space-y-3">
                            {invites.map((invite) => {
                                const usageLabel = `${invite.used_count || 0}/${invite.max_uses || 1}`;
                                return (
                                    <div key={invite.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="space-y-1">
                                                <p className="text-sm text-white font-medium">{invite.target_email || 'Sem e-mail fixo'}</p>
                                                <p className="text-xs text-gray-400">Expira: {formatDateTime(invite.expires_at)}</p>
                                                <p className="text-xs text-gray-400">Uso: {usageLabel} • Créditos: {invite.grant_credits || 0}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs rounded-full px-2 py-1 bg-white/10 text-gray-200">{invite.status}</span>
                                                {invite.status === 'active' && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        disabled={revokeLoadingId === invite.id}
                                                        onClick={() => handleRevokeInvite(invite.id)}
                                                    >
                                                        {revokeLoadingId === invite.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <XCircle className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                )}
                                                {invite.status !== 'active' && <CheckCircle2 className="h-4 w-4 text-gray-500" />}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
