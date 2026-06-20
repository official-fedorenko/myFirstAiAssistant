import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { LayoutDashboard, MessageSquare, Settings, LogOut, CheckCircle2, AlertCircle } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const API_BASE = '/api';

// Create axios instance with auth interceptor
const api = axios.create({ baseURL: API_BASE });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post(`/auth/${isLogin ? 'login' : 'register'}`, { username, password });
      localStorage.setItem('token', res.data.token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred');
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="glass-panel auth-box">
        <h1 className="text-gradient" style={{ textAlign: 'center', marginBottom: 8 }}>TGA Admin</h1>
        <p style={{ textAlign: 'center' }}>{isLogin ? 'Welcome back' : 'Create an account'}</p>
        
        {error && <div style={{ color: 'var(--danger)', marginBottom: 16, textAlign: 'center' }}>{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <input 
            type="text" 
            placeholder="Username" 
            value={username} 
            onChange={e => setUsername(e.target.value)} 
            required 
          />
          <input 
            type="password" 
            placeholder="Password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            required 
          />
          <button type="submit">{isLogin ? 'Log In' : 'Sign Up'}</button>
        </form>
        
        <p style={{ textAlign: 'center', marginTop: 16, cursor: 'pointer', color: 'var(--accent)' }} onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? "Don't have an account? Sign up" : "Already have an account? Log in"}
        </p>
      </div>
    </div>
  );
}

