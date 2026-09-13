# AI-Driven Self-Healing DevOps Pipeline

> Autonomous Kubernetes incident detection, remediation, escalation, and GitOps recovery.

## Project overview

This project demonstrates a self-healing DevOps workflow for a containerized Node.js application running on Kubernetes.

The system continuously observes application and Kubernetes signals through Prometheus, analyzes incidents with a Node.js decision engine, attempts Ansible-based remediation, and escalates to a GitOps rollback through Argo CD when the first remediation path fails.

### Core recovery flow

```text
Kubernetes / Prometheus
        |
        v
   AI Monitor
        |
        v
 Incident Scoring
        |
        v
 Decision Engine
        |
   +----+----------------+
   |                     |
   v                     v
Ansible restart       GitOps rollback
   |                     |
   | fails               v
   +----------------> Argo CD
                         |
                         v
                    Kubernetes
                         |
                         v
                    Recovery
```

## Technology stack

- Node.js — application and AI decision engine
- Docker — containerization
- Kubernetes — orchestration and health management
- Kubernetes HPA — CPU-based horizontal scaling
- Prometheus — metrics collection
- Grafana — observability dashboards
- Ansible — first-line operational remediation
- GitHub — GitOps source of truth
- Argo CD — continuous reconciliation and deployment
- Jenkins — CI pipeline
- Trivy — container vulnerability scanning

## Application

The Node.js service exposes:

- `/` — application response
- `/health` — liveness endpoint
- `/ready` — readiness endpoint
- `/api/status` — application status
- `/fault/error` — controlled HTTP error generation
- `/fault/cpu?seconds=...` — controlled CPU load
- `/metrics` — Prometheus metrics

The Kubernetes Deployment uses liveness and readiness probes and resource requests/limits.

## CI/CD

Jenkins performs:

1. Dependency installation
2. Jest tests
3. Production dependency audit
4. Docker image build
5. Trivy HIGH/CRITICAL vulnerability gate
6. Docker Hub push
7. GitOps manifest update
8. Git push to the deployment repository

The deployment repository is reconciled by Argo CD.

## AI decision engine

The AI engine combines:

- CPU utilization
- new pod restarts
- pod readiness
- pod phase/state/reason
- HPA current/desired/max replicas
- HTTP 5xx error rate

The incident scorer assigns weighted signals:

| Signal | Points |
|---|---:|
| High CPU | 30 |
| New restart | 30 |
| Pod not ready | 40 |
| HPA at max + high CPU | 20 |
| High HTTP 5xx rate | 30 |

Severity:

- `LOW` — score < 30
- `MEDIUM` — 30–59
- `HIGH` — 60–89
- `CRITICAL` — 90+

The decision engine selects actions such as `NONE`, `MONITOR`, `WAIT`, `RESTART`, `ANSIBLE_RESTART`, or `ALERT`.

## Autonomous rollback

The GitOps rollback logic searches Git history for the nearest usable manifest.

It rejects manifests containing the intentional failure-injection command:

```yaml
command: ["/bin/sh", "-c", "exit 1"]
```

It then restores a known-good manifest, commits the rollback, pushes to GitHub, and lets Argo CD reconcile the cluster.

Rollback verification checks:

- expected application image
- desired replica count
- updated replicas
- ready replicas
- available replicas
- zero unavailable replicas
- absence of the failure-injection command

## End-to-end failure test

A controlled `CrashLoopBackOff` was injected using:

```yaml
command: ["/bin/sh", "-c", "exit 1"]
```

Observed sequence:

```text
CrashLoopBackOff
  -> AI detection
  -> ANSIBLE_RESTART
  -> Ansible remediation failed
  -> GitOps rollback escalation
  -> known-good Git revision selected
  -> Argo CD reconciliation
  -> ROLLBACK_RECOVERED
```

Final recovery evidence:

```text
status: ROLLBACK_RECOVERED
desiredReplicas: 3
updatedReplicas: 3
readyReplicas: 3
availableReplicas: 3
unavailableReplicas: 0
command: null
```

Final Kubernetes state:

```text
Deployment: 3/3 READY
Pods:       3 Running
Restarts:   0
Argo CD:    Synced / Healthy
```

### Important measurement note

Do not claim a percentage reduction in SRE intervention or a specific MTTR unless it is backed by repeated measurements and a defined baseline.

The verified evidence from this project supports the automation flow and successful recovery; it does not by itself establish a 70% reduction or a statistically meaningful MTTR.

## Observability

Prometheus and Grafana are used to visualize:

- CPU
- memory
- pod availability
- HPA current/desired replicas
- HTTP request/error rate
- application health

Example CPU query:

```promql
100 *
sum(
  rate(self_healing_process_cpu_user_seconds_total{
    job="self-healing-node-service"
  }[5m])
) by (pod)
```

Example HTTP 5xx error-rate query:

```promql
100 * (
  sum(rate(http_requests_total{status_code=~"5.."}[5m]))
  /
  sum(rate(http_requests_total[5m]))
)
```

## Local services

Typical local port-forwards:

```bash
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090 -n monitoring
kubectl port-forward svc/monitoring-grafana 3001:80 -n monitoring
kubectl port-forward service/self-healing-node-service 3000:80 -n self-healing
kubectl port-forward svc/argocd-server -n argocd 8443:443
```

## Demo

See `DEMO.md`.

## Interview preparation

See `INTERVIEW.md`.

## Resume bullets

See `RESUME.md`.

## Evidence and metrics

See `METRICS.md`.

## Architecture

See `ARCHITECTURE.md` and the included portfolio infographic.

## Repository

GitHub: https://github.com/saurav266/Ai-self-healing-devops
