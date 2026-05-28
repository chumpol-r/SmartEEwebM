import React, { useEffect, useState } from 'react';
import { HelpCircle, ImageIcon, X, ImageOff } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
    return twMerge(clsx(inputs));
}

/* ---------- Lightbox (full-screen image viewer) ---------- */

const Lightbox = ({ open, src, alt, onClose }) => {
    const [errored, setErrored] = useState(false);

    useEffect(() => {
        if (!open) return;
        setErrored(false);
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-8 animate-scale-in"
        >
            <div onClick={onClose} className="absolute inset-0 bg-slate-950/85 backdrop-blur-md" />
            <div className="relative max-w-4xl w-full max-h-full flex flex-col items-center">
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute -top-2 -right-2 sm:top-2 sm:right-2 z-10 w-9 h-9 rounded-full bg-slate-900/90 border border-slate-700 hover:bg-slate-800 text-white flex items-center justify-center shadow-xl"
                >
                    <X size={16} />
                </button>

                {errored ? (
                    <div className="bg-slate-900 border border-slate-700 rounded-xl p-8 text-center max-w-md">
                        <ImageOff size={32} className="text-slate-500 mx-auto mb-3" />
                        <p className="text-sm text-slate-200 mb-1">ยังไม่ได้วางไฟล์รูป</p>
                        <code className="text-xs text-slate-400 break-all">{src}</code>
                        <p className="mt-3 text-xs text-slate-500">
                            วางไฟล์ใน <code className="text-slate-300">client/public/</code> แล้วรีโหลดหน้า
                        </p>
                    </div>
                ) : (
                    <>
                        <img
                            src={src}
                            alt={alt}
                            onError={() => setErrored(true)}
                            className="max-h-[88vh] w-auto object-contain rounded-xl shadow-2xl ring-1 ring-white/10 bg-white"
                        />
                        <p className="mt-3 text-xs text-slate-400 text-center">
                            กด <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">ESC</kbd> หรือคลิกพื้นที่ว่างเพื่อปิด
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

/* ---------- Helper data ---------- */

const TUTORIALS = {
    token: {
        label: 'How To Get Channel Access Token',
        src: '/line-tutorial-token.png',
        alt: 'ขั้นตอนการดึง Channel Access Token จาก LINE Official Account Manager',
    },
    group: {
        label: 'How To Get Group ID',
        src: '/line-tutorial-groupid.png',
        alt: 'ขั้นตอนการดึงรหัส Group ID จากลิงก์เชิญกลุ่ม LINE',
    },
};

/* ---------- Main: a single quiet helper line ---------- */

const LineCredentialsGuide = ({ type = null }) => {
    const [active, setActive] = useState(null); // 'token' | 'group' | null

    const LinkBtn = ({ id }) => (
        <button
            type="button"
            onClick={() => setActive(id)}
            className={cn(
                'inline-flex items-center gap-1 text-xs text-slate-400 hover:text-green-300',
                'underline decoration-dotted underline-offset-2 decoration-slate-600 hover:decoration-green-400/60',
                'transition-colors focus:outline-none focus-visible:text-green-300 rounded'
            )}
        >
            <ImageIcon size={11} className="opacity-70" />
            {TUTORIALS[id].label}
        </button>
    );

    // If type is specified, show only that credential's guide
    if (type === 'token') {
        return (
            <>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 px-0.5">
                    <HelpCircle size={12} className="text-slate-500" />
                    <LinkBtn id="token" />
                </div>

                <Lightbox
                    open={!!active}
                    src={active ? TUTORIALS[active].src : null}
                    alt={active ? TUTORIALS[active].alt : ''}
                    onClose={() => setActive(null)}
                />
            </>
        );
    }

    if (type === 'group') {
        return (
            <>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 px-0.5">
                    <HelpCircle size={12} className="text-slate-500" />
                    <LinkBtn id="group" />
                </div>

                <Lightbox
                    open={!!active}
                    src={active ? TUTORIALS[active].src : null}
                    alt={active ? TUTORIALS[active].alt : ''}
                    onClose={() => setActive(null)}
                />
            </>
        );
    }

    // Default: show both
    return (
        <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 px-0.5">
                <span className="inline-flex items-center gap-1.5">
                    <HelpCircle size={12} className="text-slate-500" />
                    ไม่ทราบวิธีหา? ดูภาพประกอบ:
                </span>
                <LinkBtn id="token" />
                <span className="text-slate-700">·</span>
                <LinkBtn id="group" />
            </div>

            <Lightbox
                open={!!active}
                src={active ? TUTORIALS[active].src : null}
                alt={active ? TUTORIALS[active].alt : ''}
                onClose={() => setActive(null)}
            />
        </>
    );
};

export default LineCredentialsGuide;
