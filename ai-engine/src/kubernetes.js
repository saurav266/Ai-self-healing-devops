import * as k8s from "@kubernetes/client-node";

const kc = new k8s.KubeConfig();

// Load ~/.kube/config
kc.loadFromDefault();

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const autoscalingApi = kc.makeApiClient(k8s.AutoscalingV2Api);

const NAMESPACE = process.env.K8S_NAMESPACE || "self-healing";
const DEPLOYMENT = process.env.K8S_DEPLOYMENT || "self-healing-node-app";

export async function getPodHealth() {
    const response = await coreApi.listNamespacedPod({
        namespace: NAMESPACE,
        labelSelector: `app=${DEPLOYMENT}`
    });

    return response.items.map((pod) => {
        const containerStatuses =
            pod.status?.containerStatuses || [];

        const restartCount =
            containerStatuses.reduce(
                (total, container) =>
                    total + (container.restartCount || 0),
                0
            );

        const ready =
            containerStatuses.some(
                (container) => container.ready === true
            );

        const containerState =
            containerStatuses[0]?.state || {};

        let state = "UNKNOWN";
        let reason = "";

        if (containerState.running) {
            state = "RUNNING";
        } else if (containerState.waiting) {
            state = "WAITING";
            reason =
                containerState.waiting.reason || "";
        } else if (containerState.terminated) {
            state = "TERMINATED";
            reason =
                containerState.terminated.reason || "";
        }

        return {
            pod: pod.metadata?.name,
            ready,
            restartCount,
            phase: pod.status?.phase || "Unknown",
            state,
            reason
        };
    });
}

