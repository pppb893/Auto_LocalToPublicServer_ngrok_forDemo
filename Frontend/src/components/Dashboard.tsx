import { useState, useEffect } from 'react';
import './Dashboard.css';
import ProjectUpload from './ProjectUpload';
import ProjectsList from './ProjectsList';
import type { Project, ScannedProject } from '../types/electron';

export default function Dashboard() {
    const [activeTab, setActiveTab] = useState<'upload' | 'projects'>('upload');
    const [projects, setProjects] = useState<Project[]>([]);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        const stored = await window.electronAPI.getStoredData('projects');
        if (Array.isArray(stored)) {
            setProjects(stored as Project[]);
        }
    };

    const saveProjects = async (newProjects: Project[]) => {
        setProjects(newProjects);
        await window.electronAPI.setStoredData('projects', newProjects);
    };

    const handleProjectAdded = (scannedProject: ScannedProject & {
        dockerDir?: string;
        isTemporary?: boolean;
        generatedFiles?: string[];
    }) => {
        // Check for duplicate project (same path)
        const isDuplicate = projects.some(p => p.path === scannedProject.path);
        if (isDuplicate) {
            alert('This project is already added. Please select a different project.');
            return;
        }

        const newProject: Project = {
            ...scannedProject,
            id: Date.now().toString(),
            status: 'stopped',
            addedAt: new Date().toISOString(),
            dockerDir: scannedProject.dockerDir,
        };
        saveProjects([...projects, newProject]);
        setActiveTab('projects');
    };

    const handleRemoveProject = async (id: string) => {
        const projectToRemove = projects.find(p => p.id === id);
        if (projectToRemove) {
            // Clean up any generated files
            await window.electronAPI.cleanupProjectFiles(projectToRemove);

            // If running, stop it
            if (projectToRemove.status === 'running' && projectToRemove.dockerDir) {
                await window.electronAPI.dockerDown(projectToRemove.dockerDir);
            }
        }

        saveProjects(projects.filter(p => p.id !== id));
    };

    const handleToggleStatus = (id: string) => {
        saveProjects(projects.map(p =>
            p.id === id
                ? { ...p, status: p.status === 'running' ? 'stopped' : 'running' }
                : p
        ));
    };

    const handleUpdateProject = (updatedProject: Project) => {
        saveProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
    };

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <h1 className="dashboard-title">🚀 LocalDeploy</h1>
                <nav className="tab-nav">
                    <button
                        className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
                        onClick={() => setActiveTab('upload')}
                    >
                        📁 Upload
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`}
                        onClick={() => setActiveTab('projects')}
                    >
                        📦 Projects ({projects.length})
                    </button>
                </nav>
            </header>

            <main className="dashboard-content">
                {activeTab === 'upload' && (
                    <ProjectUpload onProjectAdded={handleProjectAdded} />
                )}
                {activeTab === 'projects' && (
                    <ProjectsList
                        projects={projects}
                        onRemove={handleRemoveProject}
                        onToggleStatus={handleToggleStatus}
                        onUpdateProject={handleUpdateProject}
                        onClearAll={async () => {
                            // Clean up all projects
                            for (const p of projects) {
                                await window.electronAPI.cleanupProjectFiles(p);
                                if (p.status === 'running' && p.dockerDir) {
                                    await window.electronAPI.dockerDown(p.dockerDir);
                                }
                            }
                            await window.electronAPI.clearAllProjects();
                            setProjects([]);
                        }}
                    />
                )}
            </main>
        </div>
    );
}
