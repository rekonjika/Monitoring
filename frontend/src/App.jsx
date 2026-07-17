// frontend/src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { AcknowledgeAlarm, ExportReport, GetConfig, SaveConfig, SelectSoundFile, GetAlarmSound, GetInitialState } from '../wailsjs/go/main/App';

export default function App() {
  const [config, setConfig] = useState(null);
  const [stationsState, setStationsState] = useState({});
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [eventLogs, setEventLogs] = useState([]);
  const [showSettings, setShowSettings] = useState(false); // Состояние показа модального окна настроек
  
  // Переменные формы настроек
  const [formBroker, setFormBroker] = useState('');
  const [formPort, setFormPort] = useState(1883);
  const [formStationsCount, setFormStationsCount] = useState(3);
  const [formNodeNames, setFormNodeNames] = useState('');
  const [formSoundPath, setFormSoundPath] = useState('');
  const [formTgEnabled, setFormTgEnabled] = useState(false);
  const [formTgToken, setFormTgToken] = useState('');
  const [formTgChatId, setFormTgChatId] = useState('');

  const audioRef = useRef(null);

  useEffect(() => {
    loadApplicationConfig(true);
  }, []);

  const loadApplicationConfig = async (initAudio = false) => {
    const cfg = await GetConfig();
    if (cfg) {
      setConfig(cfg);
      setFormBroker(cfg.mqtt_broker);
      setFormPort(cfg.mqtt_port);
      setFormStationsCount(cfg.stations_count || 3);
      setFormSoundPath(cfg.sound_file_path || "По умолчанию (встроенный звук)");
      const nodeNamesArray = Object.values(cfg.node_names);
      setFormNodeNames(nodeNamesArray.join(', '));
      setFormTgEnabled(cfg.telegram_enabled);
      setFormTgToken(cfg.telegram_bot_token);
      setFormTgChatId(cfg.telegram_chat_id);

      if (initAudio) {
        await initAlarmAudio();
      }

      const initialState = await GetInitialState();
      setStationsState(initialState);
    }
  };

  const initAlarmAudio = async () => {
    try {
      const base64Audio = await GetAlarmSound();
      if (base64Audio) {
        audioRef.current = new Audio(base64Audio);
      } else {
        audioRef.current = new Audio('/sounds/alarm.mp3');
      }
      audioRef.current.loop = true;
    } catch (e) {
      console.warn("⚠️ Ошибка инициализации аудио:", e);
      audioRef.current = null;
    }
  };

  useEffect(() => {
    EventsOn("node-update", (data) => {
      const key = `Станок${data.station}_${data.node_name}`;
      
      setStationsState((prev) => ({
        ...prev,
        [key]: data
      }));

      const timestamp = new Date().toLocaleTimeString();
      let logMsg = `[${timestamp}] `;
      if (!data.connected) logMsg += `📡 СТАНЦИЯ ${data.station} (${data.node_name}): ПОТЕРЯ СВЯЗИ`;
      else if (data.state === 1) logMsg += `🔴 СТАНЦИЯ ${data.station} (${data.node_name}): ТРЕВОГА!`;
      else logMsg += `🟢 СТАНЦИЯ ${data.station} (${data.node_name}): НОРМА`;
      
      setEventLogs(prev => [logMsg, ...prev].slice(0, 200));

      if (data.state === 1 && data.connected) {
        setActiveAlarms((prev) => {
          const exists = prev.some(al => al.station === data.station && al.node_name === data.node_name);
          if (!exists) {
            if (audioRef.current) audioRef.current.play().catch(() => {});
            return [...prev, data];
          }
          return prev;
        });
      }
    });

    EventsOn("alarm-acknowledged", (data) => {
      const timestamp = new Date().toLocaleTimeString();
      setEventLogs(prev => [`[${timestamp}] 🎯 ТРЕВОГА ПРИНЯТА ОПЕРАТОРОМ: Станок ${data.station} (${data.node_name})`, ...prev]);

      setActiveAlarms((prev) => {
        const newList = prev.filter(al => !(al.station === data.station && al.node_name === data.node_name));
        if (newList.length === 0 && audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        return newList;
      });
    });
  }, []);

  const handleAcceptAlarm = (alarm) => {
    AcknowledgeAlarm(alarm.station, alarm.node_name);
  };

  const handleExportExcel = async () => {
    const result = await ExportReport();
    alert(result);
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const nodesArray = formNodeNames.split(',').map(n => n.trim()).filter(n => n !== '');
    if (nodesArray.length === 0) {
      alert("Ошибка: введите хотя бы одно имя узла!");
      return;
    }

    const result = await SaveConfig(
      formBroker,
      parseInt(formPort),
      parseInt(formStationsCount),
      nodesArray,
      formTgEnabled,
      formTgToken,
      formTgChatId
    );
    
    alert(result);
    loadApplicationConfig(true); 
    setShowSettings(false); // Закрываем модальное окно настроек после успешного сохранения!
  };

  const handleSelectSound = async () => {
    const selectedPath = await SelectSoundFile();
    if (selectedPath) {
      setFormSoundPath(selectedPath);
      await initAlarmAudio();
      alert("🎵 Новый файл сирены успешно загружен!");
    }
  };

  const renderStationsGrid = () => {
    if (!config) return null;
    
    const stationsList = [];
    const nodeNames = Object.values(config.node_names);
    const totalStations = config.stations_count || 3; 

    for (let s = 1; s <= totalStations; s++) {
      stationsList.push(
        <div key={s} className="station-block">
          <h3 className="station-title">СТАНОК {s}</h3>
          <div className="nodes-container">
            {nodeNames.map((nodeName, idx) => {
              const key = `Станок${s}_${nodeName}`;
              const stateData = stationsState[key] || { state: -1, connected: true, rssi: 0, alarm_count: 0, disconnect_count: 0 };

              let statusText = "⚪ НЕТ ДАННЫХ";
              let badgeClass = "badge-nodata";
              let cardClass = "node-card";

              if (stateData.state !== -1) {
                if (!stateData.connected) {
                  statusText = "🟠 НЕТ СВЯЗИ";
                  badgeClass = "badge-offline";
                  cardClass = "node-card card-offline";
                } else if (stateData.state === 1) {
                  statusText = "🔴 ТРЕВОГА!";
                  badgeClass = "badge-alarm animate-pulse-red";
                  cardClass = "node-card card-alarm";
                } else {
                  statusText = "🟢 НОРМА";
                  badgeClass = "badge-normal";
                }
              }

              return (
                <div key={idx} className={cardClass}>
                  <div className="node-header">
                    <span className="node-name">{nodeName}</span>
                    <span className={`badge ${badgeClass}`}>{statusText}</span>
                  </div>
                  
                  <div className="node-stats">
                    <span>🚨 Тревог: <strong style={{color: '#fca5a5'}}>{stateData.alarm_count || 0}</strong></span>
                    <span style={{marginLeft: '15px'}}>📡 Отключений: <strong style={{color: '#fdba74'}}>{stateData.disconnect_count || 0}</strong></span>
                  </div>

                  <div className="node-footer">
                    <span className="rssi-text">
                      {stateData.state !== -1 && stateData.connected ? `📶 Сигнал: ${stateData.rssi} dBm` : "📡 Нет сигнала"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return stationsList;
  };

  return (
    <div className="app-container">
      <style>{`
        body { margin: 0; padding: 0; background-color: #0b0f19; overflow: hidden; }
        
        .app-container {
          padding: 20px;
          font-family: 'Segoe UI', Roboto, sans-serif;
          background-color: #0b0f19;
          color: #f3f4f6;
          height: 100vh;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }

        /* Шапка */
        .app-header {
          border-bottom: 1px solid #1f2937;
          padding-bottom: 12px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 50px;
          box-sizing: border-box;
        }

        .header-title { margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 0.5px; }
        .header-buttons { display: flex; align-items: center; gap: 10px; }

        /* Кнопка шестеренки */
        .btn-gear {
          background-color: #1f2937;
          color: #9ca3af;
          border: 1px solid #374151;
          font-size: 18px;
          padding: 6px 12px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-gear:hover {
          color: #10b981;
          border-color: #10b981;
          background-color: #111827;
        }

        .btn-export {
          background-image: linear-gradient(135deg, #10b981, #059669);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          font-size: 13px;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
          transition: all 0.2s ease;
        }
        .btn-export:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3); }

        .tab-content {
          display: flex;
          flex-direction: column;
          flex: 1;
          gap: 16px;
          overflow: hidden;
        }

        .stations-scroll-container {
          flex: 6; 
          display: flex; 
          overflow-y: auto;
          padding-right: 6px;
        }

        .stations-scroll-container::-webkit-scrollbar { width: 6px; }
        .stations-scroll-container::-webkit-scrollbar-track { background: #0b0f19; }
        .stations-scroll-container::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 3px; }

        .stations-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); 
          gap: 20px;
          width: 100%;
          height: 100%; 
          box-sizing: border-box;
        }

        .station-block {
          background-color: #111827;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 18px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
          height: 100%; 
          box-sizing: border-box;
        }

        .station-title {
          margin: 0 0 14px 0;
          text-align: center;
          font-size: 20px; 
          font-weight: bold;
          color: #e5e7eb;
          letter-spacing: 1px;
          border-bottom: 1px solid #1f2937;
          padding-bottom: 8px;
        }

        .nodes-container { 
          display: flex; 
          flex-direction: column; 
          gap: 12px; 
          flex: 1; 
        }

        .node-card {
          background-color: #1f2937;
          padding: 16px 20px;
          border-radius: 12px;
          border: 1px solid #374151;
          transition: all 0.2s ease;
          flex: 1; 
          display: flex;
          flex-direction: column;
          justify-content: center; 
        }
        .node-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.3);
          border-color: #4b5563;
        }

        .card-alarm {
          border-color: #ef4444 !important;
          background: linear-gradient(135deg, #1f2937, #2d1616) !important;
        }
        
        .card-offline {
          border-color: #f97316 !important;
          background: linear-gradient(135deg, #1f2937, #2d2016) !important;
        }

        .node-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .node-name { font-weight: bold; font-size: 18px; color: #f9fafb; }

        .badge {
          padding: 6px 14px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: bold;
          letter-spacing: 0.5px;
        }
        .badge-nodata { background-color: #374151; color: #cbd5e1; }
        .badge-normal { background-color: #065f46; color: #34d399; box-shadow: 0 0 10px rgba(52, 211, 153, 0.25); }
        .badge-alarm { background-color: #7f1d1d; color: #fca5a5; box-shadow: 0 0 10px rgba(239, 68, 68, 0.35); }
        .badge-offline { background-color: #7c2d12; color: #fdba74; box-shadow: 0 0 10px rgba(249, 115, 22, 0.35); }

        .node-stats {
          margin-top: 8px;
          font-size: 13px;
          color: #9ca3af;
          display: flex;
          justify-content: flex-start;
          font-weight: 500;
        }

        .node-footer {
          margin-top: 6px;
          display: flex;
          justify-content: flex-start;
        }
        .rssi-text { font-size: 12px; color: #6b7280; font-weight: 500; }

        @keyframes pulse-red {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        .animate-pulse-red {
          animation: pulse-red 1.5s infinite;
        }

        /* Журнал событий */
        .log-frame {
          flex: 3; 
          background-color: #111827;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
          min-height: 140px; 
          box-sizing: border-box;
        }

        .log-container {
          flex: 1;
          overflow-y: auto;
          font-size: 12px;
          display: flex;
          flex-direction: column-reverse;
          padding-right: 8px;
        }

        .log-container::-webkit-scrollbar { width: 6px; }
        .log-container::-webkit-scrollbar-track { background: #111827; }
        .log-container::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
        .log-container::-webkit-scrollbar-thumb:hover { background: #4b5563; }

        /* Вкладка Настройки в модальном окне */
        .settings-form {
          background-color: #111827;
          border: 1px solid #10b981; /* Зеленая рамка для настроек */
          border-radius: 16px;
          padding: 30px;
          max-width: 500px;
          width: 100%;
          box-shadow: 0 0 30px rgba(16, 185, 129, 0.2);
          position: relative; /* Для позиционирования кнопки закрытия */
        }

        .btn-close-settings {
          position: absolute;
          top: 16px;
          right: 16px;
          background: transparent;
          border: none;
          color: #9ca3af;
          font-size: 20px;
          cursor: pointer;
          transition: color 0.2s;
        }
        .btn-close-settings:hover { color: #ef4444; }

        .form-group { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
        .form-group label { font-size: 13px; color: #9ca3af; font-weight: 600; }
        
        .form-input {
          background-color: #1f2937;
          color: white;
          border: 1px solid #374151;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 13px;
          transition: all 0.2s ease;
        }
        .form-input:focus {
          border-color: #10b981;
          outline: none;
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
        }

        .sound-input-group {
          display: flex;
          gap: 10px;
        }

        .btn-select-file {
          background-color: #374151;
          color: white;
          border: 1px solid #4b5563;
          border-radius: 8px;
          padding: 8px 16px;
          cursor: pointer;
          font-weight: 600;
          font-size: 13px;
          transition: all 0.2s ease;
        }
        .btn-select-file:hover { background-color: #4b5563; }

        .btn-save {
          width: 100%;
          background-image: linear-gradient(135deg, #10b981, #059669);
          color: white;
          border: none;
          padding: 10px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 13px;
          margin-top: 10px;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
          transition: all 0.2s ease;
        }
        .btn-save:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3); }

        /* Модальные окна */
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(3, 7, 18, 0.85); display: flex; justify-content: center; align-items: center; z-index: 1000; backdrop-filter: blur(4px); }
        .modal-box { background-color: #111827; border: 2px solid #ef4444; border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 0 30px rgba(239, 68, 68, 0.2); }
        .modal-title { color: #ef4444; margin: 0 0 20px 0; font-size: 26px; letter-spacing: 1px; }
        .alarm-list { display: flex; flex-direction: column; gap: 16px; }
        .alarm-item { border-bottom: 1px solid #1f2937; padding-bottom: 16px; }
        .btn-accept { background-image: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 13px; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2); transition: all 0.2s ease; }
        .btn-accept:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(239, 68, 68, 0.3); }
      `}</style>

      {/* Шапка */}
      <header className="app-header">
        <h2 className="header-title">МОНИТОРИНГ</h2>
        <div className="header-buttons">
          <button onClick={handleExportExcel} className="btn-export">
            📊 Сгенерировать отчет Excel
          </button>
          <button onClick={() => setShowSettings(true)} className="btn-gear" title="Настройки системы">
            ⚙️
          </button>
        </div>
      </header>

      {/* ОСНОВНОЙ КОНТЕНТ: МОНИТОРИНГ */}
      <div className="tab-content">
        <div className="stations-scroll-container">
          <div className="stations-grid">
            {renderStationsGrid()}
          </div>
        </div>

        <div className="log-frame">
          <h4 style={{ margin: '0 0 8px 0', borderBottom: '1px solid #1f2937', paddingBottom: '6px', color: '#9ca3af', fontSize: '13px' }}>📋 Журнал событий</h4>
          <div className="log-container">
            {eventLogs.length === 0 ? (
              <p style={{ color: '#4b5563', margin: 0, fontStyle: 'italic' }}>Ожидание событий от оборудования...</p>
            ) : (
              eventLogs.map((log, idx) => (
                <div key={idx} style={{ 
                  color: log.includes('ТРЕВОГА') ? '#fca5a5' : log.includes('ПОТЕРЯ') ? '#fdba74' : log.includes('ПРИНЯТА') ? '#34d399' : '#34d399',
                  fontFamily: 'monospace',
                  marginBottom: '3px'
                }}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* МОДАЛЬНОЕ ОКНО НАСТРОЕК (Открывается по шестеренке) */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="settings-form">
            {/* Кнопка Крестик для закрытия */}
            <button type="button" onClick={() => setShowSettings(false)} className="btn-close-settings">✕</button>
            
            <form onSubmit={handleSaveSettings}>
              <h3 style={{ margin: '0 0 20px 0', color: '#10b981', letterSpacing: '0.5px', fontSize: '16px' }}>⚙️ Системные настройки</h3>
              
              <div className="form-group">
                <label>MQTT Брокер IP:</label>
                <input type="text" value={formBroker} onChange={(e) => setFormBroker(e.target.value)} className="form-input" required />
              </div>

              <div className="form-group">
                <label>MQTT Порт:</label>
                <input type="number" value={formPort} onChange={(e) => setFormPort(e.target.value)} className="form-input" required />
              </div>

              <div className="form-group">
                <label>Количество станков (1-10):</label>
                <input type="number" min="1" max="10" value={formStationsCount} onChange={(e) => setFormStationsCount(parseInt(e.target.value))} className="form-input" required />
              </div>

              <div className="form-group">
                <label>Названия узлов (через запятую):</label>
                <input type="text" value={formNodeNames} onChange={(e) => setFormNodeNames(e.target.value)} className="form-input" required />
                <small style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>Например: Станок, Ультразвук, Чилер</small>
              </div>

              <div className="form-group">
                <label>Звуковой файл сирены (.mp3, .wav):</label>
                <div className="sound-input-group">
                  <input type="text" value={formSoundPath} className="form-input" style={{ flex: 1 }} readOnly />
                  <button type="button" onClick={handleSelectSound} className="btn-select-file">📁 Выбрать</button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '15px', marginBottom: '10px' }}>
                <input type="checkbox" checked={formTgEnabled} onChange={(e) => setFormTgEnabled(e.target.checked)} style={{ width: '16px', height: '18px', accentColor: '#10b981' }} />
                <label style={{ margin: 0, fontWeight: 'bold', fontSize: '13px', color: '#d1d5db', cursor: 'pointer' }}>Включить уведомления в Telegram</label>
              </div>

              {formTgEnabled && (
                <div style={{ paddingLeft: '16px', borderLeft: '2px solid #374151', marginTop: '10px', marginBottom: '10px' }}>
                  <div className="form-group">
                    <label>Telegram Bot Token:</label>
                    <input type="text" value={formTgToken} onChange={(e) => setFormTgToken(e.target.value)} className="form-input" required={formTgEnabled} />
                  </div>
                  <div className="form-group">
                    <label>Telegram Chat ID:</label>
                    <input type="text" value={formTgChatId} onChange={(e) => setFormTgChatId(e.target.value)} className="form-input" required={formTgEnabled} />
                  </div>
                </div>
              )}

              <button type="submit" className="btn-save">💾 Сохранить и применить настройки</button>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛЬНОЕ ОКНО ТРЕВОГИ */}
      {activeAlarms.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h1 className="modal-title animate-pulse-red">🔴 ТРЕВОГА!</h1>
            <div className="alarm-list">
              {activeAlarms.map((alarm, idx) => (
                <div key={idx} className="alarm-item">
                  <p style={{ fontSize: '18px', margin: '0 0 16px 0', color: '#f3f4f6' }}>
                    Станок <strong style={{ color: '#ef4444' }}>{alarm.station}</strong> — <strong style={{ color: '#ef4444' }}>{alarm.node_name}</strong>
                  </p>
                  <button onClick={() => handleAcceptAlarm(alarm)} className="btn-accept">
                    ПРИНЯТЬ ТРЕВОГУ
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  tabContent: { display: 'flex', flexDirection: 'column', flex: 1, gap: '20px' },
};