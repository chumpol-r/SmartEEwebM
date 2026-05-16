import React, { useState, useEffect, useRef } from 'react';
import { Clock, Zap, Droplets, Thermometer, Wind, Gauge, Activity, FlaskConical } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

/**
 * MeterCard – Universal card for Realtime Monitoring.
 * Auto-detects meter type and renders metrics based on mapped UI data.
 *
 * Props:
 *   name          – Display name
 *   hasData       – Whether MQTT data has arrived
 *   isConnected   – MQTT connection status
 *   machineData   – Raw MQTT payload object
 *   fmt           – Fallback number formatting function
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultFmt = (val, dec = 2) => {
  if (val === undefined || val === null || val === '') return '--';
  const num = Number(val);
  if (isNaN(num)) return val;
  return num.toFixed(dec);
};

/** Convert MQTT field names to readable labels (used for fallback fields) */
const formatFieldLabel = (key) => {
  let label = key;
  const unitMap = { '_mps': ' (m/s)', '_ppm': ' (ppm)', '_raw': '', '_avg': ' Avg' };
  for (const [suffix, replacement] of Object.entries(unitMap)) {
    if (label.toLowerCase().endsWith(suffix)) {
      label = label.slice(0, -suffix.length) + replacement;
    }
  }
  return label
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/([0-9]+)/g, ' $1')
    .replace(/\s+/g, ' ')
    .replace(/^./, s => s.toUpperCase())
    .trim();
};

const getCategoryMeta = (category) => {
  const cat = category.toLowerCase();
  if (cat.includes('electric')) return { icon: Zap, accent: 'text-blue-400' };
  if (cat.includes('water')) return { icon: Droplets, accent: 'text-cyan-400' };
  if (cat.includes('ammonia') || cat.includes('co2') || cat.includes('tvoc') || cat.includes('oxygen') || cat.includes('monoxide')) return { icon: FlaskConical, accent: 'text-emerald-400' };
  if (cat.includes('illuminance') || cat.includes('light')) return { icon: Zap, accent: 'text-yellow-400' };
  if (cat.includes('pressure') || cat.includes('flow')) return { icon: Gauge, accent: 'text-indigo-400' };
  if (cat.includes('wind')) return { icon: Wind, accent: 'text-sky-400' };
  if (cat.includes('temperature') || cat.includes('humidity')) return { icon: Thermometer, accent: 'text-orange-400' };
  return { icon: Activity, accent: 'text-slate-400' };
};

// ── Data Mapping Logic (from user's dataMapper.js) ───────────────────────────

