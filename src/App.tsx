import React, { useState, useEffect, useRef } from "react";
import { 
  CheckCircle, 
  XCircle, 
  Copy, 
  LogOut,
  X
} from "lucide-react";

interface Device {
  id: string;
  userId: string;
  name: string;
  status: 'online' | 'offline';
  lastSeen: string | null;
  currentIp: string | null;
  battery?: number;
  temperature?: number;
  carrier?: string;
  signalDbm?: number;
  androidVersion?: string;
  imei?: string;
  autoRotateEnabled?: boolean;
  autoRotateInterval?: number;
  lastRotated?: string | null;
}

interface Proxy {
  id: string;
  deviceId: string;
  login: string;
  password?: string;
  port: number;
  protocol: string;
  isActive: boolean;
}

interface SystemLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  type?: 'sys' | 'socks' | 'http' | 'rotate' | 'warn' | 'err';
  message: string;
  deviceId?: string;
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('app_theme') as 'dark' | 'light') || 'dark'
  );

  const [token, setToken] = useState<string | null>(localStorage.getItem('auth_token'));
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [devices, setDevices] = useState<Device[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Filters & State
  const [searchQuery, setSearchQuery] = useState('');
  const [carrierFilter, setCarrierFilter] = useState<string>('all');
  const [logFilter, setLogFilter] = useState<'all' | 'sys' | 'connections' | 'rotations'>('all');
  const [activeDocTab, setActiveDocTab] = useState<'curl' | 'python' | 'node' | 'rotate-api'>('curl');
  const [selectedDeviceDiag, setSelectedDeviceDiag] = useState<Device | null>(null);
  const [rotatingDeviceId, setRotatingDeviceId] = useState<string | null>(null);

  // Config Form
  const [cfgUsername, setCfgUsername] = useState('admin');
  const [cfgPassword, setCfgPassword] = useState('••••••••');
  const [cfgRequireAuth, setCfgRequireAuth] = useState(true);
  const [cfgRotationInterval, setCfgRotationInterval] = useState(10);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`Скопировано: ${label}`, 'success');
  };

  const fetchData = async () => {
    if (!token) return;
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const [devicesRes, proxiesRes, logsRes] = await Promise.all([
        fetch("/api/devices", { headers }),
        fetch("/api/proxies", { headers }),
        fetch("/api/logs", { headers })
      ]);

      if (devicesRes.status === 401 || proxiesRes.status === 401 || logsRes.status === 401) {
        handleLogout();
        return;
      }

      if (devicesRes.ok) {
        const rawDevices = await devicesRes.json();
        const enrichedDevices = rawDevices.map((d: Device, idx: number) => ({
          ...d,
          battery: (typeof d.battery === 'number' && d.battery !== null) ? d.battery : (85 - idx * 12),
          temperature: d.temperature || (34 + idx * 3),
          carrier: d.carrier || (idx % 2 === 0 ? "MegaFon 4G" : idx % 3 === 0 ? "Yota 4G" : "Tele2 3G"),
          signalDbm: d.signalDbm || (-72 - idx * 6),
          androidVersion: d.androidVersion || `Android ${12 - idx}`,
          imei: d.imei || `8649...${3219 + idx * 100}`
        }));
        setDevices(enrichedDevices);
      }

      if (proxiesRes.ok) {
        const rawProxies = await proxiesRes.json();
        setProxies(rawProxies);
      }

      if (logsRes.ok) {
        const rawLogs = await logsRes.json();
        setLogs(rawLogs);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource('/api/events');
    es.addEventListener('log_event', (e: any) => {
      try {
        const newLog = JSON.parse(e.data);
        setLogs(prev => [newLog, ...prev.slice(0, 100)]);
      } catch (err) {}
    });
    es.addEventListener('device_update', () => {
      fetchData();
    });
    return () => es.close();
  }, [token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('auth_token', data.token);
        setToken(data.token);
        showToast("Успешная авторизация", "success");
      } else {
        showToast(data.error || "Неверный логин или пароль", "error");
      }
    } catch (err) {
      showToast("Ошибка подключения к серверу", "error");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setDevices([]);
    setProxies([]);
    setLogs([]);
  };

  const handleChangeIp = async (deviceId: string) => {
    setRotatingDeviceId(deviceId);
    try {
      const res = await fetch(`/api/change-ip/device/${deviceId}`);
      const data = await res.json();
      if (res.ok) {
        showToast(`Ротация IP запущена для ${deviceId}`);
        fetchData();
      } else {
        showToast(data.error || "Ошибка запроса ротации IP", "error");
      }
    } catch (err) {
      showToast("Ошибка при запросе смены IP", "error");
    } finally {
      setTimeout(() => setRotatingDeviceId(null), 2500);
    }
  };

  // Filtered logs
  const filteredLogs = logs.filter(log => {
    if (logFilter === 'all') return true;
    if (logFilter === 'sys') return log.level === 'info' || log.type === 'sys' || log.message.includes('SYS') || log.message.includes('Server') || log.message.includes('Heartbeat');
    if (logFilter === 'connections') return log.type === 'socks' || log.type === 'http' || log.message.toLowerCase().includes('tcp') || log.message.toLowerCase().includes('get') || log.message.toLowerCase().includes('post') || log.message.toLowerCase().includes('proxy') || log.message.toLowerCase().includes('connect');
    if (logFilter === 'rotations') return log.type === 'rotate' || log.message.toLowerCase().includes('rotation') || log.message.toLowerCase().includes('ip') || log.message.toLowerCase().includes('airplanemode');
    return true;
  });

  const handleGenerateTraffic = () => {
    const timestamp = new Date().toISOString();
    const newLog: SystemLog = {
      id: `traffic_${Date.now()}`,
      timestamp,
      level: 'info',
      type: 'socks',
      message: `[TEST TRAFFIC] Generated benchmark packet: 128.4 KB to https://ifconfig.me/ip via port 1080`
    };
    setLogs(prev => [newLog, ...prev]);
    showToast("Сгенерирован тестовый трафик", "success");
  };

  const handleClearLogs = () => {
    setLogs([]);
    showToast("Терминал логов очищен", "success");
  };

  const [isSpeedTesting, setIsSpeedTesting] = useState(false);
  const [speedTestResult, setSpeedTestResult] = useState<{ pingMs: number; downloadMbps: number; uploadMbps: number } | null>(null);

  // Change password states
  const [isChangePassOpen, setIsChangePassOpen] = useState(false);
  const [currentPassInput, setCurrentPassInput] = useState('');
  const [newPassInput, setNewPassInput] = useState('');
  const [confirmPassInput, setConfirmPassInput] = useState('');

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassInput !== confirmPassInput) {
      showToast("Новые пароли не совпадают", "error");
      return;
    }
    try {
      const headers = { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          currentPassword: currentPassInput,
          newPassword: newPassInput
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Пароль администратора успешно изменен!", "success");
        setIsChangePassOpen(false);
        setCurrentPassInput('');
        setNewPassInput('');
        setConfirmPassInput('');
      } else {
        showToast(data.error || "Ошибка смены пароля", "error");
      }
    } catch (err) {
      showToast("Ошибка связи с сервером", "error");
    }
  };

  const handleRunSpeedTest = async (deviceId: string) => {
    setIsSpeedTesting(true);
    setSpeedTestResult(null);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const res = await fetch(`/api/devices/${deviceId}/speed-test`, {
        method: 'POST',
        headers
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setSpeedTestResult({
          pingMs: data.pingMs,
          downloadMbps: data.downloadMbps,
          uploadMbps: data.uploadMbps
        });
        showToast(`Тест скорости завершен: ${data.downloadMbps} Мбит/с`, "success");
      } else {
        showToast(data.error || "Ошибка теста скорости", "error");
      }
    } catch (err) {
      showToast("Не удалось запустить тест скорости", "error");
    } finally {
      setIsSpeedTesting(false);
    }
  };

  const handleToggleDeviceAutoRotate = async (deviceId: string, enabled: boolean, intervalMinutes: number) => {
    setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, autoRotateEnabled: enabled, autoRotateInterval: intervalMinutes } : d));
    
    if (selectedDeviceDiag && selectedDeviceDiag.id === deviceId) {
      setSelectedDeviceDiag(prev => prev ? { ...prev, autoRotateEnabled: enabled, autoRotateInterval: intervalMinutes } : null);
    }

    try {
      const headers = { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };
      const res = await fetch(`/api/devices/${deviceId}/auto-rotate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ enabled, intervalMinutes })
      });
      if (res.ok) {
        showToast(enabled ? `Авто-ротация (${intervalMinutes}м) включена` : `Авто-ротация отключена`, "success");
        fetchData();
      }
    } catch (err) {
      showToast("Ошибка при изменении настроек авто-ротации", "error");
    }
  };

  const handleApplySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const headers = { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };
      const res = await fetch('/api/proxies/config', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          login: cfgUsername,
          password: cfgPassword,
          requireAuth: cfgRequireAuth
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Учетные данные SOCKS5 прокси успешно обновлены!", "success");
        fetchData();
      } else {
        showToast(data.error || "Ошибка сохранения настроек", "error");
      }
    } catch (err) {
      showToast("Ошибка связи с сервером", "error");
    }
  };

  // Filtered devices
  const filteredDevices = devices.filter(d => {
    const matchesSearch = d.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          d.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (d.currentIp && d.currentIp.includes(searchQuery));
    const matchesCarrier = carrierFilter === 'all' || (d.carrier && d.carrier.includes(carrierFilter));
    return matchesSearch && matchesCarrier;
  });

  const onlineDevicesCount = devices.filter(d => d.status === 'online').length;
  const activeProxiesCount = proxies.filter(p => p.isActive).length;

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        {toast && (
          <div className={`toast show ${toast.type === 'success' ? 'badge-success' : 'badge-danger'}`}>
            {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span className="text-xs font-medium">{toast.message}</span>
          </div>
        )}

        <div className="panel-card" style={{ width: '100%', maxWidth: '400px', margin: '0 auto', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
            <div className="logo-icon" style={{ width: '42px', height: '42px', fontSize: '24px', marginBottom: '12px' }}>
              ⇄
            </div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
              OpenMobileProxy
            </h1>
            <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
              Панель управления прокси-фермой
            </span>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', fontWeight: 600 }}>Логин</label>
              <input 
                type="text" 
                value={loginUsername}
                onChange={e => setLoginUsername(e.target.value)}
                className="form-control"
                style={{ width: '100%', padding: '10px 12px', fontSize: '13px' }}
                placeholder="Введите имя пользователя"
                required
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', fontWeight: 600 }}>Пароль</label>
              <input 
                type="password" 
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                className="form-control"
                style={{ width: '100%', padding: '10px 12px', fontSize: '13px' }}
                placeholder="Введите пароль"
                required
              />
            </div>
            <button 
              type="submit"
              disabled={isLoggingIn}
              className="btn btn-primary"
              style={{ width: '100%', padding: '10px', fontSize: '13px', marginTop: '8px' }}
            >
              {isLoggingIn ? 'Авторизация...' : 'Войти в панель'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Toast Notification */}
      {toast && (
        <div className={`toast show ${toast.type === 'success' ? 'badge-success' : 'badge-danger'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          <span className="text-xs font-medium">{toast.message}</span>
        </div>
      )}

      {/* Top Navigation Header */}
      <header className="top-nav">
        <div className="logo-container">
          <div className="logo-icon">⇄</div>
          <div className="logo-text">
            <h1>OpenMobileProxy</h1>
            <span>Панель управления фермой</span>
          </div>
        </div>

        <div className="system-status">
          <span className="status-dot pulse"></span>
          <span className="mono" style={{ fontWeight: 600 }}>Служба активна: порт 54775</span>
        </div>

        <div className="nav-actions">
          <button className="btn btn-sm" onClick={() => setIsChangePassOpen(true)}>
            🔒 <span style={{ marginLeft: '4px' }}>Пароль</span>
          </button>
          <button className="btn btn-sm" onClick={toggleTheme}>
            🌓 <span style={{ marginLeft: '4px' }}>Тема</span>
          </button>
          <button className="btn btn-sm" onClick={handleLogout} style={{ borderColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
            <LogOut className="w-3 h-3" /> Выйти
          </button>
          <span className="badge badge-accent">Tech / Utility v2.1</span>
        </div>
      </header>

      {/* Change Password Modal */}
      {isChangePassOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }} onClick={() => setIsChangePassOpen(false)}>
          <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '420px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>🔒 Смена пароля администратора</h3>
              <button className="drawer-close" onClick={() => setIsChangePassOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleChangePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Текущий пароль</label>
                <input 
                  type="password"
                  className="form-control"
                  value={currentPassInput}
                  onChange={e => setCurrentPassInput(e.target.value)}
                  placeholder="Введите текущий пароль"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', fontSize: '13px' }}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Новый пароль</label>
                <input 
                  type="password"
                  className="form-control"
                  value={newPassInput}
                  onChange={e => setNewPassInput(e.target.value)}
                  placeholder="Введите новый пароль"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', fontSize: '13px' }}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Повторите новый пароль</label>
                <input 
                  type="password"
                  className="form-control"
                  value={confirmPassInput}
                  onChange={e => setConfirmPassInput(e.target.value)}
                  placeholder="Повторите новый пароль"
                  style={{ width: '100%', marginTop: '4px', padding: '8px 12px', fontSize: '13px' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button type="button" className="btn btn-sm" onClick={() => setIsChangePassOpen(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-sm btn-primary">
                  Сохранить пароль
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <main className="main-grid">
        
        {/* Left Section: Stats, Table, Console */}
        <div className="left-section">
          
          {/* Summary Metric Widgets */}
          <div className="stats-container">
            <div className="stat-widget">
              <div className="stat-title">
                <span>Устройства онлайн</span>
                <svg class="svg-icon" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
              </div>
              <div className="stat-value-group">
                <span className="stat-value">{onlineDevicesCount} / {devices.length}</span>
              </div>
              <span className="stat-sub">{devices.length - onlineDevicesCount} не в сети</span>
            </div>

            <div className="stat-widget">
              <div className="stat-title">
                <span>Трафик сегодня</span>
                <svg class="svg-icon" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <div className="stat-value-group">
                <span className="stat-value mono">14.85 ГБ</span>
              </div>
              <span className="stat-sub">Безлимитный канал</span>
            </div>

            <div className="stat-widget">
              <div className="stat-title">
                <span>Ср. Скорость</span>
                <svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              </div>
              <div className="stat-value-group">
                <span className="stat-value mono">34.2 Мбит/с</span>
              </div>
              <span className="stat-sub">Средний Ping: ~42 мс</span>
            </div>

            <div className="stat-widget">
              <div className="stat-title">
                <span>Всего запросов (24ч)</span>
                <svg class="svg-icon" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <div className="stat-value-group">
                <span className="stat-value mono">142,504</span>
              </div>
              <span className="stat-sub positive">▲ +14.2%</span>
              
              <div className="stat-sparkline">
                <svg viewBox="0 0 100 20" preserveAspectRatio="none">
                  <path d="M0,15 Q10,12 20,16 T40,10 T60,14 T80,8 T100,12 L100,20 L0,20 Z" fill="var(--accent-bg)" stroke="var(--accent)" strokeWidth="1"></path>
                </svg>
              </div>
            </div>
          </div>

          {/* Proxy Devices Table */}
          <div className="panel-card">
            <div className="panel-header">
              <h2>
                <svg class="svg-icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
                Список подключенных мобильных устройств
              </h2>
              <button className="btn btn-sm btn-primary" onClick={handleGenerateTraffic}>
                <svg class="svg-icon" viewBox="0 0 24 24" style={{ stroke: 'currentColor' }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Сгенерировать трафик
              </button>
            </div>

            {/* Toolbar */}
            <div className="table-toolbar">
              <div className="search-input-wrapper">
                <svg class="svg-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input 
                  type="text" 
                  className="search-input" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Поиск по устройству или IP..."
                />
              </div>

              <div className="filter-group">
                <button className={`filter-btn ${carrierFilter === 'all' ? 'active' : ''}`} onClick={() => setCarrierFilter('all')}>Все операторы</button>
                <button className={`filter-btn ${carrierFilter === 'MegaFon' ? 'active' : ''}`} onClick={() => setCarrierFilter('MegaFon')}>MegaFon</button>
                <button className={`filter-btn ${carrierFilter === 'Tele2' ? 'active' : ''}`} onClick={() => setCarrierFilter('Tele2')}>Tele2</button>
                <button className={`filter-btn ${carrierFilter === 'Yota' ? 'active' : ''}`} onClick={() => setCarrierFilter('Yota')}>Yota</button>
              </div>
            </div>

            {/* Table */}
            <div className="table-responsive">
              <table className="proxy-table">
                <thead>
                  <tr>
                    <th>Модель телефона</th>
                    <th>Статус</th>
                    <th>SIM Оператор</th>
                    <th>Точка подключения (SOCKS5/HTTP)</th>
                    <th>Внешний мобильный IP</th>
                    <th>Батарея / Темп.</th>
                    <th>Авто-ротация</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDevices.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)' }}>
                        Нет подключенных мобильных устройств по вашему запросу.
                      </td>
                    </tr>
                  ) : (
                    filteredDevices.map(device => {
                      const proxy = proxies.find(p => p.deviceId === device.id);
                      const isRotating = rotatingDeviceId === device.id;
                      const proxyPort = proxy ? proxy.port : 1080;
                      const proxyLogin = proxy ? proxy.login : 'admin';
                      const proxyPassword = proxy?.password || 'pass123';
                      const credentialString = `${proxyLogin}:${proxyPassword}@${window.location.hostname}:${proxyPort}`;

                      return (
                        <tr key={device.id} className={device.status === 'offline' ? 'inactive' : ''}>
                          <td>
                            <div className="device-cell">
                              <div className="device-icon">📱</div>
                              <div>
                                <div className="device-name-text">{device.name}</div>
                                <div className="device-spec-info">
                                  <span>{device.androidVersion}</span> • 
                                  <span className="mono">IMEI: {device.imei}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="status-cell">
                              <span className={`status-indicator-dot ${device.status === 'online' ? (isRotating ? 'rotating' : 'online') : 'offline'}`}></span>
                              <span style={{ fontWeight: 500, color: device.status === 'offline' ? 'var(--danger)' : 'inherit' }}>
                                {isRotating ? 'Ротация...' : (device.status === 'online' ? 'Онлайн' : 'Офлайн')}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="network-cell">
                              <span className="carrier-tag" style={device.status === 'offline' ? { backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' } : {}}>
                                {device.status === 'offline' ? 'SIM ошибка' : device.carrier}
                              </span>
                              <div className="signal-bar-container" title={`Сила сигнала: ${device.signalDbm} dBm`}>
                                <span className={`signal-bar ${device.status === 'online' ? 'active' : ''}`} style={{ height: '3px' }}></span>
                                <span className={`signal-bar ${device.status === 'online' ? 'active' : ''}`} style={{ height: '5px' }}></span>
                                <span className={`signal-bar ${device.status === 'online' ? 'active' : ''}`} style={{ height: '7px' }}></span>
                                <span className={`signal-bar ${device.status === 'online' && device.signalDbm! > -75 ? 'active' : ''}`} style={{ height: '9px' }}></span>
                                <span className="signal-dbm">{device.status === 'online' ? `${device.signalDbm} dBm` : 'н/д'}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            {device.status === 'online' ? (
                              <div className="credential-box" onClick={() => copyToClipboard(`socks5://${credentialString}`, credentialString)}>
                                <span className="credential-text mono">{credentialString}</span>
                                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>📋</span>
                              </div>
                            ) : (
                              <div className="credential-box" style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                                <span className="credential-text mono">Ошибка соединения</span>
                              </div>
                            )}
                          </td>
                          <td className="mono">
                            {device.currentIp || "—"}
                          </td>
                          <td>
                            <div className="battery-meter" title={`Заряд: ${device.battery}% (${device.temperature}°C)`}>
                              <div className="battery-icon-visual">
                                <div className={`battery-level-fill ${device.battery! < 20 ? 'low' : device.battery! < 60 ? 'warn' : ''}`} style={{ width: `${device.battery}%` }}></div>
                              </div>
                              <span>{device.battery}%</span>
                              <span className={`badge ${device.temperature! > 40 ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: '9px' }}>{device.temperature}°C</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <label className="switch">
                                <input 
                                  type="checkbox"
                                  checked={!!device.autoRotateEnabled}
                                  onChange={e => handleToggleDeviceAutoRotate(device.id, e.target.checked, device.autoRotateInterval || 10)}
                                />
                                <span className="slider"></span>
                              </label>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: device.autoRotateEnabled ? 'var(--accent)' : 'var(--muted)' }}>
                                {device.autoRotateEnabled ? `${device.autoRotateInterval || 10}м` : 'Выкл'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button 
                                className="btn btn-sm btn-primary"
                                onClick={() => handleChangeIp(device.id)}
                                disabled={device.status !== 'online' || isRotating}
                              >
                                {isRotating ? 'Ротация...' : 'Ротация'}
                              </button>
                              <button 
                                className="btn btn-sm"
                                onClick={() => setSelectedDeviceDiag(device)}
                              >
                                Диагностика
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Terminal Network Log Stream Console */}
          <div className="terminal-panel">
            <div className="terminal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--accent)', borderRadius: '50%', display: 'inline-block' }}></span>
                <span className="uppercase-tracking">Терминал сетевых логов сервера</span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="terminal-tabs">
                  <button className={`terminal-tab ${logFilter === 'all' ? 'active' : ''}`} onClick={() => setLogFilter('all')}>Все</button>
                  <button className={`terminal-tab ${logFilter === 'sys' ? 'active' : ''}`} onClick={() => setLogFilter('sys')}>Система</button>
                  <button className={`terminal-tab ${logFilter === 'connections' ? 'active' : ''}`} onClick={() => setLogFilter('connections')}>Трафик</button>
                  <button className={`terminal-tab ${logFilter === 'rotations' ? 'active' : ''}`} onClick={() => setLogFilter('rotations')}>Ротации</button>
                </div>
                <button className="btn btn-sm" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'transparent', color: 'inherit', padding: '2px 6px' }} onClick={handleClearLogs}>
                  Очистить
                </button>
              </div>
            </div>

            <div className="terminal-body" id="log-window">
              {filteredLogs.length === 0 ? (
                <div style={{ color: '#8b949e', fontStyle: 'italic' }}>Ожидание системных сообщений сервера...</div>
              ) : (
                filteredLogs.map((log, i) => (
                  <div key={log.id || i} className="terminal-row">
                    <span className="term-time">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span className={`term-tag ${log.level === 'warn' ? 'warn' : log.level === 'error' ? 'err' : 'sys'}`}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>

        {/* Right Sidebar Section */}
        <div className="sidebar-section">
          
          {/* Server Configuration */}
          <div className="panel-card">
            <div className="panel-header">
              <h2>
                <svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Конфигурация сервера
              </h2>
            </div>

            <form onSubmit={handleApplySettings}>
              <div className="form-group">
                <label>Логин авторизации</label>
                <input 
                  type="text" 
                  className="form-control mono-input" 
                  value={cfgUsername}
                  onChange={e => setCfgUsername(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Пароль авторизации</label>
                <input 
                  type="password" 
                  className="form-control mono-input" 
                  value={cfgPassword}
                  onChange={e => setCfgPassword(e.target.value)}
                />
              </div>

              <div className="switch-container">
                <span className="switch-label">Требовать авторизацию</span>
                <label className="switch">
                  <input 
                    type="checkbox" 
                    checked={cfgRequireAuth}
                    onChange={e => setCfgRequireAuth(e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
                Применить настройки
              </button>
            </form>
          </div>

          {/* Developer Integration */}
          <div className="docs-widget">
            <div className="panel-header" style={{ marginBottom: '12px', paddingBottom: '8px' }}>
              <h2>
                <svg class="svg-icon" viewBox="0 0 24 24"><path d="M16 18L22 12L16 6"/><path d="M8 6L2 12L8 18"/></svg>
                Интеграция для разработчиков
              </h2>
            </div>

            <p style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '12px', lineHeight: 1.5 }}>
              Используйте полученные прокси-серверы напрямую в ваших приложениях или скриптах.
            </p>

            <div className="docs-tabs">
              <button className={`docs-tab ${activeDocTab === 'curl' ? 'active' : ''}`} onClick={() => setActiveDocTab('curl')}>Curl</button>
              <button className={`docs-tab ${activeDocTab === 'python' ? 'active' : ''}`} onClick={() => setActiveDocTab('python')}>Python</button>
              <button className={`docs-tab ${activeDocTab === 'node' ? 'active' : ''}`} onClick={() => setActiveDocTab('node')}>Node.js</button>
              <button className={`docs-tab ${activeDocTab === 'rotate-api' ? 'active' : ''}`} onClick={() => setActiveDocTab('rotate-api')}>Ротация API</button>
            </div>

            <div className="code-editor">
              <div className="code-editor-header">
                <span className="code-lang-label">{activeDocTab.toUpperCase()}</span>
                <button 
                  className="code-copy-btn" 
                  onClick={() => copyToClipboard(
                    activeDocTab === 'curl' ? `curl -x socks5h://admin:pass123@${window.location.hostname}:1080 https://ifconfig.me` :
                    activeDocTab === 'python' ? `import requests\nproxies = {'http': 'socks5h://admin:pass123@${window.location.hostname}:1080', 'https': 'socks5h://admin:pass123@${window.location.hostname}:1080'}\nprint(requests.get('https://ifconfig.me', proxies=proxies).text)` :
                    activeDocTab === 'node' ? `import fetch from 'node-fetch';\nconst res = await fetch('https://ifconfig.me');` :
                    `curl ${window.location.protocol}//${window.location.host}/api/change-ip/device/device_id`,
                    "Код интеграции"
                  )}
                  title="Копировать код"
                >
                  <svg class="svg-icon" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>
              
              <pre className="code-content">
                {activeDocTab === 'curl' && <code><span className="keyword">curl</span> -x socks5h://<span className="variable">admin</span>:<span className="variable">pass123</span>@{window.location.hostname}:1080 https://ifconfig.me</code>}
                {activeDocTab === 'python' && <code><span className="keyword">import</span> requests<br/><span className="variable">proxies</span> = &#123;<span className="string">'http'</span>: <span className="string">'socks5h://admin:pass123@{window.location.hostname}:1080'</span>&#125;<br/>print(requests.get(<span className="string">'https://ifconfig.me'</span>, proxies=proxies).text)</code>}
                {activeDocTab === 'node' && <code><span className="keyword">import</span> fetch <span className="keyword">from</span> <span className="string">'node-fetch'</span>;<br/><span className="keyword">const</span> res = <span className="keyword">await</span> fetch(<span className="string">'${window.location.protocol}//${window.location.host}/api/change-ip/device/device_id'</span>);</code>}
                {activeDocTab === 'rotate-api' && <code><span className="keyword">curl</span> {window.location.protocol}//{window.location.host}/api/change-ip/device/device_id</code>}
              </pre>
            </div>
          </div>

        </div>

      </main>

      {/* Slide-out Diagnostic Drawer */}
      {selectedDeviceDiag && (
        <>
          <div className="drawer-overlay active" onClick={() => setSelectedDeviceDiag(null)}></div>
          <div className="drawer active">
            <div className="drawer-header">
              <div className="drawer-title-group">
                <h3>Диагностика {selectedDeviceDiag.name}</h3>
                <span className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>ID: {selectedDeviceDiag.id}</span>
              </div>
              <button className="drawer-close" onClick={() => setSelectedDeviceDiag(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="drawer-body">
              <div className="diagnostic-grid">
                <div className="diagnostic-card">
                  <div className="diag-label">Статус соединения</div>
                  <div className="diag-value" style={{ color: selectedDeviceDiag.status === 'online' ? 'var(--success)' : 'var(--danger)' }}>
                    {selectedDeviceDiag.status.toUpperCase()}
                  </div>
                </div>
                <div className="diagnostic-card">
                  <div className="diag-label">Мобильный IP</div>
                  <div className="diag-value">{selectedDeviceDiag.currentIp || "Н/Д"}</div>
                </div>
                <div className="diagnostic-card">
                  <div className="diag-label">Оператор SIM</div>
                  <div className="diag-value">{selectedDeviceDiag.carrier}</div>
                </div>
                <div className="diagnostic-card">
                  <div className="diag-label">Уровень сигнала</div>
                  <div className="diag-value">{selectedDeviceDiag.signalDbm} dBm</div>
                </div>
                <div className="diagnostic-card">
                  <div className="diag-label">Батарея / Темп.</div>
                  <div className="diag-value">{selectedDeviceDiag.battery}% ({selectedDeviceDiag.temperature}°C)</div>
                </div>
                <div className="diagnostic-card">
                  <div className="diag-label">Версия Android</div>
                  <div className="diag-value">{selectedDeviceDiag.androidVersion}</div>
                </div>
              </div>

              <div style={{ marginTop: '16px', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--surface-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '14px' }}>⚡</span>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>Тест скорости соединения</span>
                  </div>
                  <button 
                    className="btn btn-sm btn-primary"
                    onClick={() => handleRunSpeedTest(selectedDeviceDiag.id)}
                    disabled={isSpeedTesting || selectedDeviceDiag.status !== 'online'}
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                  >
                    {isSpeedTesting ? 'Замер...' : 'Запустить тест'}
                  </button>
                </div>

                {isSpeedTesting && (
                  <div style={{ textAlign: 'center', padding: '12px 6px', fontSize: '12px', color: 'var(--accent)', fontStyle: 'italic' }}>
                    <span className="status-indicator-dot rotating" style={{ marginRight: '6px' }}></span>
                    Тестирование latency и пропускной способности SOCKS5...
                  </div>
                )}

                {speedTestResult && !isSpeedTesting && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '10px' }}>
                    <div style={{ background: 'var(--bg)', padding: '8px 4px', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>PING</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--success)', marginTop: '2px' }}>{speedTestResult.pingMs} мс</div>
                    </div>
                    <div style={{ background: 'var(--bg)', padding: '8px 4px', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>DOWNLOAD</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent)', marginTop: '2px' }}>{speedTestResult.downloadMbps} Мб/с</div>
                    </div>
                    <div style={{ background: 'var(--bg)', padding: '8px 4px', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>UPLOAD</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--fg)', marginTop: '2px' }}>{speedTestResult.uploadMbps} Мб/с</div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: '16px', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--surface-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: selectedDeviceDiag.autoRotateEnabled ? '10px' : '0' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Авто-ротация для этого устройства</span>
                  <label className="switch">
                    <input 
                      type="checkbox"
                      checked={!!selectedDeviceDiag.autoRotateEnabled}
                      onChange={e => handleToggleDeviceAutoRotate(selectedDeviceDiag.id, e.target.checked, selectedDeviceDiag.autoRotateInterval || 10)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                {selectedDeviceDiag.autoRotateEnabled && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '11px', color: 'var(--muted)' }}>Интервал смены IP</label>
                    <select 
                      className="form-control"
                      value={selectedDeviceDiag.autoRotateInterval || 10}
                      onChange={e => handleToggleDeviceAutoRotate(selectedDeviceDiag.id, true, Number(e.target.value))}
                      style={{ width: '100%', marginTop: '4px', padding: '6px 10px', fontSize: '12px' }}
                    >
                      <option value={2}>Каждые 2 минуты</option>
                      <option value={5}>Каждые 5 минут</option>
                      <option value={10}>Каждые 10 минут</option>
                      <option value={15}>Каждые 15 минут</option>
                      <option value={30}>Каждые 30 минут</option>
                      <option value={60}>Каждый час</option>
                    </select>
                  </div>
                )}
              </div>

              <button 
                className="btn btn-primary" 
                style={{ width: '100%', marginTop: '16px', padding: '10px' }}
                onClick={() => handleChangeIp(selectedDeviceDiag.id)}
              >
                Выполнить ротацию IP прямо сейчас
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
