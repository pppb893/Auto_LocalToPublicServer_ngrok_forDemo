import { useState, useEffect, useRef } from 'react';
import './DependencyCheck.css';

type StepStatus = 'pending' | 'checking' | 'success' | 'error' | 'installing';

interface Step {
    id: string;
    name: string;
    description: string;
    status: StepStatus;
    version?: string | null;
}

export default function DependencyCheck({ onReady }: { onReady: () => void }) {
    const [platform, setPlatform] = useState<string>('');
    const [steps, setSteps] = useState<Step[]>([
        { id: 'docker', name: 'Docker', description: 'Container runtime', status: 'pending' },
        { id: 'ngrok', name: 'Ngrok', description: 'Secure tunneling', status: 'pending' },
        { id: 'node', name: 'Node.js', description: 'JavaScript runtime', status: 'pending' },
    ]);
    const [terminalOutput, setTerminalOutput] = useState<string>('> Initializing system check...\n');
    const [currentInstall, setCurrentInstall] = useState<string | null>(null);
    const [isPolling, setIsPolling] = useState(false);
    const terminalRef = useRef<HTMLDivElement>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        initCheck();

        window.electronAPI.onInstallOutput(({ data }) => {
            setTerminalOutput(prev => prev + data);
        });

        return () => {
            window.electronAPI.removeInstallOutputListener();
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [terminalOutput]);

    const initCheck = async () => {
        const plat = await window.electronAPI.getPlatform();
        setPlatform(plat === 'win32' ? 'Windows' : plat === 'darwin' ? 'macOS' : 'Linux');
        setTerminalOutput(prev => prev + `> Platform detected: ${plat === 'win32' ? 'Windows' : plat === 'darwin' ? 'macOS' : 'Linux'}\n`);
        await checkAllDependencies();
    };

    const checkAllDependencies = async () => {
        setTerminalOutput(prev => prev + '\n> Starting dependency checks...\n');

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];

            setSteps(prev => prev.map((s, idx) =>
                idx === i ? { ...s, status: 'checking' } : s
            ));

            setTerminalOutput(prev => prev + `> Checking ${step.name}... `);

            await new Promise(resolve => setTimeout(resolve, 300));

            const result = await window.electronAPI.checkDependency(step.id);

            setSteps(prev => prev.map((s, idx) =>
                idx === i ? {
                    ...s,
                    status: result.installed ? 'success' : 'error',
                    version: result.version
                } : s
            ));

            if (result.installed) {
                setTerminalOutput(prev => prev + `✓ Found (${result.version || 'installed'})\n`);
            } else {
                setTerminalOutput(prev => prev + `✗ Not found\n`);
            }
        }

        setTerminalOutput(prev => prev + '\n> Dependency check complete.\n');
    };

    const handleInstall = async (depId: string) => {
        setCurrentInstall(depId);
        setTerminalOutput(prev => prev + `\n${'='.repeat(50)}\n> Installing ${depId}...\n`);

        setSteps(prev => prev.map(s =>
            s.id === depId ? { ...s, status: 'installing' } : s
        ));

        const result = await window.electronAPI.installDependency(depId);

        if (result.success) {
            setTerminalOutput(prev => prev + `\n> Installation command sent.\n> Waiting for external terminal to complete...\n`);

            setIsPolling(true);
            let attempts = 0;
            const maxAttempts = 60;

            pollingRef.current = setInterval(async () => {
                attempts++;
                const checkResult = await window.electronAPI.checkDependency(depId);

                if (checkResult.installed) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    setIsPolling(false);
                    setCurrentInstall(null);
                    setTerminalOutput(prev => prev + `\n> ✓ ${depId} is now installed! (${checkResult.version})\n`);
                    setSteps(prev => prev.map(s =>
                        s.id === depId ? {
                            ...s,
                            status: 'success',
                            version: checkResult.version
                        } : s
                    ));
                } else if (attempts >= maxAttempts) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    setIsPolling(false);
                    setCurrentInstall(null);
                    setTerminalOutput(prev => prev + `\n> Polling timeout. Click "Recheck" when installation is complete.\n`);
                    setSteps(prev => prev.map(s =>
                        s.id === depId ? { ...s, status: 'error' } : s
                    ));
                }
            }, 1000);
        } else {
            setTerminalOutput(prev => prev + `\n> ❌ Installation failed: ${result.error || 'Unknown error'}\n`);
            setSteps(prev => prev.map(s =>
                s.id === depId ? { ...s, status: 'error' } : s
            ));
            setCurrentInstall(null);
        }
    };

    const handleRecheckAll = async () => {
        setTerminalOutput(prev => prev + `\n${'='.repeat(50)}\n`);
        await checkAllDependencies();
    };

    const allReady = steps.every(s => s.status === 'success');
    const anyChecking = steps.some(s => s.status === 'checking' || s.status === 'installing');
    const anyError = steps.some(s => s.status === 'error');

    const getIcon = (status: StepStatus) => {
        switch (status) {
            case 'pending': return '○';
            case 'checking': return '◐';
            case 'success': return '✓';
            case 'error': return '✗';
            case 'installing': return '⟳';
            default: return '○';
        }
    };

    return (
        <div className="dependency-check-container">
            <div className="glass-card">
                <span className="platform-badge">{platform || '...'}</span>
                <h1 className="title">System Check</h1>
                <p className="subtitle">Verifying required dependencies...</p>

                <div className="steps-container">
                    {steps.map((step) => (
                        <div
                            key={step.id}
                            className={`step ${step.status}`}
                        >
                            <div className={`step-icon ${step.status} ${step.status === 'checking' || step.status === 'installing' ? 'spinner' : ''}`}>
                                {getIcon(step.status)}
                            </div>
                            <div className="step-content">
                                <div className="step-name">{step.name}</div>
                                <div className={`step-status ${step.version ? 'version' : ''}`}>
                                    {step.status === 'pending' && step.description}
                                    {step.status === 'checking' && 'Checking...'}
                                    {step.status === 'success' && (step.version || 'Installed')}
                                    {step.status === 'error' && 'Not found'}
                                    {step.status === 'installing' && (isPolling ? 'Waiting for install...' : 'Installing...')}
                                </div>
                            </div>
                            {step.status === 'error' && !currentInstall && (
                                <div className="step-action">
                                    <button
                                        className="install-btn"
                                        onClick={() => handleInstall(step.id)}
                                    >
                                        Install
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="terminal-output" ref={terminalRef}>
                    <pre>{terminalOutput}</pre>
                </div>

                <div className="button-row">
                    {anyError && !anyChecking && (
                        <button
                            className="recheck-btn"
                            onClick={handleRecheckAll}
                        >
                            🔄 Recheck All
                        </button>
                    )}
                    <button
                        className="continue-btn"
                        disabled={!allReady || anyChecking}
                        onClick={onReady}
                    >
                        {anyChecking ? 'Please wait...' : allReady ? 'Continue to App →' : 'Complete installation first'}
                    </button>
                </div>
            </div>
        </div>
    );
}
