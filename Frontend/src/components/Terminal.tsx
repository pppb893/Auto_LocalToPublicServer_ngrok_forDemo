import { useState, useEffect, useRef } from 'react';
import './Terminal.css';

interface LogEntry {
    id: number;
    type: 'stdout' | 'stderr' | 'info' | 'success';
    message: string;
    tab: 'status' | 'api';
}

interface TerminalProps {
    publicUrl: string | null;
    isRunning: boolean;
    onStop: () => void;
    onOpenUrl: () => void;
}

export default function Terminal({ publicUrl, isRunning, onStop, onOpenUrl }: TerminalProps) {
    const [activeTab, setActiveTab] = useState<'status' | 'api'>('status');
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [logIdCounter, setLogIdCounter] = useState(0);
    const bodyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleDockerOutput = (data: { type: string; data: string }) => {
            const newId = logIdCounter + 1;
            setLogIdCounter(newId);

            // Determine which tab this log belongs to
            const isApiLog = data.data.toLowerCase().includes('request') ||
                data.data.toLowerCase().includes('response') ||
                data.data.toLowerCase().includes('http') ||
                data.data.toLowerCase().includes('api');

            setLogs(prev => [...prev, {
                id: newId,
                type: data.type === 'stderr' ? 'stderr' : 'stdout',
                message: data.data,
                tab: isApiLog ? 'api' : 'status'
            }]);
        };

        window.electronAPI.onDockerOutput(handleDockerOutput);

        return () => {
            window.electronAPI.removeDockerOutputListener();
        };
    }, [logIdCounter]);

    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [logs]);

    const filteredLogs = logs.filter(log => log.tab === activeTab);

    return (
        <div className="terminal-container">
            <div className="terminal-header">
                <div className="terminal-url">
                    {publicUrl ? (
                        <>
                            <span className="url-label">🌐 Public URL:</span>
                            <span className="url-value" onClick={onOpenUrl}>{publicUrl}</span>
                        </>
                    ) : (
                        <span className="url-label">Starting...</span>
                    )}
                </div>
                <div className="terminal-actions">
                    {publicUrl && (
                        <button className="terminal-btn open" onClick={onOpenUrl}>
                            🔗 Open
                        </button>
                    )}
                    {isRunning && (
                        <button className="terminal-btn stop" onClick={onStop}>
                            ⏹️ Stop
                        </button>
                    )}
                </div>
            </div>

            <div className="terminal-tabs">
                <button
                    className={`terminal-tab ${activeTab === 'status' ? 'active' : ''}`}
                    onClick={() => setActiveTab('status')}
                >
                    📊 Status
                </button>
                <button
                    className={`terminal-tab ${activeTab === 'api' ? 'active' : ''}`}
                    onClick={() => setActiveTab('api')}
                >
                    📡 API Logs
                </button>
            </div>

            <div className="terminal-body" ref={bodyRef}>
                {filteredLogs.length === 0 ? (
                    <div className="terminal-empty">
                        <div className="terminal-empty-icon">📋</div>
                        <div>No logs yet for {activeTab === 'status' ? 'Status' : 'API'}</div>
                        {isRunning && (
                            <div className="terminal-spinner">
                                <div className="spinner-icon"></div>
                                <span>Waiting for output...</span>
                            </div>
                        )}
                    </div>
                ) : (
                    filteredLogs.map(log => (
                        <div key={log.id} className={`log-line ${log.type}`}>
                            {log.message}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// Export addLog helper for external use
export function useTerminalLogs() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [logIdCounter, setLogIdCounter] = useState(0);

    const addLog = (type: LogEntry['type'], message: string, tab: 'status' | 'api' = 'status') => {
        const newId = logIdCounter + 1;
        setLogIdCounter(newId);
        setLogs(prev => [...prev, { id: newId, type, message, tab }]);
    };

    return { logs, addLog };
}
