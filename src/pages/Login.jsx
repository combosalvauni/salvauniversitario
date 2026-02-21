import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowRight, User, Loader2, GraduationCap, Phone } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export function Login() {
    const navigate = useNavigate();
    const { signIn, signUp } = useAuth();
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                const { error } = await signInFn({
                    email: formData.email,
                    password: formData.password,
                });
                if (error) throw error;
                navigate('/dashboard');
            } else {
                const { error } = await signUpFn({
                    email: formData.email,
                    password: formData.password,
                    options: {
                        data: {
                            full_name: formData.name,
                            whatsapp: formData.whatsapp,
                        }
                    }
                });
                if (error) throw error;
                alert('Cadastro realizado! Verifique seu e-mail para confirmar (ou faça login se o auto-confirm estiver ativo).');
                setIsLogin(true);
            }
        } catch (err) {
            console.error(err);
            setError(err.message === 'Invalid login credentials' ? 'Credenciais inválidas.' : err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-full flex justify-center items-center min-h-[80vh]">
            <div className="w-full max-w-md space-y-8 relative z-10">
                <div className="text-center space-y-2">
                    <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.5 }}
                        className="inline-block"
                    >
                        <div className="flex flex-col items-center">
                            <div className="mb-3 inline-flex items-center justify-center">
                                <GraduationCap
                                    strokeWidth={1.25}
                                    className="h-24 w-24 sm:h-28 sm:w-28 text-primary"
                                    style={{
                                        filter: [
                                            'drop-shadow(0 0 2px rgba(255,102,0,1))',
                                            'drop-shadow(0 0 6px rgba(255,102,0,0.95))',
                                            'drop-shadow(0 0 18px rgba(255,102,0,0.9))',
                                        ].join(' '),
                                    }}
                                />
                            </div>
                            <h1 className="font-display text-4xl font-bold bg-gradient-to-r from-primary to-orange-400 bg-clip-text text-transparent leading-none">
                                Salva
                            </h1>
                            <div className="mt-1 font-display text-2xl md:text-3xl font-bold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]">
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
                    className="bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-2xl shadow-2xl relative overflow-hidden"
                >
                    {/* Glow effect */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />

                    <form onSubmit={handleSubmit} className="space-y-6">
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
                                        onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
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
                            </div>
                        )}

                        <Button type="submit" className="w-full h-12 text-base shadow-lg shadow-primary/20" disabled={loading}>
                            {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                            {isLogin ? 'Entrar na Plataforma' : 'Criar Conta Gratuita'}
                            {!loading && <ArrowRight className="ml-2 h-5 w-5" />}
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <p className="text-sm text-gray-400">
                            {isLogin ? 'Ainda não tem conta?' : 'Já tem uma conta?'}
                            <button
                                onClick={() => setIsLogin(!isLogin)}
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
