// Shared types for the Electron API

export interface TechStack {
    name: string;
    type: string;
    icon: string;
}

export interface Database {
    name: string;
    icon: string;
    image: string | null;
}

export interface StructureItem {
    name: string;
    type: 'frontend' | 'backend' | 'root';
    path: string;
    techStacks: TechStack[];
    databases?: Database[];
}

export interface Project {
    id: string;
    path: string;
    name: string;
    structure: StructureItem[];
    databases: Database[];
    hasDockerfile: boolean;
    status: 'stopped' | 'running';
    addedAt: string;
    dockerDir?: string;
    publicUrl?: string;
    isTemporary?: boolean; // If true, Docker files are only in app's folder (not copied to project)
    generatedFiles?: string[]; // List of files we generated (absolute paths)
}

export interface ScannedProject {
    path: string;
    name: string;
    structure: StructureItem[];
    databases: Database[];
    hasDockerfile: boolean;
}

export interface DependencyResult {
    installed: boolean;
    version: string | null;
}

export interface GeneratedDockerFile {
    type: string;
    path: string;
    content: string;
}

declare global {
    interface Window {
        electronAPI: {
            // Platform & Dependencies
            getPlatform: () => Promise<string>;
            checkDependency: (dep: string) => Promise<DependencyResult>;
            installDependency: (dep: string) => Promise<{ success: boolean; error?: string }>;
            openExternal: (url: string) => Promise<void>;
            onInstallOutput: (callback: (data: { dep: string; data: string }) => void) => void;
            removeInstallOutputListener: () => void;

            // Project Management
            selectFolder: () => Promise<{ success: boolean; path: string | null }>;
            scanProject: (path: string) => Promise<{ success: boolean; project?: ScannedProject; error?: string }>;

            // Storage
            getStoredData: (key: string) => Promise<unknown>;
            setStoredData: (key: string, value: unknown) => Promise<{ success: boolean }>;
            clearAllProjects: () => Promise<{ success: boolean }>;

            // Ngrok
            checkNgrokConfigured: () => Promise<{ configured: boolean }>;
            setupNgrokKey: (key: string) => Promise<{ success: boolean; error?: string }>;
            getNgrokKey: () => Promise<string | null>;
            getNgrokUrl: (apiPort?: number) => Promise<{ success: boolean; url?: string; error?: string }>;

            // Docker
            generateDockerFiles: (project: { id: string; structure: StructureItem[]; databases?: Database[] }) => Promise<{ success: boolean; dockerDir?: string; files?: GeneratedDockerFile[]; error?: string }>;
            applyDockerToProject: (project: { path: string; structure: StructureItem[] }, dockerDir: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
            dockerBuild: (dockerDir: string) => Promise<{ success: boolean; code?: number }>;
            dockerUp: (dockerDir: string) => Promise<{ success: boolean; running?: boolean; code?: number }>;
            dockerDown: (dockerDir: string) => Promise<{ success: boolean }>;
            onDockerOutput: (callback: (data: { type: string; data: string }) => void) => void;
            removeDockerOutputListener: () => void;
            // Existing Docker
            setupExistingDocker: (project: ScannedProject) => Promise<{ success: boolean; dockerDir?: string; hasExistingCompose?: boolean; ngrokCommand?: string; error?: string; regenerate?: boolean; useSidecar?: boolean }>;
            startNgrokTunnel: (port: number) => Promise<{ success: boolean; url?: string; pid?: number; error?: string }>;
            stopNgrokTunnel: (pid?: number) => Promise<{ success: boolean }>;
            // Port Conflict Detection
            checkPortInUse: (port: number) => Promise<{ inUse: boolean; pid?: number; processName?: string; pids?: number[] }>;
            findAvailablePort: (startPort: number) => Promise<{ success: boolean; port?: number; error?: string }>;
            getDockerPorts: (dockerDir: string) => Promise<{ success: boolean; ports?: number[]; ngrokApiPort?: number; error?: string }>;
            updateDockerPorts: (dockerDir: string, mappings: { oldPort: number; newPort: number }[]) => Promise<{ success: boolean; error?: string }>;
            // Cleanup
            cleanupProjectFiles: (project: { id: string; dockerDir?: string; generatedFiles?: string[]; isTemporary?: boolean }) => Promise<{ success: boolean; deletedFiles?: string[]; error?: string }>;
        };
    }
}

export { };
