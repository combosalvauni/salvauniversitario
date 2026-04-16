import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowRight, User, Loader2, GraduationCap, Phone } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { trackCompleteRegistration } from '../lib/pixel';

const _MOTION = motion;

function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 11);
}

function formatWhatsapp(value) {
    const digits = onlyDigits(value);
    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function isLikelyValidEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!email) return false;

    const basicRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!basicRegex.test(email)) return false;

    const [localPart, domain] = email.split('@');
    if (!localPart || localPart.length < 2) return false;
    if (!domain || domain.length < 4) return false;
    if (email.includes('..')) return false;
    if (domain.startsWith('.') || domain.endsWith('.')) return false;

    const domainParts = domain.split('.').filter(Boolean);
    if (domainParts.length < 2) return false;

    const tld = domainParts[domainParts.length - 1];
    if (!/^[a-z]{2,24}$/i.test(tld)) return false;

    return true;
}

export function Login() {
    const navigate = useNavigate();
    const location = useLocation();
    const { signIn, signUp } = useAuth();
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [failedAttempts, setFailedAttempts] = useState(0);
    const [cooldownUntil, setCooldownUntil] = useState(null);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        whatsapp: '',
        password: ''
    });

    const signInFn = typeof signIn === 'function'
        ? signIn
        : (data) => supabase.auth.signInWithPassword(data);

    const signUpFn = typeof signUp === 'function'
        ? signUp
        : (data) => supabase.auth.signUp(data);

    useEffect(() => {
        const params = new URLSearchParams(location.search || '');
        const inviteToken = String(params.get('invite') || '').trim();
        if (!inviteToken) return;
        localStorage.setItem('concursaflix.adminInviteToken', inviteToken);
    }, [location.search]);

    // Gerencia cooldown de tentativas falhadas
    useEffect(() => {
        if (!cooldownUntil) return;
        
        const checkCooldown = () => {
            if (Date.now() >= cooldownUntil) {
                setCooldownUntil(null);
                setFailedAttempts(0);
            }
        };
        
        const interval = setInterval(checkCooldown, 1000);
        return () => clearInterval(interval);
    }, [cooldownUntil]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        // Verifica se está em cooldown
        if (cooldownUntil && Date.now() < cooldownUntil) {
            const remainingSeconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
            setError(`Muitas tentativas. Aguarde ${remainingSeconds}s antes de tentar novamente.`);
            return;
        }

        setLoading(true);

        try {
            const normalizedEmail = String(formData.email || '').trim().toLowerCase();
            if (!isLikelyValidEmail(normalizedEmail)) {
                setError('Informe um e-mail válido (ex.: nome@provedor.com).');
                return;
            }

            if (isLogin) {
                const { error } = await signInFn({
                    email: normalizedEmail,
                    password: formData.password,
                });
                if (error) throw error;
                
                // Login bem-sucedido - reseta tentativas e limpa qualquer cache problemático
                setFailedAttempts(0);
                setCooldownUntil(null);
                
                // Limpa possíveis dados de sessão corrompidos antes de navegar
                sessionStorage.clear();
                
                navigate('/plataformas');
            } else {
                const whatsappDigits = onlyDigits(formData.whatsapp);
                if (whatsappDigits.length < 10) {
                    setError('Informe um WhatsApp válido com DDD.');
                    return;
                }

                const { error } = await signUpFn({
                    email: normalizedEmail,
                    password: formData.password,
                    options: {
                        data: {
                            full_name: formData.name,
                            whatsapp: whatsappDigits,
                        }
                    }
                });
                if (error) throw error;
                trackCompleteRegistration({ email: normalizedEmail });
                setSuccess('Cadastro realizado! Verifique seu e-mail para confirmar e depois faça login.');
                setIsLogin(true);
                setFailedAttempts(0);
            }
        } catch (err) {
            console.error(err);
            const rawMessage = String(err?.message || '');
            
            // Incrementa tentativas falhadas apenas para erros de credenciais
            if (rawMessage === 'Invalid login credentials') {
                const newAttempts = failedAttempts + 1;
                setFailedAttempts(newAttempts);
                
                // Aplica cooldown progressivo após múltiplas tentativas
                if (newAttempts >= 5) {
                    const cooldownSeconds = 60; // 1 minuto após 5 tentativas
                    setCooldownUntil(Date.now() + cooldownSeconds * 1000);
                    setError(`Credenciais inválidas. Muitas tentativas. Aguarde ${cooldownSeconds}s.`);
                } else if (newAttempts >= 3) {
                    const cooldownSeconds = 15; // 15 segundos após 3 tentativas
                    setCooldownUntil(Date.now() + cooldownSeconds * 1000);
                    setError(`Credenciais inválidas. Aguarde ${cooldownSeconds}s antes de tentar novamente.`);
                } else {
                    setError(`Credenciais inválidas. Verifique seu e-mail e senha. (Tentativa ${newAttempts}/3)`);
                }
            } else if (rawMessage.toLowerCase().includes('failed to fetch') || rawMessage.toLowerCase().includes('network')) {
                setError('Falha de conexão. Verifique sua internet e tente novamente.');
            } else if (rawMessage.toLowerCase().includes('abort')) {
                setError('Requisição cancelada. Limpe o cache do navegador (Ctrl+Shift+Del) e tente novamente.');
            } else {
                setError(rawMessage || 'Não foi possível concluir o login agora.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-full px-4 py-6 sm:py-10 flex justify-center items-center">
            <div className="w-full max-w-md space-y-6 sm:space-y-8 relative z-10">
                <div className="text-center space-y-1.5 sm:space-y-2">
                    <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.5 }}
                        className="inline-block"
                    >
                        <div className="flex flex-col items-center">
                            <motion.div
                                className="mb-2 sm:mb-3 inline-flex items-center justify-center"
                                style={{ perspective: 1200, transformStyle: 'preserve-3d', transformOrigin: '50% 55%' }}
                                animate={{
                                    rotateY: [-18, -6, 14, 4, -18],
                                    rotateX: [3, 1, -2, 1, 3],
                                    scale: [1, 1.02, 1, 1.01, 1],
                                }}
                                transition={{ duration: 5.8, repeat: Infinity, ease: [0.4, 0.0, 0.2, 1] }}
                            >
                                <GraduationCap
                                    strokeWidth={1.25}
                                    className="h-20 w-20 sm:h-28 sm:w-28 text-primary"
                                    style={{
                                        filter: [
                                            'drop-shadow(0 0 2px rgba(255,102,0,1))',
                                            'drop-shadow(0 0 6px rgba(255,102,0,0.95))',
                                            'drop-shadow(0 0 18px rgba(255,102,0,0.9))',
                                        ].join(' '),
                                    }}
                                />
                            </motion.div>
                            <h1 className="font-display text-3xl sm:text-4xl font-bold bg-gradient-to-r from-primary to-orange-400 bg-clip-text text-transparent leading-none">
                                Salva
                            </h1>
                            <div className="mt-1 font-display text-xl sm:text-2xl md:text-3xl font-bold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]">
                                Universitários
                            </div>
                        </div>
                    </motion.div>
                    <p className="text-gray-400">
                        {isLogin ? 'Bem-vindo de volta, futuro aprovado.' : 'Comece sua jornada até a aprovação.'}
                    </p>
                </div>

                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 sm:p-8 rounded-2xl shadow-2xl relative overflow-hidden"
                >
                    {/* Glow effect */}
                    <motion.div
                        className="absolute top-0 left-[-25%] h-1 w-[150%] bg-gradient-to-r from-transparent via-primary to-orange-400"
                        animate={{
                            x: ['-18%', '18%', '18%'],
                            opacity: [0, 0.85, 0],
                        }}
                        transition={{
                            duration: 4.8,
                            times: [0, 0.6, 1],
                            repeat: Infinity,
                            ease: 'linear',
                        }}
                    />

                    <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
                        {!isLogin && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300 ml-1">Nome Completo</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                    <Input
                                        placeholder="Seu nome"
                                        className="pl-10 bg-black/20 border-white/10 focus:border-primary/50"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {!isLogin && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300 ml-1">WhatsApp</label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                    <Input
                                        type="tel"
                                        placeholder="(11) 99999-9999"
                                        className="pl-10 bg-black/20 border-white/10 focus:border-primary/50"
                                        value={formData.whatsapp}
                                        onChange={(e) => setFormData({ ...formData, whatsapp: formatWhatsapp(e.target.value) })}
                                        inputMode="numeric"
                                        maxLength={15}
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300 ml-1">E-mail</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                <Input
                                    type="email"
                                    placeholder="seu@email.com"
                                    className="pl-10 bg-black/20 border-white/10 focus:border-primary/50"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between items-center ml-1">
                                <label className="text-sm font-medium text-gray-300">Senha</label>
                                {isLogin && (
                                    <a href="#" className="text-xs text-primary hover:text-primary/80 transition-colors">
                                        Esqueceu a senha?
                                    </a>
                                )}
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
                                <Input
                                    type="password"
                                    placeholder="••••••••"
                                    className="pl-10 bg-black/20 border-white/10 focus:border-primary/50"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center">
                                {error}
                                {failedAttempts >= 2 && !cooldownUntil && (
                                    <div className="mt-2 text-xs text-red-400">
                                        Dica: Verifique se está usando o e-mail correto cadastrado.
                                    </div>
                                )}
                            </div>
                        )}

                        {success && (
                            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm text-center">
                                {success}
                            </div>
                        )}

                        <Button 
                            type="submit" 
                            className="w-full h-12 text-base shadow-lg shadow-primary/20" 
                            disabled={loading || (cooldownUntil && Date.now() < cooldownUntil)}
                        >
                            {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                            {isLogin ? 'Entrar na Plataforma' : 'Criar Conta Gratuita'}
                            {!loading && <ArrowRight className="ml-2 h-5 w-5" />}
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <p className="text-sm text-gray-400">
                            {isLogin ? 'Ainda não tem conta?' : 'Já tem uma conta?'}
                            <button
                                onClick={() => {
                                    setError('');
                                    setSuccess('');
                                    setIsLogin(!isLogin);
                                }}
                                className="ml-2 text-primary font-medium hover:underline focus:outline-none"
                            >
                                {isLogin ? 'Cadastre-se' : 'Fazer Login'}
                            </button>
                        </p>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
