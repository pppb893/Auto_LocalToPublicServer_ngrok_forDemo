const { yamlStringify } = require('./electron/dockerGenerator.cjs');

const testObj = {
    version: '3.8',
    services: {
        web: {
            image: 'nginx',
            ports: ['80:80'],
            environment: [] // This should be skipped
        }
    }
};

console.log(yamlStringify(testObj));