export function transformMqttToUI(rawData) {
  let initialStatus = "OFFLINE";
  if (rawData && rawData.Time) {
    initialStatus = "ONLINE";
    try {
      // 2026-02-23 17:54:00.798 -> 2026-02-23T17:54:00.798
      let tStr = String(rawData.Time).replace(' ', 'T');
      // If no timezone, add +07:00
      if (!tStr.includes('+') && !tStr.includes('Z')) {
        tStr += '+07:00';
      }
      
      const dataTime = new Date(tStr).getTime();
      const now = Date.now();

      if (!isNaN(dataTime)) {
        // If data is older than 60 seconds (1 min), mark as OFFLINE
        if (now - dataTime > 60000) {
          initialStatus = "OFFLINE";
        }
      } else {
        console.warn("Invalid Date parsed from:", rawData.Time);
      }
    } catch (e) {
      console.warn("Error parsing Time:", e);
    }
  }

  const uiData = {
    status: initialStatus,
    last_update: rawData?.Time || '--',
    isElectric: false,
    category: "Unknown",
    primary: [],
    secondary: [],
    electric_details: null
  };

  const hasKeys = Object.keys(rawData).length > 0;
  if (!hasKeys) return uiData;

  // 1. ตรวจจับมิเตอร์ไฟฟ้า
  if (rawData.KWH !== undefined || rawData.VoltP1 !== undefined || rawData.VoltL1 !== undefined) {
    uiData.isElectric = true;
    uiData.category = "Electric Power Meter";
    uiData.primary = [
      { label: "Total Energy (kWh)", value: (rawData.KWH !== undefined && rawData.KWH >= 0 ? rawData.KWH : 0).toFixed(2), unit: "kWh", color: "text-blue-400", dbKey: "KWH" },
      { label: "Demand (kW)", value: (rawData.LastKwDemand || rawData.KW || 0).toFixed(2), unit: "kW", color: "text-yellow-400", dbKey: "LastKwDemand" }
    ];
    uiData.electric_details = {
      kvar: { value: (rawData.KVAR || 0).toFixed(2), dbKey: "KVAR" },
      pf: { value: (rawData.PF || 0).toFixed(2), dbKey: "PF" },
      voltage: {
        r: { value: (rawData.VoltP1 || rawData.VoltL1 || 0).toFixed(2), dbKey: rawData.VoltP1 !== undefined ? "VoltP1" : "VoltL1" },
        s: { value: (rawData.VoltP2 || rawData.VoltL2 || 0).toFixed(2), dbKey: rawData.VoltP2 !== undefined ? "VoltP2" : "VoltL2" },
        t: { value: (rawData.VoltP3 || rawData.VoltL3 || 0).toFixed(2), dbKey: rawData.VoltP3 !== undefined ? "VoltP3" : "VoltL3" },
        avg: { value: (((rawData.VoltP1||rawData.VoltL1||0) + (rawData.VoltP2||rawData.VoltL2||0) + (rawData.VoltP3||rawData.VoltL3||0)) / 3).toFixed(2), dbKey: rawData['VoltP-avr'] !== undefined || rawData.VoltP1 !== undefined ? "VoltP-avr" : "VoltL-avr" }
      },
      current: {
        r: { value: (rawData.Amp1 || 0).toFixed(2), dbKey: "Amp1" },
        s: { value: (rawData.Amp2 || 0).toFixed(2), dbKey: "Amp2" },
        t: { value: (rawData.Amp3 || 0).toFixed(2), dbKey: "Amp3" },
        avg: { value: (((rawData.Amp1||0) + (rawData.Amp2||0) + (rawData.Amp3||0)) / 3).toFixed(2), dbKey: "Amp-avr" }
      }
    };
    return uiData;
  }

  // 2. ตรวจจับมิเตอร์น้ำ
  if (rawData.c_WaterFlow !== undefined || rawData.WaterFlow !== undefined || rawData.WaterAccum !== undefined) {
    uiData.category = "Water Meter";
    
    let accumKey = "WaterAccum";
    if (rawData.c_WaterFlow !== undefined) accumKey = "c_WaterFlow";
    
    let flowKey = "WaterFlow";
    if (rawData.FlowRate !== undefined) flowKey = "FlowRate";

    uiData.primary = [
      { label: "Accumulated Volume", value: (rawData.c_WaterFlow !== undefined ? rawData.c_WaterFlow : (rawData.WaterAccum || 0)).toFixed(3), unit: "m³", color: "text-blue-400", dbKey: accumKey },
      { label: "Flow Rate", value: (rawData.WaterFlow !== undefined ? rawData.WaterFlow : (rawData.FlowRate || 0)).toFixed(3), unit: "m³/h", color: "text-cyan-400", dbKey: flowKey }
    ];
    // append extra data handling
  }
  // 3. ตรวจจับเซ็นเซอร์ก๊าซ / สภาพแวดล้อมเฉพาะทาง
  else {
    const appendSecondaryTempHum = () => {
      if (rawData.Temperature !== undefined) {
        uiData.secondary.push({ label: "Temperature", value: rawData.Temperature.toFixed(2), unit: "°C", dbKey: "Temperature" });
      } else if (rawData.Temp !== undefined) {
        uiData.secondary.push({ label: "Temperature", value: rawData.Temp.toFixed(2), unit: "°C", dbKey: "Temp" });
      }
      if (rawData.Humidity !== undefined) {
        uiData.secondary.push({ label: "Humidity", value: rawData.Humidity.toFixed(2), unit: "%", dbKey: "Humidity" });
      }
    };

    if (rawData.Ammonia_ppm !== undefined) {
      uiData.category = "Ammonia (NH3)";
      uiData.primary.push({ label: "Ammonia (NH3)", value: rawData.Ammonia_ppm.toFixed(2), unit: "ppm", color: "text-red-400", dbKey: "Ammonia_ppm" });
      appendSecondaryTempHum();
    } 
    else if (rawData.CO2_ppm !== undefined) {
      uiData.category = "Carbon Dioxide (CO2)";
      uiData.primary.push({ label: "CO2 Level", value: rawData.CO2_ppm.toFixed(2), unit: "ppm", color: "text-yellow-400", dbKey: "CO2_ppm" });
      appendSecondaryTempHum();
    }
    else if (rawData.CO2_mgpm3 !== undefined) {
      uiData.category = "Carbon Dioxide (CO2)";
      uiData.primary.push({ label: "CO2 Level", value: rawData.CO2_mgpm3.toFixed(2), unit: "mg/m³", color: "text-yellow-400", dbKey: "CO2_mgpm3" });
      appendSecondaryTempHum();
    }
    else if (rawData.CO2 !== undefined) {
      uiData.category = "Carbon Dioxide (CO2)";
      uiData.primary.push({ label: "CO2 Level", value: rawData.CO2.toFixed(2), unit: "ppm", color: "text-yellow-400", dbKey: "CO2" });
      appendSecondaryTempHum();
    }
    else if (rawData.CO_ppm !== undefined) {
      uiData.category = "Carbon Monoxide (CO)";
      uiData.primary.push({ label: "Carbon Monoxide", value: rawData.CO_ppm.toFixed(2), unit: "ppm", color: "text-red-500", dbKey: "CO_ppm" });
      appendSecondaryTempHum();
    }
    else if (rawData.O2_VOL !== undefined) {
      uiData.category = "Oxygen (O2)";
      uiData.primary.push({ label: "Oxygen (O2)", value: rawData.O2_VOL.toFixed(2), unit: "%VOL", color: "text-blue-300", dbKey: "O2_VOL" });
      appendSecondaryTempHum();
    }
    else if (rawData.TVOC_ppb !== undefined) {
      uiData.category = "TVOC";
      uiData.primary.push({ label: "TVOC", value: rawData.TVOC_ppb.toFixed(2), unit: "ppb", color: "text-purple-400", dbKey: "TVOC_ppb" });
      appendSecondaryTempHum();
    }
    else if (rawData.Illuminance !== undefined) {
      uiData.category = "Illuminance";
      uiData.primary.push({ label: "Illuminance", value: rawData.Illuminance.toFixed(2), unit: "lux", color: "text-yellow-300", dbKey: "Illuminance" });
      appendSecondaryTempHum();
    }
    else if (rawData.Lux !== undefined) {
      uiData.category = "Illuminance";
      uiData.primary.push({ label: "Illuminance", value: rawData.Lux.toFixed(2), unit: "lux", color: "text-yellow-300", dbKey: "Lux" });
      appendSecondaryTempHum();
    }
    else if (rawData.NegativePa !== undefined) {
      uiData.category = "Negative Pressure";
      uiData.primary.push({ label: "Negative Pressure", value: rawData.NegativePa.toFixed(2), unit: "Pa", color: "text-indigo-400", dbKey: "NegativePa" });
      appendSecondaryTempHum();
    }
    else if (rawData.Pressure !== undefined) {
      uiData.category = "Negative Pressure";
      uiData.primary.push({ label: "Negative Pressure", value: rawData.Pressure.toFixed(2), unit: "Pa", color: "text-indigo-400", dbKey: "Pressure" });
      appendSecondaryTempHum();
    }
    else if (rawData.wind_speed_mps !== undefined) {
      uiData.category = "Wind Speed";
      uiData.primary.push({ label: "Wind Speed", value: rawData.wind_speed_mps.toFixed(2), unit: "m/s", color: "text-cyan-400", dbKey: "wind_speed_mps" });
      appendSecondaryTempHum();
    }
    else if (rawData.WindSpeed !== undefined) {
      uiData.category = "Wind Speed";
      uiData.primary.push({ label: "Wind Speed", value: rawData.WindSpeed.toFixed(2), unit: "m/s", color: "text-cyan-400", dbKey: "WindSpeed" });
      appendSecondaryTempHum();
    }
    else if (rawData.Temperature !== undefined && rawData.Humidity !== undefined) {
      uiData.category = "Temperature & Humidity";
      uiData.primary.push({ label: "Temperature", value: rawData.Temperature.toFixed(2), unit: "°C", color: "text-orange-400", dbKey: "Temperature" });
      uiData.primary.push({ label: "Humidity", value: rawData.Humidity.toFixed(2), unit: "%", color: "text-blue-400", dbKey: "Humidity" });
    } else {
      uiData.category = "Sensor";
      // Generic fallback for unknown meters
      const entries = Object.entries(rawData)
        .filter(([k]) => !['Time', 'lastUpdate', 'ID', 'Serial', 'MeterType'].includes(k))
        .slice(0, 2);
      entries.forEach(([k, v], i) => {
        uiData.primary.push({ label: formatFieldLabel(k), value: typeof v === 'number' ? v.toFixed(2) : String(v), color: i === 0 ? "text-indigo-400" : "text-cyan-400", dbKey: formatFieldLabel(k) });
      });
    }
  }

  return uiData;
}

