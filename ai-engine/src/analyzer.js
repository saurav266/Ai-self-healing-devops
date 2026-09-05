import {
    queryPrometheus,
    getHttpErrorRate
} from "./prometheus.js";

import {
    getPodHealth,
    getHpaStatus
} from "./kubernetes.js";

import {
    getNewRestartCount,
    clearPodState
} from "./state.js";

import { makeDecision } from "./decision.js";

import {
    calculateIncidentScore
} from "./incidentScore.js";

export async function analyzeSystem() {
    const cpuQuery = `
        100 *
        sum(
            rate(
                self_healing_process_cpu_user_seconds_total{
                    job="self-healing-node-service"
                }[5m]
            )
        ) by (pod)
    `;

    const [
        cpuResults,
        pods,
        hpa,
        errorRate
    ] = await Promise.all([
        queryPrometheus(cpuQuery),
        getPodHealth(),
        getHpaStatus(),
        getHttpErrorRate()
    ]);

    clearPodState(
        pods.map((pod) => pod.pod)
    );

    const analysis = cpuResults.map((item) => {
        const podName =
            item.metric?.pod || "unknown";

        const cpu =
            Number(item.value?.[1] || 0);

        const pod = pods.find(
            (p) => p.pod === podName
        );

        const restartCount =
            pod?.restartCount || 0;

        const newRestarts =
            getNewRestartCount(
                podName,
                restartCount
            );

        const podReady =
            pod?.ready ?? false;

        const incident =
            calculateIncidentScore({
                cpu,
                newRestarts,
                podReady,
                hpaCurrentReplicas:
                    hpa.currentReplicas,
                hpaDesiredReplicas:
                    hpa.desiredReplicas,
                hpaMaxReplicas:
                    hpa.maxReplicas,
                errorRate
            });

        const decision =
            makeDecision({
                cpu,
                restartCount,
                newRestarts,
                hpaCurrentReplicas:
                    hpa.currentReplicas,
                hpaDesiredReplicas:
                    hpa.desiredReplicas,
                hpaMaxReplicas:
                    hpa.maxReplicas,
                podReady
            });

        return {
            pod: podName,
            cpu: Number(cpu.toFixed(2)),
            ready: podReady,
            restartCount,
            newRestarts,
            errorRate: Number(
                errorRate.toFixed(2)
            ),
            incident,
            decision
        };
    });

    return {
        timestamp:
            new Date().toISOString(),
        hpa,
        errorRate: Number(
            errorRate.toFixed(2)
        ),
        pods: analysis
    };
}