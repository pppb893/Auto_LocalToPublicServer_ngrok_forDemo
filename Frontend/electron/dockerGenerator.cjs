/**
 * Docker File Generator
 * Generates Dockerfile and docker-compose.yml based on detected tech stack and databases
 */

const path = require('path');
const fs = require('fs');

// ========== Dockerfile Templates ==========

const dockerfileTemplates = {
    // Node.js / React / Next.js
    nodejs: (isNextJs = false) => `FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

${isNextJs ? 'RUN npm run build' : ''}

ENV PORT=${isNextJs ? '3000' : '3000'}
EXPOSE $PORT

CMD ["npm", "start"]
`,

    // React (Vite/CRA) with nginx
    // React (Vite/CRA) with nginx
    react: (hasBackend = false) => `FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
 
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/build /usr/share/nginx/html 2>/dev/null || true

# Add custom Nginx config for SPA routing and API proxy
RUN echo 'server { \\
    listen 80; \\
    location / { \\
        root /usr/share/nginx/html; \\
        index index.html index.htm; \\
        try_files $uri $uri/ /index.html; \\
    } \\
    ${hasBackend ? `location /api/ { \\
        proxy_pass http://backend:8080/; \\
        proxy_http_version 1.1; \\
        proxy_set_header Upgrade $http_upgrade; \\
        proxy_set_header Connection "upgrade"; \\
        proxy_set_header Host $host; \\
    }` : ''} \\
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`,

    // Python / Django / Flask
    python: (isDjango = false) => `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=${isDjango ? '8000' : '5000'}
EXPOSE $PORT

CMD ${isDjango ? '["sh", "-c", "python manage.py runserver 0.0.0.0:$PORT"]' : '["sh", "-c", "python app.py"]'}
`,

    // Go
    go: () => `FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/main .
EXPOSE 8080
CMD ["./main"]
`,

    // Java (Maven)
    java_maven: () => `FROM eclipse-temurin:17-jdk AS builder

WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN ./mvnw package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
`,

    // Java (Gradle)
    java_gradle: () => `FROM eclipse-temurin:17-jdk AS builder

WORKDIR /app
COPY build.gradle* settings.gradle* ./
COPY gradle ./gradle
COPY gradlew .
COPY src ./src
RUN ./gradlew build -x test

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
`,

    // PHP / Laravel
    php: (isLaravel = false) => `FROM php:8.2-fpm

WORKDIR /var/www/html

RUN apt-get update && apt-get install -y \\
    git zip unzip libpng-dev libonig-dev libxml2-dev \\
    && docker-php-ext-install pdo_mysql mbstring exif pcntl bcmath gd

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

COPY . .

RUN ${isLaravel ? 'composer install --no-dev --optimize-autoloader' : 'composer install'}

EXPOSE 9000

CMD ["php-fpm"]
`,

    // Rust
    rust: () => `FROM rust:1.70 AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/app /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
`,

    // Static HTML
    static: () => `FROM nginx:alpine

COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
`
};

// ========== Database Configurations ==========

const databaseConfigs = {
    MySQL: {
        image: 'mysql:8',
        environment: [
            'MYSQL_ROOT_PASSWORD=rootpassword',
            'MYSQL_DATABASE=app_db',
            'MYSQL_USER=app_user',
            'MYSQL_PASSWORD=app_password'
        ],
        ports: ['3306:3306'],
        volumes: ['mysql_data:/var/lib/mysql'],
        healthcheck: {
            test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
            interval: '10s',
            timeout: '5s',
            retries: 5
        }
    },
    PostgreSQL: {
        image: 'postgres:15',
        environment: [
            'POSTGRES_DB=app_db',
            'POSTGRES_USER=app_user',
            'POSTGRES_PASSWORD=app_password'
        ],
        ports: ['5432:5432'],
        volumes: ['postgres_data:/var/lib/postgresql/data'],
        healthcheck: {
            test: ['CMD-SHELL', 'pg_isready -U app_user'],
            interval: '10s',
            timeout: '5s',
            retries: 5
        }
    },
    MongoDB: {
        image: 'mongo:6',
        environment: [
            'MONGO_INITDB_ROOT_USERNAME=root',
            'MONGO_INITDB_ROOT_PASSWORD=rootpassword',
            'MONGO_INITDB_DATABASE=app_db'
        ],
        ports: ['27017:27017'],
        volumes: ['mongo_data:/data/db']
    },
    Redis: {
        image: 'redis:7-alpine',
        ports: ['6379:6379'],
        volumes: ['redis_data:/data'],
        command: 'redis-server --appendonly yes'
    }
};

