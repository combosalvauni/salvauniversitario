import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

const Button = forwardRef(({ className, variant = 'primary', size = 'default', isLoading, children, ...props }, ref) => {
    const variants = {
        primary: "bg-primary text-white hover:bg-primary-hover shadow-[0_0_15px_rgba(255,102,0,0.5)] hover:shadow-[0_0_25px_rgba(255,102,0,0.7)] border-primary",
        outline: "bg-transparent border-white/20 text-white hover:bg-white/10 hover:border-white/40",
        ghost: "bg-transparent text-gray-300 hover:text-white hover:bg-white/5",
        danger: "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20 hover:border-red-500/50"
    };

    const sizes = {
        default: "h-11 px-6 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-14 px-8 text-lg",
        icon: "h-11 w-11 p-2 flex items-center justify-center"
    };

    return (
        <button
            ref={ref}
            className={cn(
                "inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50 border",
                variants[variant],
                sizes[size],
                className
            )}
            disabled={isLoading}
            {...props}
        >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {children}
        </button>
    );
});

Button.displayName = "Button";

export { Button };
