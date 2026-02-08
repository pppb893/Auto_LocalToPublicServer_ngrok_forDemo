const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { getDockerfileForTech, generateDockerCompose, yamlStringify } = require('./dockerGenerator.cjs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;

    console.log('Loading URL:', startUrl);
    mainWindow.loadURL(startUrl);

    if (process.env.ELECTRON_START_URL) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

// IPC Handlers for Dependency Checks
ipcMain.handle('get-platform', () => {
    return process.platform; // 'win32', 'linux', 'darwin'
});

ipcMain.handle('check-dependency', async (event, dep) => {
    const checkCommand = (cmd) => {
        return new Promise((resolve) => {
            exec(`${cmd} --version`, (error, stdout) => {
                if (error) {
                    resolve({ installed: false, version: null });
                } else {
                    resolve({ installed: true, version: stdout.trim().split('\n')[0] });
                }
            });
        });
    };

    switch (dep) {
        case 'docker':
            return await checkCommand('docker');
        case 'ngrok':
            return await checkCommand('ngrok');
        case 'node':
            return await checkCommand('node');
        default:
            return { installed: false, version: null };
    }
});

ipcMain.handle('install-dependency', async (event, dep) => {
    const platform = process.platform;

    const installCommands = {
        docker: {
            linux: 'curl -fsSL https://get.docker.com | sudo sh',
            win32: 'winget install Docker.DockerDesktop',
        },
        ngrok: {
            linux: 'wget -qO- https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz | sudo tar xvz -C /usr/local/bin',
            win32: 'winget install ngrok.ngrok',
        },
        node: {
            linux: 'curl -fsSL https://nodejs.org/dist/v20.11.0/node-v20.11.0-linux-x64.tar.xz | sudo tar -xJ -C /usr/local --strip-components=1',
            win32: 'winget install OpenJS.NodeJS.LTS',
        },
    };

    if (!installCommands[dep] || !installCommands[dep][platform]) {
        return { success: false, error: `No install command for ${dep} on ${platform}` };
    }

    const command = installCommands[dep][platform];

    if (platform === 'linux') {
        // Open external terminal so user can enter sudo password
        const terminalCmd = `gnome-terminal -- bash -c "${command}; echo ''; echo 'Press Enter to close...'; read"`;

        return new Promise((resolve) => {
            exec(terminalCmd, (error) => {
                if (error) {
                    // Try xterm as fallback
                    const xtermCmd = `xterm -hold -e "${command}"`;
                    exec(xtermCmd, (err2) => {
                        if (err2) {
                            mainWindow.webContents.send('install-output', {
                                dep,
                                data: `Could not open terminal. Please run manually:\n${command}\n`
                            });
                            resolve({ success: false, error: 'Could not open terminal' });
                        } else {
                            resolve({ success: true, output: 'Opened in external terminal' });
                        }
                    });
                } else {
                    mainWindow.webContents.send('install-output', {
                        dep,
                        data: `Installation opened in external terminal.\nPlease enter your password if prompted.\n\nCommand: ${command}\n`
                    });
                    resolve({ success: true, output: 'Opened in external terminal' });
                }
            });
        });
    } else if (platform === 'win32') {
        // Download page fallbacks
        const downloadPages = {
            docker: 'https://www.docker.com/products/docker-desktop/',
            ngrok: 'https://ngrok.com/download',
            node: 'https://nodejs.org/en/download/',
        };

        // First check if winget exists
        return new Promise((resolve) => {
            exec('winget --version', (wingetError) => {
                if (wingetError) {
                    // winget not available, open download page
                    mainWindow.webContents.send('install-output', {
                        dep,
                        data: `winget not available on this system.\nOpening download page...\n`
                    });
                    shell.openExternal(downloadPages[dep]);
                    resolve({ success: true, output: 'Opened download page' });
                } else {
                    // winget available, try to install
                    const psCmd = `powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList 'winget install ${dep === 'docker' ? 'Docker.DockerDesktop' : dep === 'ngrok' ? 'ngrok.ngrok' : 'OpenJS.NodeJS.LTS'}; pause'"`;

                    exec(psCmd, (error) => {
                        if (error) {
                            // PowerShell failed, open download page
                            mainWindow.webContents.send('install-output', {
                                dep,
                                data: `Could not run winget. Opening download page instead...\n`
                            });
                            shell.openExternal(downloadPages[dep]);
                            resolve({ success: true, output: 'Opened download page' });
                        } else {
                            mainWindow.webContents.send('install-output', {
                                dep,
                                data: `Installation opened in PowerShell.\nPlease approve UAC prompt if shown.\n\nUsing: winget install\n`
                            });
                            resolve({ success: true, output: 'Opened in PowerShell' });
                        }
                    });
                }
            });
        });
    } else {
        return { success: false, error: `Unsupported platform: ${platform}` };
    }
});

ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
});

