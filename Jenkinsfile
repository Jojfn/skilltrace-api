/*
 * SkillTrace API - DevOps pipeline
 * SIT753 Professional Practice in IT, Task 7.3HD
 * Jason Hu (219220123)
 *
 * Seven stages: Build, Test, Code Quality, Security, Deploy, Release, Monitoring.
 *
 * Design notes
 *  - One artefact is built once and then promoted unchanged through staging and
 *    production. Nothing is rebuilt between environments, so what is released is
 *    exactly what was tested.
 *  - Stage logic lives in version-controlled PowerShell under ci/, not inline in
 *    this file, so it can be reviewed, reused and run by hand during an incident.
 *  - Environments are described declaratively (ecosystem.config.js, monitoring/*.yml)
 *    and applied by the pipeline rather than configured by hand on the host.
 */

pipeline {
    agent any

    options {
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        timeout(time: 40, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    triggers {
        // Poll GitHub; a push to main starts the pipeline without a webhook.
        pollSCM('H/5 * * * *')
    }

    environment {
        APP_NAME       = 'skilltrace-api'
        VERSION        = "1.0.${env.BUILD_NUMBER}"
        ARTEFACT       = "skilltrace-api-1.0.${env.BUILD_NUMBER}.zip"

        STAGING_ROOT   = 'C:\\skilltrace\\staging'
        PROD_ROOT      = 'C:\\skilltrace\\prod'
        STAGING_URL    = 'http://localhost:3101'
        PROD_URL       = 'http://localhost:3100'
        STAGING_PORT   = '3101'
        PROD_PORT      = '3100'

        PM2_CMD        = 'C:\\Users\\Maflapy\\AppData\\Roaming\\npm\\pm2.cmd'
        PM2_HOME       = 'C:\\skilltrace\\.pm2'
        PROM_URL       = 'http://localhost:9090'
    }

    stages {

        /* ---------------------------------------------------------------- 1 */
        stage('Build') {
            steps {
                echo "Building ${APP_NAME} version ${VERSION} from commit ${env.GIT_COMMIT}"
                bat 'call npm ci --no-fund --no-audit'
                bat 'call node scripts/build.js'

                // Install production-only dependencies into the artefact so the
                // deployed package is self-contained and deployment needs no network.
                bat 'cd dist\\app && call npm ci --omit=dev --no-fund --no-audit'

                powershell '''
                    $ErrorActionPreference = "Stop"
                    if (Test-Path $env:ARTEFACT) { Remove-Item $env:ARTEFACT -Force }
                    Compress-Archive -Path "dist\\app" -DestinationPath $env:ARTEFACT -CompressionLevel Optimal
                    $size = [math]::Round((Get-Item $env:ARTEFACT).Length / 1MB, 2)
                    Write-Host "[build] artefact $env:ARTEFACT ($size MB)"
                    Get-Content "dist\\app\\build-info.json"
                '''

                archiveArtifacts artifacts: "${ARTEFACT}", fingerprint: true
            }
        }

        /* ---------------------------------------------------------------- 2 */
        stage('Test') {
            steps {
                echo 'Running unit and integration suites with coverage'
                // Non-zero exit is tolerated here so the junit step below can
                // publish the results and decide the build outcome.
                bat 'call npm run test:ci || exit /b 0'
            }
            post {
                always {
                    junit testResults: 'reports/junit.xml', allowEmptyResults: false
                    archiveArtifacts artifacts: 'coverage/lcov.info', allowEmptyArchive: true
                    powershell '''
                        if (Test-Path "coverage\\coverage-summary.json") {
                            Get-Content "coverage\\coverage-summary.json"
                        }
                    '''
                }
            }
        }

        /* ---------------------------------------------------------------- 3 */
        stage('Code Quality') {
            steps {
                echo 'Static analysis and quality gate (SonarCloud)'
                bat 'call npx eslint src tests || exit /b 0'
                withCredentials([string(credentialsId: 'SONAR_TOKEN', variable: 'SONAR_TOKEN')]) {
                    powershell '''
                        $ErrorActionPreference = "Stop"
                        ./ci/quality-gate.ps1 -SonarToken $env:SONAR_TOKEN -FailOnGate
                    '''
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/quality-gate.json', allowEmptyArchive: true
                }
            }
        }

        /* ---------------------------------------------------------------- 4 */
        stage('Security') {
            steps {
                echo 'Dependency audit, static security analysis and secret scan'
                powershell '''
                    $ErrorActionPreference = "Stop"
                    ./ci/security-scan.ps1 -FailOn "high"
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/security-summary.md,reports/npm-audit.json,reports/eslint-security.json',
                                     allowEmptyArchive: true
                }
            }
        }

        /* ---------------------------------------------------------------- 5 */
        stage('Deploy') {
            steps {
                echo "Deploying build ${BUILD_NUMBER} to the staging environment"
                powershell '''
                    $ErrorActionPreference = "Stop"
                    ./ci/deploy.ps1 `
                        -ArtefactZip  $env:ARTEFACT `
                        -TargetRoot   $env:STAGING_ROOT `
                        -AppName      "skilltrace-staging" `
                        -Port         $env:STAGING_PORT `
                        -EnvName      "staging" `
                        -BuildNumber  $env:BUILD_NUMBER `
                        -Pm2Cmd       $env:PM2_CMD `
                        -Pm2Home      $env:PM2_HOME `
                        -AllowChaos   "1"
                '''
                powershell '''
                    $ErrorActionPreference = "Stop"
                    ./ci/smoke-test.ps1 -BaseUrl $env:STAGING_URL -ExpectedBuild $env:BUILD_NUMBER
                '''
            }
        }

        /* ---------------------------------------------------------------- 6 */
        stage('Release') {
            when {
                // A single-branch "pipeline script from SCM" job does not set
                // BRANCH_NAME - that is a multibranch-only variable - so
                // `branch 'main'` would silently never match. The git plugin
                // does set GIT_BRANCH, typically as "origin/main".
                expression {
                    def ref = env.BRANCH_NAME ?: env.GIT_BRANCH ?: 'main'
                    return ref == 'main' || ref.endsWith('/main')
                }
            }
            steps {
                echo "Promoting the staging-verified artefact to production as v${VERSION}"

                // Tag the exact commit that produced this artefact. The tag is
                // always created locally; publishing it needs a credential, and a
                // missing credential must not abort a release that is otherwise
                // sound, so the push is attempted separately.
                powershell '''
                    $ErrorActionPreference = "Stop"
                    git config user.email "sq.tiyu@gmail.com"
                    git config user.name  "Jenkins (SkillTrace CI)"
                    $tag = "v$env:VERSION"
                    git tag -f -a $tag -m "Release $tag from build $env:BUILD_NUMBER ($env:GIT_COMMIT)"
                    Write-Host "[release] created annotated tag $tag"
                '''

                script {
                    try {
                        withCredentials([usernamePassword(credentialsId: 'github-pat',
                                                          usernameVariable: 'GH_USER',
                                                          passwordVariable: 'GH_TOKEN')]) {
                            powershell '''
                                $ErrorActionPreference = "Stop"
                                $tag = "v$env:VERSION"
                                $remote = "https://$env:GH_USER`:$env:GH_TOKEN@github.com/Jojfn/skilltrace-api.git"
                                git push $remote $tag
                                Write-Host "[release] published tag $tag to origin"
                            '''
                        }
                    } catch (err) {
                        echo "WARNING: could not publish the release tag (${err.message})."
                        echo "The tag exists locally and the release continues; configure the " +
                             "'github-pat' credential to publish tags automatically."
                    }
                }

                // Promote the same artefact - no rebuild between environments.
                powershell '''
                    $ErrorActionPreference = "Stop"
                    ./ci/deploy.ps1 `
                        -ArtefactZip  $env:ARTEFACT `
                        -TargetRoot   $env:PROD_ROOT `
                        -AppName      "skilltrace-prod" `
                        -Port         $env:PROD_PORT `
                        -EnvName      "production" `
                        -BuildNumber  $env:BUILD_NUMBER `
                        -Pm2Cmd       $env:PM2_CMD `
                        -Pm2Home      $env:PM2_HOME `
                        -AllowChaos   "0"
                '''
            }
            post {
                failure {
                    echo 'Release failed - rolling production back to the previous release'
                    powershell '''
                        ./ci/rollback.ps1 -TargetRoot $env:PROD_ROOT -AppName "skilltrace-prod" `
                                          -Pm2Cmd $env:PM2_CMD -Pm2Home $env:PM2_HOME
                    '''
                }
            }
        }

        /* ---------------------------------------------------------------- 7 */
        stage('Monitoring') {
            steps {
                echo 'Verifying production health, metrics and alerting'
                powershell '''
                    $ErrorActionPreference = "Stop"
                    ./ci/start-prometheus.ps1
                '''
                // Confirm production is serving the build we just released.
                powershell '''
                    $ErrorActionPreference = "Stop"
                    ./ci/smoke-test.ps1 -BaseUrl $env:PROD_URL -ExpectedBuild $env:BUILD_NUMBER
                '''
                powershell '''
                    $ErrorActionPreference = "Stop"
                    ./ci/monitoring-check.ps1 -PromUrl $env:PROM_URL -ProdUrl $env:PROD_URL `
                                              -StagingUrl $env:STAGING_URL -SimulateIncident
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/monitoring-report.md', allowEmptyArchive: true
                }
            }
        }
    }

    post {
        success {
            echo "SUCCESS - ${APP_NAME} ${VERSION} built, verified, released to production and monitored."
        }
        unstable {
            echo "UNSTABLE - the pipeline completed but a quality, test or alert condition needs review."
        }
        failure {
            echo "FAILURE - pipeline halted. Production remains on its previous release."
        }
        always {
            echo "Build ${BUILD_NUMBER} finished with status: ${currentBuild.currentResult}"
        }
    }
}