export async function getHpaStatus() {
    const response = await autoscalingApi.readNamespacedHorizontalPodAutoscaler({
        name: "self-healing-node-hpa",
        namespace: NAMESPACE
    });

    const hpa = response;

    return {
        currentReplicas: hpa.status?.currentReplicas || 0,
        desiredReplicas: hpa.status?.desiredReplicas || 0,
        maxReplicas: hpa.spec?.maxReplicas || 0,
        minReplicas: hpa.spec?.minReplicas || 0
    };
}
export async function restartPod(podName) {
    if (!podName) {
        throw new Error("Pod name is required");
    }

    await coreApi.deleteNamespacedPod({
        name: podName,
        namespace: NAMESPACE
    });

    return {
        pod: podName,
        action: "RESTART",
        status: "DELETE_REQUESTED"
    };
}
export async function getDeploymentStatus() {
    const response =
        await appsApi.readNamespacedDeployment({
            name: DEPLOYMENT,
            namespace: NAMESPACE
        });

    const deployment = response;

    return {
        desiredReplicas:
            deployment.spec?.replicas || 0,

        readyReplicas:
            deployment.status?.readyReplicas || 0,

        availableReplicas:
            deployment.status?.availableReplicas || 0,

        updatedReplicas:
            deployment.status?.updatedReplicas || 0
    };
}
export async function waitForRecovery({
    removedPod,
    timeoutMs = 60000,
    intervalMs = 5000
} = {}) {

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {

        const [
            pods,
            deployment
        ] = await Promise.all([
            getPodHealth(),
            getDeploymentStatus()
        ]);

        const originalPodExists =
            pods.some(
                pod => pod.pod === removedPod
            );

        const readyPods =
            pods.filter(
                pod => pod.ready
            );

        const recovered =
            !originalPodExists &&
            deployment.readyReplicas >=
                deployment.desiredReplicas;

        if (recovered) {

            return {
                status: "RECOVERED",

                removedPod,

                recoveryTimeSeconds:
                    Number(
                        (
                            (Date.now() - startTime) /
                            1000
                        ).toFixed(2)
                    ),

                readyReplicas:
                    deployment.readyReplicas,

                desiredReplicas:
                    deployment.desiredReplicas,

                readyPods:
                    readyPods.map(
                        pod => pod.pod
                    )
            };
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    intervalMs
                )
        );
    }

    const finalStatus =
        await getDeploymentStatus();

    return {
        status: "TIMEOUT",

        removedPod,

        recoveryTimeSeconds:
            Number(
                (
                    (Date.now() - startTime) /
                    1000
                ).toFixed(2)
            ),

        readyReplicas:
            finalStatus.readyReplicas,

        desiredReplicas:
            finalStatus.desiredReplicas
    };
}
export async function rollbackDeployment() {
    if (!DEPLOYMENT) {
        throw new Error("Deployment name is required");
    }

    const response =
        await appsApi.createNamespacedDeploymentRollback({
            name: DEPLOYMENT,
            namespace: NAMESPACE
        });

    return {
        deployment: DEPLOYMENT,
        action: "ROLLBACK",
        status: "ROLLBACK_REQUESTED",
        result: response
    };
}
export async function getDeploymentHistory() {
    const response =
        await appsApi.readNamespacedDeployment({
            name: DEPLOYMENT,
            namespace: NAMESPACE
        });

    const deployment = response;

    const revision =
        deployment.metadata?.annotations?.[
            "deployment.kubernetes.io/revision"
        ] || "0";

    return {
        currentRevision: Number(revision),
        deployment: DEPLOYMENT
    };
}
export async function getPreviousDeploymentRevision() {
    const response =
        await appsApi.readNamespacedDeployment({
            name: DEPLOYMENT,
            namespace: NAMESPACE
        });

    const deployment = response;

    const currentRevision = Number(
        deployment.metadata?.annotations?.[
            "deployment.kubernetes.io/revision"
        ] || 0
    );

    if (currentRevision <= 1) {
        return null;
    }

    const replicaSetsResponse =
        await appsApi.listNamespacedReplicaSet({
            namespace: NAMESPACE,
            labelSelector: `app=${DEPLOYMENT}`
        });

    const replicaSets =
        replicaSetsResponse.items;

    const revisions = replicaSets
        .map((rs) => {
            const revision = Number(
                rs.metadata?.annotations?.[
                    "deployment.kubernetes.io/revision"
                ] || 0
            );

            const image =
                rs.spec?.template?.spec?.containers?.[0]?.image;

            return {
                revision,
                image,
                name: rs.metadata?.name
            };
        })
        .filter(
            (item) =>
                item.revision > 0 &&
                item.image
        )
        .sort(
            (a, b) =>
                b.revision - a.revision
        );

    const previous =
        revisions.find(
            (item) =>
                item.revision < currentRevision
        );

    return previous || null;
}
export async function waitForDeploymentRecovery({
    timeoutMs = 180000,
    intervalMs = 5000
} = {}) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response =
                await appsApi.readNamespacedDeployment({
                    name: DEPLOYMENT,
                    namespace: NAMESPACE
                });

            const deployment = response;

            const desiredReplicas =
                deployment.spec?.replicas || 0;

            const readyReplicas =
                deployment.status?.readyReplicas || 0;

            const availableReplicas =
                deployment.status?.availableReplicas || 0;

            const updatedReplicas =
                deployment.status?.updatedReplicas || 0;

            const recovered =
                readyReplicas >= desiredReplicas &&
                availableReplicas >= desiredReplicas &&
                updatedReplicas >= desiredReplicas;

            if (recovered) {
                return {
                    status: "RECOVERED",

                    desiredReplicas,

                    readyReplicas,

                    availableReplicas,

                    updatedReplicas,

                    recoveryTimeSeconds:
                        Number(
                            (
                                (Date.now() - startTime) /
                                1000
                            ).toFixed(2)
                        )
                };
            }

        } catch (error) {
            console.log(
                `[AI RECOVERY] ${error.message}`
            );
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    intervalMs
                )
        );
    }

    const response =
        await appsApi.readNamespacedDeployment({
            name: DEPLOYMENT,
            namespace: NAMESPACE
        });

    const deployment = response;

    return {
        status: "TIMEOUT",

        desiredReplicas:
            deployment.spec?.replicas || 0,

        readyReplicas:
            deployment.status?.readyReplicas || 0,

        availableReplicas:
            deployment.status?.availableReplicas || 0,

        updatedReplicas:
            deployment.status?.updatedReplicas || 0,

        recoveryTimeSeconds:
            Number(
                (
                    (Date.now() - startTime) /
                    1000
                ).toFixed(2)
            )
    };
}
export async function waitForRollbackRecovery({
    expectedImage,
    timeoutMs = 180000,
    intervalMs = 5000
} = {}) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const deploymentResponse =
                await appsApi.readNamespacedDeployment({
                    name: DEPLOYMENT,
                    namespace: NAMESPACE
                });

            const deployment =
                deploymentResponse;

            const desiredReplicas =
                deployment.spec?.replicas || 0;

            const readyReplicas =
                deployment.status?.readyReplicas || 0;

            const availableReplicas =
                deployment.status?.availableReplicas || 0;

            const updatedReplicas =
                deployment.status?.updatedReplicas || 0;

            const unavailableReplicas =
                deployment.status?.unavailableReplicas || 0;

            const actualImage =
                deployment.spec?.template?.spec
                    ?.containers?.[0]?.image;

            const actualCommand =
                deployment.spec?.template?.spec
                    ?.containers?.[0]?.command;

            const imageMatches =
                actualImage === expectedImage;

            const rolloutComplete =
                updatedReplicas >= desiredReplicas &&
                readyReplicas >= desiredReplicas &&
                availableReplicas >= desiredReplicas &&
                unavailableReplicas === 0;

            const commandIsClean =
                !actualCommand ||
                actualCommand.length === 0;

            const recovered =
                imageMatches &&
                rolloutComplete &&
                commandIsClean;

            if (recovered) {
                return {
                    status: "ROLLBACK_RECOVERED",

                    image: actualImage,

                    desiredReplicas,

                    updatedReplicas,

                    readyReplicas,

                    availableReplicas,

                    unavailableReplicas,

                    command: actualCommand || null,

                    recoveryTimeSeconds:
                        Number(
                            (
                                (Date.now() - startTime) /
                                1000
                            ).toFixed(2)
                        )
                };
            }

        } catch (error) {
            console.log(
                `[AI ROLLBACK RECOVERY] ${error.message}`
            );
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    intervalMs
                )
        );
    }

    const deploymentResponse =
        await appsApi.readNamespacedDeployment({
            name: DEPLOYMENT,
            namespace: NAMESPACE
        });

    const deployment =
        deploymentResponse;

    return {
        status: "ROLLBACK_TIMEOUT",

        image:
            deployment.spec?.template?.spec
                ?.containers?.[0]?.image,

        desiredReplicas:
            deployment.spec?.replicas || 0,

        updatedReplicas:
            deployment.status?.updatedReplicas || 0,

        readyReplicas:
            deployment.status?.readyReplicas || 0,

        availableReplicas:
            deployment.status?.availableReplicas || 0,

        unavailableReplicas:
            deployment.status?.unavailableReplicas || 0,

        command:
            deployment.spec?.template?.spec
                ?.containers?.[0]?.command || null,

        recoveryTimeSeconds:
            Number(
                (
                    (Date.now() - startTime) /
                    1000
                ).toFixed(2)
            )
    };
}