// ========== Generator Functions ==========

function getDockerfileForTech(techStack, hasBackend = false) {
    const techName = techStack.name.toLowerCase();

    if (techName.includes('next')) return dockerfileTemplates.nodejs(true);
    if (techName.includes('react') || techName.includes('vue') || techName.includes('svelte')) return dockerfileTemplates.react(hasBackend);
    if (techName.includes('express') || techName.includes('fastify') || techName.includes('nest') || techName.includes('node')) return dockerfileTemplates.nodejs();
    if (techName.includes('django')) return dockerfileTemplates.python(true);
    if (techName.includes('python') || techName.includes('flask')) return dockerfileTemplates.python();
    if (techName.includes('go')) return dockerfileTemplates.go();
    if (techName.includes('java')) {
        // Check if maven or gradle
        return dockerfileTemplates.java_maven(); // Default to maven
    }
    if (techName.includes('laravel')) return dockerfileTemplates.php(true);
    if (techName.includes('php')) return dockerfileTemplates.php();
    if (techName.includes('rust')) return dockerfileTemplates.rust();
    if (techName.includes('static') || techName.includes('html')) return dockerfileTemplates.static();

    // Default to Node.js
    return dockerfileTemplates.nodejs();
}

function generateDockerCompose(project, ngrokAuthToken) {
    const services = {};
    const volumes = {};

    // Add frontend/backend services
    // # generated by Auto_LocalToPublicServer_ngrok_forDemo

    // Map to store internal ports for ngrok configuration
    const servicePorts = {};

    project.structure.forEach((item, index) => {
        const serviceName = item.type === 'frontend' ? 'frontend' :
            item.type === 'backend' ? 'backend' :
                `service_${index}`;

        // Check isNginx status regardless of port source
        let isNginx = false;
        if (item.type === 'frontend' && item.techStacks && item.techStacks.length > 0) {
            const tech = item.techStacks[0].name.toLowerCase();
            if (tech.includes('react') || tech.includes('vue') || tech.includes('svelte') ||
                tech.includes('static') || tech.includes('html')) {
                isNginx = true;
            }
        }

        // Determine internal port: use user provided, or defaults based on type/stack
        let internalPort = item.port;
        if (!internalPort) {
            internalPort = isNginx ? 80 : (item.type === 'backend' ? 8080 : 3000);
        }

        servicePorts[serviceName] = internalPort;

        const hostPort = Math.floor(Math.random() * 10000) + 20000;

        services[serviceName] = {
            build: {
                context: item.path,
                dockerfile: `Dockerfile.${item.type}` // Use the specific dockerfile we generated
            },
            ports: [`${hostPort}:${internalPort}`],
            environment: []
        };

        if (!isNginx) {
            services[serviceName].environment.push(`PORT=${internalPort}`);
        }


        // Add database connection env vars for backend
        if (item.type === 'backend' && project.databases) {
            project.databases.forEach(db => {
                if (db.name === 'MySQL') {
                    services[serviceName].environment.push('DB_HOST=mysql');
                    services[serviceName].environment.push('DB_PORT=3306');
                    services[serviceName].environment.push('DB_USER=app_user');
                    services[serviceName].environment.push('DB_PASSWORD=app_password');
                    services[serviceName].environment.push('DB_NAME=app_db');
                    services[serviceName].depends_on = services[serviceName].depends_on || [];
                    services[serviceName].depends_on.push('mysql');
                }
                if (db.name === 'PostgreSQL') {
                    services[serviceName].environment.push('DATABASE_URL=postgres://app_user:app_password@postgres:5432/app_db');
                    services[serviceName].depends_on = services[serviceName].depends_on || [];
                    services[serviceName].depends_on.push('postgres');
                }
                if (db.name === 'MongoDB') {
                    services[serviceName].environment.push('MONGO_URI=mongodb://root:rootpassword@mongo:27017/app_db?authSource=admin');
                    services[serviceName].depends_on = services[serviceName].depends_on || [];
                    services[serviceName].depends_on.push('mongo');
                }
                if (db.name === 'Redis') {
                    services[serviceName].environment.push('REDIS_URL=redis://redis:6379');
                    services[serviceName].depends_on = services[serviceName].depends_on || [];
                    services[serviceName].depends_on.push('redis');
                }
            });
        }
    });

    // Add database services
    if (project.databases) {
        project.databases.forEach(db => {
            if (db.name === 'SQLite') return; // SQLite doesn't need a container

            const config = databaseConfigs[db.name];
            if (config) {
                const serviceName = db.name.toLowerCase().replace('sql', '');
                services[serviceName] = {
                    image: config.image,
                    environment: config.environment,
                    ports: config.ports,
                    volumes: config.volumes
                };
                if (config.command) services[serviceName].command = config.command;
                if (config.healthcheck) services[serviceName].healthcheck = config.healthcheck;

                // Add volumes
                config.volumes.forEach(v => {
                    const volumeName = v.split(':')[0];
                    volumes[volumeName] = {};
                });
            }
        });
    }

    // Add ngrok service

    // Determine which service to target with ngrok
    // If backend only, target backend. If frontend exists, target frontend (which proxies backend)
    let targetService = 'frontend';
    if (!services.frontend) {
        if (services.backend) targetService = 'backend';
        else targetService = Object.keys(services)[0];
    }

    const targetPort = servicePorts[targetService];

    // Use a random port between 4040-4140 for the Ngrok API to avoid collisions
    // The frontend will detect this port from the docker-compose.yml
    const ngrokApiPort = Math.floor(Math.random() * 100) + 4040;

    services.ngrok = {
        image: 'ngrok/ngrok:latest',
        command: `http ${targetService}:${targetPort}`,
        environment: [`NGROK_AUTHTOKEN=${ngrokAuthToken}`],
        ports: [`${ngrokApiPort}:4040`], // Map random host port to container's 4040
        depends_on: [targetService]
    };

    return {
        version: '3.8',
        services,
        volumes: Object.keys(volumes).length > 0 ? volumes : undefined
    };
}

