import { useState, useEffect } from 'react';
import { Mail, MessageCircle, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';

const DEFAULT_SUPPORT_SETTINGS = {
    email_title: 'E-mail de Suporte',
    email_value: 'contato@combosalvauniversitario.site',
    email_button_text: 'Entrar em Contato',
    email_url: 'mailto:contato@combosalvauniversitario.site',
    whatsapp_title: 'WhatsApp',
    whatsapp_value: '55 16 99885-9608',
    whatsapp_button_text: 'Entrar em Contato',
    whatsapp_url: 'https://wa.me/5516998859608',
};

export function Chat() {
    const [supportSettings, setSupportSettings] = useState(DEFAULT_SUPPORT_SETTINGS);

    useEffect(() => {
        let mounted = true;

        async function loadSupportSettings() {
            const { data, error } = await supabase
                .from('support_settings')
                .select('email_title, email_value, email_button_text, email_url, whatsapp_title, whatsapp_value, whatsapp_button_text, whatsapp_url')
                .eq('id', true)
                .maybeSingle();

            if (!mounted || error || !data) return;
            setSupportSettings({ ...DEFAULT_SUPPORT_SETTINGS, ...data });
        }

        loadSupportSettings();
        return () => {
            mounted = false;
        };
    }, []);

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div>
                <h1 className="font-display text-3xl font-bold text-white mb-2">Suporte</h1>
                <p className="text-gray-400">Escolha o melhor canal para falar com nosso time.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                <div className="rounded-xl border bg-card text-card-foreground shadow border-white/10 hover:shadow-2xl transition-all h-full">
                    <div className="p-6">
                        <div className="flex items-start gap-4">
                            <div className="p-4 rounded-xl bg-primary/10 border border-primary/30">
                                <Mail className="w-6 h-6 text-primary" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-white mb-2">{supportSettings.email_title}</h3>
                                <p className="text-gray-400 text-sm mb-4 break-all">{supportSettings.email_value}</p>
                                <a
                                    href={supportSettings.email_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm shadow hover:bg-primary/90 h-9 px-4 py-2 w-full bg-primary text-white font-bold"
                                >
                                    <ExternalLink className="w-4 h-4 mr-1" />
                                    {supportSettings.email_button_text}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border bg-card text-card-foreground shadow border-white/10 hover:shadow-2xl transition-all h-full">
                    <div className="p-6">
                        <div className="flex items-start gap-4">
                            <div className="p-4 rounded-xl bg-primary/10 border border-primary/30">
                                <MessageCircle className="w-6 h-6 text-primary" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-white mb-2">{supportSettings.whatsapp_title}</h3>
                                <p className="text-gray-400 text-sm mb-4 break-all">{supportSettings.whatsapp_value}</p>
                                <a
                                    href={supportSettings.whatsapp_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm shadow hover:bg-primary/90 h-9 px-4 py-2 w-full bg-primary text-white font-bold"
                                >
                                    <ExternalLink className="w-4 h-4 mr-1" />
                                    {supportSettings.whatsapp_button_text}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
