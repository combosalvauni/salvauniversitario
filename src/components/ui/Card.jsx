import { cn } from '../../lib/utils';

export function Card({ className, children, ...props }) {
    return (
        <div
            className={cn(
                "rounded-2xl border border-white/5 bg-white/5 backdrop-blur-sm transition-all duration-200 hover:bg-white/10 hover:shadow-[0_0_20px_rgba(0,0,0,0.3)]",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}

export function CardHeader({ className, children, ...props }) {
    return (
        <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props}>
            {children}
        </div>
    );
}

export function CardTitle({ className, children, ...props }) {
    return (
        <h3 className={cn("font-display text-xl font-semibold leading-none tracking-tight text-white", className)} {...props}>
            {children}
        </h3>
    );
}

export function CardContent({ className, children, ...props }) {
    return (
        <div className={cn("p-6 pt-0", className)} {...props}>
            {children}
        </div>
    );
}

export function CardFooter({ className, children, ...props }) {
    return (
        <div className={cn("flex items-center p-6 pt-0", className)} {...props}>
            {children}
        </div>
    );
}
