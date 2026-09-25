
import React from 'react';

const CrtOverlay: React.FC = () => {
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] w-full h-full overflow-hidden select-none">

        {/* 1. Curved Vignette (Dark corners) */}
        <div className="absolute inset-0 z-[60] shadow-[inset_0_0_8rem_rgba(0,0,0,0.6)]"></div>

        {/* 2. Scanlines (The horizontal lines) */}
        <div className="absolute inset-0 z-40 opacity-30 pointer-events-none mix-blend-multiply"
             style={{
                 background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.5))',
                 backgroundSize: '100% 4px'
             }}>
        </div>

        {/* 3. Aperture Grille (Vertical RGB stripes) */}
        <div className="absolute inset-0 z-50 opacity-10 pointer-events-none mix-blend-screen"
             style={{
                 background: 'linear-gradient(90deg, rgba(255,0,0,0.8), rgba(0,255,0,0.8), rgba(0,0,255,0.8))',
                 backgroundSize: '3px 100%'
             }}>
        </div>

        {/* 4. Subtle Bloom/Glow (Simulates light scattering on glass) */}
        <div className="absolute inset-0 z-30 pointer-events-none mix-blend-screen opacity-10"
             style={{
                 background: 'radial-gradient(circle at center, rgba(34,211,238,0.4) 0%, rgba(0,0,0,0) 80%)'
             }}>
        </div>

        {/* 5. Signal Noise (Snow) */}
        <div className="absolute inset-0 z-20 opacity-[0.03] animate-noise pointer-events-none mix-blend-overlay"></div>

        {/* 6. Rolling Hum Bar (Interference) */}
        <div className="absolute inset-0 z-20 bg-gradient-to-b from-transparent via-white/5 to-transparent h-[15vh] w-full animate-scanline pointer-events-none mix-blend-screen opacity-30"></div>

        {/* 7. 50/60Hz Flicker */}
        <div className="absolute inset-0 z-[100] bg-white animate-flicker pointer-events-none mix-blend-overlay opacity-[0.02]"></div>

        <style>{`
            @keyframes scanline {
                0% { transform: translateY(-100%); }
                100% { transform: translateY(1000%); }
            }
            @keyframes noise {
                0%, 100% { background-position: 0 0; }
                10% { background-position: -5% -10%; }
                20% { background-position: -15% 5%; }
                30% { background-position: 7% -25%; }
                40% { background-position: 20% 25%; }
                50% { background-position: -25% 10%; }
                60% { background-position: 15% 5%; }
                70% { background-position: 0% 15%; }
                80% { background-position: 25% 35%; }
                90% { background-position: -10% 10%; }
            }
            @keyframes flicker {
                0% { opacity: 0.02; }
                50% { opacity: 0.05; }
                100% { opacity: 0.02; }
            }
            .animate-scanline {
                animation: scanline 8s linear infinite;
            }
            .animate-noise {
                animation: noise 0.2s steps(2) infinite;
                background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
            }
            .animate-flicker {
                animation: flicker 0.03s infinite;
            }
        `}</style>
    </div>
  );
};

export default CrtOverlay;
