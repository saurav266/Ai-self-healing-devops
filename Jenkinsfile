pipeline {
    agent any

    stages {
        stage('Install Dependencies') {
            steps {
                sh 'cd app && npm ci'
            }
        }

        stage('Test') {
            steps {
                sh 'cd app && node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand'
            }
        }

        stage('Security Audit') {
            steps {
                sh 'cd app && npm audit --omit=dev'
            }
        }

        stage('Docker Build') {
            steps {
                sh 'docker build -t self-healing-node-app:${BUILD_NUMBER} app'
            }
        }

        stage('Trivy Scan') {
            steps {
                sh 'trivy image --severity HIGH,CRITICAL --exit-code 1 self-healing-node-app:${BUILD_NUMBER}'
            }
        }
    }
}