// Folder selection dialog
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Project Folder'
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, path: null };
    }

    return { success: true, path: result.filePaths[0] };
});

// Detect databases from a directory
function detectDatabases(dirPath) {
    const files = fs.readdirSync(dirPath);
    const databases = [];

    const addDb = (name, icon, image) => {
        if (!databases.find(d => d.name === name)) {
            databases.push({ name, icon, image });
        }
    };

    // ========== Node.js (package.json) ==========
    if (files.includes('package.json')) {
        try {
            const pkgPath = path.join(dirPath, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            if (deps['mysql'] || deps['mysql2']) addDb('MySQL', '🐬', 'mysql:8');
            if (deps['pg'] || deps['postgres'] || deps['postgresql']) addDb('PostgreSQL', '🐘', 'postgres:15');
            if (deps['mongoose'] || deps['mongodb']) addDb('MongoDB', '🍃', 'mongo:6');
            if (deps['redis'] || deps['ioredis']) addDb('Redis', '🔴', 'redis:7');
            if (deps['sqlite3'] || deps['better-sqlite3']) addDb('SQLite', '📁', null);
        } catch (e) { /* ignore */ }
    }

    // ========== Python (requirements.txt, pyproject.toml) ==========
    const pythonFiles = ['requirements.txt', 'pyproject.toml', 'Pipfile'];
    for (const pyFile of pythonFiles) {
        if (files.includes(pyFile)) {
            try {
                const content = fs.readFileSync(path.join(dirPath, pyFile), 'utf8').toLowerCase();
                if (content.includes('mysqlclient') || content.includes('pymysql') || content.includes('mysql-connector')) addDb('MySQL', '🐬', 'mysql:8');
                if (content.includes('psycopg') || content.includes('asyncpg') || content.includes('pg8000')) addDb('PostgreSQL', '🐘', 'postgres:15');
                if (content.includes('pymongo') || content.includes('motor')) addDb('MongoDB', '🍃', 'mongo:6');
                if (content.includes('redis') || content.includes('aioredis')) addDb('Redis', '🔴', 'redis:7');
                if (content.includes('sqlite') || content.includes('aiosqlite') || content.includes('sqlalchemy')) addDb('SQLite', '📁', null);
            } catch (e) { /* ignore */ }
        }
    }

    // ========== Go (go.mod) ==========
    if (files.includes('go.mod')) {
        try {
            const content = fs.readFileSync(path.join(dirPath, 'go.mod'), 'utf8').toLowerCase();
            if (content.includes('mysql') || content.includes('go-sql-driver')) addDb('MySQL', '🐬', 'mysql:8');
            if (content.includes('pq') || content.includes('pgx') || content.includes('lib/pq')) addDb('PostgreSQL', '🐘', 'postgres:15');
            if (content.includes('mongo')) addDb('MongoDB', '🍃', 'mongo:6');
            if (content.includes('redis') || content.includes('go-redis')) addDb('Redis', '🔴', 'redis:7');
            if (content.includes('sqlite') || content.includes('go-sqlite3') || content.includes('mattn')) addDb('SQLite', '📁', null);
            // GORM drivers
            if (content.includes('gorm.io/driver/mysql')) addDb('MySQL', '🐬', 'mysql:8');
            if (content.includes('gorm.io/driver/postgres')) addDb('PostgreSQL', '🐘', 'postgres:15');
            if (content.includes('gorm.io/driver/sqlite')) addDb('SQLite', '📁', null);
        } catch (e) { /* ignore */ }
    }

    // ========== Java (pom.xml, build.gradle) ==========
    if (files.includes('pom.xml')) {
        try {
            const content = fs.readFileSync(path.join(dirPath, 'pom.xml'), 'utf8').toLowerCase();
            if (content.includes('mysql-connector') || content.includes('mysql:mysql')) addDb('MySQL', '🐬', 'mysql:8');
            if (content.includes('postgresql') || content.includes('org.postgresql')) addDb('PostgreSQL', '🐘', 'postgres:15');
            if (content.includes('mongodb') || content.includes('mongo-java-driver')) addDb('MongoDB', '🍃', 'mongo:6');
            if (content.includes('jedis') || content.includes('lettuce') || content.includes('spring-data-redis')) addDb('Redis', '🔴', 'redis:7');
            if (content.includes('sqlite') || content.includes('xerial')) addDb('SQLite', '📁', null);
        } catch (e) { /* ignore */ }
    }
    if (files.includes('build.gradle') || files.includes('build.gradle.kts')) {
        try {
            const gradleFile = files.includes('build.gradle') ? 'build.gradle' : 'build.gradle.kts';
            const content = fs.readFileSync(path.join(dirPath, gradleFile), 'utf8').toLowerCase();
            if (content.includes('mysql-connector') || content.includes('mysql:mysql')) addDb('MySQL', '🐬', 'mysql:8');
            if (content.includes('postgresql') || content.includes('org.postgresql')) addDb('PostgreSQL', '🐘', 'postgres:15');
            if (content.includes('mongodb') || content.includes('mongo')) addDb('MongoDB', '🍃', 'mongo:6');
            if (content.includes('jedis') || content.includes('lettuce') || content.includes('redis')) addDb('Redis', '🔴', 'redis:7');
            if (content.includes('sqlite') || content.includes('xerial')) addDb('SQLite', '📁', null);
        } catch (e) { /* ignore */ }
    }

    // ========== PHP (composer.json) ==========
    if (files.includes('composer.json')) {
        try {
            const content = fs.readFileSync(path.join(dirPath, 'composer.json'), 'utf8').toLowerCase();
            if (content.includes('mysql') || content.includes('pdo_mysql') || content.includes('doctrine/dbal')) addDb('MySQL', '🐬', 'mysql:8');
            if (content.includes('postgresql') || content.includes('pdo_pgsql') || content.includes('pgsql')) addDb('PostgreSQL', '🐘', 'postgres:15');
            if (content.includes('mongodb') || content.includes('mongo')) addDb('MongoDB', '🍃', 'mongo:6');
            if (content.includes('predis') || content.includes('phpredis') || content.includes('redis')) addDb('Redis', '🔴', 'redis:7');
            if (content.includes('sqlite') || content.includes('pdo_sqlite')) addDb('SQLite', '📁', null);
        } catch (e) { /* ignore */ }
    }

    // ========== Rust (Cargo.toml) ==========
    if (files.includes('Cargo.toml')) {
        try {
            const content = fs.readFileSync(path.join(dirPath, 'Cargo.toml'), 'utf8').toLowerCase();
            if (content.includes('mysql') || content.includes('sqlx') && content.includes('mysql')) addDb('MySQL', '🐬', 'mysql:8');
            if (content.includes('postgres') || content.includes('tokio-postgres') || content.includes('sqlx') && content.includes('postgres')) addDb('PostgreSQL', '🐘', 'postgres:15');
            if (content.includes('mongodb')) addDb('MongoDB', '🍃', 'mongo:6');
            if (content.includes('redis')) addDb('Redis', '🔴', 'redis:7');
            if (content.includes('sqlite') || content.includes('rusqlite') || content.includes('sqlx') && content.includes('sqlite')) addDb('SQLite', '📁', null);
        } catch (e) { /* ignore */ }
    }

    return databases;
}


// Detect tech stack from a directory
function detectTechStack(dirPath) {
    const files = fs.readdirSync(dirPath);
    const techStacks = [];

    // Check for package.json
    if (files.includes('package.json')) {
        try {
            const pkgPath = path.join(dirPath, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            if (deps['next']) techStacks.push({ name: 'Next.js', type: 'fullstack', icon: '⚡' });
            else if (deps['react']) techStacks.push({ name: 'React', type: 'frontend', icon: '⚛️' });
            else if (deps['vue']) techStacks.push({ name: 'Vue.js', type: 'frontend', icon: '💚' });
            else if (deps['svelte']) techStacks.push({ name: 'Svelte', type: 'frontend', icon: '🔥' });
            else if (deps['express']) techStacks.push({ name: 'Express', type: 'backend', icon: '🚀' });
            else if (deps['fastify']) techStacks.push({ name: 'Fastify', type: 'backend', icon: '⚡' });
            else if (deps['nestjs'] || deps['@nestjs/core']) techStacks.push({ name: 'NestJS', type: 'backend', icon: '🐱' });
            else techStacks.push({ name: 'Node.js', type: 'backend', icon: '📦' });
        } catch (e) {
            techStacks.push({ name: 'Node.js', type: 'unknown', icon: '📦' });
        }
    }

    // Check for Go
    if (files.includes('go.mod')) {
        techStacks.push({ name: 'Go', type: 'backend', icon: '🐹' });
    }

    // Check for Python
    if (files.includes('requirements.txt') || files.includes('pyproject.toml') || files.includes('Pipfile')) {
        if (files.includes('manage.py')) {
            techStacks.push({ name: 'Django', type: 'backend', icon: '🐍' });
        } else {
            techStacks.push({ name: 'Python', type: 'backend', icon: '🐍' });
        }
    }

    // Check for Rust
    if (files.includes('Cargo.toml')) {
        techStacks.push({ name: 'Rust', type: 'backend', icon: '🦀' });
    }

    // Check for Java
    if (files.includes('pom.xml') || files.includes('build.gradle')) {
        techStacks.push({ name: 'Java', type: 'backend', icon: '☕' });
    }

    // Check for PHP
    if (files.includes('composer.json')) {
        techStacks.push({ name: 'PHP', type: 'backend', icon: '🐘' });
    }

    // Check for static HTML
    if (files.includes('index.html') && techStacks.length === 0) {
        techStacks.push({ name: 'Static HTML', type: 'frontend', icon: '📄' });
    }

    // Check for Dockerfile
    if (files.includes('Dockerfile') || files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) {
        techStacks.push({ name: 'Docker', type: 'containerized', icon: '🐳' });
    }

    return techStacks.length > 0 ? techStacks : [{ name: 'Unknown', type: 'unknown', icon: '❓' }];
}

// Scan project structure
// Helper to get default port based on tech stack
function getDefaultPort(techStacks, type) {
    if (type === 'backend') return 8080;
    if (type === 'frontend') {
        if (techStacks && techStacks.length > 0) {
            const tech = techStacks[0].name.toLowerCase();
            // Nginx based
            if (tech.includes('react') || tech.includes('vue') || tech.includes('svelte') ||
                tech.includes('static') || tech.includes('html')) {
                return 80;
            }
        }
        return 3000;
    }
    return 3000; // fallback
}

ipcMain.handle('scan-project', async (event, projectPath) => {
    try {
        const items = fs.readdirSync(projectPath, { withFileTypes: true });
        const directories = items.filter(item => item.isDirectory()).map(item => item.name);

        const result = {
            path: projectPath,
            name: path.basename(projectPath),
            structure: [],
            databases: [],
            hasDockerfile: fs.existsSync(path.join(projectPath, 'Dockerfile')) ||
                fs.existsSync(path.join(projectPath, 'docker-compose.yml'))
        };

        // Look for frontend/backend directories (case-insensitive)
        const frontendDir = directories.find(d => d.toLowerCase() === 'frontend');
        const backendDir = directories.find(d => d.toLowerCase() === 'backend');

        if (frontendDir) {
            const frontendPath = path.join(projectPath, frontendDir);
            const techStacks = await detectTechStack(frontendPath); // Assuming detectTechStack is async or sync? It's likely sync based on usage below
            result.structure.push({
                name: frontendDir,
                type: 'frontend',
                path: frontendPath,
                techStacks: techStacks,
                databases: detectDatabases(frontendPath),
                port: getDefaultPort(techStacks, 'frontend')
            });
            // Merge databases to project level
            result.databases.push(...detectDatabases(frontendPath));
        }

        if (backendDir) {
            const backendPath = path.join(projectPath, backendDir);
            const techStacks = await detectTechStack(backendPath);
            result.structure.push({
                name: backendDir,
                type: 'backend',
                path: backendPath,
                techStacks: techStacks,
                databases: detectDatabases(backendPath),
                port: getDefaultPort(techStacks, 'backend')
            });
            // Merge databases to project level
            result.databases.push(...detectDatabases(backendPath));
        }

        // If no frontend/backend structure, scan root
        if (result.structure.length === 0) {
            const rootDatabases = detectDatabases(projectPath);
            const techStacks = await detectTechStack(projectPath);
            result.structure.push({
                name: path.basename(projectPath),
                type: 'root',
                path: projectPath,
                techStacks: techStacks,
                databases: rootDatabases,
                port: getDefaultPort(techStacks, 'root')
            });
            result.databases.push(...rootDatabases);
        }

        // Deduplicate databases at project level
        result.databases = result.databases.filter((db, index, self) =>
            index === self.findIndex(d => d.name === db.name)
        );

        return { success: true, project: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Storage for persisting data
const storageFilePath = path.join(app.getPath('userData'), 'app-data.json');

function getStorageData() {
    try {
        if (fs.existsSync(storageFilePath)) {
            return JSON.parse(fs.readFileSync(storageFilePath, 'utf8'));
        }
    } catch (e) {
        console.error('Error reading storage:', e);
    }
    return {};
}

function saveStorageData(data) {
    try {
        fs.writeFileSync(storageFilePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error writing storage:', e);
    }
}

ipcMain.handle('get-stored-data', async (event, key) => {
    const data = getStorageData();
    return data[key] ?? null;
});

ipcMain.handle('set-stored-data', async (event, key, value) => {
    const data = getStorageData();
    data[key] = value;
    saveStorageData(data);
    return { success: true };
});

ipcMain.handle('clear-all-projects', async () => {
    const data = getStorageData();
    data.projects = [];
    saveStorageData(data);
    return { success: true };
});

// ========== Ngrok Setup ==========
ipcMain.handle('check-ngrok-configured', async () => {
    return new Promise((resolve) => {
        exec('ngrok config check', (error) => {
            resolve({ configured: !error });
        });
    });
});

ipcMain.handle('setup-ngrok-key', async (event, authToken) => {
    return new Promise((resolve) => {
        exec(`ngrok config add-authtoken ${authToken}`, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, error: stderr || error.message });
            } else {
                // Store the key in our app data as well
                const data = getStorageData();
                data.ngrokKey = authToken;
                saveStorageData(data);
                resolve({ success: true });
            }
        });
    });
});

ipcMain.handle('get-ngrok-key', async () => {
    const data = getStorageData();
    return data.ngrokKey || null;
});

// ========== Docker Generation & Execution ==========

// Get app's docker files directory
function getDockerDir(projectId) {
    const dockerDir = path.join(app.getPath('userData'), 'docker-files', projectId);
    if (!fs.existsSync(dockerDir)) {
        fs.mkdirSync(dockerDir, { recursive: true });
    }
    return dockerDir;
}

// Marker comment to identify files we generated
const GENERATED_MARKER = '# Generated by Auto_LocalToPublicServer_ngrok_forDemo - Safe to delete';

// Generate all Docker files for a project
ipcMain.handle('generate-docker-files', async (event, project) => {
    try {
        const dockerDir = getDockerDir(project.id);
        const ngrokKey = getStorageData().ngrokKey;

        if (!ngrokKey) {
            return { success: false, error: 'Ngrok key not configured' };
        }

        const generatedFiles = [];

        const hasBackend = project.structure.some(s => s.type === 'backend');

        // Generate Dockerfiles for each structure item (frontend/backend)
        for (const item of project.structure) {
            if (item.techStacks && item.techStacks.length > 0) {
                const dockerfileContent = getDockerfileForTech(item.techStacks[0], hasBackend);
                // Add marker at the top
                const dockerfile = `${GENERATED_MARKER}\n${dockerfileContent}`;
                const dockerfilePath = path.join(dockerDir, `Dockerfile.${item.type}`);
                fs.writeFileSync(dockerfilePath, dockerfile);
                generatedFiles.push({
                    type: item.type,
                    path: dockerfilePath,
                    content: dockerfile
                });
            }
        }

        // Generate docker-compose.yml with marker
        const composeConfig = generateDockerCompose(project, ngrokKey);
        const composeYaml = `${GENERATED_MARKER}\n${yamlStringify(composeConfig)}`;
        const composePath = path.join(dockerDir, 'docker-compose.yml');
        fs.writeFileSync(composePath, composeYaml);
        generatedFiles.push({
            type: 'docker-compose',
            path: composePath,
            content: composeYaml
        });

        return {
            success: true,
            dockerDir,
            files: generatedFiles
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Copy Docker files to user's project
ipcMain.handle('apply-docker-to-project', async (event, project, dockerDir) => {
    try {
        const files = fs.readdirSync(dockerDir);
        const copiedFiles = [];

        for (const file of files) {
            const src = path.join(dockerDir, file);
            let dest;

            if (file.includes('frontend')) {
                const frontendItem = project.structure.find(s => s.type === 'frontend');
                if (frontendItem) {
                    dest = path.join(frontendItem.path, 'Dockerfile');
                }
            } else if (file.includes('backend')) {
                const backendItem = project.structure.find(s => s.type === 'backend');
                if (backendItem) {
                    dest = path.join(backendItem.path, 'Dockerfile');
                }
            } else if (file === 'docker-compose.yml') {
                dest = path.join(project.path, 'docker-compose.yml');
            }

            if (dest) {
                fs.copyFileSync(src, dest);
                copiedFiles.push(dest);
            }
        }

        return { success: true, files: copiedFiles };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Update Docker ports in docker-compose.yml
ipcMain.handle('update-docker-ports', async (event, dockerDir, portMappings) => {
    try {
        const composePath = path.join(dockerDir, 'docker-compose.yml');
        if (!fs.existsSync(composePath)) {
            return { success: false, error: 'docker-compose.yml not found' };
        }

        let content = fs.readFileSync(composePath, 'utf8');

        // portMappings = [{ oldPort: 8080, newPort: 8081 }]
        for (const mapping of portMappings) {
            const { oldPort, newPort } = mapping;
            // Regex to match "- 8080:80" or "- '8080:8080'" or "- "8080:80""
            // Captures: $1 (prefix), $2 (container port and suffix)
            const regex = new RegExp(`(-\\s*["']?)${oldPort}(:\\d+["']?)`, 'g');
            content = content.replace(regex, `$1${newPort}$2`);
        }

        fs.writeFileSync(composePath, content);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Get ports from docker-compose.yml
// Get ports from docker-compose.yml with details
ipcMain.handle('get-docker-ports', async (event, dockerDir) => {
    try {
        const composePath = path.join(dockerDir, 'docker-compose.yml');
        if (!fs.existsSync(composePath)) {
            return { success: false, error: 'docker-compose.yml not found' };
        }

        const content = fs.readFileSync(composePath, 'utf8');
        const ports = [];
        const matches = [];

        // Regex to match "- '8080:80'" or "- 8080:80"
        // Captures: 1=HostPort, 2=ContainerPort
        const regex = /-\s*["']?(\d+):(\d+)["']?/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            const hostPort = parseInt(match[1]);
            const containerPort = parseInt(match[2]);
            ports.push(hostPort);
            matches.push({ hostPort, containerPort });
        }

        // Find the Ngrok API port (mapped to container port 4040)
        // Default to 4040 if not found explicitly
        const ngrokApiMatch = matches.find(m => m.containerPort === 4040);
        const ngrokApiPort = ngrokApiMatch ? ngrokApiMatch.hostPort : 4040;

        return {
            success: true,
            ports: [...new Set(ports)], // Unique host ports
            ngrokApiPort // Explicitly return the port to query for Ngrok API
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Build Docker containers
let buildProcess = null;
ipcMain.handle('docker-build', async (event, dockerDir) => {
    return new Promise((resolve) => {
        buildProcess = spawn('docker-compose', ['build'], {
            cwd: dockerDir,
            shell: true
        });

        buildProcess.stdout.on('data', (data) => {
            mainWindow.webContents.send('docker-output', { type: 'stdout', data: data.toString() });
        });

        buildProcess.stderr.on('data', (data) => {
            mainWindow.webContents.send('docker-output', { type: 'stderr', data: data.toString() });
        });

        buildProcess.on('close', (code) => {
            buildProcess = null;
            resolve({ success: code === 0, code });
        });
    });
});

// Run Docker containers
let runProcess = null;
ipcMain.handle('docker-up', async (event, dockerDir) => {
    return new Promise((resolve) => {
        runProcess = spawn('docker-compose', ['up'], {
            cwd: dockerDir,
            shell: true
        });

        runProcess.stdout.on('data', (data) => {
            mainWindow.webContents.send('docker-output', { type: 'stdout', data: data.toString() });
        });

        runProcess.stderr.on('data', (data) => {
            mainWindow.webContents.send('docker-output', { type: 'stderr', data: data.toString() });
        });

        runProcess.on('close', (code) => {
            runProcess = null;
            resolve({ success: code === 0, code });
        });

        // Resolve immediately since docker-compose up runs indefinitely
        setTimeout(() => resolve({ success: true, running: true }), 2000);
    });
});

// Stop Docker containers
ipcMain.handle('docker-down', async (event, dockerDir) => {
    return new Promise((resolve) => {
        exec('docker-compose down', { cwd: dockerDir }, (error) => {
            if (runProcess) {
                runProcess.kill();
                runProcess = null;
            }
            resolve({ success: !error });
        });
    });
});

// Get public ngrok URL
ipcMain.handle('get-ngrok-url', async (event, apiPort = 4040) => {
    return new Promise((resolve) => {
        // Query the specific Ngrok Inspection API for this project
        exec(`curl -s http://localhost:${apiPort}/api/tunnels`, (error, stdout) => {
            if (error) {
                console.error('Ngrok API Error:', error);
                resolve({ success: false, error: error.message });
                return;
            }
            try {
                const data = JSON.parse(stdout);

                console.log(`Fetching Ngrok URL from localhost:${apiPort}`);
                console.log('Available Tunnels:', data.tunnels.map(t => ({
                    public: t.public_url,
                    addr: t.config ? t.config.addr : 'unknown'
                })));

                // Since we are querying the specific API for this project,
                // any HTTP/HTTPS tunnel found is likely the correct one.
                const tunnel = data.tunnels.find(t => t.proto === 'https') || data.tunnels[0];

                if (tunnel) {
                    console.log('Found matching tunnel:', tunnel.public_url);
                    resolve({ success: true, url: tunnel.public_url });
                } else {
                    console.log(`No tunnel found on localhost:${apiPort}`);
                    resolve({ success: false, error: 'No tunnel found' });
                }
            } catch (e) {
                console.error('Ngrok parse error:', e);
                resolve({ success: false, error: 'Failed to parse ngrok response' });
            }
        });
    });
});

// Use existing Docker config - just add ngrok
// Use existing Docker config - inject/update ngrok service for isolation
ipcMain.handle('setup-existing-docker', async (event, project) => {
    try {
        const ngrokKey = getStorageData().ngrokKey;
        if (!ngrokKey) {
            return { success: false, error: 'Ngrok key not configured' };
        }

        const composePath = path.join(project.path, 'docker-compose.yml');
        const composeYamlPath = path.join(project.path, 'docker-compose.yaml');
        let targetPath = fs.existsSync(composePath) ? composePath :
            fs.existsSync(composeYamlPath) ? composeYamlPath : null;

        // If no compose file exists, we can't inject. Fallback to manual? 
        // Actually the generator handles "no dockerfile" cases. 
        // If "hasDockerfile" is true but no compose, we should probably generate one?
        // For now, let's assume if they have one, we patch it.

        if (targetPath) {
            let content = fs.readFileSync(targetPath, 'utf8');

            // Simple check if it's already got our random ngrok service
            // A full YAML parser would be safer but let's try regex replacement first 
            // to avoid adding heavy dependencies like 'js-yaml' if not needed.
            // Actually, we should allow the user to overwrite.

            // Wait, we don't want to break their config.
            // But we need to ensure Ngrok runs on a unique port.
            // Let's rely on the generateDockerFiles logic?
            // No, that overwrites everything.

            // Strategy: Read file. If "ngrok:" service exists, update its ports.
            // If not, append it.
            // Since we don't have a YAML parser loaded, and we want to be safe,
            // let's just use the "start-ngrok-tunnel" sidecar approach but making sure 
            // it uses a RANDOM port too to avoid local 4040 collisions.

            // BUT the user's issue is likely that they have a stale docker-compose.yml 
            // that WE generated previously (with port 4040).
            // So we MUST detect if it's a file WE generated and regenerate it.

            if (content.includes('generated by Auto_LocalToPublicServer')) {
                // It's ours! We can safely overwrite/regenerate it.
                // We'll return a special flag to tell frontend to call "generateDockerFiles" instead.
                return { success: true, regenerate: true };
            }

            // If it's the user's own file, we implement the "Sidecar" approach (start-ngrok-tunnel).
            // But we need to ensure start-ngrok-tunnel uses a RANDOM API port too.
        }

        // Return success but indicate we should use the sidecar approach
        // unless regex matched our header.
        return {
            success: true,
            dockerDir: project.path,
            useSidecar: true, // Tell frontend to use start-ngrok-tunnel
            backendPort: project.backendPort || 8080 // Default or extracted
        };

    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Start ngrok tunnel separately (for existing Docker projects)
ipcMain.handle('start-ngrok-tunnel', async (event, port) => {
    return new Promise((resolve) => {
        const ngrokKey = getStorageData().ngrokKey;
        if (!ngrokKey) {
            resolve({ success: false, error: 'Ngrok key not configured' });
            return;
        }

        const ngrokProcess = spawn('ngrok', ['http', port.toString()], {
            shell: true,
            detached: true
        });

        ngrokProcess.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });

        // Give ngrok time to start
        setTimeout(async () => {
            try {
                exec('curl -s http://localhost:4040/api/tunnels', (error, stdout) => {
                    if (error) {
                        resolve({ success: true, pid: ngrokProcess.pid });
                        return;
                    }
                    try {
                        const data = JSON.parse(stdout);
                        const tunnel = data.tunnels.find(t => t.proto === 'https') || data.tunnels[0];
                        if (tunnel) {
                            resolve({ success: true, url: tunnel.public_url, pid: ngrokProcess.pid });
                        } else {
                            resolve({ success: true, pid: ngrokProcess.pid });
                        }
                    } catch (e) {
                        resolve({ success: true, pid: ngrokProcess.pid });
                    }
                });
            } catch (e) {
                resolve({ success: true, pid: ngrokProcess.pid });
            }
        }, 2000);
    });
});

// Stop ngrok tunnel
ipcMain.handle('stop-ngrok-tunnel', async (event, pid) => {
    return new Promise((resolve) => {
        if (pid) {
            try {
                process.kill(pid);
            } catch (e) {
                // Process may already be dead
            }
        }
        exec('pkill -f ngrok', () => {
            resolve({ success: true });
        });
    });
});

// ========== Port Conflict Detection ==========

// Check if a port is in use
ipcMain.handle('check-port-in-use', async (event, port) => {
    return new Promise((resolve) => {
        const isWindows = process.platform === 'win32';
        const command = isWindows
            ? `netstat -ano | findstr :${port}`
            : `lsof -i :${port} -t`;

        exec(command, (error, stdout) => {
            if (error || !stdout.trim()) {
                resolve({ inUse: false });
            } else {
                // Parse the process info
                const pids = stdout.trim().split('\n').map(line => {
                    if (isWindows) {
                        const parts = line.trim().split(/\s+/);
                        return parts[parts.length - 1];
                    }
                    return line.trim();
                }).filter(Boolean);

                // Get process names for each PID
                if (pids.length > 0) {
                    const pid = pids[0];
                    const nameCommand = isWindows
                        ? `tasklist /FI "PID eq ${pid}" /FO CSV /NH`
                        : `ps -p ${pid} -o comm=`;

                    exec(nameCommand, (err, nameOutput) => {
                        let processName = 'Unknown';
                        if (!err && nameOutput.trim()) {
                            if (isWindows) {
                                const match = nameOutput.match(/"([^"]+)"/);
                                processName = match ? match[1] : 'Unknown';
                            } else {
                                processName = nameOutput.trim();
                            }
                        }
                        resolve({
                            inUse: true,
                            pid: parseInt(pid),
                            processName,
                            pids: pids.map(p => parseInt(p))
                        });
                    });
                } else {
                    resolve({ inUse: true, pid: null });
                }
            }
        });
    });
});

// Find next available port
ipcMain.handle('find-available-port', async (event, startPort) => {
    const checkPort = (port) => {
        return new Promise((resolve) => {
            const isWindows = process.platform === 'win32';
            const command = isWindows
                ? `netstat -ano | findstr :${port}`
                : `lsof -i :${port} -t`;

            exec(command, (error, stdout) => {
                resolve(!stdout || !stdout.trim());
            });
        });
    };

    let port = startPort;
    while (port < startPort + 100) {
        const available = await checkPort(port);
        if (available) {
            return { success: true, port };
        }
        port++;
    }
    return { success: false, error: 'No available port found in range' };
});

// Kill process on a port
ipcMain.handle('kill-port-process', async (event, port) => {
    return new Promise((resolve) => {
        const isWindows = process.platform === 'win32';

        if (isWindows) {
            exec(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`, { shell: true }, (error) => {
                resolve({ success: !error });
            });
        } else {
            exec(`lsof -i :${port} -t | xargs kill -9 2>/dev/null`, (error) => {
                resolve({ success: true }); // Even if nothing to kill, consider success
            });
        }
    });
});

// ========== Cleanup Project Files ==========

// Check if a file was generated by us (contains our marker)
function isOurGeneratedFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes('Generated by Auto_LocalToPublicServer_ngrok_forDemo');
    } catch (e) {
        return false;
    }
}

// Cleanup project files when project is removed
ipcMain.handle('cleanup-project-files', async (event, project) => {
    try {
        const deletedFiles = [];

        // 1. Delete app's internal docker-files directory for this project
        if (project.id) {
            const internalDockerDir = path.join(app.getPath('userData'), 'docker-files', project.id);
            if (fs.existsSync(internalDockerDir)) {
                fs.rmSync(internalDockerDir, { recursive: true, force: true });
                deletedFiles.push(`[internal] ${internalDockerDir}`);
            }
        }

        // 2. If temporary mode OR we have a list of generated files, delete them
        if (project.generatedFiles && Array.isArray(project.generatedFiles)) {
            for (const filePath of project.generatedFiles) {
                // Safety check: only delete if it's our file
                if (isOurGeneratedFile(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        deletedFiles.push(filePath);
                    } catch (e) {
                        console.warn(`Could not delete ${filePath}:`, e.message);
                    }
                }
            }
        }

        // 3. If dockerDir is in user's project and isTemporary, clean those too
        if (project.isTemporary && project.dockerDir) {
            // Check standard locations for our generated files
            const possibleFiles = [
                path.join(project.dockerDir, 'docker-compose.yml'),
                path.join(project.dockerDir, 'docker-compose.yaml'),
            ];

            // Also check frontend/backend subdirs if they exist
            const frontendDockerfile = path.join(project.dockerDir, 'frontend', 'Dockerfile');
            const backendDockerfile = path.join(project.dockerDir, 'backend', 'Dockerfile');
            const rootDockerfile = path.join(project.dockerDir, 'Dockerfile');

            possibleFiles.push(frontendDockerfile, backendDockerfile, rootDockerfile);

            for (const filePath of possibleFiles) {
                if (isOurGeneratedFile(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        deletedFiles.push(filePath);
                    } catch (e) {
                        console.warn(`Could not delete ${filePath}:`, e.message);
                    }
                }
            }
        }

        console.log('Cleanup completed. Deleted files:', deletedFiles);
        return { success: true, deletedFiles };
    } catch (error) {
        console.error('Cleanup error:', error);
        return { success: false, error: error.message };
    }
});
