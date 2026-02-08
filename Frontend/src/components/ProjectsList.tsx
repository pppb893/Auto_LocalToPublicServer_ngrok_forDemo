import { useState } from 'react';
import './Dashboard.css';
import Terminal from './Terminal';
import type { Project } from '../types/electron';

interface ProjectsListProps {
    projects: Project[];
    onRemove: (id: string) => void;
    onToggleStatus: (id: string) => void;
    onUpdateProject: (project: Project) => void;
    onClearAll: () => void;
}

export default function ProjectsList({ projects, onRemove, onToggleStatus, onUpdateProject, onClearAll }: ProjectsListProps) {
    const [expandedProject, setExpandedProject] = useState<string | null>(null);
    const [runningProject, setRunningProject] = useState<string | null>(null);

    if (projects.length === 0) {
        return (
            <div className="projects-list-container">
                <div className="empty-state">
                    <div className="empty-icon">📭</div>
                    <div className="empty-text">No projects yet</div>
                    <div className="empty-hint">Go to the Upload tab to add your first project</div>
                </div>
            </div>
        );
    }

    const handleStart = async (project: Project) => {
        if (!project.dockerDir) {
            alert('Docker configuration not found. Please re-process this project.');
            return;
        }

        setRunningProject(project.id);
        setExpandedProject(project.id);

        // Check ports defined in docker-compose.yml
        let portsToCheck = [3000, 8080];
        let detectedNgrokApiPort = 4040; // Default

        const portsResult = await window.electronAPI.getDockerPorts(project.dockerDir);

        if (portsResult.success && portsResult.ports && portsResult.ports.length > 0) {
            portsToCheck = portsResult.ports;
            if (portsResult.ngrokApiPort) {
                detectedNgrokApiPort = portsResult.ngrokApiPort;
            }
        }


        const conflictingPorts: { port: number; processName: string; newPort: number }[] = [];

        for (const port of portsToCheck) {
            const portCheck = await window.electronAPI.checkPortInUse(port);
            if (portCheck.inUse) {
                // Find next available port
                const available = await window.electronAPI.findAvailablePort(port + 1);
                if (available.success && available.port) {
                    conflictingPorts.push({
                        port,
                        processName: portCheck.processName || 'Unknown',
                        newPort: available.port
                    });
                }
            }
        }

        if (conflictingPorts.length > 0) {
            const portInfo = conflictingPorts
                .map(p => `• Port ${p.port} (used by "${p.processName}") → Will use ${p.newPort}`)
                .join('\n');

            // Notify user about the change
            alert(
                `⚠️ Port Conflict Detected:\n\n${portInfo}\n\n` +
                `The app will automatically update the configuration to use the new ports.`
            );

            // Update Docker configuration
            const mappings = conflictingPorts.map(p => ({ oldPort: p.port, newPort: p.newPort }));
            const updateResult = await window.electronAPI.updateDockerPorts(project.dockerDir, mappings);

            if (!updateResult.success) {
                alert(`Failed to update Docker configuration: ${updateResult.error}`);
                setRunningProject(null);
                return;
            }
        }

        // Start Docker containers
        await window.electronAPI.dockerUp(project.dockerDir);

        // Wait a bit for ngrok to start
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Determine Ngrok Inspection Port
        // 1. Start with what we parsed from the file (which might be a random port like 4123)
        let ngrokApiPort = detectedNgrokApiPort;

        // 2. If that port was found to be in use and we switched it, use the NEW port
        if (conflictingPorts.length > 0) {
            const conflict = conflictingPorts.find(p => p.port === detectedNgrokApiPort);
            if (conflict) {
                ngrokApiPort = conflict.newPort;
                console.log(`Ngrok API port conflict detected. Switched from ${detectedNgrokApiPort} to ${ngrokApiPort}`);
            }
        }

        console.log(`Checking Ngrok API on port ${ngrokApiPort}`);

        // Get the public URL using the specific inspection port
        // Helper to retry getting Ngrok URL
        const getUrlWithRetry = async (apiPort: number, retries = 5) => {
            for (let i = 0; i < retries; i++) {
                const result = await window.electronAPI.getNgrokUrl(apiPort);
                if (result.success && result.url) {
                    return result;
                }
                if (i < retries - 1) {
                    console.warn(`Attempt ${i + 1}/${retries}: Could not find ngrok tunnel on port ${apiPort}. Retrying in 2s...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            return { success: false, error: 'Max retries reached' };
        };

        const urlResult = await getUrlWithRetry(ngrokApiPort);

        if (urlResult.success && urlResult.url) {
            onUpdateProject({
                ...project,
                status: 'running',
                publicUrl: urlResult.url
            });
            // Auto-open the URL
            window.electronAPI.openExternal(urlResult.url);
        } else {
            alert(`Started, but Ngrok tunnel not found on internal API port ${ngrokApiPort}. Check terminal for status.`);
        }

        onToggleStatus(project.id);
    };

    const handleStop = async (project: Project) => {
        if (project.dockerDir) {
            await window.electronAPI.dockerDown(project.dockerDir);
        }
        setRunningProject(null);
        onUpdateProject({
            ...project,
            status: 'stopped',
            publicUrl: undefined
        });
        onToggleStatus(project.id);
    };

    const handleOpenUrl = (url: string) => {
        window.electronAPI.openExternal(url);
    };

    return (
        <div className="projects-list-container">
            <div className="projects-header">
                <h2 className="projects-title">Your Projects</h2>
                <div className="projects-header-actions">
                    <span className="projects-count">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
                    <button
                        className="action-btn clear-all"
                        onClick={() => {
                            if (window.confirm('Are you sure you want to remove all projects?')) {
                                onClearAll();
                            }
                        }}
                    >
                        🗑️ Clear All
                    </button>
                </div>
            </div>

            <div className="project-cards">
                {projects.map(project => (
                    <div key={project.id} className={`project-card ${expandedProject === project.id ? 'expanded' : ''}`}>
                        <div className="project-card-header">
                            <div className="project-info">
                                <div className="project-name">📦 {project.name}</div>
                                <div className="project-path">{project.path}</div>
                            </div>
                            <div className="project-status">
                                <span className={`status-badge ${project.status}`}>
                                    {project.status === 'running' ? '🟢 Running' : '🔴 Stopped'}
                                </span>
                            </div>
                        </div>

                        <div className="project-tech-stacks">
                            {project.structure.map((item, idx) => (
                                item.techStacks && item.techStacks.map((tech, techIdx) => (
                                    <span key={`${idx}-${techIdx}`} className="tech-tag">
                                        <span>{tech.icon}</span>
                                        <span>{tech.name}</span>
                                    </span>
                                ))
                            ))}
                            {/* Show databases */}
                            {(project.databases || []).map((db, idx) => (
                                <span key={`db-${idx}`} className="tech-tag db">
                                    <span>{db.icon}</span>
                                    <span>{db.name}</span>
                                </span>
                            ))}
                        </div>

                        <div className="project-actions">
                            {project.status === 'stopped' ? (
                                <button
                                    className="action-btn start"
                                    onClick={() => handleStart(project)}
                                    disabled={runningProject === project.id}
                                >
                                    {runningProject === project.id ? '⏳ Starting...' : '▶️ Start'}
                                </button>
                            ) : (
                                <button
                                    className="action-btn stop"
                                    onClick={() => handleStop(project)}
                                >
                                    ⏹️ Stop
                                </button>
                            )}
                            <button
                                className="action-btn terminal"
                                onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}
                            >
                                📺 {expandedProject === project.id ? 'Hide Terminal' : 'Show Terminal'}
                            </button>
                            <button
                                className="action-btn remove"
                                onClick={() => onRemove(project.id)}
                            >
                                🗑️ Remove
                            </button>
                        </div>

                        {expandedProject === project.id && (
                            <div className="project-terminal">
                                <Terminal
                                    publicUrl={project.publicUrl || null}
                                    isRunning={project.status === 'running'}
                                    onStop={() => handleStop(project)}
                                    onOpenUrl={() => project.publicUrl && handleOpenUrl(project.publicUrl)}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
