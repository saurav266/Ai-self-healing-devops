const CPU_THRESHOLD = Number(process.env.CPU_THRESHOLD || 80);
const RESTART_THRESHOLD = Number(process.env.RESTART_THRESHOLD || 2);

export function makeDecision({
    cpu,
    restartCount,
    newRestarts,
    hpaCurrentReplicas,
    hpaDesiredReplicas,
    hpaMaxReplicas,
    podReady
}) {

    // 1. Pod is currently unhealthy
    if (!podReady) {
        return {
            action: "RESTART",
            severity: "HIGH",
            reason: "Pod is not ready"
        };
    }
    if (newRestarts > 0 && !podReady) {
    return {
        action: "RESTART",
        severity: "HIGH",
        reason: "New pod restart detected and pod is not ready"
    };
}

    // 2. HPA is already responding to high load
    if (
        cpu >= CPU_THRESHOLD &&
        hpaDesiredReplicas > hpaCurrentReplicas
    ) {
        return {
            action: "WAIT",
            severity: "MEDIUM",
            reason: "High CPU detected and HPA is already scaling"
        };
    }

    // 3. High CPU but HPA cannot scale further
    if (
        cpu >= CPU_THRESHOLD &&
        hpaCurrentReplicas >= hpaMaxReplicas
    ) {
        return {
            action: "ALERT",
            severity: "HIGH",
            reason: "High CPU persists while HPA is at maximum replicas"
        };
    }

    // 4. Repeated historical restarts alone are NOT enough
  if (restartCount >= RESTART_THRESHOLD) {
    return {
        action: "MONITOR",
        severity: "MEDIUM",
        reason: "Pod has historical restarts but is currently healthy"
    };
}

    // 5. Normal
    if (cpu < CPU_THRESHOLD && podReady) {
        return {
            action: "NONE",
            severity: "LOW",
            reason: "System is operating normally"
        };
    }

    return {
        action: "MONITOR",
        severity: "MEDIUM",
        reason: "Potential anomaly detected; continue monitoring"
    };
}