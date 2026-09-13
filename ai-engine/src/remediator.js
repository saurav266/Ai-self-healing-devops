import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import {
    getPodHealth,
    restartPod,
    waitForRecovery,
    waitForRollbackRecovery,
    waitForDeploymentRecovery
} from "./kubernetes.js";

import {
    rollbackToPreviousVersion
} from "./gitops.js";

import {
    startRollback,
    finishRollback,
    isRemediationInProgress,
    startRemediation,
    finishRemediation
} from "./state.js";

const COOLDOWN_MS = Number(
    process.env.REMEDIATION_COOLDOWN_MS || 60000
);

const lastRemediation = new Map();

export async function remediate(podName, action) {
    if (!podName) {
        throw new Error("Pod name is required");
    }

    if (
        action !== "RESTART" &&
        action !== "ANSIBLE_RESTART"
    ) {
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

   

if (pod.ready ) {
    return {
        status: "SKIPPED",
        pod: podName,
        reason: "Pod is currently healthy"
    };
}
if (isRemediationInProgress(podName)) {
    return {
        status: "SKIPPED",
        pod: podName,
        reason: "Remediation already in progress"
    };
}

if (!startRemediation(podName)) {
    return {
        status: "SKIPPED",
        pod: podName,
        reason: "Unable to acquire remediation lock"
    };
}


    // --------------------------------------------------
    // 4. Record remediation time
    // --------------------------------------------------

    // --------------------------------------------------
// 4. Record remediation time
// --------------------------------------------------

lastRemediation.set(
    podName,
    Date.now()
);
    try {

    // --------------------------------------------------
    // 5. Ansible remediation
    // --------------------------------------------------

    if (action === "ANSIBLE_RESTART") {
    console.log(
        `[AI REMEDIATOR] Using Ansible remediation for ${podName}`
    );

    try {
        const result =
            await runAnsibleRestart();

        console.log(
            `[AI REMEDIATOR] Waiting for Ansible deployment recovery`
        );

        const recovery =
            await waitForDeploymentRecovery({
                timeoutMs: 120000,
                intervalMs: 5000
            });

        if (recovery.status === "RECOVERED") {
            return {
                status: "RECOVERED",
                pod: podName,
                action: "ANSIBLE_RESTART",
                result,
                recovery
            };
        }

        console.log(
            `[AI REMEDIATOR] Ansible recovery failed`
        );

    } catch (error) {
        console.log(
            `[AI REMEDIATOR] Ansible remediation failed: ${error.message}`
        );
    }

    // --------------------------------------------------
    // Escalate persistent failure to GitOps rollback
    // --------------------------------------------------

    console.log(
        `[AI REMEDIATOR] Escalating to GitOps rollback`
    );

    const rollbackPreview =
        await rollbackToPreviousVersion();

    if (
        rollbackPreview.status !==
        "ROLLBACK_REQUESTED"
    ) {
        return {
            status: "ROLLBACK_FAILED",
            pod: podName,
            action: "ANSIBLE_THEN_ROLLBACK",
            rollback: rollbackPreview
        };
    }

    const previousImage =
        rollbackPreview.previousImage;

    if (!previousImage) {
        return {
            status: "ROLLBACK_FAILED",
            pod: podName,
            action: "ANSIBLE_THEN_ROLLBACK",
            rollback: rollbackPreview,
            reason: "Previous image was not found"
        };
    }

    const rollbackAllowed =
        startRollback(previousImage);

    if (!rollbackAllowed) {
        return {
            status: "ROLLBACK_BLOCKED",
            pod: podName,
            action: "ESCALATE",
            reason:
                "Rollback already in progress or same image was already rolled back",
            rollback: rollbackPreview
        };
    }

    try {
        console.log(
            `[AI REMEDIATOR] Rollback target: ${previousImage}`
        );

        const rollbackRecovery =
            await waitForRollbackRecovery({
                expectedImage: previousImage,
                timeoutMs: 120000,
                intervalMs: 5000
            });

        const rollbackSucceeded =
            rollbackRecovery.status ===
            "ROLLBACK_RECOVERED";

        finishRollback(
            rollbackSucceeded,
            previousImage
        );

        return {
            status:
                rollbackSucceeded
                    ? "ROLLBACK_RECOVERED"
                    : "ROLLBACK_FAILED",

            pod: podName,

            action: "ANSIBLE_THEN_ROLLBACK",

            rollback: rollbackPreview,

            rollbackRecovery
        };

    } catch (error) {

        finishRollback(false);

        throw error;
    }
}

    // --------------------------------------------------
    // 6. Normal pod restart
    // --------------------------------------------------

    const result =
        await restartPod(podName);

    // --------------------------------------------------
    // 7. Wait for Kubernetes recovery
    // --------------------------------------------------

    const recovery =
        await waitForRecovery({
            removedPod: podName,
            timeoutMs: 60000,
            intervalMs: 5000
        });

    // --------------------------------------------------
    // 8. Recovery successful
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
    // 9. Persistent failure
    // --------------------------------------------------

    console.log(
        `[AI REMEDIATOR] Persistent failure detected for ${podName}`
    );

    console.log(
        `[AI REMEDIATOR] Starting GitOps rollback`
    );

    const rollbackPreview =
        await rollbackToPreviousVersion();

    if (
        rollbackPreview.status !==
        "ROLLBACK_REQUESTED"
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

    const previousImage =
        rollbackPreview.previousImage;

    if (!previousImage) {
        return {
            status: "ROLLBACK_FAILED",
            pod: podName,
            action: "RESTART_THEN_ROLLBACK",
            result,
            recovery,
            rollback: rollbackPreview,
            reason: "Previous image was not found"
        };
    }

    const rollbackAllowed =
        startRollback(previousImage);

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

        try {
        console.log(
            `[AI REMEDIATOR] Rollback target: ${previousImage}`
        );

        console.log(
            `[AI REMEDIATOR] Waiting for Kubernetes rollback recovery`
        );

        const rollbackRecovery =
            await waitForRollbackRecovery({
                expectedImage: previousImage,
                timeoutMs: 120000,
                intervalMs: 5000
            });

        console.log(
            "[AI REMEDIATOR] Rollback recovery:",
            rollbackRecovery
        );

        const rollbackSucceeded =
            rollbackRecovery.status ===
            "ROLLBACK_RECOVERED";

        finishRollback(
            rollbackSucceeded,
            previousImage
        );

        return {
            status:
                rollbackSucceeded
                    ? "ROLLBACK_RECOVERED"
                    : "ROLLBACK_FAILED",

            pod: podName,

            action: "RESTART_THEN_ROLLBACK",

            result,

            recovery,

            rollback: rollbackPreview,

            rollbackRecovery
        };

    } catch (error) {

        finishRollback(false);

        throw error;
    }

} finally {

    // Always release the remediation lock
    finishRemediation(podName);

}
}

async function runAnsibleRestart() {
    const projectDir =
        process.env.PROJECT_DIR ||
        "D:/Deveops_Project/Ai-self-healing-devops";

    const command = "docker";

    const args = [
        "run",
        "--rm",

        "-v",
        `${projectDir}/ansible:/ansible:ro`,

        "-v",
        `${process.env.USERPROFILE}/.kube:/root/.kube:ro`,

        "self-healing-ansible:1.2",

        "ansible-playbook",

        "-i",
        "/ansible/inventory.ini",

        "/ansible/restart-app.yml"
    ];

    const { stdout, stderr } =
        await execFileAsync(
            command,
            args,
            {
                windowsHide: true,
                maxBuffer: 10 * 1024 * 1024
            }
        );

    return {
        status: "ANSIBLE_COMPLETED",
        stdout,
        stderr
    };
}