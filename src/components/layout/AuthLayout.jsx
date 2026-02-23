import { Outlet } from 'react-router-dom';

export function AuthLayout() {
    return (
        <div className="flex min-h-screen w-full items-center justify-center bg-background font-body text-text-main relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute inset-0 z-0">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[800px] w-[800px] bg-gradient-radial from-primary/20 to-transparent blur-[120px] opacity-40"></div>
                <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-background via-background/80 to-transparent"></div>
            </div>

            <div className="relative z-10 w-full max-w-md p-6">
                <Outlet />
            </div>
        </div>
    );
}
