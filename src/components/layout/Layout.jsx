import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function Layout() {
    const location = useLocation();
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

    const getTitle = (pathname) => {
        switch (pathname) {
            case '/dashboard': return 'Dashboard';
            case '/plataformas': return 'Plataformas';
            case '/chat': return 'Suporte';
            case '/loja': return 'Loja';
            case '/conta': return 'Minha Conta';
            case '/admin': return 'Administração';
            default: return 'ConcursaFlix';
        }
    };

    return (
        <div className="flex min-h-[100dvh] w-full bg-background font-body text-text-main selection:bg-primary selection:text-white">
            {/* Background Effects */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-primary/20 blur-[128px] animate-pulse"></div>
                <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-secondary/10 blur-[128px] animate-pulse delay-1000"></div>
            </div>

            <Sidebar
                mobileOpen={mobileSidebarOpen}
                onMobileClose={() => setMobileSidebarOpen(false)}
            />

            <div className="flex flex-1 flex-col relative z-10 min-h-[100dvh] transition-all duration-300 md:pl-64">
                <Header
                    title={getTitle(location.pathname)}
                    onOpenMenu={() => setMobileSidebarOpen(true)}
                />
                <main className="flex-1 overflow-y-auto p-4 md:p-8 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-primary/20">
                    <div className="mx-auto max-w-7xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}
