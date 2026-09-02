pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'saurav8789/self-healing-node-app'
    }

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
                sh 'docker build -t ${DOCKER_IMAGE}:${BUILD_NUMBER} app'
            }
        }

        stage('Trivy Scan') {
            steps {
                sh 'trivy image --severity HIGH,CRITICAL --exit-code 1 ${DOCKER_IMAGE}:${BUILD_NUMBER}'
            }
        }

        stage('Docker Push') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub-credentials',
                        usernameVariable: 'DOCKER_USERNAME',
                        passwordVariable: 'DOCKER_PASSWORD'
                    )
                ]) {
                    sh '''
                        echo "$DOCKER_PASSWORD" | docker login \
                            -u "$DOCKER_USERNAME" \
                            --password-stdin

                        docker push ${DOCKER_IMAGE}:${BUILD_NUMBER}

                        docker logout
                    '''
                }
            }
        }
    }
}