function Layout({ children }) {
  const navigate = useNavigate();
  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header text-gradient">
          <MessageSquare /> TGA Admin
        </div>
        <nav className="sidebar-nav">
          <Link to="/" className="nav-item"><LayoutDashboard size={20} /> Dashboard</Link>
          <Link to="/chats" className="nav-item"><MessageSquare size={20} /> Chats</Link>
          <Link to="/settings" className="nav-item"><Settings size={20} /> Telegram Setup</Link>
          <div style={{ flex: 1 }}></div>
          <div className="nav-item" style={{ cursor: 'pointer' }} onClick={handleLogout}><LogOut size={20} /> Logout</div>
        </nav>
      </aside>
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

function TelegramSetup() {
  const [status, setStatus] = useState('disconnected');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [codeViaApp, setCodeViaApp] = useState(false);

  useEffect(() => {
    api.get('/telegram/status').then(res => {
      setStatus(res.data.status);
      if (res.data.config) {
        setApiId(res.data.config.apiId || '');
        setApiHash(res.data.config.apiHash || '');
        setPhone(res.data.config.phone || '');
      }
      if (res.data.status === 'code_requested') {
        setStep(2);
      }
    }).catch(console.error);
  }, []);

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/telegram/connect', { apiId, apiHash, phone });
      if (res.data.needsCode) {
        setCodeViaApp(res.data.isCodeViaApp);
        setStep(2);
      } else if (!res.data.success) {
        alert("Failed to connect: " + res.data.error);
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
    setLoading(false);
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/telegram/verify-code', { code, password });
      if (res.data.needsPassword) {
        setNeedsPassword(true);
      } else if (res.data.success) {
        setStatus('connected');
        setStep(3);
      } else {
        alert("Verification failed: " + res.data.error);
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
    setLoading(false);
  };

  return (
    <Layout>
      <h2>Telegram Connection</h2>
      <div className="glass-panel" style={{ maxWidth: 500 }}>
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          Status: 
          <span className={`status-badge ${status}`}>
            {status === 'connected' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>}
            {status.toUpperCase()}
          </span>
        </div>

        {status !== 'connected' && step === 1 && (
          <form onSubmit={handleConnect}>
            <p>Enter your User API keys from my.telegram.org</p>
            <input type="text" placeholder="API ID" value={apiId} onChange={e => setApiId(e.target.value)} required />
            <input type="text" placeholder="API Hash" value={apiHash} onChange={e => setApiHash(e.target.value)} required />
            <input type="text" placeholder="Phone Number (e.g. +1234567890)" value={phone} onChange={e => setPhone(e.target.value)} required />
            <button type="submit" disabled={loading}>{loading ? <div className="loader"/> : 'Connect'}</button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleVerify}>
            <div style={{ padding: '12px', marginBottom: '16px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '8px', border: '1px solid var(--accent-glow)' }}>
              <p style={{ margin: 0, color: 'var(--text-main)' }}>
                {codeViaApp 
                  ? "A verification code was sent to your official Telegram app (on your phone or PC). Please check your messages from 'Telegram'." 
                  : "A verification code was sent via SMS to your phone."}
              </p>
            </div>
            <input type="text" placeholder="Code" value={code} onChange={e => setCode(e.target.value)} required />
            {needsPassword && (
              <input type="password" placeholder="2FA Password" value={password} onChange={e => setPassword(e.target.value)} required />
            )}
            <button type="submit" disabled={loading}>{loading ? <div className="loader"/> : 'Verify & Login'}</button>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button 
                type="button" 
                className="secondary" 
                style={{ flex: 1 }}
                onClick={async () => {
                  setLoading(true);
                  try {
                    const res = await api.post('/telegram/resend-code');
                    if (res.data.success) {
                       setCodeViaApp(res.data.isCodeViaApp);
                       alert("Code resent!");
                    } else {
                       alert("Failed to resend code: " + res.data.error);
                    }
                  } catch (err) {
                    alert("Error: " + err.message);
                  }
                  setLoading(false);
                }}
              >
                Resend Code
              </button>
              <button type="button" className="secondary" style={{ flex: 1 }} onClick={() => setStep(1)}>Edit Config</button>
            </div>
          </form>
        )}

        {status === 'connected' && (
          <div>
            <p style={{ color: 'var(--success)' }}>Successfully connected to Telegram! Your account is active and listening for messages.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Chats() {
  const [chats, setChats] = useState([]);

  useEffect(() => {
    loadChats();
  }, []);

  const loadChats = () => {
    api.get('/chats').then(res => setChats(res.data)).catch(console.error);
  };

  const handleSyncMonth = async (chatId) => {
    try {
      await api.post(`/chats/${chatId}/sync-month`);
      loadChats(); // Refresh to show 'syncing' status
    } catch (err) {
      alert("Sync failed to start");
    }
  };

  return (
    <Layout>
      <h2>Monitored Chats</h2>
      <p>Here you can view all chats and request historical synchronization.</p>
      
      <div className="chat-list">
        {chats.map(chat => (
          <div key={chat.id} className="glass-panel chat-card">
            <div className="chat-title">
              {chat.title} 
              <span className="sync-status">
                {chat.sync_status === 'syncing' ? <span className="pulse" style={{color: '#f59e0b'}}>Syncing...</span> : chat.sync_status}
              </span>
            </div>
            <div className="chat-type">{chat.type}</div>
            
            <button 
              className="secondary" 
              style={{ marginTop: 16 }}
              disabled={chat.sync_status === 'syncing'}
              onClick={() => handleSyncMonth(chat.telegram_chat_id)}
            >
              Load Past Month
            </button>
          </div>
        ))}
        {chats.length === 0 && <p>No chats found. Please connect your Telegram account.</p>}
      </div>
    </Layout>
  );
}

function Dashboard() {
  const [data, setData] = useState([]);
  
  useEffect(() => {
    api.get('/analytics').then(res => setData(res.data.reverse())).catch(console.error);
  }, []);

  const chartData = {
    labels: data.map(d => d.day),
    datasets: [
      {
        label: 'Messages',
        data: data.map(d => d.count),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.5)',
        tension: 0.4
      }
    ]
  };

  return (
    <Layout>
      <h2>Dashboard Overview</h2>
      <div className="glass-panel" style={{ marginBottom: 24 }}>
        <h3>Message Activity (Last 30 Days)</h3>
        {data.length > 0 ? (
          <div style={{ height: 300, marginTop: 16 }}>
            <Line data={chartData} options={{ maintainAspectRatio: false }} />
          </div>
        ) : (
          <p style={{ marginTop: 16 }}>Not enough data to display chart. Start syncing some chats!</p>
        )}
      </div>
    </Layout>
  );
}

function ProtectedRoute({ children }) {
  if (!localStorage.getItem('token')) return <Navigate to="/login" />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/chats" element={<ProtectedRoute><Chats /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><TelegramSetup /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}
