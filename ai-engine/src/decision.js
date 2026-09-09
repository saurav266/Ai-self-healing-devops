const CPU_THRESHOLD =
    Number(process.env.CPU_THRESHOLD || 80);

const ERROR_RATE_THRESHOLD =
    Number(process.env.ERROR_RATE_THRESHOLD || 5);

const FAILURE_STATES = new Set([
    "ImagePullBackOff",
    "ErrImagePull",
    "CrashLoopBackOff",
    "CreateContainerError",
    "ContainerCannotRun"
]);

export function makeDecision({
    cpu,
    restartCount,
    newRestarts,
    hpaCurrentReplicas,
    hpaDesiredReplicas,
    hpaMaxReplicas,
    podReady,
    phase,
    state,
    reason,
    errorRate = 0,
    incidentScore = 0
}) {

    // --------------------------------------------------
    // 1. Explicit Kubernetes container failure
    // --------------------------------------------------

    if (
    !podReady &&
    FAILURE_STATES.has(reason)
) {
    return {
        action: "ANSIBLE_RESTART",
        severity: "HIGH",
        reason:
            `Ansible remediation selected for Kubernetes failure: ${reason}`
    };
}
    if (
        !podReady &&
        FAILURE_STATES.has(reason)
    ) {
        return {
            action: "RESTART",
            severity: "HIGH",
            reason:
                `Kubernetes failure detected: ${reason}`
        };
    }

    // --------------------------------------------------
    // 2. Pod is pending and cannot become ready
    // --------------------------------------------------

    if (
        !podReady &&
        phase === "Pending"
    ) {
        return {
            action: "RESTART",
            severity: "HIGH",
            reason:
                "Pod is stuck in Pending state"
        };
    }

    // --------------------------------------------------
    // 3. Pod is not ready with serious incident score
    // --------------------------------------------------

    if (
        !podReady &&
        incidentScore >= 40
    ) {
        return {
            action: "RESTART",
            severity: "HIGH",
            reason:
                "Pod is not ready and incident severity is high"
        };
    }

    // --------------------------------------------------
    // 4. High CPU while HPA is scaling
    // --------------------------------------------------

    if (
        cpu >= CPU_THRESHOLD &&
        hpaDesiredReplicas > hpaCurrentReplicas
    ) {
        return {
            action: "WAIT",
            severity: "MEDIUM",
            reason:
                "High CPU detected and HPA is already scaling"
        };
    }

    // --------------------------------------------------
    // 5. High CPU at HPA maximum
    // --------------------------------------------------

    if (
        cpu >= CPU_THRESHOLD &&
        hpaCurrentReplicas >= hpaMaxReplicas
    ) {
        return {
            action: "ALERT",
            severity: "HIGH",
            reason:
                "High CPU persists while HPA is at maximum replicas"
        };
    }

    // --------------------------------------------------
    // 6. New restart during active incident
    // --------------------------------------------------

    if (
        newRestarts > 0 &&
        incidentScore >= 30
    ) {
        return {
            action: "RESTART",
            severity: "HIGH",
            reason:
                "New restart detected during an active incident"
        };
    }

    // --------------------------------------------------
    // 7. High HTTP error rate
    // --------------------------------------------------

    if (
        errorRate >= ERROR_RATE_THRESHOLD &&
        incidentScore >= 30
    ) {
        return {
            action: "ALERT",
            severity: "HIGH",
            reason:
                "High HTTP 5xx error rate detected"
        };
    }

    // --------------------------------------------------
    // 8. Historical restarts but currently healthy
    // --------------------------------------------------

    if (
        restartCount >= 2 &&
        podReady
    ) {
        return {
            action: "MONITOR",
            severity: "MEDIUM",
            reason:
                "Pod has historical restarts but is currently healthy"
        };
    }

    // --------------------------------------------------
    // 9. Normal system
    // --------------------------------------------------

    if (
        cpu < CPU_THRESHOLD &&
        errorRate < ERROR_RATE_THRESHOLD &&
        podReady &&
        incidentScore < 30 &&
        state === "RUNNING"
    ) {
        return {
            action: "NONE",
            severity: "LOW",
            reason:
                "System is operating normally"
        };
    }

    // --------------------------------------------------
    // 10. Default
    // --------------------------------------------------

    return {
        action: "MONITOR",
        severity: "MEDIUM",
        reason:
            "Potential anomaly detected; continue monitoring"
    };
}