function yamlStringify(obj, indent = 0) {
    const spaces = '  '.repeat(indent);
    let result = '';

    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue;

        if (Array.isArray(value)) {
            if (value.length === 0) continue; // Skip empty arrays to avoid invalid YAML (hanging keys)

            result += `${spaces}${key}:\n`;
            value.forEach(item => {
                if (typeof item === 'object') {
                    result += `${spaces}  -\n`;
                    // Indent the object properties correctly relative to the dash
                    // The recursive call adds its own indentation, so we just need to append it
                    result += yamlStringify(item, indent + 2).replace(/^/gm, `${spaces}  `).replace(`${spaces}  `, '', 1);
                } else {
                    result += `${spaces}  - ${item}\n`;
                }
            });
        } else if (typeof value === 'object' && value !== null) {
            result += `${spaces}${key}:\n`;
            result += yamlStringify(value, indent + 1);
        } else {
            // FORCE QUOTES for version
            if (key === 'version') {
                result += `${spaces}${key}: "${value}"\n`;
            } else {
                result += `${spaces}${key}: ${value}\n`;
            }
        }
    }

    return result;

    return result;
}

module.exports = {
    dockerfileTemplates,
    databaseConfigs,
    getDockerfileForTech,
    generateDockerCompose,
    yamlStringify
};
