const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    checkDependency: (dep) => ipcRenderer.invoke('check-dependency', dep),
    installDependency: (dep) => ipcRenderer.invoke('install-dependency', dep),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    onInstallOutput: (callback) => ipcRenderer.on('install-output', (event, data) => callback(data)),
    removeInstallOutputListener: () => ipcRenderer.removeAllListeners('install-output'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanProject: (path) => ipcRenderer.invoke('scan-project', path),
    getStoredData: (key) => ipcRenderer.invoke('get-stored-data', key),
    setStoredData: (key, value) => ipcRenderer.invoke('set-stored-data', key, value),
    clearAllProjects: () => ipcRenderer.invoke('clear-all-projects'),
    // Ngrok
    checkNgrokConfigured: () => ipcRenderer.invoke('check-ngrok-configured'),
    setupNgrokKey: (key) => ipcRenderer.invoke('setup-ngrok-key', key),
    getNgrokKey: () => ipcRenderer.invoke('get-ngrok-key'),
    // Docker
    generateDockerFiles: (project) => ipcRenderer.invoke('generate-docker-files', project),
    applyDockerToProject: (project, dockerDir) => ipcRenderer.invoke('apply-docker-to-project', project, dockerDir),
    dockerBuild: (dockerDir) => ipcRenderer.invoke('docker-build', dockerDir),
    dockerUp: (dockerDir) => ipcRenderer.invoke('docker-up', dockerDir),
    dockerDown: (dockerDir) => ipcRenderer.invoke('docker-down', dockerDir),
    getNgrokUrl: (apiPort) => ipcRenderer.invoke('get-ngrok-url', apiPort),
    onDockerOutput: (callback) => ipcRenderer.on('docker-output', (event, data) => callback(data)),
    removeDockerOutputListener: () => ipcRenderer.removeAllListeners('docker-output'),
    // Existing Docker
    setupExistingDocker: (project) => ipcRenderer.invoke('setup-existing-docker', project),
    startNgrokTunnel: (port) => ipcRenderer.invoke('start-ngrok-tunnel', port),
    stopNgrokTunnel: (pid) => ipcRenderer.invoke('stop-ngrok-tunnel', pid),
    // Port Conflict Detection
    checkPortInUse: (port) => ipcRenderer.invoke('check-port-in-use', port),
    findAvailablePort: (startPort) => ipcRenderer.invoke('find-available-port', startPort),
    killPortProcess: (port) => ipcRenderer.invoke('kill-port-process', port),
    checkPortInUse: (port) => ipcRenderer.invoke('check-port-in-use', port),
    findAvailablePort: (startPort) => ipcRenderer.invoke('find-available-port', startPort),
    killPortProcess: (port) => ipcRenderer.invoke('kill-port-process', port),
    updateDockerPorts: (dockerDir, portMappings) => ipcRenderer.invoke('update-docker-ports', dockerDir, portMappings),
    getDockerPorts: (dockerDir) => ipcRenderer.invoke('get-docker-ports', dockerDir),
    // Cleanup
    cleanupProjectFiles: (project) => ipcRenderer.invoke('cleanup-project-files', project),
});


