import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Layers, MessageSquare, ShoppingCart, User, LogOut, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';

const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
    { icon: Layers, label: 'Plataformas', path: '/plataformas' },
    { icon: MessageSquare, label: 'Suporte', path: '/chat' },
    { icon: ShoppingCart, label: 'Loja', path: '/loja' },
    { icon: User, label: 'Minha Conta', path: '/conta' },
];

export function Sidebar({ mobileOpen = false, onMobileClose = () => {} }) {
    const location = useLocation();
    const { isAdmin, canAccessStore, signOut } = useAuth();

    const visibleMenuItems = menuItems.filter((item) => item.path !== '/loja' || canAccessStore);

    const renderSidebarContent = (onNavigate) => (
        <div className="flex h-full flex-col">
            <div className="flex h-20 items-center justify-start px-4 border-b border-white/5 bg-[#111111] overflow-hidden">
                <img
                    src="https://i.imgur.com/pvpmbwn.png"
                    alt="ConcursaFlix"
                    className="h-40 w-auto object-contain flex-shrink-0"
                    loading="eager"
                    decoding="async"
                />
            </div>

            <nav className="flex-1 space-y-2 px-4 py-6">
                {visibleMenuItems.map((item) => {
                    const Icon = item.icon;
                    const itemPathname = item.path.split('#')[0];
                    const isActive = location.pathname === itemPathname;

                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            onClick={onNavigate}
                            className={cn(
                                "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 group relative overflow-hidden",
                                isActive
                                    ? "bg-primary/10 text-primary shadow-[0_0_15px_rgba(255,102,0,0.3)] border border-primary/20"
                                    : "text-gray-400 hover:bg-white/5 hover:text-white hover:shadow-[0_0_10px_rgba(255,255,255,0.1)]"
                            )}
                        >
                            {isActive && (
                                <div className="absolute left-0 top-0 h-full w-1 bg-primary shadow-[0_0_10px_#FF6600]" />
                            )}
                            <Icon className={cn("h-5 w-5 transition-transform group-hover:scale-110", isActive && "text-primary")} />
                            <span>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            {isAdmin && (
                <div className="px-4 py-2">
                    <Link
                        to="/admin"
                        onClick={onNavigate}
                        className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
                    >
                        <Settings className="h-5 w-5" />
                        <span>Admin</span>
                    </Link>
                </div>
            )}

            <div className="border-t border-white/5 p-4">
                <button
                    type="button"
                    onClick={async () => {
                        await signOut();
                        onNavigate();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
                >
                    <LogOut className="h-5 w-5" />
                    <span>Sair</span>
                </button>
            </div>
        </div>
    );

    return (
        <>
            {/* Desktop */}
            <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-background/80 backdrop-blur-md border-r border-white/5 hidden md:block">
                {renderSidebarContent(() => {})}
            </aside>

            {/* Mobile drawer */}
            <div className={cn(
                "md:hidden fixed inset-0 z-50",
                mobileOpen ? "" : "pointer-events-none"
            )}>
                <button
                    type="button"
                    aria-label="Fechar menu"
                    onClick={onMobileClose}
                    className={cn(
                        "absolute inset-0 bg-black/60 transition-opacity",
                        mobileOpen ? "opacity-100" : "opacity-0"
                    )}
                />
                <aside className={cn(
                    "absolute left-0 top-0 h-full w-64 bg-background/90 backdrop-blur-md border-r border-white/5 transition-transform",
                    mobileOpen ? "translate-x-0" : "-translate-x-full"
                )}>
                    {renderSidebarContent(onMobileClose)}
                </aside>
            </div>
        </>
    );
}
