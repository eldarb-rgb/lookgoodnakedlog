'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TARGETS = { cal: 2600, protein: 180, water: 120 };

interface Entry {
  id?: number;
  date: string;
  log_time?: string;
  desc: string;
  cal: number;
  protein: number;
  water: number;
  note?: string;
}

interface WeightEntry {
  id?: number;
  date: string;
  weight: number;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(key: string) {
  if (!key) return '';
  const [, m, d] = key.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

function getTime() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getTotals(entries: Entry[]) {
  return entries.reduce((a, e) => ({
    cal: a.cal + (e.cal || 0),
    protein: a.protein + (e.protein || 0),
    water: a.water + (e.water || 0),
  }), { cal: 0, protein: 0, water: 0 });
}

export default function Home() {
  const [currentDate, setCurrentDate] = useState('');
  const [mounted, setMounted] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [desc, setDesc] = useState('');
  const [logging, setLogging] = useState(false);
  const [analysisNote, setAnalysisNote] = useState('');
  const [showGraph, setShowGraph] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [customWater, setCustomWater] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const today = todayKey();
    setCurrentDate(today);
    setMounted(true);
    loadEntries(today);
    loadWeights();
  }, []);

  const loadEntries = async (date: string) => {
    const { data } = await supabase
      .from('nutrition_logs')
      .select('*')
      .eq('date', date)
      .order('created_at', { ascending: false });
    if (data) setEntries(data);
  };

  const loadWeights = async () => {
    const { data } = await supabase
      .from('weight_logs')
      .select('*')
      .order('date', { ascending: true });
    if (data) setWeights(data);
  };

  const navigate = (dir: number) => {
    const d = new Date(currentDate + 'T12:00:00');
    d.setDate(d.getDate() + dir);
    const newDate = d.toISOString().split('T')[0];
    setCurrentDate(newDate);
    loadEntries(newDate);
  };

  const totals = getTotals(entries);
  const latestWeight = weights.length > 0 ? weights[weights.length - 1] : null;
  const prevWeight = weights.length > 1 ? weights[weights.length - 2] : null;
  const weightDiff = latestWeight && prevWeight ? latestWeight.weight - prevWeight.weight : null;
  const arrow = weightDiff === null ? '⚖️' : weightDiff < -0.1 ? '↓' : weightDiff > 0.1 ? '↑' : '→';
  const arrowColor = weightDiff === null ? '#666' : weightDiff < -0.1 ? '#60f090' : weightDiff > 0.1 ? '#f06060' : '#666';

  const handleLog = async () => {
    if (!desc && !photoBase64) { alert('Describe your meal or add a photo first.'); return; }
    setLogging(true);
    setAnalysisNote('');
    let cal = 0, protein = 0, note = '';
    try {
      const body: any = { description: desc };
      if (photoBase64) {
        body.imageBase64 = photoBase64.split(',')[1];
        body.mimeType = photoBase64.split(';')[0].split(':')[1];
      }
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const parsed = await res.json();
      cal = parsed.calories || 0;
      protein = parsed.protein_g || 0;
      note = parsed.notes || '';
    } catch { note = 'Could not estimate — logged without macros.'; }

    await supabase.from('nutrition_logs').insert([{
      date: currentDate,
      log_time: getTime(),
      desc,
      cal,
      protein,
      water: 0,
      note,
    }]);

    setDesc('');
    setPhotoBase64(null);
    setAnalysisNote(note);
    setLogging(false);
    await loadEntries(currentDate);
    setTimeout(() => setAnalysisNote(''), 5000);
  };

  const logWater = async (oz: number) => {
    await supabase.from('nutrition_logs').insert([{
      date: currentDate,
      log_time: getTime(),
      desc: 'Water',
      cal: 0,
      protein: 0,
      water: oz,
      note: '',
    }]);
    await loadEntries(currentDate);
  };

