import {
    getPodHealth,
    restartPod,
    waitForRecovery
} from "./kubernetes.js";

const COOLDOWN_MS = Number(
    process.env.REMEDIATION_COOLDOWN_MS || 60000
);

const lastRemediation = new Map();

export async function remediate(podName, action) {
    if (!podName) {
        throw new Error("Pod name is required");
    }

    if (action !== "RESTART") {
        return {
            status: "SKIPPED",
            reason: `Unsupported action: ${action}`
        };
    }

    /*
     * Cooldown protection
     */
    const lastAction = lastRemediation.get(podName);

    if (
        lastAction &&
        Date.now() - lastAction < COOLDOWN_MS
    ) {
        const remaining =
            COOLDOWN_MS -
            (Date.now() - lastAction);

        return {
            status: "COOLDOWN",
            pod: podName,
            action,
            retryAfterSeconds:
                Math.ceil(remaining / 1000)
        };
    }

    /*
     * Get current Kubernetes state
     */
    const pods = await getPodHealth();

    const pod = pods.find(
        (item) => item.pod === podName
    );

    if (!pod) {
        return {
            status: "SKIPPED",
            pod: podName,
            reason: "Pod no longer exists"
        };
    }

    /*
     * Safety check
     */
   if (pod.ready) {
    return {
        status: "SKIPPED",
        pod: podName,
        reason: "Pod is currently healthy"
    };
}

    /*
     * Record remediation time BEFORE
     * calling Kubernetes.
     */
    lastRemediation.set(
        podName,
        Date.now()
    );

const result = await restartPod(podName);

console.log(
    `[AI REMEDIATOR] Restart requested for ${podName}`
);

const recovery =
    await waitForRecovery({
        removedPod: podName,
        timeoutMs: 60000,
        intervalMs: 5000
    });

return {
    status: recovery.status === "RECOVERED"
        ? "RECOVERED"
        : "RECOVERY_TIMEOUT",

    pod: podName,

    action: "RESTART",

    result,

    recovery
};
}