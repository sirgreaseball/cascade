import { useState } from 'react';

const WIDGETS = [
  {
    id: 1,
    x: '20%',
    y: '45%',
    label: 'SENSOR 04',
    status: 'ANOMALY DETECTED',
    value: 'WATER PRESSURE +2.4kPa',
    alert: true,
  },
  {
    id: 2,
    x: '75%',
    y: '30%',
    label: 'EVACUATION ZONE ALPHA',
    status: 'EVACUATING',
    value: 'COMPLETION: 45%',
    alert: false,
  },
  {
    id: 3,
    x: '60%',
    y: '70%',
    label: 'DAM BREACH INTEGRITY',
    status: 'CRITICAL',
    value: 'STRUCTURAL YIELD 89%',
    alert: true,
  }
];

export default function FloatingWidgets() {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="fixed inset-0 pointer-events-none z-[15]">
      {WIDGETS.map((widget) => (
        <div 
          key={widget.id}
          className="absolute pointer-events-auto"
          style={{ top: widget.y, left: widget.x }}
          onMouseEnter={() => setHovered(widget.id)}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Node Dot */}
          <div className="relative group cursor-none">
            <div className={`w-3 h-3 rounded-full flex items-center justify-center transition-all duration-500 ${widget.alert ? 'bg-alert/20' : 'bg-ink/20'} backdrop-blur-md border ${widget.alert ? 'border-alert/50' : 'border-ink/30'} group-hover:scale-150`}>
              <div className={`w-1 h-1 rounded-full ${widget.alert ? 'bg-alert animate-pulse' : 'bg-ink'}`} />
            </div>

            {/* Expanded Info Panel */}
            <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-4 flex flex-col items-center origin-top transition-all duration-500 ${hovered === widget.id ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
              <div className="w-[1px] h-4 bg-gradient-to-b from-white/30 to-transparent -mt-4 mb-2" />
              <div className="bg-[#050505]/80 backdrop-blur-xl border border-white/10 p-3 min-w-[200px] flex flex-col gap-1 shadow-2xl">
                <span className="font-mono text-[10px] tracking-widest text-dim uppercase">{widget.label}</span>
                <span className={`font-sans text-xs font-medium uppercase ${widget.alert ? 'text-alert' : 'text-ink'}`}>{widget.status}</span>
                <span className="font-mono text-[9px] tracking-widest text-dim/70 mt-1 uppercase">{widget.value}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
