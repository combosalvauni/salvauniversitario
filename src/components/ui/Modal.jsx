import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { createPortal } from 'react-dom';

export function Modal({ isOpen, onClose, title, children, className }) {
    // Prevent scrolling when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className={cn(
                    "relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#1C1C1C] shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-200 max-h-[calc(100dvh-2rem)] overflow-hidden",
                    className
                )}
            >
                <div className="flex items-center justify-between border-b border-white/5 p-6">
                    <h2 className="font-display text-xl font-bold text-white">{title}</h2>
                    <button
                        onClick={onClose}
                        className="rounded-full p-2 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto max-h-[calc(100dvh-8rem)]">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
