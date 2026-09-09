import {
    getPodHealth,
    restartPod,
    waitForRecovery,
    waitForRollbackRecovery
} from "./kubernetes.js";

import {
    rollbackToPreviousVersion
} from "./gitops.js";

import {
    startRollback,
    finishRollback
} from "./state.js";

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

    // --------------------------------------------------
    // 1. Cooldown protection
    // --------------------------------------------------

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

    // --------------------------------------------------
    // 2. Verify pod still exists
    // --------------------------------------------------

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

    // --------------------------------------------------
    // 3. Don't restart a healthy pod
    // --------------------------------------------------

    if (pod.ready) {
        return {
            status: "SKIPPED",
            pod: podName,
            reason: "Pod is currently healthy"
        };
    }

    // --------------------------------------------------
    // 4. Record remediation time
    // --------------------------------------------------

    lastRemediation.set(
        podName,
        Date.now()
    );

    // --------------------------------------------------
    // 5. Restart pod
    // --------------------------------------------------

    const result = await restartPod(podName);

    console.log(
        `[AI REMEDIATOR] Restart requested for ${podName}`
    );

    // --------------------------------------------------
    // 6. Wait for Kubernetes recovery
    // --------------------------------------------------

    const recovery =
        await waitForRecovery({
            removedPod: podName,
            timeoutMs: 60000,
            intervalMs: 5000
        });

    // --------------------------------------------------
    // 7. Recovery successful
    // --------------------------------------------------

    if (recovery.status === "RECOVERED") {
        console.log(
            `[AI REMEDIATOR] Recovery successful for ${podName}`
        );

        return {
            status: "RECOVERED",
            pod: podName,
            action: "RESTART",
            result,
            recovery
        };
    }

    // --------------------------------------------------
    // 8. Persistent failure detected
    // --------------------------------------------------

    console.log(
        `[AI REMEDIATOR] Persistent failure detected for ${podName}`
    );

    console.log(
        `[AI REMEDIATOR] Starting GitOps rollback`
    );

    // --------------------------------------------------
    // 9. Roll back to previous deployment version
    // --------------------------------------------------
    const rollbackPreview =
        await rollbackToPreviousVersion();

    if (
        !rollbackPreview.previousImage
    ) {
        return {
            status: "ROLLBACK_FAILED",
            pod: podName,
            action: "RESTART_THEN_ROLLBACK",
            result,
            recovery,
            rollback: rollbackPreview
        };
    }

    const rollbackAllowed =
        startRollback(
            rollbackPreview.previousImage
        );

    if (!rollbackAllowed) {
        console.log(
            `[AI REMEDIATOR] Rollback blocked to prevent rollback loop`
        );

        return {
            status: "ROLLBACK_BLOCKED",
            pod: podName,
            action: "ESCALATE",
            reason:
                "Rollback already in progress or same image was already rolled back",
            result,
            recovery,
            rollback: rollbackPreview
        };
    }

    let rollback;

    try {
        rollback =
            rollbackPreview;

        console.log(
            `[AI REMEDIATOR] Rollback target: ${rollback.previousImage}`
        );

        console.log(
            `[AI REMEDIATOR] Waiting for Kubernetes rollback recovery`
        );

        const rollbackRecovery =
            await waitForRollbackRecovery({
                expectedImage:
                    rollback.previousImage,
                timeoutMs: 120000,
                intervalMs: 5000
            });

        console.log(
            "[AI REMEDIATOR] Rollback recovery:",
            rollbackRecovery
        );

        return {
            status:
                rollbackRecovery.status ===
                "ROLLBACK_RECOVERED"
                    ? "ROLLBACK_RECOVERED"
                    : "ROLLBACK_FAILED",

            pod: podName,

            action: "RESTART_THEN_ROLLBACK",

            result,

            recovery,

            rollback,

            rollbackRecovery
        };
    } finally {
        finishRollback();
    }
}
