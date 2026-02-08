import { useState } from 'react';
import './ProjectUpload.css';
import Terminal from './Terminal';
import NgrokSetup from './NgrokSetup';

// Types
interface TechStack {
    name: string;
    type: string;
    icon: string;
}

interface Database {
    name: string;
    icon: string;
    image: string | null;
}

interface StructureItem {
    name: string;
    type: 'frontend' | 'backend' | 'root';
    path: string;
    techStacks: TechStack[];
    databases: Database[];
    port?: number;
}

interface ScannedProject {
    path: string;
    name: string;
    structure: StructureItem[];
    databases: Database[];
    hasDockerfile: boolean;
}

interface ProjectUploadProps {
    onProjectAdded?: (project: ScannedProject & { 
        dockerDir?: string;
        isTemporary?: boolean;
        generatedFiles?: string[];
        id?: string;
    }) => void;
}

type ProcessingStep = 'idle' | 'ngrok' | 'generating' | 'building' | 'done';

export default function ProjectUpload({ onProjectAdded }: ProjectUploadProps) {
    const [project, setProject] = useState<ScannedProject | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showNgrokSetup, setShowNgrokSetup] = useState(false);
    const [processingStep, setProcessingStep] = useState<ProcessingStep>('idle');
    const [processingMessage, setProcessingMessage] = useState('');
    const [showTerminal, setShowTerminal] = useState(false);
    const [saveToProject, setSaveToProject] = useState(false); // Whether to save Docker files to user's project

    const handlePortChange = (index: number, newPort: string) => {
        if (!project) return;

        const portNum = parseInt(newPort);
        if (isNaN(portNum)) return;

        const newStructure = [...project.structure];
        newStructure[index] = {
            ...newStructure[index],
            port: portNum
        };

        setProject({
            ...project,
            structure: newStructure
        });
    };

    const handleSelectFolder = async () => {
        setError(null);
        const result = await window.electronAPI.selectFolder();

        if (result.success && result.path) {
            setIsScanning(true);
            const scanResult = await window.electronAPI.scanProject(result.path);
            setIsScanning(false);

            if (scanResult.success && scanResult.project) {
                setProject(scanResult.project as ScannedProject);
            } else {
                setError(scanResult.error || 'Failed to scan project');
            }
        }
    };

    const handleProcess = async () => {
        if (!project) return;

        // Check if ngrok is configured
        const ngrokKey = await window.electronAPI.getNgrokKey();
        if (!ngrokKey) {
            setShowNgrokSetup(true);
            return;
        }

        await startProcessing();
    };

    const handleNgrokComplete = async (_key: string) => {
        setShowNgrokSetup(false);
        await startProcessing();
    };

    const saveAndNavigate = (projectToSave: ScannedProject, dockerDir: string, isTemporary: boolean = false, generatedFiles: string[] = []) => {
        // Step 4: Done - add project and navigate
        setProcessingStep('done');
        setProcessingMessage('Setup complete!');

        if (onProjectAdded) {
            onProjectAdded({
                ...projectToSave,
                dockerDir,
                isTemporary,
                generatedFiles
            });
        }

        // Reset state
        setProject(null);
        setProcessingStep('idle');
        setSaveToProject(false); // Reset checkbox for next project
    };

    const generateNewConfig = async (projectWithId: ScannedProject & { id: string }) => {
        setProcessingStep('generating');
        setProcessingMessage('Generating Docker configuration...');

        const genResult = await window.electronAPI.generateDockerFiles(projectWithId);
        if (!genResult.success) {
            throw new Error(genResult.error || 'Failed to generate Docker files');
        }

        const dockerDir = genResult.dockerDir!;
        const generatedFiles = genResult.files?.map(f => f.path) || [];

        // Build
        setProcessingStep('building');
        setProcessingMessage('Building Docker containers...');
        setShowTerminal(true);
        const buildResult = await window.electronAPI.dockerBuild(dockerDir);

        if (!buildResult.success) {
            throw new Error('Docker build failed. Check terminal for details.');
        }

        // Apply to project only if user requested
        if (saveToProject) {
            setProcessingMessage('Saving configuration to project...');
            await window.electronAPI.applyDockerToProject(projectWithId, dockerDir);
        }

        saveAndNavigate(projectWithId, dockerDir, !saveToProject, generatedFiles);
    };

    const startProcessing = async () => {
        if (!project) return;

        try {
            const projectWithId = {
                ...project,
                id: Date.now().toString()
            };

            let dockerDir: string;

            if (project.hasDockerfile) {
                // ========== Has Docker → Check status ==========
                setProcessingStep('generating');
                setProcessingMessage('Using existing Docker configuration...');
                setShowTerminal(true);

                const existingResult = await window.electronAPI.setupExistingDocker(projectWithId);

                // Check if we need to regenerate our own old file
                if (existingResult.regenerate) {
                    setProcessingMessage('Updating stale configuration...');
                    await generateNewConfig(projectWithId);
                    return;
                }

                if (!existingResult.success) {
                    throw new Error(existingResult.error || 'Failed to setup existing Docker');
                }

                // Sidecar mode (user's own docker-compose)
                if (existingResult.useSidecar) {
                    saveAndNavigate(projectWithId, project.path, false, []);
                    return;
                }

                dockerDir = existingResult.dockerDir || project.path;

                // Build existing
                setProcessingStep('building');
                setProcessingMessage('Building Docker containers...');

                const buildResult = await window.electronAPI.dockerBuild(dockerDir);
                if (!buildResult.success) {
                    throw new Error('Docker build failed');
                }

                // Prompt to apply if successful
                const applyToProject = window.confirm('Docker files validated. Add to project?');
                if (applyToProject) {
                    await window.electronAPI.applyDockerToProject(projectWithId, dockerDir);
                }

                // Existing docker means it's not temporary
                saveAndNavigate(projectWithId, dockerDir, false, []);

            } else {
                // ========== No Docker → Generate New ==========
                await generateNewConfig(projectWithId);
                return; // generateNewConfig handles saving
            }

        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
            setProcessingStep('idle');
        }
    };

    const isProcessing = processingStep !== 'idle';

    return (
        <div className="project-upload-container">
            <div className="upload-header">
                <h1 className="upload-title">Add New Project</h1>
                <p className="upload-subtitle">Select a project folder to get started</p>
            </div>

            {!project ? (
                <div className="drop-zone" onClick={handleSelectFolder}>
                    <div className="drop-zone-icon">📁</div>
                    <div className="drop-zone-text">Click to select your project folder</div>
                    <div className="drop-zone-hint">
                        We'll automatically detect frontend/backend structure, tech stack, and databases
                    </div>
                    <button className="select-btn" onClick={(e) => { e.stopPropagation(); handleSelectFolder(); }}>
                        Select Folder
                    </button>
                </div>
            ) : (
                <div className="project-card">
                    <div className="project-card-header">
                        <div>
                            <div className="project-name">📦 {project.name}</div>
                            <div className="project-path">{project.path}</div>
                        </div>
                        {!isProcessing && (
                            <button className="change-folder-btn" onClick={handleSelectFolder}>
                                Change Folder
                            </button>
                        )}
                    </div>

                    <div className="structure-list">
                        {project.structure.map((item, index) => (
                            <div key={index} className="structure-item">
                                <div className="structure-item-header">
                                    <span className={`structure-type-badge ${item.type}`}>
                                        {item.type}
                                    </span>
                                    <span className="structure-name">{item.name}</span>
                                </div>
                                <div className="tech-stack-list">
                                    {item.techStacks.map((tech, techIndex) => (
                                        <span key={techIndex} className="tech-badge">
                                            <span className="tech-icon">{tech.icon}</span>
                                            {tech.name}
                                        </span>
                                    ))}
                                </div>
                                <div className="port-config" style={{ marginTop: '10px' }}>
                                    <label style={{ fontSize: '0.85em', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        Internal Port:
                                        <input
                                            type="number"
                                            value={item.port || ''}
                                            onChange={(e) => handlePortChange(index, e.target.value)}
                                            disabled={isProcessing}
                                            style={{
                                                width: '80px',
                                                padding: '4px 8px',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: '4px',
                                                fontSize: '1em'
                                            }}
                                        />
                                        <span style={{ fontSize: '0.85em', color: '#94a3b8' }}>(Edit if specific port needed)</span>
                                    </label>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Databases Section */}
                    {project.databases && project.databases.length > 0 && (
                        <div className="databases-section">
                            <div className="databases-title">🗄️ Detected Databases</div>
                            <div className="databases-list">
                                {project.databases.map((db, index) => (
                                    <span key={index} className="database-badge">
                                        <span className="db-icon">{db.icon}</span>
                                        {db.name}
                                        {db.image && <span className="db-image">({db.image})</span>}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {project.hasDockerfile ? (
                        <div className="docker-badge">
                            🐳 Dockerfile detected - Will use existing configuration
                        </div>
                    ) : (
                        <div className="docker-options" style={{ marginTop: '15px', padding: '10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
                                <input
                                    type="checkbox"
                                    checked={saveToProject}
                                    onChange={(e) => setSaveToProject(e.target.checked)}
                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                />
                                <div>
                                    <div style={{ fontWeight: 500, color: '#334155' }}>Save Docker files to my project</div>
                                    <div style={{ fontSize: '0.85em', color: '#64748b', marginTop: '2px' }}>
                                        If unchecked, files will be temporary and deleted when you remove the project.
                                    </div>
                                </div>
                            </label>
                        </div>
                    )}

                    {isProcessing && (
                        <div className="processing-status">
                            <div className="processing-spinner"></div>
                            <span>{processingMessage}</span>
                        </div>
                    )}

                    <div className="action-buttons">
                        <button
                            className="deploy-btn"
                            onClick={handleProcess}
                            disabled={isProcessing}
                        >
                            {isProcessing ? '⏳ Processing...' : '🚀 Process & Deploy'}
                        </button>
                    </div>

                    {showTerminal && (
                        <div className="terminal-wrapper" style={{ marginTop: '20px' }}>
                            <Terminal
                                publicUrl={null}
                                isRunning={isProcessing}
                                onStop={() => setShowTerminal(false)} // Use Stop to close/hide for now
                                onOpenUrl={() => { }}
                            />
                        </div>
                    )}
                </div>
            )}

            {error && (
                <div style={{ textAlign: 'center', color: '#ef4444', marginTop: '20px' }}>
                    ❌ {error}
                </div>
            )}

            {isScanning && (
                <div className="scanning-overlay">
                    <div className="scanning-content">
                        <div className="scanning-spinner">🔍</div>
                        <div>Scanning project structure...</div>
                    </div>
                </div>
            )}

            {showNgrokSetup && (
                <NgrokSetup
                    onComplete={handleNgrokComplete}
                    onCancel={() => setShowNgrokSetup(false)}
                />
            )}
        </div>
    );
}