// ── Sub-components ───────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  const map = {
    ONLINE: 'bg-green-500/20 text-green-400',
    CONNECTING: 'bg-yellow-500/20 text-yellow-400 animate-pulse',
    OFFLINE: 'bg-slate-700 text-slate-400',
  };
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-wide ${map[status] || map.OFFLINE}`}>
      {status || 'OFFLINE'}
    </span>
  );
};

const PrimaryBox = ({ label, value, unit, color = 'text-white', dbKey, isSelected, onToggle, isStale }) => {
  const finalColor = isStale ? 'text-slate-500' : color;
  const isLongValue = value && String(value).length > 10;
  
  return (
    <div 
      onClick={() => onToggle && onToggle({ label, dbKey, unit, color })}
      className={`bg-slate-900/50 p-3 rounded-lg relative transition-all ${onToggle ? 'cursor-pointer hover:bg-slate-800' : ''} ${isSelected ? 'ring-2 ring-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.2)]' : 'ring-1 ring-transparent'} ${isStale ? 'opacity-80' : ''}`}
    >
      <div className={`text-[10px] mb-1 truncate pr-4 uppercase tracking-tighter ${isStale ? 'text-slate-600' : 'text-slate-500'}`}>{label}</div>
      <div className={`flex items-baseline gap-1 flex-wrap min-w-0 ${finalColor}`}>
        <span className={`${isLongValue ? 'text-lg' : 'text-xl'} font-bold font-mono truncate`}>
          {value !== undefined ? value : '--'}
        </span>
        {unit && (
          <span className="text-[10px] font-medium opacity-80 shrink-0 mb-0.5">
            {unit}
          </span>
        )}
      </div>
      {isSelected && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
      )}
    </div>
  );
};

const ElectricDetailsRow = ({ label, item, isSelected, onToggle, isStale }) => {
  if (!item) return null;
  const valColor = isStale ? 'text-slate-500' : 'text-white';
  
  return (
    <div 
      onClick={() => onToggle && onToggle({ label, dbKey: item.dbKey, unit: '' })}
      className={`flex justify-between border-b border-slate-700/50 pb-1 transition-colors ${onToggle ? 'cursor-pointer hover:bg-slate-800 rounded px-1' : ''} ${isSelected ? 'bg-blue-500/20 px-1 rounded border-b-transparent' : ''}`}
    >
      <span className={`${isStale ? 'text-slate-600' : 'text-slate-400'}`}>{label}:</span>
      <span className={`font-mono flex items-center gap-2 ${valColor}`}>
        {item.value}
        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>}
      </span>
    </div>
  );
};

const ElectricDetails = ({ details, selectedKeys = [], onToggle, isStale }) => {
  if (!details) return null;
  const isSel = (key) => selectedKeys.includes(key);

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <ElectricDetailsRow label="kVAR" item={details.kvar} isSelected={isSel(details.kvar?.dbKey)} onToggle={onToggle} isStale={isStale} />
      <ElectricDetailsRow label="Pf" item={details.pf} isSelected={isSel(details.pf?.dbKey)} onToggle={onToggle} isStale={isStale} />

      <div className={`col-span-2 mt-2 font-semibold text-xs uppercase ${isStale ? 'text-slate-700' : 'text-slate-500'}`}>Voltage (V)</div>
      <ElectricDetailsRow label="R" item={details.voltage.r} isSelected={isSel(details.voltage.r?.dbKey)} onToggle={onToggle} isStale={isStale} />
      <ElectricDetailsRow label="S" item={details.voltage.s} isSelected={isSel(details.voltage.s?.dbKey)} onToggle={onToggle} isStale={isStale} />
      <ElectricDetailsRow label="T" item={details.voltage.t} isSelected={isSel(details.voltage.t?.dbKey)} onToggle={onToggle} isStale={isStale} />
      <div className="border-t border-slate-700/50 pt-1 col-span-1">
        <ElectricDetailsRow label="Avg" item={details.voltage.avg} isSelected={isSel(details.voltage.avg?.dbKey)} onToggle={onToggle} isStale={isStale} />
      </div>

      <div className={`col-span-2 mt-2 font-semibold text-xs uppercase ${isStale ? 'text-slate-700' : 'text-slate-500'}`}>Current (A)</div>
      <ElectricDetailsRow label="R" item={details.current.r} isSelected={isSel(details.current.r?.dbKey)} onToggle={onToggle} isStale={isStale} />
      <ElectricDetailsRow label="S" item={details.current.s} isSelected={isSel(details.current.s?.dbKey)} onToggle={onToggle} isStale={isStale} />
      <ElectricDetailsRow label="T" item={details.current.t} isSelected={isSel(details.current.t?.dbKey)} onToggle={onToggle} isStale={isStale} />
      <div className="border-t border-slate-700/50 pt-1 col-span-1">
        <ElectricDetailsRow label="Avg" item={details.current.avg} isSelected={isSel(details.current.avg?.dbKey)} onToggle={onToggle} isStale={isStale} />
      </div>
    </div>
  );
};

const GenericDetails = ({ secondary, selectedKeys = [], onToggle, isStale }) => {
  if (!secondary || secondary.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {secondary.map((item, idx) => {
        const displayVal = item.value !== undefined ? `${item.value}${item.unit ? ' ' + item.unit : ''}` : '--';
        const isSelected = selectedKeys.includes(item.dbKey);
        const valColor = isStale ? 'text-slate-500' : 'text-white';
        
        return (
          <div 
            key={idx} 
            onClick={() => onToggle && onToggle({ label: item.label, dbKey: item.dbKey, unit: item.unit })}
            className={`flex justify-between border-b border-slate-700/50 pb-1 transition-colors ${onToggle ? 'cursor-pointer hover:bg-slate-800 rounded px-1' : ''} ${isSelected ? 'bg-blue-500/20 px-1 rounded border-b-transparent' : ''}`}
          >
            <span className={`truncate mr-2 ${isStale ? 'text-slate-600' : 'text-slate-400'}`}>{item.label}:</span>
            <span className={`font-mono whitespace-nowrap flex items-center gap-2 ${valColor}`}>
              {displayVal}
              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const MeterCard = ({ name, hasData, isConnected, machineData, fmt, selectedMetrics = [], onToggleMetric }) => {
  const d = machineData || {};
  const uiData = transformMqttToUI(d);
  
  // Only show ONLINE if hasData is true AND the data is not stale (uiData.status)
  const status = hasData 
    ? (uiData.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE') 
    : isConnected ? 'CONNECTING' : 'OFFLINE';
  
  const meta = getCategoryMeta(uiData.category);
  const CategoryIcon = meta.icon;

  const selectedKeys = selectedMetrics.map(m => m.dbKey);

  // History state for sparkline chart (only for non-electric meters)
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (hasData && !uiData.isElectric && uiData.primary.length > 0) {
      const mainVal = parseFloat(uiData.primary[0].value);
      if (!isNaN(mainVal)) {
        setHistory(prev => {
          const timeKey = d.Time || Date.now();
          const last = prev[prev.length - 1];
          if (last && last.time === timeKey) return prev; // Avoid exact time duplicates
          
          const newHist = [...prev, { time: timeKey, value: mainVal }];
          if (newHist.length > 30) return newHist.slice(newHist.length - 30);
          return newHist;
        });
      }
    }
  }, [machineData, hasData, uiData.isElectric]);

  return (
    <div
      className={`
        bg-slate-800 border-2 rounded-xl overflow-hidden
        transition-all duration-300 shadow-lg relative
        min-h-[450px] flex flex-col
        ${selectedKeys.length > 0 ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-slate-700 hover:border-slate-600'}
        ${!hasData && isConnected ? 'opacity-70' : ''}
      `}
    >
      {!hasData && isConnected && (
        <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-2"></div>
            <span className="text-sm text-slate-400">Waiting for data...</span>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="bg-slate-900/50 p-3 border-b border-slate-700 flex justify-between items-center">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-lg text-white truncate flex items-center gap-2" title={name}>
            <CategoryIcon size={18} className={`shrink-0 ${meta.accent}`} />
            {name}
          </h3>
          <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
            <Clock size={12} />
            {uiData.last_update || d.Time || 'Waiting...'}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5 ml-2">
          <StatusBadge status={status} />
          {hasData && uiData.category !== "Unknown" && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 ${meta.accent} font-medium uppercase tracking-wide truncate max-w-[130px] text-right`} title={uiData.category}>
              {uiData.category}
            </span>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="p-4 space-y-4 flex-1 flex flex-col">
        {/* Primary metrics (side-by-side boxes) */}
        {uiData.primary.length > 0 ? (
          <div className={`grid gap-3 ${uiData.primary.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {uiData.primary.map((item, idx) => (
              <PrimaryBox 
                key={idx} 
                label={item.label} 
                value={item.value} 
                unit={item.unit} 
                color={idx === 0 ? 'text-cyan-400' : 'text-amber-400'}
                dbKey={item.dbKey}
                isSelected={selectedKeys.includes(item.dbKey)}
                onToggle={onToggleMetric}
                isStale={status === 'OFFLINE'}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <PrimaryBox label="--" value={undefined} color="text-slate-500" />
            <PrimaryBox label="--" value={undefined} color="text-slate-500" />
          </div>
        )}

        {/* Detail section & Chart */}
        <div className="flex-1 flex flex-col">
          {uiData.isElectric ? (
            <ElectricDetails 
              details={uiData.electric_details} 
              selectedKeys={selectedKeys} 
              onToggle={onToggleMetric} 
              isStale={status === 'OFFLINE'}
            />
          ) : (
            <>
              <GenericDetails 
                secondary={uiData.secondary} 
                selectedKeys={selectedKeys} 
                onToggle={onToggleMetric} 
                isStale={status === 'OFFLINE'}
              />
              
              {/* Realtime Chart */}
              {history.length > 0 && (() => {
                const vals = history.map(h => h.value);
                const minVal = Math.min(...vals);
                const maxVal = Math.max(...vals);
                // Ensure there is always headroom so the chart doesn't touch the absolute top
                const upperPad = maxVal === minVal 
                  ? (maxVal === 0 ? 10 : Math.abs(maxVal * 0.1)) 
                  : (maxVal - minVal) * 0.2;
                const upperDomain = maxVal + upperPad;

                return (
                  <div className={`mt-auto pt-4 h-[216px] w-full transition-all duration-500 ${status === 'OFFLINE' ? 'grayscale opacity-30 brightness-50' : ''}`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`colorGradient-${name.replace(/\s+/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', color: '#f8fafc', fontSize: '12px', padding: '4px 8px' }}
                          itemStyle={{ color: '#22d3ee', fontWeight: 600 }}
                          labelStyle={{ display: 'none' }}
                          formatter={(value) => [`${value}`, uiData.primary[0]?.label || 'Value']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="value" 
                          stroke="#22d3ee" 
                          strokeWidth={2} 
                          fillOpacity={1}
                          fill={`url(#colorGradient-${name.replace(/\s+/g, '')})`}
                          isAnimationActive={false} 
                        />
                        <YAxis hide domain={[minVal, upperDomain]} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeterCard;
