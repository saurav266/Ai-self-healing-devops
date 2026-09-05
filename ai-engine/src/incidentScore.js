const CPU_THRESHOLD = Number(process.env.CPU_THRESHOLD || 80);

export function calculateIncidentScore({
    cpu,
    newRestarts,
    podReady,
    hpaCurrentReplicas,
    hpaDesiredReplicas,
    hpaMaxReplicas,
    errorRate = 0
}) {
    let score = 0;
    const signals = [];

    // High CPU
    if (cpu >= CPU_THRESHOLD) {
        score += 30;

        signals.push({
            type: "HIGH_CPU",
            value: cpu,
            points: 30
        });
    }

    // New restart
    if (newRestarts > 0) {
        score += 30;

        signals.push({
            type: "NEW_RESTART",
            value: newRestarts,
            points: 30
        });
    }

    // Pod unhealthy
    if (!podReady) {
        score += 40;

        signals.push({
            type: "POD_NOT_READY",
            value: true,
            points: 40
        });
    }

    // HPA reached maximum
    if (
        hpaCurrentReplicas >= hpaMaxReplicas &&
        cpu >= CPU_THRESHOLD
    ) {
        score += 20;

        signals.push({
            type: "HPA_MAX_REPLICAS",
            value: hpaCurrentReplicas,
            points: 20
        });
    }

    // HTTP error rate
    if (errorRate > 5) {
        score += 30;

        signals.push({
            type: "HIGH_ERROR_RATE",
            value: errorRate,
            points: 30
        });
    }

    let severity;

    if (score >= 90) {
        severity = "CRITICAL";
    } else if (score >= 60) {
        severity = "HIGH";
    } else if (score >= 30) {
        severity = "MEDIUM";
    } else {
        severity = "LOW";
    }

    return {
        score,
        severity,
        signals
    };
}