  const deleteEntry = async (id: number) => {
    await supabase.from('nutrition_logs').delete().eq('id', id);
    await loadEntries(currentDate);
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setPhotoBase64(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const logWeight = async () => {
    const val = parseFloat(weightInput);
    if (!val || val < 50 || val > 500) { alert('Enter a valid weight.'); return; }
    const today = todayKey();
    const existing = weights.find(w => w.date === today);
    if (existing) {
      await supabase.from('weight_logs').update({ weight: val }).eq('id', existing.id);
    } else {
      await supabase.from('weight_logs').insert([{ date: today, weight: val }]);
    }
    setWeightInput('');
    await loadWeights();
    setTimeout(() => drawChart(), 100);
  };

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (weights.length === 0) {
      ctx.fillStyle = '#444';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No weigh-ins yet', W / 2, H / 2);
      return;
    }
    const vals = weights.map(w => w.weight);
    const minV = Math.min(...vals) - 3, maxV = Math.max(...vals) + 3;
    const pad = { t: 16, r: 16, b: 28, l: 40 };
    const gW = W - pad.l - pad.r, gH = H - pad.t - pad.b;
    const toX = (i: number) => pad.l + (i / Math.max(weights.length - 1, 1)) * gW;
    const toY = (v: number) => pad.t + (1 - (v - minV) / (maxV - minV)) * gH;

    ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (i / 4) * gH;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + gW, y); ctx.stroke();
      const val = maxV - (i / 4) * (maxV - minV);
      ctx.fillStyle = '#555'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(0), pad.l - 4, y + 3);
    }

    ctx.beginPath(); ctx.strokeStyle = '#f0a060'; ctx.lineWidth = 2;
    weights.forEach((w, i) => { i === 0 ? ctx.moveTo(toX(i), toY(w.weight)) : ctx.lineTo(toX(i), toY(w.weight)); });
    ctx.stroke();

    ctx.beginPath();
    weights.forEach((w, i) => { i === 0 ? ctx.moveTo(toX(i), toY(w.weight)) : ctx.lineTo(toX(i), toY(w.weight)); });
    ctx.lineTo(toX(weights.length - 1), pad.t + gH);
    ctx.lineTo(toX(0), pad.t + gH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(240,160,96,0.08)'; ctx.fill();

    weights.forEach((w, i) => {
      ctx.beginPath(); ctx.arc(toX(i), toY(w.weight), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#f0a060'; ctx.fill();
      ctx.fillStyle = '#888'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(formatDate(w.date), toX(i), H - 6);
    });
  }, [weights]);

  const openGraph = () => { setShowGraph(true); setTimeout(drawChart, 100); };

  const calPct = Math.min(totals.cal / TARGETS.cal, 1);
  const proteinPct = Math.min(totals.protein / TARGETS.protein, 1);
  const waterPct = Math.min(totals.water / TARGETS.water, 1);

  return (
    <main style={{ fontFamily: "'DM Mono', monospace", background: '#0f0f0f', color: '#f0ede8', minHeight: '100vh', padding: '16px', maxWidth: '480px', margin: '0 auto', paddingBottom: '80px' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Comfortaa:wght@700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingTop: '8px' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '18px', letterSpacing: '-0.5px' }}>
          <span style={{ fontFamily: 'Comfortaa, cursive' }}>LookGood<span style={{ color: '#c8f060' }}>NakedLog</span></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={() => navigate(-1)} style={navBtnStyle}>‹</button>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '15px', color: '#c8f060', minWidth: '48px', textAlign: 'center' }}>
            <span style={{ fontFamily: 'DM Mono, monospace', fontVariantNumeric: 'tabular-nums' }}>{formatDate(currentDate)}</span>
          </div>
          <button onClick={() => navigate(1)} style={navBtnStyle}>›</button>
        </div>
      </div>

      {/* Weight */}
      <div onClick={openGraph} style={{ background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '14px', padding: '14px 16px', marginBottom: '14px', cursor: 'pointer' }}>
        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1.5px', color: '#666', marginBottom: '6px' }}>SUNDAY WEIGH-IN · tap to see history</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '28px', color: '#f0a060', lineHeight: 1 }}>
                {latestWeight ? latestWeight.weight.toFixed(1) : '—'}
              </div>
              <div style={{ fontSize: '11px', color: '#666' }}>lbs</div>
            </div>
            <div style={{ fontSize: '11px', marginTop: '3px', color: weightDiff === null ? '#666' : weightDiff < -0.1 ? '#60f090' : weightDiff > 0.1 ? '#f06060' : '#666' }}>
              {weightDiff === null ? (latestWeight ? 'First weigh-in logged' : 'No weigh-ins yet') : weightDiff < -0.1 ? `${Math.abs(weightDiff).toFixed(1)} lbs down` : weightDiff > 0.1 ? `${weightDiff.toFixed(1)} lbs up` : 'Holding steady'}
            </div>
          </div>
          <div style={{ fontSize: '32px', color: arrowColor }}>{arrow}</div>
        </div>
      </div>

      {/* Graph Modal */}
      {showGraph && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setShowGraph(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '440px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', color: '#f0a060' }}>WEIGHT HISTORY</div>
              <button onClick={() => setShowGraph(false)} style={{ background: 'none', border: 'none', color: '#666', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            <canvas ref={canvasRef} width={400} height={180} style={{ width: '100%', height: '180px' }} />
            <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
              <input type="number" value={weightInput} onChange={e => setWeightInput(e.target.value)}
                placeholder="Enter weight (lbs)" step="0.1" min="100" max="400"
                style={{ flex: 1, background: '#0f0f0f', border: '1px solid #2e2e2e', borderRadius: '8px', color: '#f0ede8', fontFamily: 'DM Mono, monospace', fontSize: '14px', padding: '8px 12px', outline: 'none' }} />
              <button onClick={logWeight} style={{ background: 'rgba(240,160,96,0.15)', border: '1px solid rgba(240,160,96,0.4)', borderRadius: '8px', color: '#f0a060', cursor: 'pointer', padding: '8px 14px', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px' }}>LOG</button>
            </div>
          </div>
        </div>
      )}

      {/* Macro Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
        {[
          { label: 'Calories', val: totals.cal, target: TARGETS.cal, unit: 'kcal', pct: calPct, color: '#c8f060' },
          { label: 'Protein', val: totals.protein, target: TARGETS.protein, unit: 'g', pct: proteinPct, color: '#60c8f0' },
          { label: 'Water', val: totals.water, target: TARGETS.water, unit: 'oz', pct: waterPct, color: '#a060f0' },
        ].map(({ label, val, target, unit, pct, color }) => (
          <div key={label} style={{ background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '12px', padding: '12px 10px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1.5px', color: '#666', marginBottom: '6px' }}>{label}</div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '20px', color, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>/ {target} <span style={{ fontSize: '10px' }}>{unit}</span></div>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: color, transformOrigin: 'left', transform: `scaleX(${pct})`, transition: 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1)' }} />
          </div>
        ))}
      </div>

      {/* Water */}
      <div style={{ background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '14px', padding: '12px 14px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '13px', color: '#a060f0', flex: 1 }}>💧 Log Water</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[8, 16, 33].map(oz => (
              <button key={oz} onClick={() => logWater(oz)} style={{ background: 'rgba(160,96,240,0.12)', border: '1px solid rgba(160,96,240,0.3)', borderRadius: '20px', color: '#a060f0', cursor: 'pointer', padding: '5px 11px', fontSize: '11px', fontFamily: 'DM Mono, monospace' }}>{oz} oz</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input type="number" value={customWater} onChange={e => setCustomWater(e.target.value)}
            placeholder="Custom amount (oz)" min="1" max="200"
            style={{ flex: 1, background: '#0f0f0f', border: '1px solid #2e2e2e', borderRadius: '8px', color: '#f0ede8', fontFamily: 'DM Mono, monospace', fontSize: '13px', padding: '7px 10px', outline: 'none' }} />
          <button onClick={() => { const v = parseInt(customWater); if (v > 0) { logWater(v); setCustomWater(''); } }} style={{ background: 'rgba(160,96,240,0.15)', border: '1px solid rgba(160,96,240,0.4)', borderRadius: '8px', color: '#a060f0', cursor: 'pointer', padding: '7px 14px', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '11px' }}>LOG</button>
        </div>
      </div>

      {/* Meal Form */}
      <div style={{ background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '14px', padding: '16px', marginBottom: '14px' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: '#c8f060', marginBottom: '10px' }}>+ LOG MEAL / FOOD</div>
        <textarea value={desc} onChange={e => setDesc(e.target.value)}
          placeholder={"Describe what you ate — be specific.\ne.g. '1/4 lb sockeye salmon, 1 cup Brussels sprouts, sriracha'\n\nClaude estimates calories & protein when you hit LOG IT."}
          style={{ width: '100%', background: '#0f0f0f', border: '1px solid #2e2e2e', borderRadius: '8px', color: '#f0ede8', fontFamily: 'DM Mono, monospace', fontSize: '12px', padding: '10px 12px', resize: 'none', minHeight: '88px', outline: 'none', lineHeight: 1.5 }} />

        {photoBase64 && <img src={photoBase64} alt="preview" style={{ width: '44px', height: '44px', borderRadius: '6px', objectFit: 'cover', border: '1px solid #2e2e2e', marginTop: '8px' }} />}

        {analysisNote && (
          <div style={{ background: 'rgba(96,200,240,0.06)', border: '1px solid rgba(96,200,240,0.2)', borderRadius: '8px', padding: '10px 12px', marginTop: '10px', fontSize: '11px', color: '#60c8f0', lineHeight: 1.6 }}>
            {analysisNote}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
          <input type="file" ref={photoInputRef} accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
          <button onClick={() => photoInputRef.current?.click()} style={{ background: '#0f0f0f', border: `1px ${photoBase64 ? 'solid' : 'dashed'} ${photoBase64 ? '#c8f060' : '#2e2e2e'}`, borderRadius: '8px', color: photoBase64 ? '#c8f060' : '#666', cursor: 'pointer', padding: '8px 12px', fontSize: '11px', fontFamily: 'DM Mono, monospace' }}>
            {photoBase64 ? '✓ Photo added' : '📷 Photo'}
          </button>
          <button onClick={handleLog} disabled={logging} style={{ background: logging ? '#555' : '#c8f060', border: 'none', borderRadius: '8px', color: '#0f0f0f', cursor: logging ? 'not-allowed' : 'pointer', padding: '8px 18px', fontSize: '12px', fontFamily: 'Syne, sans-serif', fontWeight: 700, marginLeft: 'auto' }}>
            {logging ? 'Analyzing...' : 'LOG IT'}
          </button>
        </div>
      </div>

      {/* Entries */}
      <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '2px', color: '#666', marginBottom: '10px' }}>
        {currentDate === todayKey() ? "TODAY'S LOG" : `${formatDate(currentDate)} LOG`}
      </div>

      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px', color: '#666', fontSize: '12px', lineHeight: 1.8 }}>Nothing logged yet.<br />Describe a meal above and hit LOG IT.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {entries.map((e) => (
            <div key={e.id} style={{ background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: '10px', padding: '12px', display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: '10px', color: '#666', marginBottom: '3px' }}>{e.log_time}</div>
                <div style={{ fontSize: '12px', lineHeight: 1.4 }}>{e.desc || (e.water ? 'Water intake' : 'Entry')}</div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {e.cal > 0 && <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', background: 'rgba(200,240,96,0.12)', color: '#c8f060' }}>{e.cal} cal</span>}
                  {e.protein > 0 && <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', background: 'rgba(96,200,240,0.12)', color: '#60c8f0' }}>{e.protein}g protein</span>}
                  {e.water > 0 && <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '20px', background: 'rgba(160,96,240,0.12)', color: '#a060f0' }}>{e.water}oz water</span>}
                  {e.note && <div style={{ fontSize: '10px', color: '#666', marginTop: '4px', fontStyle: 'italic' }}>{e.note}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <button onClick={() => deleteEntry(e.id!)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', padding: '2px', lineHeight: 1 }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #2e2e2e', color: '#f0ede8',
  width: '28px', height: '28px', borderRadius: '6px', cursor: 'pointer',
  fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
};