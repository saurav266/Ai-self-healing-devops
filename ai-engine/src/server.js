import express from "express";
import { detectCpuAnomaly } from "./detector.js";
import { analyzeSystem } from "./analyzer.js";
import {
    queryPrometheus,
    getHttpErrorRate
} from "./prometheus.js";
import { getNewRestartCount, clearPodState } from "./state.js";
import { calculateIncidentScore } from "./incidentScore.js";

import {
    getPodHealth,
    getHpaStatus,
    restartPod
} from "./kubernetes.js";
import { makeDecision } from "./decision.js";
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
    res.json({
        service: "AI Self-Healing Engine",
        status: "running"
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "healthy"
    });
});
app.get("/detect/cpu", async (req, res) => {
    try {
        const query = `
            100 *
            sum(
                rate(
                    self_healing_process_cpu_user_seconds_total{
                        job="self-healing-node-service"
                    }[5m]
                )
            ) by (pod)
        `;

        const result = await queryPrometheus(query);

        const analysis = detectCpuAnomaly(result);

        const anomalies = analysis.filter(
            (item) => item.anomaly
        );

        res.json({
            metric: "cpu",
            threshold: Number(process.env.CPU_THRESHOLD || 80),
            pods: analysis,
            anomalyDetected: anomalies.length > 0,
            anomalyCount: anomalies.length
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

app.get("/metrics/cpu", async (req, res) => {
    try {
        const query = `
            100 *
            sum(
                rate(
                    self_healing_process_cpu_user_seconds_total{
                        job="self-healing-node-service"
                    }[5m]
                )
            ) by (pod)
        `;

        const result = await queryPrometheus(query);

        res.json({
            metric: "cpu",
            result
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});
app.get("/context", async (req, res) => {
    try {
        const [pods, hpa] = await Promise.all([
            getPodHealth(),
            getHpaStatus()
        ]);

        res.json({
            timestamp: new Date().toISOString(),
            kubernetes: {
                namespace: "self-healing",
                deployment: "self-healing-node-app"
            },
            pods,
            hpa
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});
app.get("/analyze", async (req, res) => {
    try {
        const analysis = await analyzeSystem();

        res.json(analysis);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});
app.post("/remediate", async (req, res) => {
    try {
        const { pod: podName, action } = req.body;

        if (!podName) {
            return res.status(400).json({
                error: "Pod name is required"
            });
        }

        if (action !== "RESTART") {
            return res.status(400).json({
                error: "Only RESTART action is currently supported"
            });
        }

        const pods = await getPodHealth();

        const targetPod = pods.find(
            (pod) => pod.pod === podName
        );

        if (!targetPod) {
            return res.status(404).json({
                error: "Pod not found",
                pod: podName
            });
        }

        /*
         * Safety rule:
         *
         * Restart only if:
         * 1. Pod is not ready
         * OR
         * 2. A new restart was detected
         */
        const newRestarts = getNewRestartCount(
            podName,
            targetPod.restartCount
        );

        const unsafeToRestart =
            targetPod.ready === true &&
            newRestarts === 0;

        if (unsafeToRestart) {
            return res.status(409).json({
                error: "Pod is healthy and no new restart was detected",
                pod: targetPod,
                newRestarts
            });
        }

        const result = await restartPod(podName);

        res.json({
            timestamp: new Date().toISOString(),
            remediation: result,
            pod: {
                name: podName,
                ready: targetPod.ready,
                restartCount: targetPod.restartCount,
                newRestarts
            }
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});
app.listen(PORT, () => {
    console.log(`AI Engine running on port ${PORT}`);
});