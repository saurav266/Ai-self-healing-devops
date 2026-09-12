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

    let result;
if (action === "ANSIBLE_RESTART") {
    console.log(
        `[AI REMEDIATOR] Using Ansible remediation for ${podName}`
    );

    result = await runAnsibleRestart();

    console.log(
        `[AI REMEDIATOR] Waiting for Ansible deployment recovery`
    );

    const recovery =
        await waitForDeploymentRecovery({
            timeoutMs: 120000,
            intervalMs: 5000
        });

    return {
        status:
            recovery.status === "RECOVERED"
                ? "RECOVERED"
                : "RECOVERY_TIMEOUT",

        pod: podName,

        action: "ANSIBLE_RESTART",

        result,

        recovery
    };
}

    // --------------------------------------------------
    // 6. Wait for Kubernetes recovery
    // --------------------------------------------------
result = await restartPod(podName);
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
// 9. Protect against rollback loops
// --------------------------------------------------

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

    // --------------------------------------------------
    // 10. Wait for Argo CD → Kubernetes synchronization
    // --------------------------------------------------

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

    return {
        status:
            rollbackRecovery.status === "ROLLBACK_RECOVERED"
                ? "ROLLBACK_RECOVERED"
                : "ROLLBACK_FAILED",

        pod: podName,

        action: "RESTART_THEN_ROLLBACK",

        result,

        recovery,

        rollback: rollbackPreview,

        rollbackRecovery
    };

} finally {
    finishRollback();
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

        "self-healing-ansible:1.1",

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