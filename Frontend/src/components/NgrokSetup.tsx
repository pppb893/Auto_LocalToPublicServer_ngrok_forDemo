import { useState } from 'react';
import './NgrokSetup.css';

interface NgrokSetupProps {
    onComplete: (key: string) => void;
    onCancel: () => void;
}

export default function NgrokSetup({ onComplete, onCancel }: NgrokSetupProps) {
    const [key, setKey] = useState('');
    const [isValidating, setIsValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!key.trim()) {
            setError('Please enter your ngrok auth token');
            return;
        }

        setIsValidating(true);
        setError(null);

        try {
            const result = await window.electronAPI.setupNgrokKey(key.trim());

            if (result.success) {
                onComplete(key.trim());
            } else {
                setError(result.error || 'Failed to configure ngrok');
                setIsValidating(false);
            }
        } catch (err) {
            setError('An error occurred while configuring ngrok');
            setIsValidating(false);
        }
    };

    const handleOpenDashboard = () => {
        window.electronAPI.openExternal('https://dashboard.ngrok.com/get-started/your-authtoken');
    };

    return (
        <div className="ngrok-modal-overlay">
            <div className="ngrok-modal modal-relative">
                {isValidating && (
                    <div className="ngrok-spinner-overlay">
                        <div className="ngrok-spinner"></div>
                        <div className="ngrok-spinner-text">Configuring ngrok...</div>
                    </div>
                )}

                <div className="ngrok-header">
                    <div className="ngrok-icon">🔗</div>
                    <h2 className="ngrok-title">Connect Ngrok</h2>
                    <p className="ngrok-subtitle">Enter your ngrok auth token to enable public URLs</p>
                </div>

                {error && (
                    <div className="ngrok-error">❌ {error}</div>
                )}

                <div className="ngrok-input-group">
                    <input
                        type="text"
                        className="ngrok-input"
                        placeholder="Enter your ngrok auth token..."
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                        disabled={isValidating}
                    />
                </div>

                <div className="ngrok-instructions">
                    <h4 className="instructions-title">📋 How to get your token:</h4>
                    <ol className="instructions-steps">
                        <li data-step="1.">
                            <a href="#" onClick={(e) => { e.preventDefault(); handleOpenDashboard(); }}>
                                Open ngrok dashboard
                            </a>
                        </li>
                        <li data-step="2.">Sign up or log in (free account)</li>
                        <li data-step="3.">Copy your auth token from the dashboard</li>
                        <li data-step="4.">Paste it above and click "Connect"</li>
                    </ol>
                </div>

                <div className="ngrok-buttons">
                    <button
                        className="ngrok-btn secondary"
                        onClick={onCancel}
                        disabled={isValidating}
                    >
                        Cancel
                    </button>
                    <button
                        className="ngrok-btn primary"
                        onClick={handleSubmit}
                        disabled={isValidating || !key.trim()}
                    >
                        Connect
                    </button>
                </div>
            </div>
        </div>
    );
}
